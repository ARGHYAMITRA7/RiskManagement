import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { classes, subjects, teacherAssignments, teachers, timetableEntries, users } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getStudentForUser, getTeacherForUser } from "@/lib/access";
import { audit } from "@/lib/events";

export const dynamic = "force-dynamic";

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

const select = {
  id: timetableEntries.id,
  classId: timetableEntries.classId,
  classCode: classes.code,
  subjectId: timetableEntries.subjectId,
  subjectCode: subjects.code,
  subjectName: subjects.name,
  teacherId: timetableEntries.teacherId,
  teacherName: users.fullName,
  dayOfWeek: timetableEntries.dayOfWeek,
  startTime: timetableEntries.startTime,
  endTime: timetableEntries.endTime,
  room: timetableEntries.room,
};

/** Student: own class timetable. Teacher: own teaching timetable. Admin: any class or teacher. */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const classParam = url.searchParams.get("classId");
  const teacherParam = url.searchParams.get("teacherId");
  const conds = [];
  if (user.role === "student") {
    const me = await getStudentForUser(user.id);
    if (!me?.classId) return jsonOk({ items: [] });
    conds.push(eq(timetableEntries.classId, me.classId));
  } else if (user.role === "teacher") {
    const t = await getTeacherForUser(user.id);
    if (!t) return jsonOk({ items: [] });
    conds.push(or(eq(timetableEntries.teacherId, t.id), classParam ? eq(timetableEntries.classId, Number(classParam)) : undefined)!);
  } else if (user.role === "guardian") {
    throw new ApiError(403, "Use the guardian dashboard to view a linked student's timetable");
  }
  if (classParam && user.role === "admin") conds.push(eq(timetableEntries.classId, Number(classParam)));
  if (teacherParam && user.role === "admin") conds.push(eq(timetableEntries.teacherId, Number(teacherParam)));
  const rows = await db
    .select(select)
    .from(timetableEntries)
    .innerJoin(classes, eq(classes.id, timetableEntries.classId))
    .innerJoin(subjects, eq(subjects.id, timetableEntries.subjectId))
    .innerJoin(teachers, eq(teachers.id, timetableEntries.teacherId))
    .innerJoin(users, eq(users.id, teachers.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(timetableEntries.dayOfWeek, timetableEntries.startTime);
  return jsonOk({ items: rows });
});

const createSchema = z
  .object({
    classId: z.coerce.number().int().positive(),
    subjectId: z.coerce.number().int().positive(),
    teacherId: z.coerce.number().int().positive(),
    dayOfWeek: z.coerce.number().int().min(1).max(6),
    startTime: z.string().regex(timeRe, "Use HH:MM (24 hour)"),
    endTime: z.string().regex(timeRe, "Use HH:MM (24 hour)"),
    room: z.string().trim().max(40).optional().nullable(),
  })
  .refine((v) => v.startTime < v.endTime, { message: "End time must be after the start time" });

/** Creates a slot after validating that neither the class nor the teacher is double-booked. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const body = await readJson(req, createSchema);
  if (user.role === "teacher") {
    const t = await getTeacherForUser(user.id);
    if (!t || t.id !== body.teacherId) throw new ApiError(403, "Teachers can only schedule their own sessions");
  }
  const [allocated] = await db
    .select({ id: teacherAssignments.id })
    .from(teacherAssignments)
    .where(and(eq(teacherAssignments.teacherId, body.teacherId), eq(teacherAssignments.subjectId, body.subjectId), eq(teacherAssignments.classId, body.classId)))
    .limit(1);
  if (!allocated && user.role !== "admin") throw new ApiError(403, "The teacher is not allocated to this subject and class");
  if (!allocated) throw new ApiError(400, "Allocate the teacher to this subject and class before scheduling");

  const overlaps = await db
    .select({ ...select })
    .from(timetableEntries)
    .innerJoin(classes, eq(classes.id, timetableEntries.classId))
    .innerJoin(subjects, eq(subjects.id, timetableEntries.subjectId))
    .innerJoin(teachers, eq(teachers.id, timetableEntries.teacherId))
    .innerJoin(users, eq(users.id, teachers.userId))
    .where(
      and(
        eq(timetableEntries.dayOfWeek, body.dayOfWeek),
        sql`${timetableEntries.startTime} < ${body.endTime} and ${body.startTime} < ${timetableEntries.endTime}`,
        or(eq(timetableEntries.classId, body.classId), eq(timetableEntries.teacherId, body.teacherId)),
      ),
    );
  if (overlaps.length) {
    const first = overlaps[0];
    const reason = first.classId === body.classId ? `class ${first.classCode} already has ${first.subjectCode}` : `${first.teacherName} is already teaching ${first.subjectCode} (${first.classCode})`;
    throw new ApiError(409, `Timetable conflict: ${reason} from ${first.startTime} to ${first.endTime}.`, overlaps);
  }
  const [row] = await db.insert(timetableEntries).values({ ...body, room: body.room ?? "" }).returning();
  await audit({ id: user.id, role: user.role }, "timetable.create", "timetable_entry", row.id, body);
  return jsonOk(row, 201);
});

export const DELETE = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "id is required");
  const [entry] = await db.select().from(timetableEntries).where(eq(timetableEntries.id, id)).limit(1);
  if (!entry) throw new ApiError(404, "Timetable entry not found");
  if (user.role === "teacher") {
    const t = await getTeacherForUser(user.id);
    if (!t || t.id !== entry.teacherId) throw new ApiError(403, "You can only remove your own sessions");
  }
  await db.delete(timetableEntries).where(eq(timetableEntries.id, id));
  await audit({ id: user.id, role: user.role }, "timetable.delete", "timetable_entry", id, {});
  return jsonOk({ ok: true });
});
