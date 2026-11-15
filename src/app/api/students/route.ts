import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { students, classes, courses, subjects, users, studentSubjects } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { accessibleStudentIds } from "@/lib/access";
import { audit } from "@/lib/events";
import { pageParams } from "@/lib/api-helpers";
import { nextStudentCode, syncEnrolments } from "@/lib/students";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const SORTS: Record<string, string> = {
  name: "s.full_name",
  code: "s.student_code",
  semester: "s.current_semester",
  risk: "r.risk_score",
  class: "c.code",
};

/** Filtered, sorted, paginated student list. Scope is enforced server-side per role. */
export const GET = handle(async (req) => {
  const user = await requireUser(["admin", "teacher"]);
  const url = new URL(req.url);
  const { page, pageSize, offset } = pageParams(url);
  const scope = await accessibleStudentIds(user);
  const conds: SQL[] = [];
  if (scope !== "all") {
    if (scope.length === 0) return jsonOk({ items: [], total: 0, page, pageSize });
    conds.push(sql`s.id in (${sql.join(scope.map((i) => sql`${i}`), sql`, `)})`);
  }
  const status = url.searchParams.get("status") ?? "active";
  if (status !== "all") conds.push(sql`s.status = ${status}`);
  const q = url.searchParams.get("q")?.trim();
  if (q) conds.push(sql`(s.full_name ilike ${`%${q}%`} or s.student_code ilike ${`%${q}%`})`);
  if (url.searchParams.get("classId")) conds.push(sql`s.class_id = ${Number(url.searchParams.get("classId"))}`);
  if (url.searchParams.get("courseId")) conds.push(sql`s.course_id = ${Number(url.searchParams.get("courseId"))}`);
  if (url.searchParams.get("semester")) conds.push(sql`s.current_semester = ${Number(url.searchParams.get("semester"))}`);
  const risk = url.searchParams.get("risk");
  if (risk && ["low", "medium", "high"].includes(risk)) conds.push(sql`r.risk_category = ${risk}`);
  const sortKey = SORTS[url.searchParams.get("sort") ?? "code"] ?? "s.student_code";
  const dir = url.searchParams.get("order") === "desc" ? "desc" : "asc";
  const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
  const from = sql`
    from students s
    left join classes c on c.id = s.class_id
    left join courses co on co.id = s.course_id
    left join users u on u.id = s.user_id
    left join lateral (select p.risk_category, p.risk_score, p.predicted_at from risk_predictions p
                       where p.student_id = s.id order by p.predicted_at desc limit 1) r on true`;
  const rows = await db.execute(sql`
    select s.id, s.student_code, s.full_name, s.email, s.phone, s.current_semester, s.status, s.class_id, s.course_id,
           c.code as class_code, c.name as class_name, co.code as course_code, co.name as course_name,
           s.user_id, u.status as account_status, r.risk_category, r.risk_score, r.predicted_at
    ${from} ${where}
    order by ${sql.raw(sortKey)} ${sql.raw(dir)} nulls last, s.student_code asc
    limit ${pageSize} offset ${offset}`);
  const count = await db.execute(sql`select count(*)::int as total ${from} ${where}`);
  return jsonOk({ items: rows.rows, total: Number((count.rows[0] as { total: number }).total), page, pageSize });
});

const createSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().max(200).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  courseId: z.coerce.number().int().positive(),
  classId: z.coerce.number().int().positive().nullable().optional(),
  academicYearId: z.coerce.number().int().positive().nullable().optional(),
  currentSemester: z.coerce.number().int().min(1).max(12),
  studentCode: z.string().trim().min(3).max(40).optional(),
  guardianName: z.string().trim().max(120).optional().nullable(),
  guardianPhone: z.string().trim().max(20).optional().nullable(),
  guardianEmail: z.string().trim().toLowerCase().max(200).optional().nullable(),
  dailyStudyGoalMinutes: z.coerce.number().int().min(15).max(600).default(60),
});

/** Admin: creates a student record, generates the student ID when absent and enrols the student in the semester's subjects. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const body = await readJson(req, createSchema);
  const [course] = await db.select({ id: courses.id }).from(courses).where(eq(courses.id, body.courseId)).limit(1);
  if (!course) throw new ApiError(400, "Selected course does not exist");
  if (body.classId) {
    const [cls] = await db.select().from(classes).where(eq(classes.id, body.classId)).limit(1);
    if (!cls) throw new ApiError(400, "Selected class does not exist");
    if (cls.courseId !== body.courseId || cls.semester !== body.currentSemester) {
      throw new ApiError(400, "The class must belong to the selected course and semester");
    }
  }
  const code = body.studentCode ?? (await nextStudentCode());
  const [dup] = await db.select({ id: students.id }).from(students).where(eq(students.studentCode, code)).limit(1);
  if (dup) throw new ApiError(409, `Student ID ${code} already exists`);

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(students)
      .values({
        studentCode: code,
        fullName: body.fullName,
        email: body.email || null,
        phone: body.phone || null,
        courseId: body.courseId,
        classId: body.classId ?? null,
        academicYearId: body.academicYearId ?? null,
        currentSemester: body.currentSemester,
        guardianName: body.guardianName || null,
        guardianPhone: body.guardianPhone || null,
        guardianEmail: body.guardianEmail || null,
        dailyStudyGoalMinutes: body.dailyStudyGoalMinutes,
      })
      .returning();
    const enrolled = await syncEnrolments(tx, row.id, body.courseId, body.currentSemester);
    return { ...row, enrolled };
  });
  await audit({ id: admin.id, role: admin.role }, "student.create", "student", created.id, { studentCode: code, enrolled: created.enrolled });
  return jsonOk(created, 201);
});
