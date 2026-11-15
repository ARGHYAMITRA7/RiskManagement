import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attendanceCorrections, attendanceRecords, attendanceSessions, students, subjects, classes } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, paramNumber, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { assertTeacherClassSubject } from "@/lib/access";
import { audit, notifyStudentAndGuardians } from "@/lib/events";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req, ctx) => {
  const user = await requireUser(["admin", "teacher"]);
  const id = paramNumber((await ctx.params).id);
  const [session] = await db
    .select({
      id: attendanceSessions.id,
      sessionDate: attendanceSessions.sessionDate,
      subjectId: attendanceSessions.subjectId,
      classId: attendanceSessions.classId,
      subjectCode: subjects.code,
      subjectName: subjects.name,
      classCode: classes.code,
    })
    .from(attendanceSessions)
    .innerJoin(subjects, eq(subjects.id, attendanceSessions.subjectId))
    .innerJoin(classes, eq(classes.id, attendanceSessions.classId))
    .where(eq(attendanceSessions.id, id))
    .limit(1);
  if (!session) throw new ApiError(404, "Attendance session not found");
  await assertTeacherClassSubject(user, session.subjectId, session.classId);

  const roster = await db
    .select({ id: students.id, studentCode: students.studentCode, fullName: students.fullName, status: students.status })
    .from(students)
    .where(and(eq(students.classId, session.classId), eq(students.status, "active")))
    .orderBy(asc(students.studentCode));
  const records = await db.select().from(attendanceRecords).where(eq(attendanceRecords.sessionId, id));
  const byStudent = new Map(records.map((r) => [r.studentId, r]));
  const corrections = records.length
    ? await db
        .select()
        .from(attendanceCorrections)
        .where(inArray(attendanceCorrections.recordId, records.map((r) => r.id)))
        .orderBy(desc(attendanceCorrections.createdAt))
    : [];
  return jsonOk({
    session,
    roster: roster.map((s) => {
      const rec = byStudent.get(s.id);
      return {
        studentId: s.id,
        studentCode: s.studentCode,
        fullName: s.fullName,
        recordId: rec?.id ?? null,
        // "unmarked" is a distinct state: it is never counted as absent.
        status: rec?.status ?? "unmarked",
        remarks: rec?.remarks ?? null,
      };
    }),
    corrections,
  });
});

const correctionSchema = z.object({
  reason: z.string().trim().min(5, "Give a reason for the correction (min 5 characters)").max(300),
  changes: z
    .array(z.object({ studentId: z.coerce.number().int().positive(), status: z.enum(["present", "absent", "late", "excused"]) }))
    .min(1),
});

/** Edits or completes a session. Every change is written to attendance_corrections with the reason. */
export const PUT = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const id = paramNumber((await ctx.params).id);
  const body = await readJson(req, correctionSchema);
  const [session] = await db.select().from(attendanceSessions).where(eq(attendanceSessions.id, id)).limit(1);
  if (!session) throw new ApiError(404, "Attendance session not found");
  await assertTeacherClassSubject(user, session.subjectId, session.classId);

  const roster = await db.select({ id: students.id }).from(students).where(eq(students.classId, session.classId));
  const inRoster = new Set(roster.map((r) => r.id));
  const existing = await db.select().from(attendanceRecords).where(eq(attendanceRecords.sessionId, id));
  const byStudent = new Map(existing.map((r) => [r.studentId, r]));
  let changed = 0;
  await db.transaction(async (tx) => {
    for (const change of body.changes) {
      if (!inRoster.has(change.studentId)) throw new ApiError(400, `Student ${change.studentId} is not in this class`);
      const current = byStudent.get(change.studentId);
      if (current && current.status === change.status) continue;
      if (current) {
        await tx.update(attendanceRecords).set({ status: change.status, updatedAt: new Date() }).where(eq(attendanceRecords.id, current.id));
        await tx.insert(attendanceCorrections).values({
          recordId: current.id,
          oldStatus: current.status,
          newStatus: change.status,
          reason: body.reason,
          changedBy: user.id,
        });
      } else {
        const [rec] = await tx
          .insert(attendanceRecords)
          .values({ sessionId: id, studentId: change.studentId, status: change.status })
          .returning();
        await tx.insert(attendanceCorrections).values({ recordId: rec.id, oldStatus: "unmarked", newStatus: change.status, reason: body.reason, changedBy: user.id });
      }
      changed++;
    }
    await tx.update(attendanceSessions).set({ updatedAt: new Date() }).where(eq(attendanceSessions.id, id));
  });
  for (const change of body.changes) {
    await notifyStudentAndGuardians(change.studentId, {
      title: "Attendance record updated",
      message: `Your attendance for ${session.sessionDate} was changed to ${change.status}.`,
      category: "attendance",
      link: "/attendance",
    });
  }
  await audit({ id: user.id, role: user.role }, "attendance.correct", "attendance_session", id, { changed, reason: body.reason });
  return jsonOk({ ok: true, changed });
});

export const DELETE = handle(async (req, ctx) => {
  assertSameOrigin(req);
  void req;
  void ctx;
  throw new ApiError(405, "Attendance sessions cannot be deleted; use corrections so the history is preserved");
});
