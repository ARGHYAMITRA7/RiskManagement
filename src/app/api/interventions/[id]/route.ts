import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { interventionHistory, interventions, studyTasks, students, teacherObservations, users } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, paramNumber, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { assertStudentAccess } from "@/lib/access";
import { audit, notifyStudentAndGuardians } from "@/lib/events";
import { INTERVENTION_STATUSES } from "@/lib/constants";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req, ctx) => {
  const user = await requireUser(["admin", "teacher", "student"]);
  const id = paramNumber((await ctx.params).id);
  const [iv] = await db.select().from(interventions).where(eq(interventions.id, id)).limit(1);
  if (!iv) throw new ApiError(404, "Intervention not found");
  await assertStudentAccess(user, iv.studentId);
  const [st] = await db.select({ code: students.studentCode, name: students.fullName }).from(students).where(eq(students.id, iv.studentId)).limit(1);
  const history = await db
    .select({ id: interventionHistory.id, status: interventionHistory.status, kind: interventionHistory.kind, note: interventionHistory.note, createdAt: interventionHistory.createdAt, changedBy: users.fullName })
    .from(interventionHistory)
    .leftJoin(users, eq(users.id, interventionHistory.changedBy))
    .where(eq(interventionHistory.interventionId, id))
    .orderBy(desc(interventionHistory.createdAt));
  // Private teacher observations are returned to staff only.
  const observations =
    user.role === "student"
      ? []
      : await db
          .select({ id: teacherObservations.id, body: teacherObservations.body, createdAt: teacherObservations.createdAt, authorName: users.fullName })
          .from(teacherObservations)
          .leftJoin(users, eq(users.id, teacherObservations.authorId))
          .where(eq(teacherObservations.interventionId, id))
          .orderBy(desc(teacherObservations.createdAt));
  return jsonOk({ intervention: iv, student: st, history, observations, privateNotice: user.role === "student" ? null : "Observations are private to staff." });
});

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), status: z.enum(INTERVENTION_STATUSES), note: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal("session"), note: z.string().trim().min(5).max(1000) }),
  z.object({ action: z.literal("observation"), body: z.string().trim().min(3).max(2000) }),
  z.object({ action: z.literal("followup"), followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().max(500).optional() }),
  z.object({
    action: z.literal("task"),
    title: z.string().trim().min(3).max(160),
    taskDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    minutes: z.coerce.number().int().min(15).max(240).default(45),
    subjectId: z.coerce.number().int().positive().nullable().optional(),
  }),
  z.object({ action: z.literal("update"), plan: z.string().trim().min(10).max(2000), target: z.string().trim().max(300).optional() }),
]);

/** Staff manage the case: status, support sessions, private observations, follow-ups, revision tasks. */
export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const id = paramNumber((await ctx.params).id);
  const body = await readJson(req, schema);
  const [iv] = await db.select().from(interventions).where(eq(interventions.id, id)).limit(1);
  if (!iv) throw new ApiError(404, "Intervention not found");
  await assertStudentAccess(user, iv.studentId);
  const now = new Date();
  const hist = (status: string, kind: string, note: string) =>
    db.insert(interventionHistory).values({ interventionId: id, status, kind, note, changedBy: user.id });

  switch (body.action) {
    case "status":
      await db
        .update(interventions)
        .set({ status: body.status, closedAt: body.status === "completed" ? now : null, updatedAt: now })
        .where(eq(interventions.id, id));
      await hist(body.status, "status_change", body.note || `Status changed to ${body.status.replace(/_/g, " ")}.`);
      break;
    case "session":
      await hist(iv.status, "support_session", body.note);
      await db.update(interventions).set({ updatedAt: now }).where(eq(interventions.id, id));
      break;
    case "observation":
      await db.insert(teacherObservations).values({ studentId: iv.studentId, authorId: user.id, interventionId: id, body: body.body, visibility: "private" });
      break;
    case "followup":
      await db
        .update(interventions)
        .set({ followUpDate: body.followUpDate, status: "follow_up_required", updatedAt: now })
        .where(eq(interventions.id, id));
      await hist("follow_up_required", "follow_up", body.note || `Follow-up scheduled for ${body.followUpDate}.`);
      break;
    case "task":
      await db.insert(studyTasks).values({
        studentId: iv.studentId,
        title: body.title,
        subjectId: body.subjectId ?? null,
        taskDate: body.taskDate,
        minutes: body.minutes,
        source: "teacher",
      });
      await hist(iv.status, "revision_task", `Revision task assigned: ${body.title} (${body.taskDate}).`);
      await notifyStudentAndGuardians(iv.studentId, {
        title: "Revision task assigned",
        message: `${body.title} has been added to your study planner for ${body.taskDate}.`,
        category: "intervention",
        link: "/student/learning",
      });
      break;
    case "update":
      await db.update(interventions).set({ plan: body.plan, target: body.target ?? iv.target, updatedAt: now }).where(eq(interventions.id, id));
      await hist(iv.status, "update", "Plan updated.");
      break;
  }

  if (body.action === "status" || body.action === "followup") {
    await notifyStudentAndGuardians(iv.studentId, {
      title: "Intervention update",
      message: body.action === "status" ? `Your support plan is now: ${body.status.replace(/_/g, " ")}.` : `A follow-up is scheduled for ${body.followUpDate}.`,
      category: "intervention",
      link: "/student/learning",
    });
  }
  await audit({ id: user.id, role: user.role }, `intervention.${body.action}`, "intervention", id, {});
  return jsonOk({ ok: true });
});
