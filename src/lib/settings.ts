import { db } from "@/db";
import { systemSettings } from "@/db/schema";

export type GradeBand = { min: number; grade: string; gpa: number };

export type Settings = {
  institutionName: string;
  attendanceThresholdPct: number;
  passPercentage: number;
  riskThresholds: { low: number; high: number };
  masteryThresholds: { needsImprovement: number; developing: number; proficient: number; minEvidence: number };
  gradingScale: GradeBand[];
  gamificationEnabled: boolean;
  quizDefaultTimeSeconds: number;
  quizDefaultQuestions: number;
};

export const DEFAULT_SETTINGS: Settings = {
  institutionName: "Demo Institute of Technology",
  attendanceThresholdPct: 75,
  passPercentage: 40,
  riskThresholds: { low: 0.35, high: 0.6 },
  masteryThresholds: { needsImprovement: 0.5, developing: 0.7, proficient: 0.85, minEvidence: 5 },
  gradingScale: [
    { min: 90, grade: "O", gpa: 10 },
    { min: 80, grade: "A+", gpa: 9 },
    { min: 70, grade: "A", gpa: 8 },
    { min: 60, grade: "B+", gpa: 7 },
    { min: 50, grade: "B", gpa: 6 },
    { min: 40, grade: "C", gpa: 5 },
    { min: 0, grade: "F", gpa: 0 },
  ],
  gamificationEnabled: true,
  quizDefaultTimeSeconds: 600,
  quizDefaultQuestions: 5,
};

export async function getSettings(): Promise<Settings> {
  const rows = await db.select().from(systemSettings);
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) merged[row.key] = row.value;
  }
  return merged as unknown as Settings;
}

export async function setSettings(patch: Partial<Settings>, userId: number | null) {
  for (const [key, value] of Object.entries(patch)) {
    await db
      .insert(systemSettings)
      .values({ key, value: value as object, updatedBy: userId })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: value as object, updatedBy: userId, updatedAt: new Date() },
      });
  }
}

/** Maps a percentage to grade and GPA using the configured institutional grading scale. */
export function gradeFor(percentage: number, scale: GradeBand[]): { grade: string; gpa: number } {
  const sorted = [...scale].sort((a, b) => b.min - a.min);
  const band = sorted.find((b) => percentage >= b.min) ?? sorted[sorted.length - 1];
  return { grade: band?.grade ?? "F", gpa: band?.gpa ?? 0 };
}
