import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  classes,
  courses,
  earlyWarningAlerts,
  interventionHistory,
  interventions,
  riskPredictions,
  studentSubjects,
  students,
  subjects,
  teacherObservations,
  users,
  recommendations,
} from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, paramNumber, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { assertStudentAccess } from "@/lib/access";
import { audit } from "@/lib/events";
import { studentDashboard } from "@/lib/analytics";
import { syncEnrolments } from "@/lib/students";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req, ctx) => {
  const user = await requireUser();
  const id = paramNumber((await ctx.params).id);
  const student = await assertStudentAccess(user, id);
  const dashboard = await studentDashboard(id, { forGuardian: user.role === "guardian" });
  const [classRow] = student.classId ? await db.select().from(classes).where(eq(classes.id, student.classId)).limit(1) : [];
  const [course] = await db.select().from(courses).where(eq(courses.id, student.courseId)).limit(1);
  const [account] = student.userId
    ? await db.select({ email: users.email, status: users.status }).from(users).where(eq(users.id, student.userId)).limit(1)
    : [];
  const enrolled = await db
    .select({ id: subjects.id, code: subjects.code, name: subjects.name, semester: subjects.semester })
    .from(studentSubjects)
    .innerJoin(subjects, eq(subjects.id, studentSubjects.subjectId))
    .where(eq(studentSubjects.studentId, id));

  const base = {
    student: { ...student, className: classRow?.code ?? null, courseName: course?.name ?? null, account: account ?? null },
    enrolled,
    dashboard,
  };
  if (user.role === "guardian") return jsonOk({ ...base, predictions: [], interventions: [], observations: [], alerts: [] });

  const predictions = await db
    .select({
      id: riskPredictions.id,
      riskCategory: riskPredictions.riskCategory,
      riskScore: riskPredictions.riskScore,
      probability: riskPredictions.probability,
      method: riskPredictions.method,
      explanation: riskPredictions.explanation,
      suggestedIntervention: riskPredictions.suggestedIntervention,
      features: riskPredictions.features,
      missingFeatures: riskPredictions.missingFeatures,
      predictedAt: riskPredictions.predictedAt,
      isDemo: riskPredictions.isDemo,
    })
    .from(riskPredictions)
    .where(eq(riskPredictions.studentId, id))
    .orderBy(desc(riskPredictions.predictedAt))
    .limit(20);
  const ivs = await db.select().from(interventions).where(eq(interventions.studentId, id)).orderBy(desc(interventions.createdAt));
  const recs = await db.select().from(recommendations).where(eq(recommendations.studentId, id)).orderBy(desc(recommendations.createdAt));

  if (user.role === "student") {
    // Students see the plan and status but never private teacher observations.
    return jsonOk({ ...base, predictions, interventions: ivs.map((i) => ({ ...i })), observations: [], alerts: [], recommendations: recs });
  }
  const history = ivs.length
    ? await db.select().from(interventionHistory).where(and(eq(interventionHistory.interventionId, ivs[0].id))).orderBy(desc(interventionHistory.createdAt))
    : [];
  const observations = await db.select().from(teacherObservations).where(eq(teacherObservations.studentId, id)).orderBy(desc(teacherObservations.createdAt));
  const alerts = await db
    .select()
    .from(earlyWarningAlerts)
    .where(eq(earlyWarningAlerts.studentId, id))
    .orderBy(desc(earlyWarningAlerts.createdAt))
    .limit(30);
  return jsonOk({ ...base, predictions, interventions: ivs, historyLatest: history, observations, alerts, recommendations: recs });
});

const patchSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().toLowerCase().max(200).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  courseId: z.coerce.number().int().positive().optional(),
  classId: z.coerce.number().int().positive().nullable().optional(),
  currentSemester: z.coerce.number().int().min(1).max(12).optional(),
  guardianName: z.string().trim().max(120).nullable().optional(),
  guardianPhone: z.string().trim().max(20).nullable().optional(),
  guardianEmail: z.string().trim().toLowerCase().max(200).nullable().optional(),
  dailyStudyGoalMinutes: z.coerce.number().int().min(15).max(600).optional(),
});

export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const id = paramNumber((await ctx.params).id);
  const body = await readJson(req, patchSchema);
  const [current] = await db.select().from(students).where(eq(students.id, id)).limit(1);
  if (!current) throw new ApiError(404, "Student not found");
  if (body.classId) {
    const [cls] = await db.select().from(classes).where(eq(classes.id, body.classId)).limit(1);
    if (!cls) throw new ApiError(400, "Selected class does not exist");
  }
  const courseId = body.courseId ?? current.courseId;
  const semester = body.currentSemester ?? current.currentSemester;
  await db.transaction(async (tx) => {
    await tx
      .update(students)
      .set({ ...body, email: body.email === undefined ? undefined : body.email || null, updatedAt: new Date() })
      .where(eq(students.id, id));
    if (courseId !== current.courseId || semester !== current.currentSemester) {
      await syncEnrolments(tx, id, courseId, semester);
    }
  });
  await audit({ id: admin.id, role: admin.role }, "student.update", "student", id, body as Record<string, unknown>);
  return jsonOk({ ok: true });
});

/** Archive (soft delete): record and history are kept; the linked login is suspended. */
export const DELETE = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const id = paramNumber((await ctx.params).id);
  const [s] = await db.select().from(students).where(eq(students.id, id)).limit(1);
  if (!s) throw new ApiError(404, "Student not found");
  await db.transaction(async (tx) => {
    await tx.update(students).set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() }).where(eq(students.id, id));
    if (s.userId) await tx.update(users).set({ status: "suspended", updatedAt: new Date() }).where(eq(users.id, s.userId));
  });
  await audit({ id: admin.id, role: admin.role }, "student.archive", "student", id, { studentCode: s.studentCode });
  return jsonOk({ ok: true, status: "archived" });
});

export const PUT = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const id = paramNumber((await ctx.params).id);
  const [s] = await db.select().from(students).where(eq(students.id, id)).limit(1);
  if (!s) throw new ApiError(404, "Student not found");
  await db.update(students).set({ status: "active", archivedAt: null, updatedAt: new Date() }).where(eq(students.id, id));
  if (s.userId) await db.update(users).set({ status: "active", updatedAt: new Date() }).where(eq(users.id, s.userId));
  await audit({ id: admin.id, role: admin.role }, "student.restore", "student", id, {});
  return jsonOk({ ok: true, status: "active" });
});
