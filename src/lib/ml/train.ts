import { eq } from "drizzle-orm";
import { db } from "@/db";
import { academicOutcomes, modelVersions } from "@/db/schema";
import { getSettings, type Settings } from "@/lib/settings";
import { ApiError } from "@/lib/http";
import { round } from "@/lib/utils";
import { FEATURE_KEYS, buildFeatures, toVector, type FeatureValues } from "./features";
import {
  classificationMetrics,
  bestThresholdForFbeta,
  fitGaussianNB,
  fitLogistic,
  fitPreprocessor,
  mean,
  permutationImportance,
  rocAuc,
  scoreModel,
  std,
  stratifiedFolds,
  stratifiedSplit,
  transform,
  type ModelParams,
  type Preprocessor,
  type Vec,
} from "./logistic";
import { ruleScreen } from "./rules";

export const LAMBDA_GRID = [0.0001, 0.001, 0.01, 0.1, 1];
export const NB_SMOOTHING = 0.05;
export const MODEL_SEED = 42;
export const DEMO_MODEL_NOTE =
  "DEMONSTRATION MODEL: trained on synthetic outcome labels. Metrics show pipeline behaviour only and do not establish real-world predictive validity. Retrain with validated institutional outcome labels before operational use.";

export type StoredModelParams = {
  model: ModelParams;
  preprocess: Preprocessor;
  permutationImportance: { feature: string; importance: number }[];
};

type Candidate = { name: string; threshold: number; pooledF2: number; pooledRecall: number; pooledPrecision: number; pooledFpr: number; meanFoldAuc: number | null };

function crossValidate(
  X: Vec[],
  y: number[],
  folds: number[][],
  fit: (Xa: Vec[], ya: number[], Xb: Vec[]) => number[],
) {
  const oof = new Array(y.length).fill(0);
  const foldAucs: number[] = [];
  for (const testIdx of folds) {
    const testSet = new Set(testIdx);
    const trainIdx = y.map((_, i) => i).filter((i) => !testSet.has(i));
    const scores = fit(
      trainIdx.map((i) => X[i]),
      trainIdx.map((i) => y[i]),
      testIdx.map((i) => X[i]),
    );
    testIdx.forEach((idx, k) => {
      oof[idx] = scores[k];
    });
    const auc = rocAuc(testIdx.map((i) => y[i]), scores);
    if (auc !== null) foldAucs.push(auc);
  }
  return { oof, foldAucs };
}

function summarizeCv(name: string, y: number[], oof: number[], foldAucs: number[]): Candidate {
  const best = bestThresholdForFbeta(y, oof, 2);
  const m = classificationMetrics(y, oof, best.threshold);
  return {
    name,
    threshold: best.threshold,
    pooledF2: m.f2,
    pooledRecall: m.recall,
    pooledPrecision: m.precision,
    pooledFpr: m.falsePositiveRate,
    meanFoldAuc: foldAucs.length ? round(mean(foldAucs), 4) : null,
  };
}

function buildDataQuality(
  rows: { values: FeatureValues; y: number; source: string }[],
) {
  const n = rows.length;
  const missingRateByFeature: Record<string, number> = {};
  const outlierCountByFeature: Record<string, number> = {};
  for (const key of FEATURE_KEYS) {
    const vals = rows.map((r) => r.values[key]).filter((v): v is number => v !== null && v !== undefined);
    missingRateByFeature[key] = round((n - vals.length) / Math.max(n, 1), 3);
    const m = mean(vals);
    const s = std(vals) || 1;
    outlierCountByFeature[key] = vals.filter((v) => Math.abs((v - m) / s) > 3).length;
  }
  const signatures = rows.map((r) => JSON.stringify([FEATURE_KEYS.map((k) => r.values[k] ?? null), r.y]));
  const duplicateFeatureRows = signatures.length - new Set(signatures).size;
  const positives = rows.filter((r) => r.y === 1).length;
  const labelSources: Record<string, number> = {};
  for (const r of rows) labelSources[r.source] = (labelSources[r.source] ?? 0) + 1;
  return {
    records: n,
    positives,
    negatives: n - positives,
    positiveRate: round(positives / Math.max(n, 1), 3),
    missingRateByFeature,
    outlierCountByFeature,
    duplicateFeatureRows,
    labelSources,
    imbalanceHandling: "Class-balanced loss weights: n / (2 * n_class). Preprocessing fitted on training split only.",
    duplicatePolicy: "Duplicate feature rows are reported, not removed, because each row is a distinct student record.",
    outlierPolicy: "Outliers (|z| > 3) are reported for inspection and retained; no values were clipped.",
  };
}

export async function getActiveModel() {
  const [row] = await db.select().from(modelVersions).where(eq(modelVersions.isActive, true)).limit(1);
  return row ?? null;
}

/**
 * Trains and compares Logistic Regression and Gaussian Naive Bayes against the rule-based baseline,
 * selects the model with the best cross-validated F2 (recall-weighted) on the TRAINING split,
 * evaluates once on the held-out test split, and stores the model as the active version.
 */
export async function trainRiskModel(userId: number | null, notes?: string, settingsOverride?: Settings) {
  const settings = settingsOverride ?? (await getSettings());
  const outcomes = await db.select().from(academicOutcomes);
  const labels = new Map<number, { y: number; source: string }>();
  for (const o of outcomes) {
    const current = labels.get(o.studentId);
    if (!current || o.source === "institutional") {
      labels.set(o.studentId, { y: o.outcome === "at_risk" ? 1 : 0, source: o.source });
    }
  }
  const ids = [...labels.keys()].sort((a, b) => a - b);
  if (ids.length < 60) {
    throw new ApiError(400, "At least 60 labelled student records are required. Load the synthetic demo dataset or import outcome labels first.");
  }

  const feats = await buildFeatures(ids, settings.passPercentage);
  const rows = ids
    .filter((id) => feats.has(id))
    .map((id) => ({
      id,
      values: feats.get(id)!.values,
      x: toVector(feats.get(id)!.values),
      y: labels.get(id)!.y,
      source: labels.get(id)!.source,
    }));
  const y = rows.map((r) => r.y);
  const X = rows.map((r) => r.x);
  const positives = y.filter((v) => v === 1).length;
  if (positives < 10 || rows.length - positives < 10) {
    throw new ApiError(400, "At least 10 at-risk and 10 on-track labelled examples are required to train the model.");
  }

  const dataQuality = buildDataQuality(rows);

  // 1. Stratified 80/20 split. The test split is not used for any selection decision.
  const split = stratifiedSplit(y, 0.2, MODEL_SEED);
  const Xtr = split.train.map((i) => X[i]);
  const ytr = split.train.map((i) => y[i]);
  const Xte = split.test.map((i) => X[i]);
  const yte = split.test.map((i) => y[i]);

  // 2. Hyperparameter search with stratified 5-fold CV inside the training split.
  const folds = stratifiedFolds(ytr, 5, MODEL_SEED);
  const lrRuns = LAMBDA_GRID.map((lambda) => {
    const cv = crossValidate(Xtr, ytr, folds, (Xa, ya, Xb) => {
      const p = fitPreprocessor(Xa);
      const fitted = fitLogistic(transform(Xa, p), ya, lambda);
      return scoreModel({ type: "logistic", ...fitted, lambda }, transform(Xb, p));
    });
    return { lambda, cv, summary: summarizeCv(`logistic_lambda_${lambda}`, ytr, cv.oof, cv.foldAucs) };
  });
  const bestLr = lrRuns.reduce((a, b) => (b.summary.pooledF2 > a.summary.pooledF2 ? b : a));

  const nbCv = crossValidate(Xtr, ytr, folds, (Xa, ya, Xb) => {
    const p = fitPreprocessor(Xa);
    return scoreModel(fitGaussianNB(transform(Xa, p), ya, NB_SMOOTHING), transform(Xb, p));
  });
  const nbSummary = summarizeCv("gaussian_naive_bayes", ytr, nbCv.oof, nbCv.foldAucs);

  // 3. Model selection uses validation (CV) F2 only.
  const selectedAlgorithm = bestLr.summary.pooledF2 >= nbSummary.pooledF2 ? "logistic_regression" : "gaussian_naive_bayes";

  // 4. Final fit on the full training split; preprocessing statistics come from training rows only.
  const prep = fitPreprocessor(Xtr);
  const Ztr = transform(Xtr, prep);
  const Zte = transform(Xte, prep);
  const lrFinal: ModelParams = { type: "logistic", ...fitLogistic(Ztr, ytr, bestLr.lambda), lambda: bestLr.lambda };
  const nbFinal: ModelParams = fitGaussianNB(Ztr, ytr, NB_SMOOTHING);

  const lrTestScores = scoreModel(lrFinal, Zte);
  const nbTestScores = scoreModel(nbFinal, Zte);
  const lrTest = classificationMetrics(yte, lrTestScores, bestLr.summary.threshold);
  const nbTest = classificationMetrics(yte, nbTestScores, nbSummary.threshold);

  const ruleBinary = split.test.map((i) => (ruleScreen(rows[i].values, settings).category === "low" ? 0 : 1));
  const ruleTest = classificationMetrics(yte, ruleBinary, 0.5);

  const selectedParams = selectedAlgorithm === "logistic_regression" ? lrFinal : nbFinal;
  const selectedTest = selectedAlgorithm === "logistic_regression" ? lrTest : nbTest;
  const selectedThreshold = selectedAlgorithm === "logistic_regression" ? bestLr.summary.threshold : nbSummary.threshold;
  const trainAuc = rocAuc(ytr, scoreModel(selectedParams, Ztr));
  const importance = permutationImportance(selectedParams, Zte, yte, FEATURE_KEYS, MODEL_SEED, 5);

  const comparison = [
    {
      model: "Logistic Regression (L2, class-balanced)",
      selected: selectedAlgorithm === "logistic_regression",
      selectedLambda: bestLr.lambda,
      cvPooledF2: bestLr.summary.pooledF2,
      cvPooledRecall: bestLr.summary.pooledRecall,
      cvMeanFoldAuc: bestLr.summary.meanFoldAuc,
      threshold: bestLr.summary.threshold,
      testAccuracy: lrTest.accuracy,
      testPrecision: lrTest.precision,
      testRecall: lrTest.recall,
      testF1: lrTest.f1,
      testFpr: lrTest.falsePositiveRate,
      testRocAuc: lrTest.rocAuc,
    },
    {
      model: "Gaussian Naive Bayes",
      selected: selectedAlgorithm === "gaussian_naive_bayes",
      selectedLambda: null,
      cvPooledF2: nbSummary.pooledF2,
      cvPooledRecall: nbSummary.pooledRecall,
      cvMeanFoldAuc: nbSummary.meanFoldAuc,
      threshold: nbSummary.threshold,
      testAccuracy: nbTest.accuracy,
      testPrecision: nbTest.precision,
      testRecall: nbTest.recall,
      testF1: nbTest.f1,
      testFpr: nbTest.falsePositiveRate,
      testRocAuc: nbTest.rocAuc,
    },
    {
      model: "Rule-based screening (baseline, no training)",
      selected: false,
      selectedLambda: null,
      cvPooledF2: null,
      cvPooledRecall: null,
      cvMeanFoldAuc: null,
      threshold: 0.5,
      testAccuracy: ruleTest.accuracy,
      testPrecision: ruleTest.precision,
      testRecall: ruleTest.recall,
      testF1: ruleTest.f1,
      testFpr: ruleTest.falsePositiveRate,
      testRocAuc: null,
    },
  ];

  const labelSourceSet = new Set(rows.map((r) => r.source));
  const labelSource = labelSourceSet.size > 1 ? "mixed" : labelSourceSet.has("institutional") ? "institutional" : "synthetic-demo";
  const isDemo = labelSource !== "institutional";

  await db.update(modelVersions).set({ isActive: false }).where(eq(modelVersions.isActive, true));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const params: StoredModelParams = { model: selectedParams, preprocess: prep, permutationImportance: importance };
  const [row] = await db
    .insert(modelVersions)
    .values({
      name: `risk-model-${stamp}`,
      algorithm: selectedAlgorithm,
      datasetSize: rows.length,
      positiveCount: positives,
      labelSource,
      metrics: {
        ...selectedTest,
        trainRocAuc: trainAuc === null ? null : round(trainAuc, 4),
        overfitGapAuc: trainAuc === null || selectedTest.rocAuc === null ? null : round(trainAuc - selectedTest.rocAuc, 4),
        splitSizes: { train: ytr.length, test: yte.length },
        cvFolds: 5,
        selectedThreshold,
        isDemo,
      },
      comparison,
      featureNames: FEATURE_KEYS,
      params: {
        ...(params as unknown as Record<string, unknown>),
        cvResults: lrRuns.map((r) => ({ lambda: r.lambda, ...r.summary })),
        nbCv: nbSummary,
        hyperparameterGrid: { lambda: LAMBDA_GRID, nbSmoothing: NB_SMOOTHING },
        leakageControls: [
          "Median imputation and standardisation fitted on training rows only",
          "Cross-validation refits preprocessing inside every fold",
          "End-semester results excluded from features (they define the outcome label)",
          "Test split used once for final reporting; not used for model selection",
        ],
      },
      dataQuality,
      threshold: selectedThreshold,
      isActive: true,
      notes: notes ?? (isDemo ? DEMO_MODEL_NOTE : "Trained on institutional outcome labels."),
      createdBy: userId,
    })
    .returning();
  return row;
}
