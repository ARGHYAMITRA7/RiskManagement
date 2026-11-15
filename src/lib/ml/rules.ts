import type { Settings } from "@/lib/settings";
import type { FeatureValues } from "./features";

export type RuleResult = {
  category: "low" | "medium" | "high";
  count: number;
  triggered: { feature: string; label: string; message: string }[];
  thresholds: { medium: number; high: number };
};

/**
 * Transparent rule-based screening. It is the fallback when no trained model is active,
 * and it is the baseline the ML model must beat. It does not learn from data.
 */
export function ruleDefinitions(settings: Settings) {
  const pass = settings.passPercentage;
  const att = settings.attendanceThresholdPct;
  return [
    { feature: "attendancePct", label: "Attendance below target", test: (v: number) => v < att, message: (v: number) => `Attendance ${v}% is below the ${att}% target.` },
    { feature: "internalPct", label: "Internal marks below pass mark", test: (v: number) => v < pass, message: (v: number) => `Internal assessment average ${v}% is below the ${pass}% pass mark.` },
    { feature: "midPct", label: "Mid-semester marks below pass mark", test: (v: number) => v < pass, message: (v: number) => `Mid-semester average ${v}% is below the ${pass}% pass mark.` },
    { feature: "assignmentCompletionPct", label: "Low assignment completion", test: (v: number) => v < 60, message: (v: number) => `Only ${v}% of past-deadline assignments were submitted.` },
    { feature: "missedAssignments", label: "Repeated missed assignments", test: (v: number) => v >= 2, message: (v: number) => `${v} assignments past deadline were not submitted.` },
    { feature: "quizAvgPct", label: "Weak quiz performance", test: (v: number) => v < 40, message: (v: number) => `Quiz average ${v}% indicates topic-level weaknesses.` },
    { feature: "studyHoursPerDay", label: "Low study time", test: (v: number) => v < 0.75, message: (v: number) => `Average study time ${v} h/day is below 0.75 h/day.` },
    { feature: "activeDays14", label: "Low platform engagement", test: (v: number) => v < 4, message: (v: number) => `Learning platform used on only ${v} of the last 14 days.` },
    { feature: "subjectWeakRatio", label: "Many weak subjects", test: (v: number) => v >= 0.5, message: (v: number) => `${Math.round(v * 100)}% of current subjects are below the pass mark.` },
  ];
}

export function ruleScreen(values: FeatureValues, settings: Settings): RuleResult {
  const triggered = ruleDefinitions(settings)
    .filter((r) => {
      const v = values[r.feature];
      return v !== null && v !== undefined && r.test(v);
    })
    .map((r) => ({ feature: r.feature, label: r.label, message: r.message(values[r.feature] as number) }));
  const count = triggered.length;
  const category = count >= 4 ? "high" : count >= 2 ? "medium" : "low";
  return { category, count, triggered, thresholds: { medium: 2, high: 4 } };
}
