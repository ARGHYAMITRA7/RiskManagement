import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { learningActivities, studyTasks } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, paramNumber, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getStudentForUser } from "@/lib/access";
import { audit } from "@/lib/events";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete"), completed: z.boolean().default(true) }),
  z.object({ action: z.literal("reschedule"), taskDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("edit"), title: z.string().trim().min(3).max(160).optional(), minutes: z.coerce.number().int().min(15).max(240).optional() }),
]);

/** Completing a task records learning activity, which feeds the engagement signals used by the risk model and streaks. */
export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(["student"]);
  const me = await getStudentForUser(user.id);
  if (!me) throw new ApiError(404, "No student record is linked to this account");
  const id = paramNumber((await ctx.params).id);
  const body = await readJson(req, schema);
  const [task] = await db.select().from(studyTasks).where(and(eq(studyTasks.id, id), eq(studyTasks.studentId, me.id))).limit(1);
  if (!task) throw new ApiError(404, "Task not found");
  if (body.action === "complete") {
    const completed = body.completed;
    await db
      .update(studyTasks)
      .set({ status: completed ? "completed" : "planned", completedAt: completed ? new Date() : null })
      .where(eq(studyTasks.id, id));
    if (completed && task.status !== "completed") {
      await db.insert(learningActivities).values({
        studentId: me.id,
        subjectId: task.subjectId,
        activityType: "study_session",
        minutes: task.minutes,
        activityDate: new Date().toISOString().slice(0, 10),
      });
    }
  } else if (body.action === "reschedule") {
    await db
      .update(studyTasks)
      .set({ taskDate: body.taskDate, rescheduleCount: task.rescheduleCount + 1 })
      .where(eq(studyTasks.id, id));
  } else {
    await db
      .update(studyTasks)
      .set({ title: body.title ?? task.title, minutes: body.minutes ?? task.minutes })
      .where(eq(studyTasks.id, id));
  }
  await audit({ id: user.id, role: user.role }, `planner.${body.action}`, "study_task", id, {});
  return jsonOk({ ok: true });
});

export const DELETE = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(["student"]);
  const me = await getStudentForUser(user.id);
  if (!me) throw new ApiError(404, "No student record is linked to this account");
  const id = paramNumber((await ctx.params).id);
  const removed = await db
    .delete(studyTasks)
    .where(and(eq(studyTasks.id, id), eq(studyTasks.studentId, me.id), eq(studyTasks.status, "planned")))
    .returning({ id: studyTasks.id });
  if (removed.length === 0) throw new ApiError(404, "Planned task not found");
  await audit({ id: user.id, role: user.role }, "planner.delete", "study_task", id, {});
  return jsonOk({ ok: true });
});
