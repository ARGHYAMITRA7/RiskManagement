import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, classes, departments, subjects, teacherAssignments, teachers, users } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, paramNumber, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/events";
import { teacherDashboard } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req, ctx) => {
  const user = await requireUser(["admin", "teacher"]);
  const id = paramNumber((await ctx.params).id);
  const [t] = await db
    .select({
      id: teachers.id,
      teacherCode: teachers.teacherCode,
      designation: teachers.designation,
      phone: teachers.phone,
      departmentId: teachers.departmentId,
      departmentName: departments.name,
      userId: teachers.userId,
      fullName: users.fullName,
      email: users.email,
      status: users.status,
    })
    .from(teachers)
    .innerJoin(users, eq(users.id, teachers.userId))
    .innerJoin(departments, eq(departments.id, teachers.departmentId))
    .where(eq(teachers.id, id))
    .limit(1);
  if (!t) throw new ApiError(404, "Teacher not found");
  if (user.role === "teacher" && t.userId !== user.id) throw new ApiError(403, "You can only view your own teacher profile");
  const allocations = await db
    .select({
      id: teacherAssignments.id,
      subjectId: subjects.id,
      subjectCode: subjects.code,
      subjectName: subjects.name,
      classId: classes.id,
      classCode: classes.code,
      semester: subjects.semester,
    })
    .from(teacherAssignments)
    .innerJoin(subjects, eq(subjects.id, teacherAssignments.subjectId))
    .innerJoin(classes, eq(classes.id, teacherAssignments.classId))
    .where(eq(teacherAssignments.teacherId, id));
  const activity = await db
    .select({ action: auditLogs.action, entityType: auditLogs.entityType, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(eq(auditLogs.actorId, t.userId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(25);
  const dashboard = await teacherDashboard(id);
  return jsonOk({ teacher: t, allocations, activity, dashboard });
});

const patchSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  designation: z.string().trim().max(80).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const id = paramNumber((await ctx.params).id);
  const body = await readJson(req, patchSchema);
  const [t] = await db.select().from(teachers).where(eq(teachers.id, id)).limit(1);
  if (!t) throw new ApiError(404, "Teacher not found");
  await db
    .update(teachers)
    .set({
      ...(body.departmentId ? { departmentId: body.departmentId } : {}),
      ...(body.designation !== undefined ? { designation: body.designation } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
    })
    .where(eq(teachers.id, id));
  await db
    .update(users)
    .set({
      ...(body.fullName ? { fullName: body.fullName } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, t.userId));
  await audit({ id: admin.id, role: admin.role }, "teacher.update", "teacher", id, body as Record<string, unknown>);
  return jsonOk({ ok: true });
});

export const DELETE = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const id = paramNumber((await ctx.params).id);
  const [t] = await db.select().from(teachers).where(eq(teachers.id, id)).limit(1);
  if (!t) throw new ApiError(404, "Teacher not found");
  await db.update(users).set({ status: "suspended", updatedAt: new Date() }).where(eq(users.id, t.userId));
  await audit({ id: admin.id, role: admin.role }, "teacher.deactivate", "teacher", id, { teacherCode: t.teacherCode });
  return jsonOk({ ok: true, status: "suspended" });
});
