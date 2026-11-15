import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { questions, subjects, topics } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/events";
import { classesForSubject } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** Question bank (staff). Correct answers are visible to staff only; students receive questions through quiz attempts. */
export const GET = handle(async (req) => {
  const user = await requireUser(["admin", "teacher"]);
  const url = new URL(req.url);
  const subjectId = Number(url.searchParams.get("subjectId"));
  if (!subjectId) throw new ApiError(400, "subjectId is required");
  const scope = await classesForSubject(user, subjectId);
  if (scope !== "all" && scope.length === 0) throw new ApiError(403, "You are not allocated to this subject");
  const topicId = url.searchParams.get("topicId");
  const rows = await db
    .select({
      id: questions.id,
      subjectId: questions.subjectId,
      topicId: questions.topicId,
      topicName: topics.name,
      questionType: questions.questionType,
      difficulty: questions.difficulty,
      prompt: questions.prompt,
      options: questions.options,
      correctAnswer: questions.correctAnswer,
      acceptedAnswers: questions.acceptedAnswers,
      explanation: questions.explanation,
      isActive: questions.isActive,
      createdAt: questions.createdAt,
    })
    .from(questions)
    .innerJoin(topics, eq(topics.id, questions.topicId))
    .where(and(eq(questions.subjectId, subjectId), topicId ? eq(questions.topicId, Number(topicId)) : undefined))
    .orderBy(desc(questions.createdAt));
  const [subject] = await db.select({ code: subjects.code, name: subjects.name }).from(subjects).where(eq(subjects.id, subjectId)).limit(1);
  return jsonOk({ items: rows, subject });
});

const createSchema = z.object({
  subjectId: z.coerce.number().int().positive(),
  topicId: z.coerce.number().int().positive(),
  questionType: z.enum(["mcq", "true_false", "short_answer"]),
  difficulty: z.coerce.number().int().min(1).max(3),
  prompt: z.string().trim().min(8).max(1000),
  options: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
  correctAnswer: z.string().trim().min(1).max(300),
  acceptedAnswers: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  explanation: z.string().trim().min(5).max(1000),
});

/** Validates question shape: MCQ needs 2-6 options with the answer among them; True/False is fixed; short answers are matched. */
function validateQuestion(q: z.infer<typeof createSchema>) {
  if (q.questionType === "mcq") {
    if (q.options.length < 2) throw new ApiError(400, "Multiple-choice questions need at least two options");
    if (!q.options.includes(q.correctAnswer)) throw new ApiError(400, "The correct answer must be one of the options");
    return { ...q, options: q.options, acceptedAnswers: [] };
  }
  if (q.questionType === "true_false") {
    if (!["True", "False"].includes(q.correctAnswer)) throw new ApiError(400, "True/False questions need the correct answer True or False");
    return { ...q, options: ["True", "False"], acceptedAnswers: [] };
  }
  return { ...q, options: [] };
}

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const body = validateQuestion(await readJson(req, createSchema));
  const scope = await classesForSubject(user, body.subjectId);
  if (scope !== "all" && scope.length === 0) throw new ApiError(403, "You are not allocated to this subject");
  const [topic] = await db.select().from(topics).where(eq(topics.id, body.topicId)).limit(1);
  if (!topic || topic.subjectId !== body.subjectId) throw new ApiError(400, "The topic does not belong to the selected subject");
  const [row] = await db.insert(questions).values({ ...body, createdBy: user.id }).returning();
  await audit({ id: user.id, role: user.role }, "question.create", "question", row.id, { subjectId: body.subjectId, topicId: body.topicId });
  return jsonOk(row, 201);
});

const patchSchema = z.object({ id: z.coerce.number().int().positive(), isActive: z.boolean() });

export const PATCH = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["admin", "teacher"]);
  const body = await readJson(req, patchSchema);
  const [q] = await db.select().from(questions).where(eq(questions.id, body.id)).limit(1);
  if (!q) throw new ApiError(404, "Question not found");
  const scope = await classesForSubject(user, q.subjectId);
  if (scope !== "all" && scope.length === 0) throw new ApiError(403, "You are not allocated to this subject");
  await db.update(questions).set({ isActive: body.isActive }).where(eq(questions.id, body.id));
  await audit({ id: user.id, role: user.role }, "question.toggle", "question", body.id, { isActive: body.isActive });
  return jsonOk({ ok: true });
});
