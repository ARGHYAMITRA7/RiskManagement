import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { studentSubjects, teacherAssignments } from "@/db/schema";
import { getActiveModel } from "@/lib/ml/train";
import { getSettings } from "@/lib/settings";

/* All dashboard numbers come from live SQL aggregates over the application tables. */

// Raw SQL rows are loosely typed by design; each consumer converts values explicitly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

async function q<T = R>(query: SQL): Promise<T[]> {
  const res = await db.execute(query);
  return res.rows as unknown as T[];
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const r1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);
const todayStr = () => new Date().toISOString().slice(0, 10);

function inList(ids: number[]): SQL {
  return ids.length ? sql.join(ids.map((i) => sql`${i}`), sql`, `) : sql`null`;
}

export function pivotRiskTrend(rows: { day: string; risk_category: string; n: number }[]) {
  const days = new Map<string, { day: string; low: number; medium: number; high: number }>();
  for (const r of rows) {
    const d = days.get(r.day) ?? { day: r.day, low: 0, medium: 0, high: 0 };
    if (r.risk_category === "low" || r.risk_category === "medium" || r.risk_category === "high") d[r.risk_category] = n(r.n);
    days.set(r.day, d);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export async function adminDashboard() {
  const settings = await getSettings();
  const today = todayStr();
  const [totals] = await q<R>(sql`
    select
      (select count(*) from students where status = 'active')::int as students,
      (select count(*) from students where status = 'archived')::int as archived,
      (select count(*) from teachers)::int as teachers,
      (select count(*) from departments)::int as departments,
      (select count(*) from courses)::int as courses,
      (select count(*) from subjects where is_active)::int as subjects,
      (select count(*) from users where status = 'active')::int as active_accounts,
      (select count(*) from users where status = 'pending')::int as pending_accounts,
      (select avg(er.marks_obtained * 100.0 / e.max_marks)::float from exam_results er join exams e on e.id = er.exam_id where er.marks_obtained is not null) as avg_performance,
      (select (sum(case when status in ('present','late') then 1 else 0 end)::float / nullif(sum(case when status <> 'excused' then 1 else 0 end), 0) * 100)::float from attendance_records) as avg_attendance,
      (select (select count(*) from assignment_submissions)::float / nullif((select count(*) from assignments a join students st on st.class_id = a.class_id and st.status = 'active'), 0) * 100)::float as assignment_completion,
      (select count(*) from interventions where status <> 'completed')::int as pending_interventions,
      (select count(*) from early_warning_alerts where status = 'open')::int as open_alerts,
      (select count(*) from learning_resources where status = 'pending')::int as pending_resources,
      (select count(*) from guardian_links where approved = false)::int as pending_guardian_links
  `);

  const latest = await q<{ student_id: number; risk_category: string; risk_score: number; rn: number }>(sql`
    select student_id, risk_category, risk_score, rn from (
      select student_id, risk_category, risk_score,
             row_number() over (partition by student_id order by predicted_at desc) as rn
      from risk_predictions
    ) x where rn <= 2`);
  const cur = latest.filter((r) => n(r.rn) === 1);
  const prevMap = new Map(latest.filter((r) => n(r.rn) === 2).map((r) => [r.student_id, n(r.risk_score)]));
  const riskDistribution = { low: 0, medium: 0, high: 0 };
  for (const r of cur) {
    if (r.risk_category in riskDistribution) riskDistribution[r.risk_category as keyof typeof riskDistribution]++;
  }
  let improving = 0;
  let declining = 0;
  for (const r of cur) {
    const prev = prevMap.get(r.student_id);
    if (prev === undefined) continue;
    if (n(r.risk_score) <= prev - 5) improving++;
    if (n(r.risk_score) >= prev + 5) declining++;
  }

  const perStudent = await q<{ pct: number }>(sql`
    select avg(er.marks_obtained * 100.0 / e.max_marks)::float as pct
    from exam_results er join exams e on e.id = er.exam_id
    where er.marks_obtained is not null group by er.student_id`);
  const bins = ["<40", "40-49", "50-59", "60-69", "70-79", "80+"].map((label) => ({ label, count: 0 }));
  for (const r of perStudent) {
    const p = n(r.pct);
    const idx = p < 40 ? 0 : p < 50 ? 1 : p < 60 ? 2 : p < 70 ? 3 : p < 80 ? 4 : 5;
    bins[idx].count++;
  }

  const attendanceTrend = await q<{ month: string; pct: number }>(sql`
    select to_char(s.session_date::date, 'YYYY-MM') as month,
           (sum(case when r.status in ('present','late') then 1 else 0 end)::float / nullif(sum(case when r.status <> 'excused' then 1 else 0 end), 0) * 100)::float as pct
    from attendance_records r join attendance_sessions s on s.id = r.session_id
    group by 1 order by 1`);

  const subjectPerformance = await q(sql`
    select sub.code, sub.name, sub.semester, avg(er.marks_obtained * 100.0 / e.max_marks)::float as pct, count(*)::int as n
    from exam_results er join exams e on e.id = er.exam_id join subjects sub on sub.id = e.subject_id
    where er.marks_obtained is not null group by sub.id, sub.code, sub.name, sub.semester order by sub.semester, sub.code`);

  const semesterPerformance = await q(sql`
    select sub.semester, avg(er.marks_obtained * 100.0 / e.max_marks)::float as pct, count(*)::int as n
    from exam_results er join exams e on e.id = er.exam_id join subjects sub on sub.id = e.subject_id
    where er.marks_obtained is not null group by sub.semester order by sub.semester`);

  const departmentComparison = await q(sql`
    select d.name, avg(er.marks_obtained * 100.0 / e.max_marks)::float as pct
    from exam_results er join exams e on e.id = er.exam_id join subjects sub on sub.id = e.subject_id
    join courses c on c.id = sub.course_id join departments d on d.id = c.department_id
    where er.marks_obtained is not null group by d.id, d.name order by d.name`);

  const assignmentCompletion = await q(sql`
    select a.title,
      (select count(*) from students st where st.class_id = a.class_id and st.status = 'active')::int as expected,
      (select count(*) from assignment_submissions x where x.assignment_id = a.id)::int as submitted
    from assignments a order by a.created_at desc limit 8`);

  const quizPerformance = await q(sql`
    select sub.name, avg(qa.percentage)::float as pct, count(*)::int as attempts
    from quiz_attempts qa join quizzes qz on qz.id = qa.quiz_id join subjects sub on sub.id = qz.subject_id
    where qa.status = 'submitted' group by sub.id, sub.name order by sub.name`);

  const recommendationEffectiveness = await q(sql`
    select r.category, count(*)::int as total,
      count(*) filter (where r.status = 'completed')::int as completed,
      avg(r.effectiveness)::float as avg_effectiveness,
      avg(r.feedback_rating)::float as avg_rating
    from recommendations r group by r.category order by total desc`);

  const engagementWeekly = await q<{ week: string; avg_minutes: number }>(sql`
    select to_char(activity_date::date, 'IYYY-"W"IW') as week,
           (sum(minutes)::float / nullif(count(distinct student_id), 0))::float as avg_minutes
    from learning_activities group by 1 order by 1 desc limit 8`);

  const riskTrendRows = await q<{ day: string; risk_category: string; n: number }>(sql`
    select to_char(predicted_at, 'YYYY-MM-DD') as day, risk_category, count(*)::int as n
    from risk_predictions group by 1, 2 order by 1`);

  const attention = await q(sql`
    select st.id, st.full_name, st.student_code, p.risk_score, p.risk_category, p.suggested_intervention
    from (select distinct on (student_id) student_id, risk_category, risk_score, suggested_intervention
          from risk_predictions order by student_id, predicted_at desc) p
    join students st on st.id = p.student_id
    where p.risk_category = 'high' and st.status = 'active'
    order by p.risk_score desc limit 8`);

  const upcomingExams = await q(sql`
    select e.id, e.name, e.exam_type, e.exam_date, e.status, sub.name as subject_name
    from exams e join subjects sub on sub.id = e.subject_id
    where e.exam_date >= ${today} order by e.exam_date limit 6`);

  const upcomingEvents = await q(sql`
    select id, title, event_type, event_date from academic_events
    where event_date >= ${today} order by event_date limit 6`);

  const recentActivity = await q(sql`
    select action, entity_type, actor_role, created_at from audit_logs order by created_at desc limit 10`);

  const activeModel = await getActiveModel();
  return {
    settings: { institutionName: settings.institutionName, attendanceThresholdPct: settings.attendanceThresholdPct },
    totals: {
      students: n(totals?.students),
      archived: n(totals?.archived),
      teachers: n(totals?.teachers),
      departments: n(totals?.departments),
      courses: n(totals?.courses),
      subjects: n(totals?.subjects),
      activeAccounts: n(totals?.active_accounts),
      pendingAccounts: n(totals?.pending_accounts),
      avgPerformance: r1(nn(totals?.avg_performance)),
      avgAttendance: r1(nn(totals?.avg_attendance)),
      assignmentCompletion: r1(nn(totals?.assignment_completion)),
      pendingInterventions: n(totals?.pending_interventions),
      openAlerts: n(totals?.open_alerts),
      pendingResources: n(totals?.pending_resources),
      pendingGuardianLinks: n(totals?.pending_guardian_links),
    },
    risk: {
      distribution: riskDistribution,
      assessedStudents: cur.length,
      improving,
      declining,
      trend: pivotRiskTrend(riskTrendRows),
      modelName: activeModel?.name ?? null,
      modelAlgorithm: activeModel?.algorithm ?? null,
      method: activeModel ? "ml" : "rule_screening",
    },
    charts: {
      performanceDistribution: bins,
      attendanceTrend: attendanceTrend.map((r) => ({ month: r.month, pct: r1(nn(r.pct)) })),
      subjectPerformance: subjectPerformance.map((r) => ({ ...r, pct: r1(nn(r.pct)) })),
      semesterPerformance: semesterPerformance.map((r) => ({ semester: `Sem ${n(r.semester)}`, pct: r1(nn(r.pct)) })),
      departmentComparison: departmentComparison.map((r) => ({ name: r.name, pct: r1(nn(r.pct)) })),
      assignmentCompletion: assignmentCompletion.map((r) => ({
        title: r.title,
        expected: n(r.expected),
        submitted: n(r.submitted),
        pct: n(r.expected) ? r1((n(r.submitted) / n(r.expected)) * 100) : 0,
      })),
      quizPerformance: quizPerformance.map((r) => ({ name: r.name, pct: r1(nn(r.pct)), attempts: n(r.attempts) })),
      recommendationEffectiveness: recommendationEffectiveness.map((r) => ({
        category: r.category,
        total: n(r.total),
        completed: n(r.completed),
        completionRate: n(r.total) ? r1((n(r.completed) / n(r.total)) * 100) : 0,
        avgEffectiveness: r1(nn(r.avg_effectiveness)),
        avgRating: r1(nn(r.avg_rating)),
      })),
      engagement: engagementWeekly.reverse().map((r) => ({ week: r.week, avgMinutes: Math.round(n(r.avg_minutes)) })),
    },
    attention: attention.map((r) => ({ id: n(r.id), name: r.full_name, code: r.student_code, score: n(r.risk_score), intervention: r.suggested_intervention })),
    upcomingExams,
    upcomingEvents,
    recentActivity,
  };
}

export async function teacherDashboard(teacherId: number) {
  const settings = await getSettings();
  const assigns = await db
    .select({ subjectId: teacherAssignments.subjectId, classId: teacherAssignments.classId })
    .from(teacherAssignments)
    .where(eq(teacherAssignments.teacherId, teacherId));
  const classIds = [...new Set(assigns.map((a) => a.classId))];
  const subjectIds = [...new Set(assigns.map((a) => a.subjectId))];
  if (classIds.length === 0) {
    return { classes: [], subjects: [], totals: { students: 0, atRisk: 0, openAlerts: 0 }, charts: {}, alerts: [], interventions: [], upcomingExams: [] };
  }
  const classes = await q(sql`select id, code, name, semester from classes where id in (${inList(classIds)}) order by code`);
  const subjects = await q(sql`select id, code, name, semester from subjects where id in (${inList(subjectIds)}) order by code`);
  const [totals] = await q<R>(sql`
    select
      (select count(*) from students where class_id in (${inList(classIds)}) and status = 'active')::int as students,
      (select count(*) from early_warning_alerts a join students st on st.id = a.student_id
         where st.class_id in (${inList(classIds)}) and a.status = 'open')::int as open_alerts`);
  const studentRows = await q<{ id: number }>(sql`select id from students where class_id in (${inList(classIds)}) and status = 'active'`);
  const ids = studentRows.map((s) => s.id);
  const latest = ids.length
    ? await q<{ student_id: number; risk_category: string }>(sql`
        select distinct on (student_id) student_id, risk_category from risk_predictions
        where student_id in (${inList(ids)}) order by student_id, predicted_at desc`)
    : [];
  const risk = { low: 0, medium: 0, high: 0 };
  for (const r of latest) if (r.risk_category in risk) risk[r.risk_category as keyof typeof risk]++;

  const subjectPerformance = await q(sql`
    select sub.name, sub.code, avg(er.marks_obtained * 100.0 / e.max_marks)::float as pct
    from exam_results er join exams e on e.id = er.exam_id join subjects sub on sub.id = e.subject_id
    where sub.id in (${inList(subjectIds)}) and er.marks_obtained is not null and er.student_id in (${inList(ids.length ? ids : [0])})
    group by sub.id, sub.name, sub.code order by sub.code`);

  const attendanceBySubject = await q(sql`
    select sub.name, (sum(case when r.status in ('present','late') then 1 else 0 end)::float / nullif(sum(case when r.status <> 'excused' then 1 else 0 end), 0) * 100)::float as pct
    from attendance_records r join attendance_sessions s on s.id = r.session_id join subjects sub on sub.id = s.subject_id
    where s.subject_id in (${inList(subjectIds)}) and s.class_id in (${inList(classIds)})
    group by sub.id, sub.name order by sub.name`);

  const assignmentStats = await q(sql`
    select a.title, sub.name as subject_name,
      (select count(*) from students st where st.class_id = a.class_id and st.status = 'active')::int as expected,
      (select count(*) from assignment_submissions x where x.assignment_id = a.id)::int as submitted
    from assignments a join subjects sub on sub.id = a.subject_id
    where a.subject_id in (${inList(subjectIds)}) and a.class_id in (${inList(classIds)})
    order by a.created_at desc limit 8`);

  const alerts = await q(sql`
    select a.id, a.title, a.severity, a.status, a.category, a.created_at, st.full_name, st.student_code, st.id as student_id
    from early_warning_alerts a join students st on st.id = a.student_id
    where st.class_id in (${inList(classIds)}) and a.status <> 'resolved'
    order by case a.severity when 'high' then 0 when 'medium' then 1 else 2 end, a.created_at desc limit 10`);

  const interventions = await q(sql`
    select i.status, count(*)::int as n from interventions i where i.created_by = (select user_id from teachers where id = ${teacherId}) group by i.status`);

  const upcomingExams = await q(sql`
    select e.id, e.name, e.exam_type, e.exam_date, sub.name as subject_name from exams e join subjects sub on sub.id = e.subject_id
    where e.subject_id in (${inList(subjectIds)}) and e.exam_date >= ${todayStr()} order by e.exam_date limit 6`);

  return {
    settings: { attendanceThresholdPct: settings.attendanceThresholdPct },
    classes,
    subjects,
    totals: { students: n(totals?.students), atRisk: risk.high + risk.medium, openAlerts: n(totals?.open_alerts) },
    charts: {
      risk,
      subjectPerformance: subjectPerformance.map((r) => ({ name: r.name, code: r.code, pct: r1(nn(r.pct)) })),
      attendanceBySubject: attendanceBySubject.map((r) => ({ name: r.name, pct: r1(nn(r.pct)) })),
      assignmentStats: assignmentStats.map((r) => ({
        title: r.title,
        subject: r.subject_name,
        expected: n(r.expected),
        submitted: n(r.submitted),
        pct: n(r.expected) ? r1((n(r.submitted) / n(r.expected)) * 100) : 0,
      })),
    },
    alerts,
    interventions,
    upcomingExams,
  };
}

/** Student / guardian view. Guardians never see teacher observations or private intervention notes. */
export async function studentDashboard(studentId: number, opts: { forGuardian?: boolean } = {}) {
  const settings = await getSettings();
  const [profile] = await q<R>(sql`
    select s.id, s.student_code, s.full_name, s.email, s.current_semester, s.daily_study_goal_minutes, s.class_id, s.course_id,
           c.name as class_name, c.code as class_code, co.name as course_name
    from students s left join classes c on c.id = s.class_id left join courses co on co.id = s.course_id
    where s.id = ${studentId}`);
  if (!profile) return null;
  const pub = opts.forGuardian ? sql`and e.status = 'published'` : sql``;

  const results = await q(sql`
    select e.id as exam_id, e.name as exam_name, e.exam_type, e.exam_date, e.max_marks, e.pass_marks, e.status,
           sub.id as subject_id, sub.name as subject_name, sub.code as subject_code, sub.semester,
           er.marks_obtained, er.attendance_status, er.remarks
    from exam_results er join exams e on e.id = er.exam_id join subjects sub on sub.id = e.subject_id
    where er.student_id = ${studentId} ${pub}
    order by e.exam_date, sub.code`);

  const attendanceBySubject = await q(sql`
    select sub.id, sub.name,
      sum(case when r.status = 'present' then 1 else 0 end)::int as present,
      sum(case when r.status = 'late' then 1 else 0 end)::int as late,
      sum(case when r.status = 'absent' then 1 else 0 end)::int as absent,
      sum(case when r.status = 'excused' then 1 else 0 end)::int as excused
    from attendance_records r join attendance_sessions s on s.id = r.session_id join subjects sub on sub.id = s.subject_id
    where r.student_id = ${studentId} group by sub.id, sub.name order by sub.name`);

  const attendanceMonthly = await q(sql`
    select to_char(s.session_date::date, 'YYYY-MM') as month,
           (sum(case when r.status in ('present','late') then 1 else 0 end)::float / nullif(sum(case when r.status <> 'excused' then 1 else 0 end), 0) * 100)::float as pct
    from attendance_records r join attendance_sessions s on s.id = r.session_id
    where r.student_id = ${studentId} group by 1 order by 1`);

  const assignmentsList = profile.class_id
    ? await q(sql`
        select a.id, a.title, a.deadline, a.max_marks, a.allow_resubmission, sub.name as subject_name,
               x.id as submission_id, x.submitted_at, x.is_late, x.marks, x.status as submission_status, x.feedback
        from assignments a join subjects sub on sub.id = a.subject_id
        left join assignment_submissions x on x.assignment_id = a.id and x.student_id = ${studentId}
        where a.class_id = ${Number(profile.class_id)} order by a.deadline desc limit 30`)
    : [];

  const riskHistory = await q(sql`
    select predicted_at, risk_category, risk_score, probability, method, suggested_intervention, explanation
    from risk_predictions where student_id = ${studentId} order by predicted_at desc limit 12`);

  const enrolledSubjects = await db
    .select({ subjectId: studentSubjects.subjectId })
    .from(studentSubjects)
    .where(eq(studentSubjects.studentId, studentId));
  const subjIds = enrolledSubjects.map((s) => s.subjectId);
  const upcoming = subjIds.length
    ? await q(sql`
        select e.id, e.name, e.exam_type, e.exam_date, e.max_marks, sub.name as subject_name
        from exams e join subjects sub on sub.id = e.subject_id
        where e.subject_id in (${inList(subjIds)}) and e.exam_date >= ${todayStr()} order by e.exam_date limit 8`)
    : [];

  const mastery = opts.forGuardian
    ? []
    : await q(sql`
        select t.name as topic, sub.name as subject, m.level, m.mastery_score, m.trend, m.attempted, m.history
        from topic_mastery m join topics t on t.id = m.topic_id join subjects sub on sub.id = m.subject_id
        where m.student_id = ${studentId} order by sub.name, t.name`);

  const quizHistory = await q(sql`
    select qa.id, qz.title, sub.name as subject_name, qa.percentage, qa.status, qa.submitted_at, qa.started_at
    from quiz_attempts qa join quizzes qz on qz.id = qa.quiz_id join subjects sub on sub.id = qz.subject_id
    where qa.student_id = ${studentId} order by qa.started_at desc limit 12`);

  const recStatus = opts.forGuardian
    ? []
    : await q(sql`select status, count(*)::int as n from recommendations where student_id = ${studentId} group by status`);

  const activityDays = await q<{ d: string; minutes: number }>(sql`
    select activity_date::text as d, sum(minutes)::int as minutes from learning_activities
    where student_id = ${studentId} and activity_date >= ${new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10)}
    group by activity_date order by activity_date`);

  const dailyGoal = Number(profile.daily_study_goal_minutes ?? 60);
  const minutesByDay = new Map(activityDays.map((a) => [a.d, n(a.minutes)]));
  const today = new Date();
  const dayKey = (offset: number) => new Date(today.getTime() - offset * 86400000).toISOString().slice(0, 10);
  const weeklyTotal = Array.from({ length: 7 }, (_, i) => minutesByDay.get(dayKey(i)) ?? 0).reduce((a, b) => a + b, 0);
  let streak = 0;
  let offset = minutesByDay.get(dayKey(0)) ? 0 : 1;
  while (minutesByDay.get(dayKey(offset))) {
    streak++;
    offset++;
  }
  const weeklyActivity = Array.from({ length: 8 }, (_, w) => {
    let total = 0;
    for (let d = 0; d < 7; d++) total += minutesByDay.get(dayKey(w * 7 + d)) ?? 0;
    return { week: w === 0 ? "This week" : `${w} wk ago`, minutes: total };
  }).reverse();

  // Improvement timeline: exam percentages ordered by date.
  const timeline = results
    .filter((r) => r.marks_obtained !== null)
    .map((r) => ({ date: r.exam_date, label: `${r.subject_code} ${r.exam_name}`, pct: r1((n(r.marks_obtained) / n(r.max_marks)) * 100) }));

  const submittedAssignments = assignmentsList.filter((a) => a.submission_id !== null).length;
  const pastAssignments = assignmentsList.filter((a) => new Date(String(a.deadline)).getTime() < Date.now()).length;
  const attTotals = attendanceBySubject.reduce<{ present: number; marked: number }>(
    (acc, r) => ({
      present: acc.present + n(r.present) + n(r.late),
      marked: acc.marked + n(r.present) + n(r.late) + n(r.absent),
    }),
    { present: 0, marked: 0 },
  );
  const attendancePct = attTotals.marked ? r1((attTotals.present / attTotals.marked) * 100) : null;
  const firstPct = timeline[0]?.pct ?? null;
  const lastPct = timeline[timeline.length - 1]?.pct ?? null;

  const badges = settings.gamificationEnabled && !opts.forGuardian
    ? [
        { id: "first_quiz", title: "First Step", earned: quizHistory.some((q) => q.status === "submitted"), description: "Completed your first practice quiz." },
        { id: "streak_5", title: "Five-Day Streak", earned: streak >= 5, description: "Studied on five consecutive days." },
        { id: "assignment_ace", title: "Assignment Ace", earned: pastAssignments > 0 && submittedAssignments === pastAssignments, description: "Submitted every assignment that has passed its deadline." },
        { id: "attendance_star", title: "Attendance Star", earned: attendancePct !== null && attendancePct >= settings.attendanceThresholdPct, description: "Met the attendance target." },
        { id: "mastery_builder", title: "Mastery Builder", earned: mastery.some((m) => m.level === "proficient" || m.level === "strong"), description: "Reached Proficient mastery on a topic." },
        { id: "improver", title: "Visible Improver", earned: firstPct !== null && lastPct !== null && lastPct >= firstPct + 10, description: "Improved your latest exam score by 10+ points over your first recorded exam." },
      ]
    : null;

  return {
    profile,
    settings: { passPercentage: settings.passPercentage, attendanceThresholdPct: settings.attendanceThresholdPct },
    results,
    attendance: { bySubject: attendanceBySubject, monthly: attendanceMonthly.map((r) => ({ month: r.month, pct: r1(nn(r.pct)) })), overallPct: attendancePct },
    assignments: assignmentsList,
    riskHistory: riskHistory.map((r) => ({
      predictedAt: r.predicted_at,
      riskCategory: r.risk_category,
      riskScore: n(r.risk_score),
      method: r.method,
      suggestedIntervention: r.suggested_intervention,
      headline: (r.explanation as { headline?: string } | null)?.headline ?? "",
    })),
    upcomingExams: upcoming,
    mastery,
    quizHistory,
    recommendationStatus: recStatus,
    progress: {
      timeline,
      firstPct,
      lastPct,
      weeklyActivity,
      weeklyMinutes: weeklyTotal,
      weeklyGoalMinutes: dailyGoal * 7,
      streakDays: streak,
    },
    badges,
  };
}

export async function guardianStudents(userGuardianId: number) {
  return q(sql`
    select st.id, st.full_name, st.student_code from guardian_links gl join students st on st.id = gl.student_id
    where gl.guardian_id = ${userGuardianId} and gl.approved = true`);
}
