import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { quizAttempts, quizzes, studentSubjects } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getStudentForUser } from "@/lib/access";
import { startAttempt } from "@/lib/quiz";
import { audit } from "@/lib/events";

export const dynamic = "force-dynamic";

/** Student: own attempt history. Staff: attempts for a quiz (scope enforced by quiz subject allocation). */
export const GET = handle(async (req) => {
  const user = await requireUser(["admin", "teacher", "student"]);
  const quizId = new URL(req.url).searchParams.get("quizId");
  if (user.role === "student") {
    const me = await getStudentForUser(user.id);
    if (!me) return jsonOk({ items: [] });
    const items = await db
      .select({
        id: quizAttempts.id,
        quizId: quizAttempts.quizId,
        quizTitle: quizzes.title,
        status: quizAttempts.status,
        startedAt: quizAttempts.startedAt,
        submittedAt: quizAttempts.submittedAt,
        score: quizAttempts.score,
        maxScore: quizAttempts.maxScore,
        percentage: quizAttempts.percentage,
        startDifficulty: quizAttempts.startDifficulty,
        endDifficulty: quizAttempts.endDifficulty,
      })
      .from(quizAttempts)
      .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
      .where(eq(quizAttempts.studentId, me.id))
      .orderBy(desc(quizAttempts.startedAt))
      .limit(100);
    return jsonOk({ items });
  }
  if (!quizId) throw new ApiError(400, "quizId is required");
  const rows = await db.execute(sql`
    select a.id, a.status, a.started_at, a.submitted_at, a.percentage, a.score, a.max_score, st.student_code, st.full_name
    from quiz_attempts a join students st on st.id = a.student_id where a.quiz_id = ${Number(quizId)} order by a.started_at desc limit 200`);
  return jsonOk({ items: rows.rows });
});

const startSchema = z.object({ quizId: z.coerce.number().int().positive() });

/** Starts (or resumes) a timed attempt. Questions are selected adaptively; correct answers are never returned. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["student"]);
  const body = await readJson(req, startSchema);
  const me = await getStudentForUser(user.id);
  if (!me) throw new ApiError(403, "No student record is linked to this account");
  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, body.quizId)).limit(1);
  if (!quiz) throw new ApiError(404, "Quiz not found");
  const [enrolled] = await db
    .select({ id: studentSubjects.id })
    .from(studentSubjects)
    .where(sql`${studentSubjects.studentId} = ${me.id} and ${studentSubjects.subjectId} = ${quiz.subjectId}`)
    .limit(1);
  if (!enrolled) throw new ApiError(403, "You are not enrolled in this subject");
  const attempt = await startAttempt(me.id, body.quizId);
  await audit({ id: user.id, role: user.role }, "quiz.start", "quiz_attempt", attempt.attempt.id, { quizId: body.quizId, resumed: attempt.resumed });
  return jsonOk(attempt, attempt.resumed ? 200 : 201);
});
