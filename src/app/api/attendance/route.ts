import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attendanceRecords, attendanceSessions, students, subjects, classes, users, studentSubjects } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { assertTeacherClassSubject, getStudentForUser } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { audit, notifyStudentAndGuardians } from "@/lib/events";
import { manageableClassIds, pageParams } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** Session list with marked / unmarked counts. Unmarked students are reported separately from absences. */
export const GET = handle(async (req) => {
  const user = await requireUser(["admin", "teacher", "student"]);
  const url = new URL(req.url);
  const { page, pageSize, offset } = pageParams(url);
  if (user.role === "student") {
    // Students see their own daily records (never other students' data).
    const me = await getStudentForUser(user.id);
    if (!me) return jsonOk({ items: [], total: 0, page, pageSize });
    const rows = await db.execute(sql`
      select r.status, r.remarks, s.session_date, sub.code as subject_code, sub.name as subject_name
      from attendance_records r join attendance_sessions s on s.id = r.session_id join subjects sub on sub.id = s.subject_id
      where r.student_id = ${me.id} order by s.session_date desc, sub.code limit ${pageSize} offset ${offset}`);
    return jsonOk({ items: rows.rows, total: rows.rows.length, page, pageSize });
  }
  const scope = await manageableClassIds(user);
  const conds = [];
  if (scope !== "all") {
    if (scope.length === 0) return jsonOk({ items: [], total: 0, page, pageSize });
    conds.push(sql`s.class_id in (${sql.join(scope.map((c) => sql`${c}`), sql`, `)})`);
  }
  if (url.searchParams.get("classId")) conds.push(sql`s.class_id = ${Number(url.searchParams.get("classId"))}`);
  if (url.searchParams.get("subjectId")) conds.push(sql`s.subject_id = ${Number(url.searchParams.get("subjectId"))}`);
  if (url.searchParams.get("from")) conds.push(sql`s.session_date >= ${url.searchParams.get("from")}`);
  if (url.searchParams.get("to")) conds.push(sql`s.session_date <= ${url.searchParams.get("to")}`);
  const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
  const from = sql`
    from attendance_sessions s
    join subjects sub on sub.id = s.subject_id
    join classes c on c.id = s.class_id
    left join attendance_records r on r.session_id = s.id`;
  const rows = await db.execute(sql`
    select s.id, s.session_date, s.subject_id, sub.code as subject_code, sub.name as subject_name, s.class_id, c.code as class_code,
           count(r.id)::int as marked,
           sum(case when r.status = 'present' then 1 else 0 end)::int as present,
           sum(case when r.status = 'late' then 1 else 0 end)::int as late,
           sum(case when r.status = 'absent' then 1 else 0 end)::int as absent,
           sum(case when r.status = 'excused' then 1 else 0 end)::int as excused,
           (select count(*) from students st where st.class_id = s.class_id and st.status = 'active')::int as class_size,
           s.created_at, s.updated_at
    ${from} ${where}
    group by s.id, sub.code, sub.name, c.code
    order by s.session_date desc, sub.code
    limit ${pageSize} offset ${offset}`);
  const count = await db.execute(sql`select count(*)::int as total from attendance_sessions s ${where}`);
  return jsonOk({ items: rows.rows, total: Number((count.rows[0] as { total: number }).total), page, pageSize });
});

const recordSchema = z.object({
  studentId: z.coerce.number().int().positive(),
  status: z.enum(["present", "absent", "late", "excused"]),
  remarks: z.string().trim().max(200).optional().nullable(),
});

const createSchema = z.object({
  subjectId: z.coerce.number().int().positive(),
  classId: z.coerce.number().int().positive(),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  topicId: z.coerce.number().int().positive().nullable().optional(),
  records: z.array(recordSchema).min(1, "Mark at least one student"),
});

/** Creates one attendance session per subject, class and date, with the marked records. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const body = await readJson(req, createSchema);
  const today = new Date().toISOString().slice(0, 10);
  if (body.sessionDate > today) throw new ApiError(400, "Attendance cannot be recorded for a future date");
  const teacher = await assertTeacherClassSubject(user, body.subjectId, body.classId);
  const ids = [...new Set(body.records.map((r) => r.studentId))];
  if (ids.length !== body.records.length) throw new ApiError(400, "Each student may appear only once in a session");
  const inClass = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.classId, body.classId), inArray(students.id, ids)));
  if (inClass.length !== ids.length) throw new ApiError(400, "One or more students do not belong to the selected class");

  const [dup] = await db
    .select({ id: attendanceSessions.id })
    .from(attendanceSessions)
    .where(and(eq(attendanceSessions.subjectId, body.subjectId), eq(attendanceSessions.classId, body.classId), eq(attendanceSessions.sessionDate, body.sessionDate)))
    .limit(1);
  if (dup) throw new ApiError(409, "Attendance has already been recorded for this subject, class and date. Open the session to make corrections.", { sessionId: dup.id });

  const session = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(attendanceSessions)
      .values({
        subjectId: body.subjectId,
        classId: body.classId,
        teacherId: teacher?.id ?? null,
        sessionDate: body.sessionDate,
        topicId: body.topicId ?? null,
        createdBy: user.id,
      })
      .returning();
    await tx.insert(attendanceRecords).values(
      body.records.map((r) => ({ sessionId: s.id, studentId: r.studentId, status: r.status, remarks: r.remarks || null })),
    );
    return s;
  });

  // Low-attendance alerts: notify students (and linked guardians) whose overall attendance is now below target.
  const settings = await getSettings();
  const pct = await db.execute(sql`
    select r.student_id, (sum(case when r.status in ('present','late') then 1 else 0 end)::float / nullif(sum(case when r.status <> 'excused' then 1 else 0 end), 0) * 100)::float as pct
    from attendance_records r where r.student_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) group by r.student_id`);
  for (const row of pct.rows as { student_id: number; pct: number | null }[]) {
    if (row.pct !== null && row.pct < settings.attendanceThresholdPct) {
      await notifyStudentAndGuardians(row.student_id, {
        title: "Attendance below target",
        message: `Your attendance is ${Math.round(row.pct)}%, below the ${settings.attendanceThresholdPct}% institutional target.`,
        category: "attendance",
        link: "/attendance",
      });
    }
  }
  await audit({ id: user.id, role: user.role }, "attendance.create", "attendance_session", session.id, { records: body.records.length, date: body.sessionDate });
  return jsonOk({ id: session.id, recorded: body.records.length }, 201);
});
