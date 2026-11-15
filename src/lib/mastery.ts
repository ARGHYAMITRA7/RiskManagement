import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { recommendations, topicMastery } from "@/db/schema";
import { getSettings, type Settings } from "@/lib/settings";
import { round } from "@/lib/utils";
import type { MasteryLevel } from "@/lib/constants";

export type MasteryHistoryPoint = { date: string; accuracy: number; attempted: number };
export type MasteryPrev = {
  attempted: number;
  correct: number;
  masteryScore: number;
  history: MasteryHistoryPoint[];
} | null;

/**
 * Mastery bands (lower bounds configured in settings):
 *   score < needsImprovement            -> Needs Improvement
 *   score < developing                  -> Developing
 *   score < proficient                  -> Proficient
 *   score >= proficient                 -> Strong
 * Proficient/Strong require minimum evidence (minEvidence answered questions); otherwise the level is capped at Developing.
 */
export function levelFor(score: number, attempted: number, t: Settings["masteryThresholds"]): MasteryLevel {
  let level: MasteryLevel =
    score < t.needsImprovement
      ? "needs_improvement"
      : score < t.developing
        ? "developing"
        : score < t.proficient
          ? "proficient"
          : "strong";
  if (attempted < t.minEvidence && (level === "proficient" || level === "strong")) level = "developing";
  return level;
}

/** Trend compares the latest accuracy with the mean of up to three earlier points. */
export function computeTrend(history: MasteryHistoryPoint[]): "improving" | "stable" | "declining" {
  if (history.length < 2) return "stable";
  const latest = history[history.length - 1].accuracy;
  const earlier = history.slice(0, -1).slice(-3);
  const baseline = earlier.reduce((a, h) => a + h.accuracy, 0) / earlier.length;
  const d = latest - baseline;
  if (d > 0.1) return "improving";
  if (d < -0.1) return "declining";
  return "stable";
}

/** Pure update rule (also used by the synthetic data generator so both paths stay identical). */
export function computeMasteryUpdate(
  prev: MasteryPrev,
  add: { attempted: number; correct: number },
  t: Settings["masteryThresholds"],
  date: string,
) {
  if (add.attempted <= 0) return null;
  const attempted = (prev?.attempted ?? 0) + add.attempted;
  const correct = (prev?.correct ?? 0) + add.correct;
  const accuracy = add.correct / add.attempted;
  const masteryScore = prev && prev.attempted > 0 ? 0.6 * prev.masteryScore + 0.4 * accuracy : accuracy;
  const history = [...(prev?.history ?? []), { date, accuracy: round(accuracy, 3), attempted: add.attempted }].slice(-20);
  return {
    attempted,
    correct,
    masteryScore: round(masteryScore, 4),
    level: levelFor(masteryScore, attempted, t),
    trend: computeTrend(history),
    history,
  };
}

export async function applyTopicResults(
  studentId: number,
  subjectId: number,
  results: { topicId: number; attempted: number; correct: number }[],
) {
  if (results.length === 0) return;
  const settings = await getSettings();
  const today = new Date().toISOString().slice(0, 10);
  const existing = await db
    .select()
    .from(topicMastery)
    .where(and(eq(topicMastery.studentId, studentId), inArray(topicMastery.topicId, results.map((r) => r.topicId))));
  for (const r of results) {
    const prev = existing.find((e) => e.topicId === r.topicId) ?? null;
    const update = computeMasteryUpdate(prev, { attempted: r.attempted, correct: r.correct }, settings.masteryThresholds, today);
    if (!update) continue;
    if (prev) {
      await db
        .update(topicMastery)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(topicMastery.id, prev.id));
    } else {
      await db.insert(topicMastery).values({ studentId, topicId: r.topicId, subjectId, ...update });
    }
  }
}

/** After a follow-up assessment, record the subsequent score on active recommendations for the same topic/subject. */
export async function updateRecommendationEffectiveness(
  studentId: number,
  subjectId: number,
  topicId: number | null,
  scorePct: number,
) {
  const rows = await db
    .select()
    .from(recommendations)
    .where(
      and(
        eq(recommendations.studentId, studentId),
        inArray(recommendations.status, ["in_progress", "completed"]),
        topicId ? eq(recommendations.topicId, topicId) : eq(recommendations.subjectId, subjectId),
      ),
    );
  for (const rec of rows) {
    const effectiveness = rec.baselineScore === null ? null : round(scorePct - rec.baselineScore, 1);
    await db
      .update(recommendations)
      .set({ followUpScore: round(scorePct, 1), effectiveness, updatedAt: new Date() })
      .where(eq(recommendations.id, rec.id));
  }
}
