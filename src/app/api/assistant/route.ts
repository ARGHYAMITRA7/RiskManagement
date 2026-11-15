import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { learningResources, questions, quizAnswers, quizAttempts, studentSubjects, subjects, topicMastery, topics, exams } from "@/db/schema";
import { assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getStudentForUser } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { labelize, round } from "@/lib/utils";

export const dynamic = "force-dynamic";

const schema = z.object({ question: z.string().trim().min(3).max(500) });

/**
 * Rule-based academic assistant. It works without any external LLM.
 * It answers only from the approved resource library, the question bank, and the student's own records.
 * It never invents exam dates, marks, attendance or risk results.
 */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser(["student"]);
  const { question } = await readJson(req, schema);
  const me = await getStudentForUser(user.id);
  if (!me) return jsonOk({ answer: ["No student record is linked to your account, so I cannot use your academic records."], sources: [], practice: null });

  const q = question.toLowerCase();
  const enrolled = await db
    .select({ id: subjects.id, code: subjects.code, name: subjects.name })
    .from(studentSubjects)
    .innerJoin(subjects, eq(subjects.id, studentSubjects.subjectId))
    .where(eq(studentSubjects.studentId, me.id));
  const subjectIds = enrolled.map((s) => s.id);
  const topicRows = subjectIds.length
    ? await db
        .select({ id: topics.id, name: topics.name, subjectId: topics.subjectId })
        .from(topics)
        .where(inArray(topics.subjectId, subjectIds))
    : [];

  const tokens = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const topicMatch = topicRows.find((t) => tokens.some((tok) => t.name.toLowerCase().includes(tok) || tok.includes(t.name.toLowerCase().split(" ")[0])));
  const subjectMatch = enrolled.find((s) => tokens.some((tok) => s.name.toLowerCase().includes(tok) || s.code.toLowerCase() === tok));
  const topic = topicMatch ?? (subjectMatch ? topicRows.find((t) => t.subjectId === subjectMatch.id) : undefined);

  const answer: string[] = [];
  const sources: { title: string; url: string | null; type: string }[] = [];
  let practice: { prompt: string; type: string; options: string[] } | null = null;
  const wantsPlan = /plan|schedule|timetable|routine|planner/.test(q);
  const wantsMistake = /mistake|wrong|incorrect|why|explain/.test(q);
  const wantsPractice = /practice|question|quiz|test|exercise/.test(q);

  if (topic) {
    const subject = enrolled.find((s) => s.id === topic.subjectId);
    const [m] = await db
      .select()
      .from(topicMastery)
      .where(and(eq(topicMastery.studentId, me.id), eq(topicMastery.topicId, topic.id)))
      .limit(1);
    const settings = await getSettings();
    answer.push(
      `${topic.name} (${subject?.code ?? ""}): ${
        m && m.attempted > 0
          ? `your mastery estimate is ${round(m.masteryScore * 100, 1)}% (${labelize(m.level)}), based on ${m.attempted} answered question(s).`
          : "you have not answered practice questions on this topic yet, so there is no mastery estimate."
      }`,
    );
    if (m && (m.level === "needs_improvement" || m.level === "developing")) {
      answer.push(`Suggested revision: read the approved notes below, then complete the practice quiz "Practice: ${topic.name}". Target mastery: ${round(settings.masteryThresholds.proficient * 100)}%.`);
    }
    if (wantsMistake) {
      const [wrong] = await db
        .select({ given: quizAnswers.givenAnswer, prompt: questions.prompt, correct: questions.correctAnswer, explanation: questions.explanation })
        .from(quizAnswers)
        .innerJoin(quizAttempts, eq(quizAttempts.id, quizAnswers.attemptId))
        .innerJoin(questions, eq(questions.id, quizAnswers.questionId))
        .where(and(eq(quizAttempts.studentId, me.id), eq(questions.topicId, topic.id), eq(quizAnswers.isCorrect, false), eq(quizAttempts.status, "submitted")))
        .orderBy(desc(quizAnswers.id))
        .limit(1);
      if (wrong) {
        answer.push(
          `Your most recent incorrect answer was on: "${wrong.prompt}". You answered "${wrong.given ?? "(no answer)"}". The correct answer is "${wrong.correct}". Explanation: ${wrong.explanation}`,
        );
      } else {
        answer.push("I could not find an incorrect quiz answer on this topic in your records.");
      }
    }
    if (wantsPractice || (!wantsMistake && !wantsPlan)) {
      const [pq] = await db
        .select({ prompt: questions.prompt, type: questions.questionType, options: questions.options })
        .from(questions)
        .where(and(eq(questions.topicId, topic.id), eq(questions.isActive, true), eq(questions.difficulty, 1)))
        .limit(1);
      if (pq) practice = { prompt: pq.prompt, type: pq.type, options: pq.options };
    }
    const resources = await db
      .select({ title: learningResources.title, url: learningResources.externalUrl, type: learningResources.resourceType, filePath: learningResources.filePath })
      .from(learningResources)
      .where(and(eq(learningResources.status, "approved"), eq(learningResources.topicId, topic.id)))
      .limit(3);
    for (const r of resources) sources.push({ title: r.title, url: r.url ?? (r.filePath ? `/api/files/${r.filePath}` : null), type: r.type });
  } else {
    answer.push(
      `I could not match your question to a topic in your enrolled subjects. Try naming a topic or subject. Your subjects: ${enrolled.map((s) => s.name).join(", ") || "none yet"}.`,
    );
  }

  if (wantsPlan) {
    const [next] = subjectIds.length
      ? await db
          .select({ name: exams.name, date: exams.examDate, subject: subjects.name })
          .from(exams)
          .innerJoin(subjects, eq(subjects.id, exams.subjectId))
          .where(and(inArray(exams.subjectId, subjectIds), sql`${exams.examDate} >= current_date`))
          .orderBy(exams.examDate)
          .limit(1)
      : [];
    answer.push(
      "To build a schedule, open Learning Plan and click 'Generate weekly plan'. It uses your weakest topics, pending assignments and upcoming examinations.",
    );
    answer.push(next ? `Your next published examination date in the records is ${next.date} (${next.subject}: ${next.name}).` : "No upcoming examination date is recorded for your subjects.");
  }

  answer.push("I answer only from approved resources, the question bank and your own records. I cannot change marks, attendance or risk results.");
  return jsonOk({ answer, sources, practice });
});
