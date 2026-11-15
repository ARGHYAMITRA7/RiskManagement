import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { learningActivities, questions, quizAnswers, quizAttempts, quizzes, topicMastery } from "@/db/schema";
import { ApiError } from "@/lib/http";
import { round } from "@/lib/utils";
import { applyTopicResults, updateRecommendationEffectiveness } from "@/lib/mastery";

const GRACE_MS = 15000;

export const normalizeAnswer = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Adaptive difficulty:
 *  - base target from the average mastery of the scope (1 easy, 2 medium, 3 hard)
 *  - consistently correct recent answers (>= 80% over >= 3 answers) raise the target
 *  - repeated incorrect answers (<= 40%) lower the target and flag a revision recommendation
 */
export async function selectAdaptiveQuestions(
  studentId: number,
  subjectId: number,
  topicId: number | null,
  count: number,
  mastery: { masteryScore: number }[],
) {
  const base = mastery.length ? mastery.reduce((a, m) => a + m.masteryScore, 0) / mastery.length : 0.5;
  let target = base < 0.5 ? 1 : base < 0.8 ? 2 : 3;

  const recent = await db
    .select({ isCorrect: quizAnswers.isCorrect, id: quizAnswers.id })
    .from(quizAnswers)
    .innerJoin(quizAttempts, eq(quizAttempts.id, quizAnswers.attemptId))
    .innerJoin(questions, eq(questions.id, quizAnswers.questionId))
    .where(
      and(
        eq(quizAttempts.studentId, studentId),
        eq(quizAttempts.status, "submitted"),
        topicId ? eq(questions.topicId, topicId) : eq(questions.subjectId, subjectId),
      ),
    )
    .orderBy(desc(quizAnswers.id))
    .limit(6);
  const judged = recent.filter((r) => r.isCorrect !== null);
  let revisionRecommended = false;
  if (judged.length >= 3) {
    const acc = judged.filter((r) => r.isCorrect).length / judged.length;
    if (acc >= 0.8) target += 1;
    if (acc <= 0.4) {
      target -= 1;
      revisionRecommended = true;
    }
  }
  target = Math.min(3, Math.max(1, target));

  const pool = await db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.subjectId, subjectId),
        eq(questions.isActive, true),
        topicId ? eq(questions.topicId, topicId) : undefined,
      ),
    );
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const chosen = shuffled
    .sort((a, b) => Math.abs(a.difficulty - target) - Math.abs(b.difficulty - target))
    .slice(0, count);
  return { questions: chosen, startDifficulty: target, revisionRecommended };
}

export async function buildAttemptView(attemptId: number) {
  const [attempt] = await db.select().from(quizAttempts).where(eq(quizAttempts.id, attemptId)).limit(1);
  if (!attempt) throw new ApiError(404, "Attempt not found");
  const rows = await db
    .select({
      questionId: quizAnswers.questionId,
      position: quizAnswers.position,
      difficulty: quizAnswers.difficulty,
      givenAnswer: quizAnswers.givenAnswer,
      questionType: questions.questionType,
      prompt: questions.prompt,
      options: questions.options,
    })
    .from(quizAnswers)
    .innerJoin(questions, eq(questions.id, quizAnswers.questionId))
    .where(eq(quizAnswers.attemptId, attemptId))
    .orderBy(asc(quizAnswers.position));
  // Correct answers and explanations are never sent before submission.
  return {
    attempt: {
      id: attempt.id,
      quizId: attempt.quizId,
      status: attempt.status,
      startedAt: attempt.startedAt,
      deadline: attempt.deadline,
      startDifficulty: attempt.startDifficulty,
    },
    questions: rows.map((r) => ({
      questionId: r.questionId,
      position: r.position,
      type: r.questionType,
      difficulty: r.difficulty,
      prompt: r.prompt,
      options: r.options,
      answered: r.givenAnswer !== null,
    })),
  };
}

export async function startAttempt(studentId: number, quizId: number) {
  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, quizId)).limit(1);
  if (!quiz || !quiz.isPublished) throw new ApiError(404, "Quiz not found or not published");

  const now = new Date();
  const open = await db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.quizId, quizId), eq(quizAttempts.studentId, studentId), eq(quizAttempts.status, "in_progress")))
    .orderBy(desc(quizAttempts.id))
    .limit(1);
  if (open[0]) {
    if (open[0].deadline.getTime() + GRACE_MS > now.getTime()) return { ...(await buildAttemptView(open[0].id)), resumed: true };
    await db.update(quizAttempts).set({ status: "expired" }).where(eq(quizAttempts.id, open[0].id));
  }

  const mastery = await db
    .select({ masteryScore: topicMastery.masteryScore })
    .from(topicMastery)
    .where(
      and(
        eq(topicMastery.studentId, studentId),
        eq(topicMastery.subjectId, quiz.subjectId),
        quiz.topicId ? eq(topicMastery.topicId, quiz.topicId) : undefined,
      ),
    );

  const selection = await selectAdaptiveQuestions(studentId, quiz.subjectId, quiz.topicId, quiz.questionCount, mastery);
  if (selection.questions.length === 0) throw new ApiError(409, "No active questions are available for this quiz yet.");

  const deadline = new Date(now.getTime() + quiz.timeLimitSeconds * 1000);
  const [attempt] = await db
    .insert(quizAttempts)
    .values({ quizId, studentId, startedAt: now, deadline, startDifficulty: selection.startDifficulty, status: "in_progress" })
    .returning();
  await db.insert(quizAnswers).values(
    selection.questions.map((q, i) => ({ attemptId: attempt.id, questionId: q.id, position: i + 1, difficulty: q.difficulty })),
  );
  return { ...(await buildAttemptView(attempt.id)), revisionRecommended: selection.revisionRecommended, resumed: false };
}

/** Grades an attempt: objective auto-marking, short answers matched to accepted answers, others flagged for review. */
export async function submitAttempt(attemptId: number, studentId: number, answers: { questionId: number; answer: string }[]) {
  const [attempt] = await db.select().from(quizAttempts).where(eq(quizAttempts.id, attemptId)).limit(1);
  if (!attempt || attempt.studentId !== studentId) throw new ApiError(404, "Attempt not found");
  if (attempt.status !== "in_progress") throw new ApiError(409, "This attempt has already been closed");
  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, attempt.quizId)).limit(1);
  const now = new Date();

  if (now.getTime() > attempt.deadline.getTime() + GRACE_MS) {
    await db.update(quizAttempts).set({ status: "expired", submittedAt: now, score: 0, maxScore: 0, percentage: 0 }).where(eq(quizAttempts.id, attemptId));
    throw new ApiError(409, "The time limit for this quiz has passed. The attempt was closed without scoring.");
  }

  const rows = await db
    .select({
      id: quizAnswers.id,
      questionId: quizAnswers.questionId,
      position: quizAnswers.position,
      difficulty: quizAnswers.difficulty,
      topicId: questions.topicId,
      questionType: questions.questionType,
      prompt: questions.prompt,
      correctAnswer: questions.correctAnswer,
      acceptedAnswers: questions.acceptedAnswers,
      explanation: questions.explanation,
    })
    .from(quizAnswers)
    .innerJoin(questions, eq(questions.id, quizAnswers.questionId))
    .where(eq(quizAnswers.attemptId, attemptId))
    .orderBy(asc(quizAnswers.position));

  const submitted = new Map(answers.map((a) => [a.questionId, a.answer]));
  let score = 0;
  const topicAgg = new Map<number, { attempted: number; correct: number }>();
  const review: {
    questionId: number;
    position: number;
    prompt: string;
    givenAnswer: string | null;
    correctAnswer: string;
    isCorrect: boolean;
    needsReview: boolean;
    explanation: string;
  }[] = [];

  for (const row of rows) {
    const given = submitted.get(row.questionId)?.trim() ?? "";
    const answered = given.length > 0;
    let isCorrect = false;
    let needsReview = false;
    if (answered) {
      if (row.questionType === "short_answer") {
        const accepted = [row.correctAnswer, ...row.acceptedAnswers].map(normalizeAnswer);
        isCorrect = accepted.includes(normalizeAnswer(given));
        needsReview = !isCorrect;
      } else {
        isCorrect = normalizeAnswer(given) === normalizeAnswer(row.correctAnswer);
      }
    }
    if (isCorrect) score += 1;
    await db
      .update(quizAnswers)
      .set({ givenAnswer: answered ? given.slice(0, 1000) : null, isCorrect, marksAwarded: isCorrect ? 1 : 0, needsReview })
      .where(eq(quizAnswers.id, row.id));
    const agg = topicAgg.get(row.topicId) ?? { attempted: 0, correct: 0 };
    agg.attempted += 1;
    if (isCorrect) agg.correct += 1;
    topicAgg.set(row.topicId, agg);
    review.push({
      questionId: row.questionId,
      position: row.position,
      prompt: row.prompt,
      givenAnswer: answered ? given : null,
      correctAnswer: row.correctAnswer,
      isCorrect,
      needsReview,
      explanation: row.explanation,
    });
  }

  const maxScore = rows.length;
  const percentage = maxScore ? round((score / maxScore) * 100, 1) : 0;
  const accuracy = maxScore ? score / maxScore : 0;
  const start = attempt.startDifficulty ?? 2;
  const endDifficulty = accuracy >= 0.8 ? Math.min(3, start + 1) : accuracy <= 0.4 ? Math.max(1, start - 1) : start;

  await db
    .update(quizAttempts)
    .set({ status: "submitted", submittedAt: now, score, maxScore, percentage, endDifficulty })
    .where(eq(quizAttempts.id, attemptId));

  const subjectId = quiz?.subjectId ?? 0;
  await applyTopicResults(
    studentId,
    subjectId,
    [...topicAgg.entries()].map(([topicId, a]) => ({ topicId, ...a })),
  );
  for (const [topicId, a] of topicAgg.entries()) {
    await updateRecommendationEffectiveness(studentId, subjectId, topicId, (a.correct / a.attempted) * 100);
  }
  await updateRecommendationEffectiveness(studentId, subjectId, null, percentage);

  const minutes = Math.max(1, Math.round((now.getTime() - attempt.startedAt.getTime()) / 60000));
  await db.insert(learningActivities).values({
    studentId,
    subjectId,
    activityType: "quiz",
    minutes,
    activityDate: now.toISOString().slice(0, 10),
  });

  return {
    attemptId,
    score,
    maxScore,
    percentage,
    startDifficulty: start,
    nextDifficulty: endDifficulty,
    review,
  };
}

/** Teacher override for a short-answer item that needs manual evaluation. Recomputes the attempt score. */
export async function overrideAnswer(attemptId: number, questionId: number, isCorrect: boolean) {
  await db
    .update(quizAnswers)
    .set({ isCorrect, marksAwarded: isCorrect ? 1 : 0, needsReview: false })
    .where(and(eq(quizAnswers.attemptId, attemptId), eq(quizAnswers.questionId, questionId)));
  const rows = await db
    .select({ isCorrect: quizAnswers.isCorrect, marks: quizAnswers.marksAwarded })
    .from(quizAnswers)
    .where(eq(quizAnswers.attemptId, attemptId));
  const score = rows.reduce((a, r) => a + (r.marks ?? 0), 0);
  const maxScore = rows.length;
  const percentage = maxScore ? round((score / maxScore) * 100, 1) : 0;
  await db.update(quizAttempts).set({ score, maxScore, percentage }).where(eq(quizAttempts.id, attemptId));
  return { score, maxScore, percentage };
}
