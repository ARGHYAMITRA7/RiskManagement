import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { departments, teacherAssignments, teachers, users } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/events";
import { hashPassword, validatePasswordPolicy } from "@/lib/security";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireUser(["admin"]);
  const rows = await db
    .select({
      id: teachers.id,
      teacherCode: teachers.teacherCode,
      designation: teachers.designation,
      phone: teachers.phone,
      departmentId: teachers.departmentId,
      departmentName: departments.name,
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      status: users.status,
      allocations: sql<number>`(select count(*)::int from teacher_assignments ta where ta.teacher_id = ${teachers.id})`,
    })
    .from(teachers)
    .innerJoin(users, eq(users.id, teachers.userId))
    .innerJoin(departments, eq(departments.id, teachers.departmentId))
    .orderBy(teachers.teacherCode);
  return jsonOk({ items: rows });
});

const createSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().min(5).max(200),
  password: z.string().min(8).max(128),
  departmentId: z.coerce.number().int().positive(),
  designation: z.string().trim().max(80).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  allocations: z
    .array(z.object({ subjectId: z.coerce.number().int().positive(), classId: z.coerce.number().int().positive() }))
    .optional(),
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const body = await readJson(req, createSchema);
  const policy = validatePasswordPolicy(body.password, body.email);
  if (policy.length) throw new ApiError(400, policy.join(" "), policy);
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
  if (exists) throw new ApiError(409, "An account with this email already exists");
  const [dept] = await db.select({ id: departments.id }).from(departments).where(eq(departments.id, body.departmentId)).limit(1);
  if (!dept) throw new ApiError(400, "Selected department does not exist");

  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: body.email, fullName: body.fullName, role: "teacher", status: "active", passwordHash: await hashPassword(body.password), phone: body.phone || null })
      .returning();
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(teachers);
    const code = `TCH-${String(Number(n) + 1).padStart(3, "0")}`;
    const [teacher] = await tx
      .insert(teachers)
      .values({ teacherCode: code, userId: user.id, departmentId: body.departmentId, designation: body.designation || null, phone: body.phone || null })
      .returning();
    if (body.allocations?.length) {
      await tx.insert(teacherAssignments).values(body.allocations.map((a) => ({ teacherId: teacher.id, subjectId: a.subjectId, classId: a.classId })));
    }
    return { teacher, user };
  });
  await audit({ id: admin.id, role: admin.role }, "teacher.create", "teacher", result.teacher.id, { teacherCode: result.teacher.teacherCode });
  return jsonOk({ id: result.teacher.id, teacherCode: result.teacher.teacherCode, userId: result.user.id }, 201);
});
