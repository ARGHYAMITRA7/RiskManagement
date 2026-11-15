import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assignments, students, studentSubjects } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { assertTeacherClassSubject, getStudentForUser } from "@/lib/access";
import { audit, notifyStudentAndGuardians } from "@/lib/events";
import { manageableClassIds, parseBody } from "@/lib/api-helpers";
import { saveUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const user = await requireUser(["admin", "teacher", "student"]);
  const url = new URL(req.url);
  const subjectId = url.searchParams.get("subjectId") ? Number(url.searchParams.get("subjectId")) : null;
  const conds: SQL[] = [];
  let mySubmissionJoin = sql``;
  if (user.role === "student") {
    const me = await getStudentForUser(user.id);
    if (!me?.classId) return jsonOk({ items: [] });
    conds.push(sql`a.class_id = ${me.classId}`);
    mySubmissionJoin = sql`and x.student_id = ${me.id}`;
  } else {
    const scope = await manageableClassIds(user);
    if (scope !== "all") {
      if (scope.length === 0) return jsonOk({ items: [] });
      conds.push(sql`a.class_id in (${sql.join(scope.map((c) => sql`${c}`), sql`, `)})`);
    }
  }
  if (subjectId) conds.push(sql`a.subject_id = ${subjectId}`);
  const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
  const rows = await db.execute(sql`
    select a.id, a.title, a.deadline, a.max_marks, a.allow_resubmission, a.subject_id, a.class_id, a.attachment_name,
           sub.code as subject_code, sub.name as subject_name, c.code as class_code, t.name as topic_name,
           (select count(*)::int from students st where st.class_id = a.class_id and st.status = 'active') as expected,
           (select count(*)::int from assignment_submissions x where x.assignment_id = a.id) as submitted,
           (select count(*)::int from assignment_submissions x where x.assignment_id = a.id and x.is_late) as late,
           (select count(*)::int from assignment_submissions x where x.assignment_id = a.id and x.status = 'graded') as graded,
           x.id as my_submission_id, x.submitted_at as my_submitted_at, x.is_late as my_is_late, x.marks as my_marks, x.status as my_status, x.feedback as my_feedback
    from assignments a
    join subjects sub on sub.id = a.subject_id
    left join classes c on c.id = a.class_id
    left join topics t on t.id = a.topic_id
    left join assignment_submissions x on x.assignment_id = a.id ${mySubmissionJoin}
    ${where}
    order by a.deadline desc limit 200`);
  const now = Date.now();
  const items = (rows.rows as Record<string, unknown>[]).map((r) => ({
    ...r,
    overdue: new Date(String(r.deadline)).getTime() < now,
    my_status: r.my_submission_id ? r.my_status : "not_submitted",
  }));
  return jsonOk({ items });
});

const boolish = z.preprocess((v) => v === true || v === "true" || v === "on" || v === 1 || v === "1", z.boolean());

const createSchema = z.object({
  title: z.string().trim().min(3).max(160),
  subjectId: z.coerce.number().int().positive(),
  classId: z.coerce.number().int().positive(),
  topicId: z.coerce.number().int().positive().nullable().optional(),
  instructions: z.string().trim().min(10).max(5000),
  deadline: z.coerce.date(),
  maxMarks: z.coerce.number().min(1).max(100),
  allowResubmission: boolish.default(false),
});

/** Teacher/admin: creates an assignment for a class, optionally with a validated attachment, and notifies the class. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const { json, files } = await parseBody(req);
  const body = createSchema.parse(json);
  if (body.deadline.getTime() <= Date.now()) throw new ApiError(400, "The deadline must be in the future");
  await assertTeacherClassSubject(user, body.subjectId, body.classId);
  let attachment: { relPath: string; fileName: string } | null = null;
  const file = files.attachment;
  if (file instanceof File) {
    const saved = await saveUpload(file, "document", "attachments");
    attachment = { relPath: saved.relPath, fileName: saved.fileName };
  }
  const [row] = await db
    .insert(assignments)
    .values({
      title: body.title,
      subjectId: body.subjectId,
      classId: body.classId,
      topicId: body.topicId ?? null,
      instructions: body.instructions,
      deadline: body.deadline,
      maxMarks: body.maxMarks,
      allowResubmission: body.allowResubmission,
      attachmentPath: attachment?.relPath ?? null,
      attachmentName: attachment?.fileName ?? null,
      createdBy: user.id,
    })
    .returning();
  const classStudents = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.classId, body.classId), eq(students.status, "active")));
  for (const s of classStudents) {
    await notifyStudentAndGuardians(s.id, {
      title: "New assignment",
      message: `${body.title} is due ${body.deadline.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
      category: "assignment",
      link: "/assignments",
    });
  }
  await audit({ id: user.id, role: user.role }, "assignment.create", "assignment", row.id, { title: body.title, classId: body.classId });
  return jsonOk(row, 201);
});
