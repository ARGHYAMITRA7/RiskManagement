import { desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { riskPredictions } from "@/db/schema";
import { getSettings, type Settings } from "@/lib/settings";
import { FEATURE_KEYS, FEATURE_LABELS, buildFeatures, toVector, type FeatureValues } from "./features";
import { scoreModel, transform, type ModelParams } from "./logistic";
import { getActiveModel, type StoredModelParams } from "./train";
import { ruleScreen, type RuleResult } from "./rules";
import type { RiskCategory } from "@/lib/constants";

export const CAUSAL_NOTE =
  "Explanations describe statistical associations learned from the data (feature importance and correlation). They do not prove causes. Use them to plan support, not to judge a student.";

export function categorize(probability: number, thresholds: { low: number; high: number }): RiskCategory {
  if (probability >= thresholds.high) return "high";
  if (probability >= thresholds.low) return "medium";
  return "low";
}

/** Plain-language observation for each feature value, relative to configured targets. */
export function describeFeature(key: string, v: number, s: Settings): string {
  switch (key) {
    case "internalPct":
      return `Internal assessment average is ${v}%${v < s.passPercentage ? ", below the pass mark" : ""}.`;
    case "midPct":
      return `Mid-semester average is ${v}%${v < s.passPercentage ? ", below the pass mark" : ""}.`;
    case "prevSemesterPct":
      return `Previous semester end-exam average was ${v}%.`;
    case "attendancePct":
      return `Attendance is ${v}%, ${v < s.attendanceThresholdPct ? "below" : "meeting"} the institutional target of ${s.attendanceThresholdPct}%.`;
    case "assignmentCompletionPct":
      return `Assignment completion is ${v}%${v < 60 ? ", which requires improvement" : ""}.`;
    case "missedAssignments":
      return `${v} assignment(s) past their deadline have no submission.`;
    case "quizAvgPct":
      return `Recent practice quiz average is ${v}%, ${v < 50 ? "indicating subject weaknesses" : "showing reasonable recall"}.`;
    case "practiceCount":
      return `${v} practice quiz attempt(s) completed.`;
    case "studyHoursPerDay":
      return `Average logged study time is ${v} hours per day over the last 14 days.`;
    case "activeDays14":
      return `The learning platform was used on ${v} of the last 14 days.`;
    case "learningConsistency":
      return `Learning consistency score is ${v} (0 = highly irregular, 1 = very regular).`;
    case "subjectWeakRatio":
      return `${Math.round(v * 100)}% of current subjects are below the pass mark.`;
    default:
      return `${FEATURE_LABELS[key] ?? key}: ${v}.`;
  }
}

function suggestIntervention(factorKeys: string[], category: string): string {
  if (category === "low" && factorKeys.length === 0) return "Maintain the current routine and continue regular monitoring.";
  const map: Record<string, string> = {
    attendancePct: "Agree an attendance recovery target with the class teacher and review it weekly.",
    internalPct: "Schedule topic-level revision for the weakest subjects and a follow-up internal test.",
    midPct: "Schedule topic-level revision for the weakest subjects and a follow-up internal test.",
    prevSemesterPct: "Review foundation topics from earlier semesters with a mentor.",
    assignmentCompletionPct: "Use the study planner to clear outstanding assignments before new deadlines.",
    missedAssignments: "Use the study planner to clear outstanding assignments before new deadlines.",
    quizAvgPct: "Complete adaptive practice quizzes on weak topics several times a week.",
    practiceCount: "Complete adaptive practice quizzes on weak topics several times a week.",
    studyHoursPerDay: "Adopt a daily study routine of at least the configured goal using the study planner.",
    activeDays14: "Adopt a daily study routine of at least the configured goal using the study planner.",
    learningConsistency: "Schedule regular short study sessions rather than occasional long sessions.",
    subjectWeakRatio: "Arrange teacher-assisted revision sessions for subjects below the pass mark.",
  };
  const picks = [...new Set(factorKeys.map((k) => map[k]).filter(Boolean))].slice(0, 3);
  return picks.length ? picks.join(" ") : "Review the risk explanation with the class teacher.";
}

type Factor = { feature: string; label: string; value: number; contribution: number; text: string };

export function buildExplanation(args: {
  values: FeatureValues;
  method: "ml" | "rule_screening";
  probability: number | null;
  category: string;
  riskScore: number;
  settings: Settings;
  rule: RuleResult;
  contributions: Record<string, number> | null;
  importance: { feature: string; importance: number }[] | null;
  modelName: string | null;
  previous: { riskCategory: string; riskScore: number; predictedAt: Date } | null;
}) {
  const { values, settings, rule, contributions } = args;
  const observed = FEATURE_KEYS.filter((k) => values[k] !== null && values[k] !== undefined);
  const missing = FEATURE_KEYS.filter((k) => values[k] === null || values[k] === undefined).map((k) => FEATURE_LABELS[k]);

  const factorOf = (k: string, contribution: number): Factor => ({
    feature: k,
    label: FEATURE_LABELS[k] ?? k,
    value: values[k] as number,
    contribution: Math.round(contribution * 1000) / 1000,
    text: describeFeature(k, values[k] as number, settings),
  });

  let positive: Factor[] = [];
  let negative: Factor[] = [];
  if (contributions) {
    const entries = Object.entries(contributions).filter(([k]) => observed.includes(k));
    positive = entries
      .filter(([, c]) => c > 0.02)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, c]) => factorOf(k, c));
    negative = entries
      .filter(([, c]) => c < -0.02)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3)
      .map(([k, c]) => factorOf(k, c));
  } else {
    positive = rule.triggered.map((t) => ({
      feature: t.feature,
      label: t.label,
      value: values[t.feature] as number,
      contribution: 1,
      text: t.message,
    }));
  }

  const narrative = observed.map((k) => describeFeature(k, values[k] as number, settings));
  if (missing.length) {
    narrative.push(`No data is recorded for: ${missing.join(", ")}. These were excluded or imputed and were NOT treated as zero.`);
  }

  const previous = args.previous
    ? {
        riskCategory: args.previous.riskCategory,
        riskScore: args.previous.riskScore,
        predictedAt: args.previous.predictedAt,
        change:
          args.riskScore - args.previous.riskScore >= 5
            ? "increased"
            : args.riskScore - args.previous.riskScore <= -5
              ? "decreased"
              : "unchanged",
      }
    : null;

  const headline =
    args.method === "ml"
      ? `Model estimate: ${args.category.toUpperCase()} risk (probability ${Math.round((args.probability ?? 0) * 100)}%).`
      : `Rule-based screening: ${args.category.toUpperCase()} risk (${rule.count} indicator(s) triggered).`;

  return {
    headline,
    method: args.method,
    modelName: args.modelName,
    disclaimer:
      "This is a decision-support estimate, not a certainty. Probabilities are model outputs and can be wrong. Demonstration models trained on synthetic labels must not be used for real decisions.",
    causalNote: CAUSAL_NOTE,
    riskIncreasingFactors: positive,
    protectiveFactors: negative,
    globalImportance: args.importance?.slice(0, 6).map((i) => ({ feature: i.feature, label: FEATURE_LABELS[i.feature], importance: i.importance })) ?? null,
    ruleScreening: { category: rule.category, count: rule.count, triggered: rule.triggered },
    narrative,
    missingFeatures: missing,
    previous,
    contributionsAvailable: contributions !== null,
  };
}

export type RiskRun = { studentId: number; riskCategory: string; riskScore: number; probability: number | null; method: string };

/**
 * Scores students (all when studentIds omitted). With an active ML model the probability
 * drives the category; otherwise the transparent rule screening is used.
 * Each run is stored as a prediction record so history and trends are preserved.
 */
export async function runRiskAssessments(studentIds: number[] | undefined): Promise<{ count: number; byCategory: Record<string, number>; method: string; results: RiskRun[] }> {
  const settings = await getSettings();
  const model = await getActiveModel();
  const feats = await buildFeatures(studentIds, settings.passPercentage);
  const ids = [...feats.keys()];
  if (ids.length === 0) return { count: 0, byCategory: { low: 0, medium: 0, high: 0 }, method: "none", results: [] };

  const prevRows = await db
    .select({
      studentId: riskPredictions.studentId,
      riskCategory: riskPredictions.riskCategory,
      riskScore: riskPredictions.riskScore,
      predictedAt: riskPredictions.predictedAt,
    })
    .from(riskPredictions)
    .where(inArray(riskPredictions.studentId, ids))
    .orderBy(desc(riskPredictions.predictedAt));
  const prevMap = new Map<number, (typeof prevRows)[number]>();
  for (const r of prevRows) if (!prevMap.has(r.studentId)) prevMap.set(r.studentId, r);

  const stored = model?.params as unknown as StoredModelParams | undefined;
  const X = ids.map((id) => toVector(feats.get(id)!.values));
  let Z: number[][] | null = null;
  let probs: number[] | null = null;
  if (model && stored?.model && stored.preprocess) {
    Z = transform(X, stored.preprocess);
    probs = scoreModel(stored.model as ModelParams, Z);
  }

  const byCategory: Record<string, number> = { low: 0, medium: 0, high: 0 };
  const results: RiskRun[] = [];
  const rows = ids.map((id, i) => {
    const values = feats.get(id)!.values;
    const rule = ruleScreen(values, settings);
    const probability = probs ? probs[i] : null;
    const category = probability !== null ? categorize(probability, settings.riskThresholds) : rule.category;
    const riskScore = Math.round((probability !== null ? probability : rule.count / 8) * 100);
    const method = probability !== null ? "ml" : "rule_screening";
    let contributions: Record<string, number> | null = null;
    if (Z && stored?.model.type === "logistic") {
      contributions = {};
      FEATURE_KEYS.forEach((k, j) => {
        contributions![k] = stored.model.type === "logistic" ? stored.model.weights[j] * Z![i][j] : 0;
      });
    }
    const explanation = buildExplanation({
      values,
      method,
      probability,
      category,
      riskScore,
      settings,
      rule,
      contributions,
      importance: stored?.permutationImportance ?? null,
      modelName: model?.algorithm ?? null,
      previous: prevMap.get(id) ?? null,
    });
    const factorKeys = [
      ...explanation.riskIncreasingFactors.map((f) => f.feature),
      ...rule.triggered.map((t) => t.feature),
    ];
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    results.push({ studentId: id, riskCategory: category, riskScore, probability, method });
    return {
      studentId: id,
      modelVersionId: model?.id ?? null,
      method,
      riskCategory: category,
      ruleCategory: rule.category,
      probability: probability === null ? null : Math.round(probability * 10000) / 10000,
      riskScore,
      features: values,
      missingFeatures: FEATURE_KEYS.filter((k) => values[k] === null || values[k] === undefined),
      explanation: explanation as unknown as Record<string, unknown>,
      suggestedIntervention: suggestIntervention(factorKeys, category),
      labelSource: model?.labelSource ?? "rules-only",
      isDemo: model ? model.labelSource !== "institutional" : true,
    };
  });

  for (let i = 0; i < rows.length; i += 300) {
    await db.insert(riskPredictions).values(rows.slice(i, i + 300));
  }
  return { count: rows.length, byCategory, method: model ? "ml" : "rule_screening", results };
}
