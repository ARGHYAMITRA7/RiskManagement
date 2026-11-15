"use client";

import Link from "next/link";
import { Award, Flame, Target } from "lucide-react";
import { Badge, Button, Card, DataTable, Loading, Notice, PageHeader, Progress, StatCard, fmtPct } from "@/components/ui";
import { AreaTrend, BarChartCard, TrendChart } from "@/components/charts";
import { useFetch } from "@/lib/client";
import { formatDate, labelize, riskColor } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dash = any;

export default function StudentDashboard() {
  const { data, error, loading } = useFetch<{ role: string; data: Dash }>("/api/analytics");
  if (loading) return <Loading label="Loading your academic dashboard…" />;
  if (error) return <Notice tone="error">{error}</Notice>;
  const d: Dash = data?.data;
  if (!d) return null;
  const p = d.profile;
  const latest = d.riskHistory[0];
  const open = d.recommendationStatus.filter((r: Dash) => r.status === "suggested" || r.status === "in_progress").reduce((a: number, r: Dash) => a + r.n, 0);
  const quizAvg = d.quizHistory.filter((q: Dash) => q.status === "submitted" && q.percentage !== null);
  const quizMean = quizAvg.length ? quizAvg.reduce((a: number, q: Dash) => a + Number(q.percentage), 0) / quizAvg.length : null;
  const subjectAvg = Object.values(
    d.results.reduce((acc: Record<string, { name: string; sum: number; n: number }>, r: Dash) => {
      if (r.marks_obtained === null) return acc;
      const key = r.subject_code;
      acc[key] = acc[key] ?? { name: key, sum: 0, n: 0 };
      acc[key].sum += (Number(r.marks_obtained) / Number(r.max_marks)) * 100;
      acc[key].n += 1;
      return acc;
    }, {}),
  ).map((s: Dash) => ({ code: s.name, pct: Math.round((s.sum / s.n) * 10) / 10 }));
  const goalPct = d.progress.weeklyGoalMinutes ? Math.min(100, (d.progress.weeklyMinutes / d.progress.weeklyGoalMinutes) * 100) : 0;
  const synthetic = String(p.student_code).startsWith("SYN-");

  return (
    <>
      <PageHeader
        title={`Welcome, ${String(p.full_name).split(" ")[0]}`}
        description={`${p.course_name ?? "Programme"} · Semester ${p.current_semester} · Class ${p.class_code ?? "not assigned"} · ID ${p.student_code}`}
        actions={
          <>
            {synthetic && <Badge value="pending">SYNTHETIC demo record</Badge>}
            <Link href="/student/learning"><Button><Target className="h-4 w-4" /> Open learning plan</Button></Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Attendance" value={fmtPct(d.attendance.overallPct)} hint={`Target ${d.settings.attendanceThresholdPct}%`} tone={d.attendance.overallPct !== null && d.attendance.overallPct < d.settings.attendanceThresholdPct ? "red" : "green"} />
        <StatCard label="Latest exam" value={fmtPct(d.progress.lastPct)} hint={d.progress.firstPct !== null ? `First recorded: ${fmtPct(d.progress.firstPct)}` : "No published marks yet"} />
        <StatCard label="Quiz average" value={fmtPct(quizMean)} hint={`${quizAvg.length} submitted attempt(s)`} tone="cyan" />
        <StatCard label="Open recommendations" value={open} hint="Suggested or in progress" tone="amber" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Risk assessment" subtitle="Decision-support estimate. Not a certainty; see the explainable factors on the learning page.">
          {latest ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${riskColor(latest.riskCategory)}`}>{labelize(latest.riskCategory)} risk</span>
                <span className="text-sm text-slate-600 dark:text-slate-300">Score {latest.riskScore}/100 · {labelize(latest.method)} · {formatDate(latest.predictedAt)}</span>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-200">{latest.headline}</p>
              {latest.suggestedIntervention && <p className="rounded-xl bg-brand-500/5 p-3 text-sm text-slate-700 dark:bg-navy-800 dark:text-slate-200"><strong>Suggested next step:</strong> {latest.suggestedIntervention}</p>}
            </div>
          ) : (
            <Notice tone="info">No risk assessment has been run for your record yet. Your teacher or the administrator can run one.</Notice>
          )}
        </Card>
        <Card title="Engagement & streak" subtitle={d.badges ? "Improvement-focused goals" : "Gamification is disabled by the administrator"}>
          <div className="space-y-4">
            <div className="flex items-center gap-3"><Flame className="h-8 w-8 text-amber-500" /><div><p className="text-2xl font-semibold dark:text-white">{d.progress.streakDays} day streak</p><p className="text-xs text-slate-500">Consecutive days with learning activity</p></div></div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-slate-600 dark:text-slate-300"><span>Weekly study goal</span><span>{Math.round(d.progress.weeklyMinutes)} / {d.progress.weeklyGoalMinutes} min</span></div>
              <Progress value={goalPct} tone={goalPct >= 100 ? "green" : "blue"} />
            </div>
            {d.badges && (
              <div className="grid grid-cols-2 gap-2">
                {d.badges.map((b: Dash) => (
                  <div key={b.id} title={b.description} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${b.earned ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-slate-200 text-slate-400 dark:border-navy-700"}`}>
                    <Award className="h-4 w-4 shrink-0" /> <span className="truncate">{b.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card title="Academic progress" subtitle="Exam percentages over time">
          <TrendChart data={d.progress.timeline} xKey="label" series={[{ key: "pct", label: "Score %", color: "#2f78e8" }]} domain={[0, 100]} />
        </Card>
        <Card title="Subject-wise marks" subtitle="Average percentage in each subject">
          <BarChartCard data={subjectAvg} xKey="code" yKey="pct" colorByIndex />
        </Card>
        <Card title="Attendance by subject" subtitle={`Overall ${fmtPct(d.attendance.overallPct)}`}>
          <BarChartCard data={d.attendance.bySubject.map((a: Dash) => ({ name: a.name, pct: (Number(a.present) + Number(a.late)) / Math.max(1, Number(a.present) + Number(a.late) + Number(a.absent)) * 100 }))} xKey="name" yKey="pct" color="#22d3ee" />
        </Card>
        <Card title="Weekly learning activity" subtitle="Minutes logged per week (last 8 weeks)">
          <AreaTrend data={d.progress.weeklyActivity} xKey="week" yKey="minutes" color="#10b981" />
        </Card>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Assignments" subtitle="Latest assignments for your class">
          <DataTable rows={d.assignments} rowKey={(r: Dash) => r.id} empty="No assignments yet." columns={[
            { key: "title", header: "Assignment", render: (r: Dash) => <Link href="/assignments" className="font-medium text-brand-600 hover:underline dark:text-cyan-300">{r.title}</Link> },
            { key: "subject_name", header: "Subject" },
            { key: "deadline", header: "Deadline", render: (r: Dash) => formatDate(r.deadline) },
            { key: "status", header: "Status", render: (r: Dash) => (r.submission_id ? <Badge value={r.is_late ? "late" : "submitted"}>{r.is_late ? "Late" : "Submitted"}</Badge> : new Date(r.deadline) < new Date() ? <Badge value="absent">Missing</Badge> : <Badge value="pending">Pending</Badge>) },
            { key: "marks", header: "Marks", render: (r: Dash) => (r.marks === null ? "—" : `${r.marks}/${r.max_marks}`) },
          ]} />
        </Card>
        <Card title="Upcoming examinations">
          <DataTable rows={d.upcomingExams} rowKey={(r: Dash) => r.id} empty="No upcoming examinations recorded." columns={[
            { key: "name", header: "Examination" },
            { key: "subject_name", header: "Subject" },
            { key: "exam_date", header: "Date", render: (r: Dash) => formatDate(r.exam_date) },
          ]} />
        </Card>
        <Card title="Topic mastery" subtitle="Your current mastery levels" className="xl:col-span-3">
          <DataTable rows={d.mastery} rowKey={(r: Dash, i: number) => `${r.topic}-${i}`} empty="Complete a practice quiz to see mastery estimates." columns={[
            { key: "subject", header: "Subject" },
            { key: "topic", header: "Topic" },
            { key: "level", header: "Level", render: (r: Dash) => <Badge value={r.level}>{labelize(r.level)}</Badge> },
            { key: "mastery_score", header: "Mastery", render: (r: Dash) => <div className="w-40"><Progress value={Number(r.mastery_score) * 100} tone={Number(r.mastery_score) >= 0.7 ? "green" : Number(r.mastery_score) >= 0.5 ? "amber" : "red"} /><span className="text-xs text-slate-500">{Math.round(Number(r.mastery_score) * 100)}%</span></div> },
            { key: "trend", header: "Trend", render: (r: Dash) => <Badge value={r.trend}>{labelize(r.trend)}</Badge> },
          ]} />
        </Card>
      </div>
      <p className="mt-6 text-xs text-slate-500">Need help? Open the <Link href="/student/learning" className="underline">AI assistant</Link> or ask your teacher for a support session.</p>
      {d.mastery.length === 0 && <Notice tone="info">Mastery estimates appear after you complete practice quizzes.</Notice>}
    </>
  );
}
