import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  earlyWarningAlerts,
  examResults,
  exams,
  learningActivities,
  quizAttempts,
  students,
  subjects,
  teacherAssignments,
  teachers,
} from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { notifyUsers } from "@/lib/events";
import { buildFeatures } from "@/lib/ml/features";

type Found = {
  category: string;
  subjectId: number | null;
  severity: "low" | "medium" | "high";
  title: string;
  factors: string[];
  action: string;
};

const ACTIONS: Record<string, string> = {
  falling_marks: "Review the topics behind the drop and schedule a revision test in this subject.",
  attendance_decline: "Contact the student and guardian and agree an attendance recovery plan.",
  missed_assignments: "Check for barriers and set a catch-up deadline for outstanding work.",
  quiz_failures: "Assign targeted practice on the weakest topics and a teacher-led revision session.",
  reduced_activity: "Check in with the student about workload and agree a small daily study goal.",
  subject_deterioration: "Arrange a subject-level support session with the subject teacher.",
};

/**
 * Early-warning scan. Each indicator is re-evaluated; new indicators create alerts (deduplicated per
 * student, category and subject), persisting indicators update them, and indicators that no longer hold
 * are resolved automatically. Teachers allocated to the class are notified of new alerts.
 */
export async function runEarlyWarningScan(studentIds: number[] | undefined) {
  const settings = await getSettings();
  const feats = await buildFeatures(studentIds, settings.passPercentage);
  const ids = [...feats.keys()];
  if (ids.length === 0) return { scanned: 0, created: 0, resolved: 0 };

  const studentRows = await db
    .select({ id: students.id, classId: students.classId, fullName: students.fullName })
    .from(students)
    .where(inArray(students.id, ids));

  const exRows = await db
    .select({
      sid: examResults.studentId,
      subjectId: exams.subjectId,
      subjectName: subjects.name,
      passMarks: subjects.passMarks,
      date: exams.examDate,
      marks: examResults.marksObtained,
      max: exams.maxMarks,
      type: exams.examType,
    })
    .from(examResults)
    .innerJoin(exams, eq(exams.id, examResults.examId))
    .innerJoin(subjects, eq(subjects.id, exams.subjectId))
    .where(inArray(examResults.studentId, ids));

  const quizRows = await db
    .select({ sid: quizAttempts.studentId, pct: quizAttempts.percentage, at: quizAttempts.submittedAt })
    .from(quizAttempts)
    .where(and(inArray(quizAttempts.studentId, ids), eq(quizAttempts.status, "submitted")));

  const actRows = await db
    .select({ sid: learningActivities.studentId, date: learningActivities.activityDate, minutes: learningActivities.minutes })
    .from(learningActivities)
    .where(inArray(learningActivities.studentId, ids));

  const openAlerts = await db
    .select()
    .from(earlyWarningAlerts)
    .where(and(inArray(earlyWarningAlerts.studentId, ids), inArray(earlyWarningAlerts.status, ["open", "acknowledged"])));

  const classIds = [...new Set(studentRows.map((s) => s.classId).filter((c): c is number => c !== null))];
  const teacherRows = classIds.length
    ? await db
        .select({ classId: teacherAssignments.classId, userId: teachers.userId })
        .from(teacherAssignments)
        .innerJoin(teachers, eq(teachers.id, teacherAssignments.teacherId))
        .where(inArray(teacherAssignments.classId, classIds))
    : [];

  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  let created = 0;
  let resolved = 0;

  for (const s of studentRows) {
    const f = feats.get(s.id)?.values ?? {};
    const found: Found[] = [];
    const exams_ = exRows.filter((r) => r.sid === s.id && r.marks !== null);

    // Falling marks and subject-level deterioration.
    const bySubject = new Map<number, typeof exams_>();
    for (const r of exams_) bySubject.set(r.subjectId, [...(bySubject.get(r.subjectId) ?? []), r]);
    let belowPassSubjects = 0;
    for (const [subjectId, rows] of bySubject) {
      const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date));
      const pcts = ordered.map((r) => ((r.marks as number) / r.max) * 100);
      const last = ordered[ordered.length - 1];
      if (pcts.length >= 2) {
        const prev = pcts[pcts.length - 2];
        const cur = pcts[pcts.length - 1];
        if (prev - cur >= 10) {
          found.push({
            category: "falling_marks",
            subjectId,
            severity: prev - cur >= 20 ? "high" : "medium",
            title: `Marks falling in ${last.subjectName}`,
            factors: [`${Math.round(prev)}% then ${Math.round(cur)}% (${last.type.replace(/_/g, " ")})`],
            action: ACTIONS.falling_marks,
          });
        }
      }
      if (pcts[pcts.length - 1] < last.passMarks / (last.max / 100) && pcts.length) belowPassSubjects++;
    }
    if (belowPassSubjects >= 2) {
      found.push({
        category: "subject_deterioration",
        subjectId: null,
        severity: belowPassSubjects >= 3 ? "high" : "medium",
        title: `${belowPassSubjects} subjects are below the pass mark`,
        factors: [`Latest assessment is below the pass mark in ${belowPassSubjects} subjects.`],
        action: ACTIONS.subject_deterioration,
      });
    }

    const att = f.attendancePct;
    if (att !== null && att !== undefined && att < settings.attendanceThresholdPct) {
      found.push({
        category: "attendance_decline",
        subjectId: null,
        severity: att < settings.attendanceThresholdPct - 15 ? "high" : "medium",
        title: "Attendance below institutional target",
        factors: [`Attendance is ${att}% against a ${settings.attendanceThresholdPct}% target.`],
        action: ACTIONS.attendance_decline,
      });
    }

    const missed = f.missedAssignments ?? 0;
    if (missed >= 2) {
      found.push({
        category: "missed_assignments",
        subjectId: null,
        severity: missed >= 3 ? "high" : "medium",
        title: "Repeated missed assignments",
        factors: [`${missed} assignments past deadline have no submission.`],
        action: ACTIONS.missed_assignments,
      });
    }

    const quizzes = quizRows
      .filter((r) => r.sid === s.id && r.pct !== null)
      .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    if (quizzes.length >= 2 && quizzes[0].pct! < 40 && quizzes[1].pct! < 40) {
      const three = quizzes.length >= 3 && quizzes[2].pct! < 40;
      found.push({
        category: "quiz_failures",
        subjectId: null,
        severity: three ? "high" : "medium",
        title: "Repeated practice quiz failures",
        factors: [`Latest quiz scores: ${quizzes.slice(0, 3).map((q) => `${Math.round(q.pct!)}%`).join(", ")}.`],
        action: ACTIONS.quiz_failures,
      });
    }

    const acts = actRows.filter((r) => r.sid === s.id);
    if (acts.length > 0) {
      const last7 = acts.filter((r) => r.date >= weekAgo).reduce((a, r) => a + r.minutes, 0);
      const priorStart = new Date(today.getTime() - 28 * 86400000).toISOString().slice(0, 10);
      const prior = acts.filter((r) => r.date >= priorStart && r.date < weekAgo).reduce((a, r) => a + r.minutes, 0);
      const priorWeekly = prior / 3;
      if (priorWeekly >= 60 && last7 < priorWeekly * 0.5) {
        found.push({
          category: "reduced_activity",
          subjectId: null,
          severity: last7 === 0 && priorWeekly >= 120 ? "high" : "medium",
          title: "Learning activity has dropped",
          factors: [`${Math.round(last7)} minutes in the last 7 days against an average of ${Math.round(priorWeekly)} minutes per week earlier.`],
          action: ACTIONS.reduced_activity,
        });
      }
    }

    // Sync alerts for this student.
    const mine = openAlerts.filter((a) => a.studentId === s.id);
    const foundKeys = new Set(found.map((x) => `${x.category}:${x.subjectId ?? ""}`));
    for (const x of found) {
      const ex = mine.find((a) => a.category === x.category && (a.subjectId ?? null) === x.subjectId);
      if (ex) {
        await db
          .update(earlyWarningAlerts)
          .set({ severity: x.severity, title: x.title, factors: x.factors, recommendedAction: x.action })
          .where(eq(earlyWarningAlerts.id, ex.id));
      } else {
        await db.insert(earlyWarningAlerts).values({
          studentId: s.id,
          subjectId: x.subjectId,
          category: x.category,
          severity: x.severity,
          title: x.title,
          factors: x.factors,
          recommendedAction: x.action,
        });
        created++;
        if (x.severity === "high") {
          const userIds = teacherRows.filter((t) => t.classId === s.classId).map((t) => t.userId);
          await notifyUsers(userIds, {
            title: "High-severity early warning",
            message: `${s.fullName}: ${x.title}`,
            category: "risk_alert",
            link: "/alerts",
          });
        }
      }
    }
    for (const a of mine) {
      if (!foundKeys.has(`${a.category}:${a.subjectId ?? ""}`)) {
        await db
          .update(earlyWarningAlerts)
          .set({ status: "resolved", resolvedAt: new Date(), resolvedBy: null })
          .where(eq(earlyWarningAlerts.id, a.id));
        resolved++;
      }
    }
  }
  return { scanned: studentRows.length, created, resolved };
}
