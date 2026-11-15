import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { examResults, exams, studentSubjects, students, subjects, classes } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getStudentForUser } from "@/lib/access";
import { audit } from "@/lib/events";
import { classesForSubject, manageableClassIds, teacherProfileOf } from "@/lib/api-helpers";
import { EXAM_TYPES } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Staff: exams for allocated subjects (admins: all). Students: exams for enrolled subjects, with published results only. */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const subjectId = url.searchParams.get("subjectId") ? Number(url.searchParams.get("subjectId")) : null;

  if (user.role === "student" || user.role === "guardian") {
    const me = user.role === "student" ? await getStudentForUser(user.id) : null;
    if (user.role === "guardian") throw new ApiError(403, "Guardians view exams from the student's record view");
    if (!me) return jsonOk({ items: [] });
    const rows = await db.execute(sql`
      select e.id, e.name, e.exam_type, e.exam_date, e.max_marks, e.pass_marks, e.status, sub.id as subject_id, sub.code as subject_code, sub.name as subject_name,
             er.marks_obtained as my_marks,
             case when e.status = 'published' then er.marks_obtained else null end as published_marks
      from exams e
      join subjects sub on sub.id = e.subject_id
      join student_subjects ss on ss.subject_id = e.subject_id and ss.student_id = ${me.id}
      left join exam_results er on er.exam_id = e.id and er.student_id = ${me.id}
      where true ${subjectId ? sql`and e.subject_id = ${subjectId}` : sql``}
      order by e.exam_date desc`);
    const items = (rows.rows as Record<string, unknown>[]).map((r) => ({
      ...r,
      my_marks: r.status === "published" ? r.my_marks : null,
      results_pending: r.status !== "published",
    }));
    return jsonOk({ items });
  }

  const scope = await manageableClassIds(user);
  const conds: SQL[] = [];
  if (scope !== "all") {
    if (scope.length === 0) return jsonOk({ items: [] });
    const t = await teacherProfileOf(user);
    const allowed = await db.execute(sql`select distinct subject_id from teacher_assignments where teacher_id = ${t!.id}`);
    const subs = (allowed.rows as { subject_id: number }[]).map((r) => r.subject_id);
    if (subs.length === 0) return jsonOk({ items: [] });
    conds.push(sql`e.subject_id in (${sql.join(subs.map((s) => sql`${s}`), sql`, `)})`);
  }
  if (subjectId) conds.push(sql`e.subject_id = ${subjectId}`);
  const status = url.searchParams.get("status");
  if (status) conds.push(sql`e.status = ${status}`);
  const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
  const rows = await db.execute(sql`
    select e.id, e.name, e.exam_type, e.exam_date, e.max_marks, e.pass_marks, e.status, e.class_id,
           sub.id as subject_id, sub.code as subject_code, sub.name as subject_name, sub.semester,
           (select count(*)::int from exam_results r where r.exam_id = e.id) as result_rows,
           (select count(*)::int from exam_results r where r.exam_id = e.id and r.marks_obtained is not null) as entered_rows
    from exams e join subjects sub on sub.id = e.subject_id
    ${where}
    order by e.exam_date desc, sub.code`);
  return jsonOk({ items: rows.rows });
});

const createSchema = z
  .object({
    name: z.string().trim().min(3).max(160),
    examType: z.enum(EXAM_TYPES),
    subjectId: z.coerce.number().int().positive(),
    classId: z.coerce.number().int().positive().nullable().optional(),
    examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    maxMarks: z.coerce.number().min(1).max(1000),
    passMarks: z.coerce.number().min(0).max(1000),
  })
  .refine((v) => v.passMarks <= v.maxMarks, { message: "Pass marks cannot exceed maximum marks" });

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const body = await readJson(req, createSchema);
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, body.subjectId)).limit(1);
  if (!subject) throw new ApiError(400, "Subject not found");
  const allowed = await classesForSubject(user, body.subjectId);
  if (allowed !== "all" && allowed.length === 0) throw new ApiError(403, "You are not allocated to this subject");
  if (body.classId) {
    const [cls] = await db.select().from(classes).where(eq(classes.id, body.classId)).limit(1);
    if (!cls || cls.semester !== subject.semester) throw new ApiError(400, "The class must be in the subject's semester");
    if (allowed !== "all" && !allowed.includes(body.classId)) throw new ApiError(403, "You are not allocated to this subject and class");
  }
  const [row] = await db
    .insert(exams)
    .values({ ...body, classId: body.classId ?? null, status: "scheduled", createdBy: user.id })
    .returning();
  await audit({ id: user.id, role: user.role }, "exam.create", "exam", row.id, { subjectId: body.subjectId, examType: body.examType });
  return jsonOk(row, 201);
});
