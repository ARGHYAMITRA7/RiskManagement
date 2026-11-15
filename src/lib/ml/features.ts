import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assignmentSubmissions,
  assignments,
  attendanceRecords,
  examResults,
  exams,
  learningActivities,
  quizAttempts,
  students,
  subjects,
} from "@/db/schema";
import { round } from "@/lib/utils";

export type FeatureMeta = { key: string; label: string; unit: string; description: string };

/**
 * Feature set for the academic-risk model. Protected personal characteristics
 * (gender, religion, caste, nationality, etc.) are deliberately NOT used.
 * End-semester results are excluded so the prediction is made before them
 * (the label is derived from end-semester outcomes, so this prevents target leakage).
 */
export const FEATURE_META: FeatureMeta[] = [
  { key: "internalPct", label: "Internal assessment average", unit: "%", description: "Average of internal assessments, class tests, practicals and projects for current-semester subjects." },
  { key: "midPct", label: "Mid-semester exam average", unit: "%", description: "Average mid-semester examination percentage in the current semester." },
  { key: "prevSemesterPct", label: "Previous semester average", unit: "%", description: "Average end-semester percentage in earlier semesters." },
  { key: "attendancePct", label: "Attendance", unit: "%", description: "Present + late sessions divided by all marked sessions (excused sessions excluded)." },
  { key: "assignmentCompletionPct", label: "Assignment completion", unit: "%", description: "Share of assignments with passed deadlines that were submitted." },
  { key: "missedAssignments", label: "Missed assignments", unit: "count", description: "Assignments past deadline with no submission." },
  { key: "quizAvgPct", label: "Quiz average", unit: "%", description: "Average percentage across submitted practice quiz attempts." },
  { key: "practiceCount", label: "Practice quizzes completed", unit: "count", description: "Number of submitted practice quiz attempts." },
  { key: "studyHoursPerDay", label: "Study hours per day", unit: "h", description: "Logged learning minutes over the last 14 days divided by 14." },
  { key: "activeDays14", label: "Active learning days (14 days)", unit: "days", description: "Distinct days with learning activity in the last 14 days." },
  { key: "learningConsistency", label: "Learning consistency", unit: "0-1", description: "1 minus the coefficient of variation of weekly learning minutes over 4 weeks (clamped to 0-1)." },
  { key: "subjectWeakRatio", label: "Share of weak subjects", unit: "ratio", description: "Fraction of current-semester subjects whose average is below the pass mark." },
];

export const FEATURE_KEYS: string[] = FEATURE_META.map((f) => f.key);
export const FEATURE_LABELS: Record<string, string> = Object.fromEntries(FEATURE_META.map((f) => [f.key, f.label]));

export type FeatureValues = Record<string, number | null>;
export type StudentFeatures = { studentId: number; currentSemester: number; classId: number | null; values: FeatureValues };

const INTERNAL_TYPES = new Set(["internal_assessment", "class_test", "practical", "project"]);

export function toVector(values: FeatureValues): (number | null)[] {
  return FEATURE_KEYS.map((k) => values[k] ?? null);
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function groupBy<T>(rows: T[], key: (r: T) => number): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

function isoDaysAgo(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
}

function daysBetween(dateStr: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(`${dateStr}T00:00:00Z`)) / 86400000);
}

/**
 * Builds the feature matrix for the given students (or all students when omitted).
 * Missing data stays null: it is never converted to zero.
 */
export async function buildFeatures(
  studentIds: number[] | undefined,
  passPct: number,
  now = new Date(),
): Promise<Map<number, StudentFeatures>> {
  if (studentIds && studentIds.length === 0) return new Map();
  const studentRows = await db
    .select({ id: students.id, sem: students.currentSemester, classId: students.classId })
    .from(students)
    .where(studentIds ? inArray(students.id, studentIds) : undefined);
  const ids = studentRows.map((s) => s.id);
  if (ids.length === 0) return new Map();

  const [examRows, attRows, asgRows, quizRows, actRows] = await Promise.all([
    db
      .select({
        sid: examResults.studentId,
        marks: examResults.marksObtained,
        examType: exams.examType,
        maxMarks: exams.maxMarks,
        subjectId: exams.subjectId,
        subjectSem: subjects.semester,
      })
      .from(examResults)
      .innerJoin(exams, eq(exams.id, examResults.examId))
      .innerJoin(subjects, eq(subjects.id, exams.subjectId))
      .where(inArray(examResults.studentId, ids)),
    db
      .select({
        sid: attendanceRecords.studentId,
        status: attendanceRecords.status,
        n: sql<number>`count(*)::int`,
      })
      .from(attendanceRecords)
      .where(inArray(attendanceRecords.studentId, ids))
      .groupBy(attendanceRecords.studentId, attendanceRecords.status),
    db
      .select({ sid: students.id, submissionId: assignmentSubmissions.id })
      .from(students)
      .innerJoin(assignments, and(eq(assignments.classId, students.classId), lt(assignments.deadline, now)))
      .leftJoin(
        assignmentSubmissions,
        and(eq(assignmentSubmissions.assignmentId, assignments.id), eq(assignmentSubmissions.studentId, students.id)),
      )
      .where(inArray(students.id, ids)),
    db
      .select({ sid: quizAttempts.studentId, pct: quizAttempts.percentage })
      .from(quizAttempts)
      .where(and(inArray(quizAttempts.studentId, ids), eq(quizAttempts.status, "submitted"))),
    db
      .select({
        sid: learningActivities.studentId,
        date: learningActivities.activityDate,
        minutes: learningActivities.minutes,
      })
      .from(learningActivities)
      .where(and(inArray(learningActivities.studentId, ids), gte(learningActivities.activityDate, isoDaysAgo(28, now)))),
  ]);

  const exM = groupBy(examRows, (r) => r.sid);
  const atM = groupBy(attRows, (r) => r.sid);
  const asM = groupBy(asgRows, (r) => r.sid);
  const qM = groupBy(quizRows, (r) => r.sid);
  const aM = groupBy(actRows, (r) => r.sid);

  const out = new Map<number, StudentFeatures>();
  for (const s of studentRows) {
    const pctOf = (r: { marks: number | null; maxMarks: number }) => ((r.marks ?? 0) / r.maxMarks) * 100;
    const ex = (exM.get(s.id) ?? []).filter((r) => r.marks !== null);
    const cur = ex.filter((r) => r.subjectSem === s.sem && r.examType !== "end_semester");
    const internal = avg(cur.filter((r) => INTERNAL_TYPES.has(r.examType)).map(pctOf));
    const mid = avg(cur.filter((r) => r.examType === "mid_semester").map(pctOf));
    const prev = avg(ex.filter((r) => r.examType === "end_semester" && r.subjectSem < s.sem).map(pctOf));

    const bySubject = groupBy(cur, (r) => r.subjectId);
    const subjectAvgs = [...bySubject.values()].map((rs) => avg(rs.map(pctOf)) ?? 0);
    const weakRatio = subjectAvgs.length ? subjectAvgs.filter((v) => v < passPct).length / subjectAvgs.length : null;

    const at = atM.get(s.id) ?? [];
    const cnt = (st: string) => at.find((r) => r.status === st)?.n ?? 0;
    const present = cnt("present");
    const late = cnt("late");
    const absent = cnt("absent");
    const marked = present + late + absent;
    const attendancePct = marked > 0 ? ((present + late) / marked) * 100 : null;

    const asg = asM.get(s.id) ?? [];
    const total = asg.length;
    const submitted = asg.filter((r) => r.submissionId !== null).length;
    const completionPct = total > 0 ? (submitted / total) * 100 : null;

    const qz = qM.get(s.id) ?? [];
    const quizAvg = avg(qz.map((r) => r.pct).filter((v): v is number => v !== null));

    const act = aM.get(s.id) ?? [];
    let studyHours: number | null = null;
    let activeDays: number | null = null;
    let consistency: number | null = null;
    if (act.length > 0) {
      const last14 = act.filter((r) => daysBetween(r.date, now) < 14);
      studyHours = last14.reduce((sum, r) => sum + r.minutes, 0) / 14 / 60;
      activeDays = new Set(last14.map((r) => r.date)).size;
      const weekly = [0, 0, 0, 0];
      for (const r of act) {
        const w = Math.floor(daysBetween(r.date, now) / 7);
        if (w >= 0 && w < 4) weekly[w] += r.minutes;
      }
      const m = weekly.reduce((a, b) => a + b, 0) / 4;
      if (m > 0) {
        const sd = Math.sqrt(weekly.reduce((a, b) => a + (b - m) ** 2, 0) / 4);
        consistency = Math.max(0, Math.min(1, 1 - sd / m));
      } else {
        consistency = 0;
      }
    }

    const r2 = (v: number | null) => (v === null ? null : round(v, 2));
    out.set(s.id, {
      studentId: s.id,
      currentSemester: s.sem,
      classId: s.classId,
      values: {
        internalPct: r2(internal),
        midPct: r2(mid),
        prevSemesterPct: r2(prev),
        attendancePct: r2(attendancePct),
        assignmentCompletionPct: r2(completionPct),
        missedAssignments: total - submitted,
        quizAvgPct: r2(quizAvg),
        practiceCount: qz.length,
        studyHoursPerDay: r2(studyHours),
        activeDays14: activeDays,
        learningConsistency: r2(consistency),
        subjectWeakRatio: r2(weakRatio),
      },
    });
  }
  return out;
}
