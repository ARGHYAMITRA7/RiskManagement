import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { quizzes, questions, studentSubjects } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getStudentForUser } from "@/lib/access";
import { audit } from "@/lib/events";
import { classesForSubject } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** Students see published quizzes for enrolled subjects. Staff see quizzes for their allocated subjects. */
export const GET = handle(async (req) => {
  const user = await requireUser(["admin", "teacher", "student"]);
  const subjectId = new URL(req.url).searchParams.get("subjectId");
  if (user.role === "student") {
    const me = await getStudentForUser(user.id);
    if (!me) return jsonOk({ items: [] });
    const rows = await db.execute(sql`
      select q.id, q.title, q.subject_id, q.topic_id, q.time_limit_seconds, q.question_count, q.is_published,
             sub.code as subject_code, sub.name as subject_name, t.name as topic_name,
             (select count(*)::int from quiz_attempts a where a.quiz_id = q.id and a.student_id = ${me.id} and a.status = 'submitted') as my_attempts,
             (select a.percentage from quiz_attempts a where a.quiz_id = q.id and a.student_id = ${me.id} and a.status = 'submitted' order by a.submitted_at desc limit 1) as my_last_pct,
             (select count(*)::int from questions qq where qq.is_active and qq.subject_id = q.subject_id and (q.topic_id is null or qq.topic_id = q.topic_id)) as available_questions
      from quizzes q
      join student_subjects ss on ss.subject_id = q.subject_id and ss.student_id = ${me.id}
      join subjects sub on sub.id = q.subject_id
      left join topics t on t.id = q.topic_id
      where q.is_published ${subjectId ? sql`and q.subject_id = ${Number(subjectId)}` : sql``}
      order by sub.code, q.title`);
    return jsonOk({ items: rows.rows });
  }
  const scope = await (async () => {
    if (user.role === "admin") return null;
    return "teacher";
  })();
  const rows = await db.execute(sql`
    select q.id, q.title, q.subject_id, q.topic_id, q.time_limit_seconds, q.question_count, q.is_published,
           sub.code as subject_code, sub.name as subject_name, t.name as topic_name,
           (select count(*)::int from quiz_attempts a where a.quiz_id = q.id and a.status = 'submitted') as attempts,
           (select round(avg(a.percentage)::numeric, 1)::float from quiz_attempts a where a.quiz_id = q.id and a.status = 'submitted') as avg_pct,
           (select count(*)::int from questions qq where qq.is_active and qq.subject_id = q.subject_id and (q.topic_id is null or qq.topic_id = q.topic_id)) as available_questions
    from quizzes q join subjects sub on sub.id = q.subject_id left join topics t on t.id = q.topic_id
    where true ${subjectId ? sql`and q.subject_id = ${Number(subjectId)}` : sql``}
    order by sub.code, q.title`);
  const items = [];
  for (const r of rows.rows as { subject_id: number }[]) {
    if (scope === null || (await classesForSubject(user, r.subject_id)) !== undefined) {
      const allowed = scope === null ? "all" : await classesForSubject(user, r.subject_id);
      if (allowed === "all" || (Array.isArray(allowed) && allowed.length > 0)) items.push(r);
    }
  }
  return jsonOk({ items });
});

const createSchema = z.object({
  title: z.string().trim().min(3).max(160),
  subjectId: z.coerce.number().int().positive(),
  topicId: z.coerce.number().int().positive().nullable().optional(),
  timeLimitSeconds: z.coerce.number().int().min(60).max(3600).default(600),
  questionCount: z.coerce.number().int().min(1).max(20).default(5),
  isPublished: z.boolean().default(true),
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const body = await readJson(req, createSchema);
  const allowed = await classesForSubject(user, body.subjectId);
  if (allowed !== "all" && allowed.length === 0) throw new ApiError(403, "You are not allocated to this subject");
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(questions)
    .where(and(eq(questions.subjectId, body.subjectId), eq(questions.isActive, true), body.topicId ? eq(questions.topicId, body.topicId) : undefined));
  if (Number(n) === 0) throw new ApiError(409, "Add active questions to the question bank before creating a quiz for this scope");
  const [row] = await db.insert(quizzes).values({ ...body, topicId: body.topicId ?? null, createdBy: user.id }).returning();
  await audit({ id: user.id, role: user.role }, "quiz.create", "quiz", row.id, { title: body.title, available: Number(n) });
  return jsonOk({ ...row, availableQuestions: Number(n), lowBankWarning: Number(n) < body.questionCount }, 201);
});
