import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { classes, subjects, teacherAssignments, teachers, users } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/events";
import { getTeacherForUser } from "@/lib/access";

export const dynamic = "force-dynamic";

/** Teacher-to-subject-and-class allocations. Admins see all; teachers see their own. */
export const GET = handle(async () => {
  const user = await requireUser(["admin", "teacher"]);
  const base = db
    .select({
      id: teacherAssignments.id,
      teacherId: teacherAssignments.teacherId,
      teacherCode: teachers.teacherCode,
      teacherName: users.fullName,
      subjectId: subjects.id,
      subjectCode: subjects.code,
      subjectName: subjects.name,
      classId: classes.id,
      classCode: classes.code,
      semester: classes.semester,
    })
    .from(teacherAssignments)
    .innerJoin(teachers, eq(teachers.id, teacherAssignments.teacherId))
    .innerJoin(users, eq(users.id, teachers.userId))
    .innerJoin(subjects, eq(subjects.id, teacherAssignments.subjectId))
    .innerJoin(classes, eq(classes.id, teacherAssignments.classId));
  if (user.role === "teacher") {
    const t = await getTeacherForUser(user.id);
    if (!t) return jsonOk({ items: [] });
    return jsonOk({ items: await base.where(eq(teacherAssignments.teacherId, t.id)) });
  }
  return jsonOk({ items: await base });
});

const schema = z.object({
  teacherId: z.coerce.number().int().positive(),
  subjectId: z.coerce.number().int().positive(),
  classId: z.coerce.number().int().positive(),
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const body = await readJson(req, schema);
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, body.subjectId)).limit(1);
  const [cls] = await db.select().from(classes).where(eq(classes.id, body.classId)).limit(1);
  if (!subject || !cls) throw new ApiError(400, "Subject or class does not exist");
  if (subject.semester !== cls.semester) throw new ApiError(400, "The subject's semester must match the class semester");
  if (subject.courseId !== cls.courseId) throw new ApiError(400, "The subject and class belong to different courses");
  try {
    const [row] = await db.insert(teacherAssignments).values(body).returning();
    await audit({ id: admin.id, role: admin.role }, "allocation.create", "teacher_assignment", row.id, body);
    return jsonOk(row, 201);
  } catch {
    throw new ApiError(409, "This teacher is already allocated to that subject and class");
  }
});

export const DELETE = handle(async (req) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "id is required");
  const [row] = await db.delete(teacherAssignments).where(eq(teacherAssignments.id, id)).returning();
  if (!row) throw new ApiError(404, "Allocation not found");
  await audit({ id: admin.id, role: admin.role }, "allocation.delete", "teacher_assignment", id, {});
  return jsonOk({ ok: true });
});
