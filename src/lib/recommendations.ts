import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  examResults,
  exams,
  learningResources,
  recommendations,
  riskPredictions,
  studentSubjects,
  students,
  subjects,
  topicMastery,
  topics,
} from "@/db/schema";
import { ApiError } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { notifyStudentAndGuardians } from "@/lib/events";
import { labelize, round } from "@/lib/utils";
import { buildFeatures, type FeatureValues } from "@/lib/ml/features";
import { ruleScreen } from "@/lib/ml/rules";

type Candidate = {
  dedupeKey: string;
  category: string;
  title: string;
  description: string;
  priority: number;
  subjectId: number | null;
  topicId: number | null;
  baseline: number | null;
  resourceTypes?: string[];
};

/**
 * Rule-based adaptive recommendation engine. It is independent of the ML model:
 * it reads observed indicators (features, subject averages, topic mastery, latest risk category)
 * and proposes concrete actions. Duplicate actions are prevented by a per-student dedupe key.
 */
export async function generateRecommendations(studentId: number) {
  const settings = await getSettings();
  const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!student) throw new ApiError(404, "Student not found");

  const feats = (await buildFeatures([studentId], settings.passPercentage)).get(studentId);
  const v: FeatureValues = feats?.values ?? {};
  const rule = ruleScreen(v, settings);
  const [latest] = await db
    .select({ riskCategory: riskPredictions.riskCategory })
    .from(riskPredictions)
    .where(eq(riskPredictions.studentId, studentId))
    .orderBy(desc(riskPredictions.predictedAt))
    .limit(1);
  const riskCategory = latest?.riskCategory ?? rule.category;

  const subs = await db
    .select({ id: subjects.id, name: subjects.name, passMarks: subjects.passMarks })
    .from(studentSubjects)
    .innerJoin(subjects, eq(subjects.id, studentSubjects.subjectId))
    .where(eq(studentSubjects.studentId, studentId));

  const exRows = await db
    .select({ subjectId: exams.subjectId, marks: examResults.marksObtained, max: exams.maxMarks, type: exams.examType })
    .from(examResults)
    .innerJoin(exams, eq(exams.id, examResults.examId))
    .where(eq(examResults.studentId, studentId));
  const subjAvg = new Map<number, number>();
  for (const s of subs) {
    const pcts = exRows
      .filter((r) => r.subjectId === s.id && r.marks !== null && r.type !== "end_semester")
      .map((r) => ((r.marks as number) / r.max) * 100);
    if (pcts.length) subjAvg.set(s.id, pcts.reduce((a, b) => a + b, 0) / pcts.length);
  }

  const mastery = await db
    .select({
      topicId: topicMastery.topicId,
      subjectId: topicMastery.subjectId,
      attempted: topicMastery.attempted,
      masteryScore: topicMastery.masteryScore,
      level: topicMastery.level,
      name: topics.name,
    })
    .from(topicMastery)
    .innerJoin(topics, eq(topics.id, topicMastery.topicId))
    .where(eq(topicMastery.studentId, studentId));

  const resources = await db
    .select({
      id: learningResources.id,
      subjectId: learningResources.subjectId,
      topicId: learningResources.topicId,
      resourceType: learningResources.resourceType,
    })
    .from(learningResources)
    .where(eq(learningResources.status, "approved"));

  const cands: Candidate[] = [];
  for (const s of subs) {
    const avg = subjAvg.get(s.id);
    if (avg !== undefined && avg < s.passMarks) {
      cands.push({
        dedupeKey: `subject_revision:${s.id}`,
        category: "subject_revision",
        title: `Revise ${s.name}`,
        description: `Your average of ${round(avg, 1)}% is below the ${s.passMarks}% pass mark. Revise the core chapters and complete the subject practice quizzes. Goal: reach ${s.passMarks + 10}% in the next internal assessment.`,
        priority: 1,
        subjectId: s.id,
        topicId: null,
        baseline: round(avg, 1),
        resourceTypes: ["note", "pdf", "reference"],
      });
    }
  }

  for (const m of mastery) {
    if (m.attempted === 0) continue;
    const pct = round(m.masteryScore * 100, 1);
    if (m.level === "needs_improvement" || m.level === "developing") {
      cands.push({
        dedupeKey: `topic_revision:${m.topicId}`,
        category: "topic_revision",
        title: `Revise topic: ${m.name}`,
        description: `Mastery estimate is ${pct}% (${labelize(m.level)}). Re-read the core notes, then complete two adaptive practice quizzes. Goal: mastery of at least ${round(settings.masteryThresholds.proficient * 100)}%.`,
        priority: m.level === "needs_improvement" ? 1 : 2,
        subjectId: m.subjectId,
        topicId: m.topicId,
        baseline: pct,
        resourceTypes: ["note", "pdf", "presentation", "reference"],
      });
      cands.push({
        dedupeKey: `practice:${m.topicId}`,
        category: "practice_exercises",
        title: `Practice: ${m.name}`,
        description: `Attempt adaptive practice questions on ${m.name}. Difficulty adjusts to your recent accuracy. Goal: four out of five correct.`,
        priority: 2,
        subjectId: m.subjectId,
        topicId: m.topicId,
        baseline: pct,
        resourceTypes: ["practice"],
      });
      if (m.level === "needs_improvement") {
        cands.push({
          dedupeKey: `video:${m.topicId}`,
          category: "video_tutorial",
          title: `Watch a tutorial on ${m.name}`,
          description: `A visual walkthrough of ${m.name} can help close the gaps shown by your quiz answers.`,
          priority: 2,
          subjectId: m.subjectId,
          topicId: m.topicId,
          baseline: pct,
          resourceTypes: ["video", "external_link"],
        });
      }
    }
  }

  const att = v.attendancePct;
  if (att !== null && att !== undefined && att < settings.attendanceThresholdPct) {
    cands.push({
      dedupeKey: "attendance",
      category: "attendance_improvement",
      title: "Improve class attendance",
      description: `Attendance is ${att}% against a ${settings.attendanceThresholdPct}% target. Attend every scheduled session this week and ask the teacher about missed content.`,
      priority: att < settings.attendanceThresholdPct - 10 ? 1 : 2,
      subjectId: null,
      topicId: null,
      baseline: att,
    });
  }
  const missed = v.missedAssignments;
  if (missed !== null && missed !== undefined && missed >= 1) {
    cands.push({
      dedupeKey: "assignments",
      category: "assignment_completion",
      title: "Complete outstanding assignments",
      description: `${missed} past-deadline assignment(s) are not submitted. Submit them even if late to recover marks and feedback.`,
      priority: missed >= 2 ? 1 : 2,
      subjectId: null,
      topicId: null,
      baseline: v.assignmentCompletionPct ?? null,
    });
  }
  const hours = v.studyHoursPerDay;
  const goalHours = student.dailyStudyGoalMinutes / 60;
  if (hours !== null && hours !== undefined && hours < goalHours) {
    cands.push({
      dedupeKey: "schedule",
      category: "study_schedule",
      title: "Follow a daily study schedule",
      description: `Average study time is ${round(hours, 2)} h/day against a goal of ${round(goalHours, 2)} h/day. Generate a weekly plan in the study planner and complete its sessions.`,
      priority: 2,
      subjectId: null,
      topicId: null,
      baseline: null,
    });
  }
  const days = v.activeDays14;
  if (days !== null && days !== undefined && days < 5) {
    cands.push({
      dedupeKey: "time_management",
      category: "time_management",
      title: "Build a consistent study routine",
      description: `You were active on ${days} of the last 14 days. Choose two fixed study slots per day and use reminders in the study planner.`,
      priority: 3,
      subjectId: null,
      topicId: null,
      baseline: null,
    });
  }
  const quizAvg = v.quizAvgPct;
  if (quizAvg !== null && quizAvg !== undefined && quizAvg < 60) {
    cands.push({
      dedupeKey: "mock_test",
      category: "mock_test",
      title: "Attempt a timed mock test",
      description: `Your practice quiz average is ${quizAvg}%. Take a timed quiz under exam conditions to find remaining gaps.`,
      priority: quizAvg < 40 ? 1 : 2,
      subjectId: null,
      topicId: null,
      baseline: quizAvg,
    });
  }
  if (riskCategory === "high") {
    cands.push({
      dedupeKey: "teacher_assistance",
      category: "teacher_assistance",
      title: "Book a support session with your teacher",
      description: "The latest risk assessment shows several academic indicators. Request a support session with your class teacher to agree a revision plan.",
      priority: 1,
      subjectId: null,
      topicId: null,
      baseline: null,
    });
  }

  // Attach the best approved library resource (topic match first, then subject match).
  const withResources = cands.map((c) => {
    const matches = resources.filter((r) => r.subjectId === c.subjectId && (!c.resourceTypes || c.resourceTypes.includes(r.resourceType)));
    const pick = matches.find((r) => r.topicId !== null && r.topicId === c.topicId) ?? matches.find((r) => r.topicId === null) ?? matches[0];
    return { ...c, resourceId: pick?.id ?? null };
  });

  const existing = await db.select().from(recommendations).where(eq(recommendations.studentId, studentId));
  const byKey = new Map(existing.map((e) => [e.dedupeKey, e]));
  const seen = new Set<string>();
  let created = 0;
  let updated = 0;
  let closed = 0;

  for (const c of withResources) {
    seen.add(c.dedupeKey);
    const ex = byKey.get(c.dedupeKey);
    if (!ex) {
      await db.insert(recommendations).values({
        studentId,
        subjectId: c.subjectId,
        topicId: c.topicId,
        category: c.category,
        title: c.title,
        description: c.description,
        priority: c.priority,
        dedupeKey: c.dedupeKey,
        resourceId: c.resourceId,
        source: "rules",
        baselineScore: c.baseline,
      });
      created++;
    } else if (ex.status === "suggested" || ex.status === "in_progress") {
      if (ex.description !== c.description || ex.priority !== c.priority || ex.resourceId !== c.resourceId) {
        await db
          .update(recommendations)
          .set({ description: c.description, priority: c.priority, resourceId: c.resourceId, title: c.title, updatedAt: new Date() })
          .where(eq(recommendations.id, ex.id));
        updated++;
      }
    }
    // completed / dismissed items are never duplicated.
  }

  for (const ex of existing) {
    if (!seen.has(ex.dedupeKey) && ex.status === "suggested") {
      await db
        .update(recommendations)
        .set({ status: "dismissed", description: `${ex.description} (Closed automatically: the indicator no longer applies.)`, updatedAt: new Date() })
        .where(eq(recommendations.id, ex.id));
      closed++;
    }
  }

  if (created > 0) {
    await notifyStudentAndGuardians(studentId, {
      title: "New personalised recommendations",
      message: `${created} new learning recommendation(s) were generated for you.`,
      category: "recommendations",
      link: "/student/learning",
    });
  }
  return { created, updated, closed, total: withResources.length, riskCategory };
}

export async function listRecommendations(studentId: number) {
  return db
    .select({
      id: recommendations.id,
      category: recommendations.category,
      title: recommendations.title,
      description: recommendations.description,
      priority: recommendations.priority,
      status: recommendations.status,
      subjectId: recommendations.subjectId,
      topicId: recommendations.topicId,
      resourceId: recommendations.resourceId,
      baselineScore: recommendations.baselineScore,
      followUpScore: recommendations.followUpScore,
      effectiveness: recommendations.effectiveness,
      feedbackRating: recommendations.feedbackRating,
      feedbackText: recommendations.feedbackText,
      startedAt: recommendations.startedAt,
      completedAt: recommendations.completedAt,
      createdAt: recommendations.createdAt,
    })
    .from(recommendations)
    .where(eq(recommendations.studentId, studentId))
    .orderBy(recommendations.priority, desc(recommendations.createdAt));
}
