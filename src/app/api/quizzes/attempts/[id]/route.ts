import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { quizAnswers, quizAttempts, questions, quizzes, students } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, paramNumber, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getStudentForUser } from "@/lib/access";
import { buildAttemptView, overrideAnswer, submitAttempt } from "@/lib/quiz";
import { audit } from "@/lib/events";
import { classesForSubject } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req, ctx) => {
  const user = await requireUser(["admin", "teacher", "student"]);
  const id = paramNumber((await ctx.params).id);
  const [attempt] = await db.select().from(quizAttempts).where(eq(quizAttempts.id, id)).limit(1);
  if (!attempt) throw new ApiError(404, "Attempt not found");
  if (user.role === "student") {
    const me = await getStudentForUser(user.id);
    if (!me || me.id !== attempt.studentId) throw new ApiError(403, "You can only open your own attempts");
    if (attempt.status === "in_progress") return jsonOk(await buildAttemptView(id));
    // Closed attempts show the review (answers and explanations) after submission.
    return jsonOk({ review: await reviewOf(id), summary: attempt });
  }
  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, attempt.quizId)).limit(1);
  const scope = await classesForSubject(user, quiz.subjectId);
  if (scope !== "all" && scope.length === 0) throw new ApiError(403, "You are not allocated to this subject");
  const [st] = await db.select({ code: students.studentCode, name: students.fullName }).from(students).where(eq(students.id, attempt.studentId)).limit(1);
  return jsonOk({ review: await reviewOf(id), summary: attempt, student: st });
});

async function reviewOf(attemptId: number) {
  return db
    .select({
      questionId: quizAnswers.questionId,
      position: quizAnswers.position,
      difficulty: quizAnswers.difficulty,
      givenAnswer: quizAnswers.givenAnswer,
      isCorrect: quizAnswers.isCorrect,
      needsReview: quizAnswers.needsReview,
      prompt: questions.prompt,
      correctAnswer: questions.correctAnswer,
      explanation: questions.explanation,
    })
    .from(quizAnswers)
    .innerJoin(questions, eq(questions.id, quizAnswers.questionId))
    .where(eq(quizAnswers.attemptId, attemptId))
    .orderBy(quizAnswers.position);
}

const submitSchema = z.object({
  answers: z.array(z.object({ questionId: z.coerce.number().int().positive(), answer: z.string().max(1000).default("") })).min(0),
});

export const POST = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(["student"]);
  const id = paramNumber((await ctx.params).id);
  const me = await getStudentForUser(user.id);
  if (!me) throw new ApiError(403, "No student record is linked to this account");
  const body = await readJson(req, submitSchema);
  const result = await submitAttempt(id, me.id, body.answers);
  await audit({ id: user.id, role: user.role }, "quiz.submit", "quiz_attempt", id, { percentage: result.percentage });
  return jsonOk(result);
});

const overrideSchema = z.object({
  questionId: z.coerce.number().int().positive(),
  isCorrect: z.boolean(),
});

/** Teacher manual evaluation of a short answer that was not matched automatically. */
export const PATCH = handle(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const id = paramNumber((await ctx.params).id);
  const body = await readJson(req, overrideSchema);
  const [attempt] = await db.select().from(quizAttempts).where(eq(quizAttempts.id, id)).limit(1);
  if (!attempt) throw new ApiError(404, "Attempt not found");
  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, attempt.quizId)).limit(1);
  const scope = await classesForSubject(user, quiz.subjectId);
  if (scope !== "all" && scope.length === 0) throw new ApiError(403, "You are not allocated to this subject");
  const result = await overrideAnswer(id, body.questionId, body.isCorrect);
  await audit({ id: user.id, role: user.role }, "quiz.manual_evaluation", "quiz_attempt", id, { questionId: body.questionId, isCorrect: body.isCorrect });
  return jsonOk(result);
});
