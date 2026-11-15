import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assignmentSubmissions, assignments, examResults, exams, studyTasks, studentSubjects, subjects, topicMastery, topics } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getStudentForUser } from "@/lib/access";
import { audit } from "@/lib/events";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const dayStr = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

/** Weekly plan rows for the student (or read-only for staff with access to the student). */
export const GET = handle(async (req) => {
  const user = await requireUser(["student"]);
  const me = await getStudentForUser(user.id);
  if (!me) throw new ApiError(404, "No student record is linked to this account");
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? dayStr(0);
  const to = url.searchParams.get("to") ?? dayStr(6);
  const tasks = await db
    .select({
      id: studyTasks.id,
      title: studyTasks.title,
      subjectId: studyTasks.subjectId,
      topicId: studyTasks.topicId,
      taskDate: studyTasks.taskDate,
      minutes: studyTasks.minutes,
      source: studyTasks.source,
      status: studyTasks.status,
      completedAt: studyTasks.completedAt,
      rescheduleCount: studyTasks.rescheduleCount,
    })
    .from(studyTasks)
    .where(and(eq(studyTasks.studentId, me.id), gte(studyTasks.taskDate, from), lte(studyTasks.taskDate, to)))
    .orderBy(asc(studyTasks.taskDate), asc(studyTasks.id));
  const planned = tasks.reduce((a, t) => a + t.minutes, 0);
  const done = tasks.filter((t) => t.status === "completed").reduce((a, t) => a + t.minutes, 0);
  return jsonOk({ tasks, goalMinutesPerDay: me.dailyStudyGoalMinutes, totals: { planned, completed: done, days: 7 } });
});

const createSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), days: z.coerce.number().int().min(1).max(14).default(7) }),
  z.object({
    action: z.literal("create"),
    title: z.string().trim().min(3).max(160),
    taskDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    minutes: z.coerce.number().int().min(15).max(240).default(45),
    subjectId: z.coerce.number().int().positive().nullable().optional(),
  }),
]);

/**
 * Plan generation uses: the daily study goal, weakest topics (mastery), subjects below the pass mark,
 * assignments due within 14 days that are not submitted, and exams within 30 days.
 * Completed tasks are preserved; unfinished planner-generated tasks in the window are regenerated.
 */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["student"]);
  const me = await getStudentForUser(user.id);
  if (!me) throw new ApiError(404, "No student record is linked to this account");
  const body = await readJson(req, createSchema);

  if (body.action === "create") {
    const [row] = await db
      .insert(studyTasks)
      .values({ studentId: me.id, title: body.title, taskDate: body.taskDate, minutes: body.minutes, subjectId: body.subjectId ?? null, source: "planner" })
      .returning();
    await audit({ id: user.id, role: user.role }, "planner.create", "study_task", row.id, {});
    return jsonOk(row, 201);
  }

  const settings = await getSettings();
  const goal = Math.max(30, me.dailyStudyGoalMinutes);
  const subs = await db
    .select({ id: subjects.id, name: subjects.name, code: subjects.code, passMarks: subjects.passMarks })
    .from(studentSubjects)
    .innerJoin(subjects, eq(subjects.id, studentSubjects.subjectId))
    .where(eq(studentSubjects.studentId, me.id));
  const subjectIds = subs.map((s) => s.id);

  const exRows = subjectIds.length
    ? await db
        .select({ subjectId: exams.subjectId, marks: examResults.marksObtained, max: exams.maxMarks, date: exams.examDate, name: exams.name, type: exams.examType })
        .from(examResults)
        .innerJoin(exams, eq(exams.id, examResults.examId))
        .where(and(eq(examResults.studentId, me.id), inArray(exams.subjectId, subjectIds)))
    : [];
  const weakSubjects = subs.filter((s) => {
    const pcts = exRows.filter((r) => r.subjectId === s.id && r.marks !== null && r.type !== "end_semester").map((r) => ((r.marks as number) / r.max) * 100);
    return pcts.length > 0 && pcts.reduce((a, b) => a + b, 0) / pcts.length < s.passMarks;
  });
  const upcomingExams = exRows.filter((r) => r.date >= dayStr(0) && r.date <= dayStr(30) && r.marks === null);
  const mastery = await db
    .select({ topicId: topicMastery.topicId, level: topicMastery.level, name: topics.name, subjectId: topicMastery.subjectId, score: topicMastery.masteryScore })
    .from(topicMastery)
    .innerJoin(topics, eq(topics.id, topicMastery.topicId))
    .where(and(eq(topicMastery.studentId, me.id), inArray(topicMastery.level, ["needs_improvement", "developing"])))
    .orderBy(asc(topicMastery.masteryScore))
    .limit(8);
  const pendingAssignments = me.classId
    ? await db
        .select({ id: assignments.id, title: assignments.title, subjectId: assignments.subjectId, deadline: assignments.deadline })
        .from(assignments)
        .leftJoin(assignmentSubmissions, and(eq(assignmentSubmissions.assignmentId, assignments.id), eq(assignmentSubmissions.studentId, me.id)))
        .where(
          and(
            eq(assignments.classId, me.classId),
            gte(assignments.deadline, new Date()),
            lte(assignments.deadline, new Date(Date.now() + 14 * 86400000)),
            sql`${assignmentSubmissions.id} is null`,
          ),
        )
    : [];

  // Candidate tasks ordered by priority.
  type Cand = { title: string; subjectId: number | null; topicId: number | null; minutes: number };
  const cands: Cand[] = [];
  for (const e of upcomingExams.slice(0, 4)) {
    const s = subs.find((x) => x.id === e.subjectId);
    cands.push({ title: `Prepare for ${e.name} (${s?.code ?? ""})`, subjectId: e.subjectId, topicId: null, minutes: 60 });
  }
  for (const a of pendingAssignments.slice(0, 3)) {
    cands.push({ title: `Finish: ${a.title}`, subjectId: a.subjectId, topicId: null, minutes: 45 });
  }
  for (const m of mastery) {
    cands.push({ title: `Revise ${m.name}`, subjectId: m.subjectId, topicId: m.topicId, minutes: 45 });
    cands.push({ title: `Practice quiz: ${m.name}`, subjectId: m.subjectId, topicId: m.topicId, minutes: 30 });
  }
  for (const s of weakSubjects) cands.push({ title: `Review weak subject: ${s.name}`, subjectId: s.id, topicId: null, minutes: 45 });
  if (cands.length === 0) {
    for (const s of subs.slice(0, 4)) cands.push({ title: `Review notes: ${s.name}`, subjectId: s.id, topicId: null, minutes: 40 });
  }

  // Replace unfinished planner tasks in the window; keep completed work.
  const to = dayStr(body.days - 1);
  await db
    .delete(studyTasks)
    .where(and(eq(studyTasks.studentId, me.id), eq(studyTasks.source, "planner"), eq(studyTasks.status, "planned"), gte(studyTasks.taskDate, dayStr(0)), lte(studyTasks.taskDate, to)));

  const rows: Record<string, unknown>[] = [];
  let idx = 0;
  for (let d = 0; d < body.days; d++) {
    let remaining = goal;
    while (remaining >= 30 && cands.length) {
      const c = cands[idx % cands.length];
      idx++;
      const minutes = Math.min(c.minutes, remaining);
      rows.push({ studentId: me.id, title: c.title, subjectId: c.subjectId, topicId: c.topicId, taskDate: dayStr(d), minutes, source: "planner" });
      remaining -= minutes;
      if (idx > cands.length * 3) break;
    }
  }
  if (rows.length) await db.insert(studyTasks).values(rows as never);
  await audit({ id: user.id, role: user.role }, "planner.generate", "student", me.id, { tasks: rows.length, days: body.days });
  return jsonOk({ generated: rows.length, goalMinutesPerDay: goal, basedOn: { weakTopics: mastery.length, weakSubjects: weakSubjects.length, upcomingExams: upcomingExams.length, pendingAssignments: pendingAssignments.length } }, 201);
});
