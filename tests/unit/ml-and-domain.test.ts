import { describe, expect, it } from "vitest";
import {
  bestThresholdForFbeta,
  classificationMetrics,
  fitGaussianNB,
  fitLogistic,
  fitPreprocessor,
  mulberry32,
  permutationImportance,
  rocAuc,
  scoreModel,
  stratifiedFolds,
  stratifiedSplit,
  transform,
} from "@/lib/ml/logistic";
import { ruleScreen } from "@/lib/ml/rules";
import { categorize, describeFeature } from "@/lib/ml/predict";
import { computeMasteryUpdate, levelFor } from "@/lib/mastery";
import { parseCsv, validateStudentTable } from "@/lib/csv";
import { gradeFor, DEFAULT_SETTINGS } from "@/lib/settings";
import { hashPassword, rateLimit, validatePasswordPolicy, verifyPassword } from "@/lib/security";

/* ---------- Machine learning ---------- */

describe("stratified splitting", () => {
  const y = Array.from({ length: 200 }, (_, i) => (i % 4 === 0 ? 1 : 0)); // 25% positive

  it("keeps class proportions and produces disjoint train/test sets", () => {
    const { train, test } = stratifiedSplit(y, 0.2, 42);
    const overlap = train.filter((i) => test.includes(i));
    expect(overlap).toHaveLength(0);
    expect(train.length + test.length).toBe(200);
    const testPos = test.filter((i) => y[i] === 1).length / test.length;
    expect(Math.abs(testPos - 0.25)).toBeLessThan(0.03);
  });

  it("is deterministic for a fixed seed", () => {
    expect(stratifiedSplit(y, 0.2, 7)).toEqual(stratifiedSplit(y, 0.2, 7));
  });

  it("creates folds that cover every row exactly once", () => {
    const folds = stratifiedFolds(y, 5, 1);
    const all = folds.flat().sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });
});

describe("preprocessing (leakage control)", () => {
  it("imputes missing values with the training median, never zero", () => {
    const train = [[10], [20], [30], [null]];
    const p = fitPreprocessor(train);
    expect(p.medians[0]).toBe(20);
    const [z] = transform([[null]], p);
    expect(z[0]).toBeCloseTo((20 - p.means[0]) / p.stds[0], 10);
    expect(z[0]).not.toBeCloseTo((0 - p.means[0]) / p.stds[0], 5);
  });

  it("uses training statistics only: test rows do not change the scaler", () => {
    const train = [[1], [2], [3]];
    const p1 = fitPreprocessor(train);
    const p2 = fitPreprocessor(train);
    transform([[1000]], p1);
    expect(p1).toEqual(p2);
  });
});

describe("models and metrics", () => {
  const rand = mulberry32(3);
  const n = 300;
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const label = i < 90 ? 1 : 0; // imbalanced
    const x1 = (label ? -1 : 1) + (rand() - 0.5) * 0.8;
    const x2 = rand() * 2 - 1; // noise feature
    X.push([x1, x2]);
    y.push(label);
  }

  it("logistic regression separates an informative feature (AUC > 0.9)", () => {
    const p = fitPreprocessor(X);
    const Z = transform(X, p);
    const m = fitLogistic(Z, y, 0.001);
    const scores = scoreModel({ type: "logistic", ...m, lambda: 0.001 }, Z);
    expect(rocAuc(y, scores)).toBeGreaterThan(0.9);
  });

  it("naive Bayes also learns the signal", () => {
    const Z = transform(X, fitPreprocessor(X));
    const nb = fitGaussianNB(Z, y, 0.05);
    expect(rocAuc(y, scoreModel(nb, Z))).toBeGreaterThan(0.9);
  });

  it("permutation importance ranks the informative feature above noise", () => {
    const Z = transform(X, fitPreprocessor(X));
    const m = fitLogistic(Z, y, 0.001);
    const imp = permutationImportance({ type: "logistic", ...m, lambda: 0.001 }, Z, y, ["signal", "noise"], 7, 3);
    expect(imp[0].feature).toBe("signal");
  });

  it("ROC-AUC is exact for perfect, reversed and tied scores", () => {
    expect(rocAuc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9])).toBe(1);
    expect(rocAuc([0, 0, 1, 1], [0.9, 0.8, 0.2, 0.1])).toBe(0);
    expect(rocAuc([0, 1], [0.5, 0.5])).toBe(0.5);
    expect(rocAuc([1, 1], [0.5, 0.6])).toBeNull();
  });

  it("confusion matrix and recall are computed correctly", () => {
    const m = classificationMetrics([1, 1, 0, 0, 1], [0.9, 0.2, 0.1, 0.7, 0.8], 0.5);
    expect(m.confusionMatrix).toEqual({ tp: 2, fp: 1, tn: 1, fn: 1 });
    expect(m.recall).toBeCloseTo(2 / 3, 3);
    expect(m.falsePositiveRate).toBeCloseTo(1 / 2, 3);
  });

  it("threshold search for F2 returns a value inside the valid range", () => {
    const t = bestThresholdForFbeta(y, X.map((r) => (r[0] < 0 ? 0.8 : 0.2)), 2).threshold;
    expect(t).toBeGreaterThanOrEqual(0.05);
    expect(t).toBeLessThanOrEqual(0.95);
  });
});

describe("rule-based screening and risk categories", () => {
  it("counts triggered indicators into low, medium and high categories", () => {
    const low = ruleScreen({ attendancePct: 90, internalPct: 75, midPct: 70, assignmentCompletionPct: 95, missedAssignments: 0, quizAvgPct: 80, studyHoursPerDay: 2, activeDays14: 10, subjectWeakRatio: 0 }, DEFAULT_SETTINGS);
    expect(low.category).toBe("low");
    const high = ruleScreen({ attendancePct: 50, internalPct: 30, midPct: 35, assignmentCompletionPct: 20, missedAssignments: 4, quizAvgPct: 20, studyHoursPerDay: 0.2, activeDays14: 1, subjectWeakRatio: 1 }, DEFAULT_SETTINGS);
    expect(high.category).toBe("high");
  });

  it("missing indicators do not count as triggered (not treated as zero)", () => {
    const r = ruleScreen({ attendancePct: null, quizAvgPct: null, studyHoursPerDay: null }, DEFAULT_SETTINGS);
    expect(r.count).toBe(0);
    expect(r.category).toBe("low");
  });

  it("categorises probabilities using configured thresholds", () => {
    const t = { low: 0.35, high: 0.6 };
    expect(categorize(0.2, t)).toBe("low");
    expect(categorize(0.5, t)).toBe("medium");
    expect(categorize(0.7, t)).toBe("high");
  });

  it("describes missing and observed values in plain language", () => {
    expect(describeFeature("attendancePct", 56, DEFAULT_SETTINGS)).toContain("below the institutional target");
  });
});

/* ---------- Academic rules ---------- */

describe("grading and mastery", () => {
  it("maps percentages to grades on the configured scale", () => {
    expect(gradeFor(91, DEFAULT_SETTINGS.gradingScale).grade).toBe("O");
    expect(gradeFor(40, DEFAULT_SETTINGS.gradingScale).grade).toBe("C");
    expect(gradeFor(39.9, DEFAULT_SETTINGS.gradingScale).grade).toBe("F");
  });

  it("requires minimum evidence before Proficient or Strong", () => {
    expect(levelFor(0.95, 3, DEFAULT_SETTINGS.masteryThresholds)).toBe("developing");
    expect(levelFor(0.95, 10, DEFAULT_SETTINGS.masteryThresholds)).toBe("strong");
    expect(levelFor(0.3, 10, DEFAULT_SETTINGS.masteryThresholds)).toBe("needs_improvement");
  });

  it("updates mastery with evidence, history and trend", () => {
    const first = computeMasteryUpdate(null, { attempted: 3, correct: 1 }, DEFAULT_SETTINGS.masteryThresholds, "2026-01-01");
    expect(first?.masteryScore).toBeCloseTo(1 / 3, 3);
    const second = computeMasteryUpdate(first, { attempted: 3, correct: 3 }, DEFAULT_SETTINGS.masteryThresholds, "2026-01-02");
    expect(second?.attempted).toBe(6);
    expect(second?.trend).toBe("improving");
    expect(computeMasteryUpdate(second, { attempted: 0, correct: 0 }, DEFAULT_SETTINGS.masteryThresholds, "x")).toBeNull();
  });
});

describe("student import validation", () => {
  const lookup = { courseCodes: new Set(["BCA"]), classCodes: new Set(["BCA-S3-A"]), existingCodes: new Set(["STU0001"]) };

  it("parses quoted CSV fields", () => {
    expect(parseCsv('a,"b, c","d ""q"""\r\n1,2,3\r\n')).toEqual([["a", "b, c", 'd "q"'], ["1", "2", "3"]]);
  });

  it("reports missing required columns and blocks the import", () => {
    const r = validateStudentTable([["student_code", "full_name"], ["X1", "Asha"]], lookup);
    expect(r.missingColumns).toEqual(["course_code", "semester"]);
    expect(r.validRows).toBe(0);
  });

  it("flags invalid rows, duplicates and existing IDs without treating them as valid", () => {
    const table = [
      ["full_name", "course_code", "semester", "student_code", "class_code"],
      ["Asha", "BCA", "3", "NEW1", "BCA-S3-A"],
      ["Ravi", "XYZ", "9", "NEW1", "NOPE"],
      ["Meera", "BCA", "2", "STU0001", ""],
    ];
    const r = validateStudentTable(table, lookup);
    expect(r.validRows).toBe(0);
    expect(r.invalidRows).toBe(3);
    expect(r.duplicateCodesInFile).toEqual(["NEW1"]);
    expect(r.existingCodesInDatabase).toEqual(["STU0001"]);
  });

  it("accepts a valid row", () => {
    const r = validateStudentTable([["full_name", "course_code", "semester"], ["Asha", "BCA", "3"]], lookup);
    expect(r.validRows).toBe(1);
  });
});

/* ---------- Security ---------- */

describe("authentication primitives", () => {
  it("hashes passwords with a salt and verifies them", async () => {
    const hash = await hashPassword("Correct-Horse-1");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toContain("Correct-Horse-1");
    expect(await verifyPassword("Correct-Horse-1", hash)).toBe(true);
    expect(await verifyPassword("wrong-password-1", hash)).toBe(false);
  });

  it("enforces the password policy", () => {
    expect(validatePasswordPolicy("short1")).not.toHaveLength(0);
    expect(validatePasswordPolicy("lettersonly")).not.toHaveLength(0);
    expect(validatePasswordPolicy("zebra-Secret9", "alice@x.edu")).toHaveLength(0);
    expect(validatePasswordPolicy("alice1234", "alice@x.edu").join(" ")).toContain("email");
  });

  it("rate limits repeated attempts within a window", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 60000).ok).toBe(true);
    expect(rateLimit(key, 3, 60000).ok).toBe(false);
  });
});
