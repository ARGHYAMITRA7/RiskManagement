import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { interventionHistory, interventions, students, subjects } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { accessibleStudentIds, assertStudentAccess } from "@/lib/access";
import { audit, notifyStudentAndGuardians } from "@/lib/events";

export const dynamic = "force-dynamic";

/** Staff: interventions for their students. Students: their own plans (private observations are never included). */
export const GET = handle(async (req) => {
  const user = await requireUser(["admin", "teacher", "student"]);
  const status = new URL(req.url).searchParams.get("status");
  const scope = await accessibleStudentIds(user);
  if (scope !== "all" && scope.length === 0) return jsonOk({ items: [] });
  const where = [
    scope === "all" ? undefined : inArray(interventions.studentId, scope),
    status ? eq(interventions.status, status) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const rows = await db
    .select({
      id: interventions.id,
      studentId: interventions.studentId,
      studentCode: students.studentCode,
      studentName: students.fullName,
      subjectId: interventions.subjectId,
      subjectName: subjects.name,
      status: interventions.status,
      plan: interventions.plan,
      target: interventions.target,
      improvementTargetPct: interventions.improvementTargetPct,
      followUpDate: interventions.followUpDate,
      closedAt: interventions.closedAt,
      createdAt: interventions.createdAt,
      updatedAt: interventions.updatedAt,
    })
    .from(interventions)
    .innerJoin(students, eq(students.id, interventions.studentId))
    .leftJoin(subjects, eq(subjects.id, interventions.subjectId))
    .where(where.length ? sql.join(where, sql` and `) : undefined)
    .orderBy(desc(interventions.updatedAt))
    .limit(300);
  const counts = await db
    .select({ status: interventions.status, n: sql<number>`count(*)::int` })
    .from(interventions)
    .where(scope === "all" ? undefined : inArray(interventions.studentId, scope))
    .groupBy(interventions.status);
  return jsonOk({ items: rows, counts });
});

const createSchema = z.object({
  studentId: z.coerce.number().int().positive(),
  subjectId: z.coerce.number().int().positive().nullable().optional(),
  plan: z.string().trim().min(10).max(2000),
  target: z.string().trim().max(300).optional().nullable(),
  improvementTargetPct: z.coerce.number().min(0).max(100).nullable().optional(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(["pending", "in_progress"]).default("pending"),
});

/** Teachers and administrators create intervention plans for students in their scope. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const body = await readJson(req, createSchema);
  await assertStudentAccess(user, body.studentId);
  const [row] = await db
    .insert(interventions)
    .values({
      studentId: body.studentId,
      createdBy: user.id,
      subjectId: body.subjectId ?? null,
      status: body.status,
      plan: body.plan,
      target: body.target ?? "",
      improvementTargetPct: body.improvementTargetPct ?? null,
      followUpDate: body.followUpDate ?? null,
    })
    .returning();
  await db.insert(interventionHistory).values({ interventionId: row.id, status: body.status, kind: "status_change", note: "Intervention plan created.", changedBy: user.id });
  await notifyStudentAndGuardians(body.studentId, {
    title: "New support plan",
    message: "A teacher has created a support plan for you. Review it in your learning plan.",
    category: "intervention",
    link: "/student/learning",
  });
  await audit({ id: user.id, role: user.role }, "intervention.create", "intervention", row.id, { studentId: body.studentId });
  return jsonOk(row, 201);
});
