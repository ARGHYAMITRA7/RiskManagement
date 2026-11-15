"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, BookOpen, Users } from "lucide-react";
import { Badge, Button, Card, DataTable, Loading, Notice, PageHeader, StatCard, fmtPct } from "@/components/ui";
import { AreaTrend, BarChartCard, DonutChart, TrendChart } from "@/components/charts";
import { useFetch } from "@/lib/client";
import { formatDate, formatDateTime, labelize } from "@/lib/utils";

/* Payload is produced by the server-side analytics module (live SQL aggregates). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dash = any;

export default function AdminDashboard() {
  const { data, error, loading } = useFetch<{ role: string; data: Dash }>("/api/analytics");
  if (loading) return <Loading label="Loading institutional analytics…" />;
  if (error) return <Notice tone="error">{error}</Notice>;
  const d: Dash = data?.data;
  if (!d) return null;
  const t = d.totals;
  const dist = d.risk.distribution;
  const notices: { text: string; href: string }[] = [];
  if (t.pendingAccounts) notices.push({ text: `${t.pendingAccounts} account(s) awaiting approval`, href: "/admin/people" });
  if (t.pendingGuardianLinks) notices.push({ text: `${t.pendingGuardianLinks} guardian link request(s)`, href: "/admin/people" });
  if (t.pendingResources) notices.push({ text: `${t.pendingResources} resource(s) pending approval`, href: "/resources" });
  if (t.openAlerts) notices.push({ text: `${t.openAlerts} open early-warning alert(s)`, href: "/alerts" });
  if (!d.risk.modelName) notices.push({ text: "No ML model is active. Risk uses the transparent rule-based screening.", href: "/admin/ml" });

  return (
    <>
      <PageHeader
        title="Institutional Dashboard"
        description={`${d.settings.institutionName}. Every figure below is computed from live database records.`}
        actions={
          <>
            <Link href="/students"><Button variant="secondary"><Users className="h-4 w-4" /> Manage students</Button></Link>
            <Link href="/admin/ml"><Button><BookOpen className="h-4 w-4" /> Risk & AI models</Button></Link>
          </>
        }
      />

      {notices.length > 0 && (
        <Card className="mb-6" title="System notifications" subtitle="Items that need administrative attention">
          <ul className="grid gap-2 md:grid-cols-2">
            {notices.map((n) => (
              <li key={n.text}>
                <Link href={n.href} className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {n.text}</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active students" value={t.students} hint={`${t.archived} archived`} />
        <StatCard label="Teachers" value={t.teachers} hint={`${t.departments} departments · ${t.courses} courses`} tone="cyan" />
        <StatCard label="Subjects" value={t.subjects} hint="Active subjects in catalogue" tone="slate" />
        <StatCard label="Active accounts" value={t.activeAccounts} hint={`${t.pendingAccounts} pending approval`} tone="green" />
        <StatCard label="Average performance" value={fmtPct(t.avgPerformance)} hint="Across entered exam marks" />
        <StatCard label="Average attendance" value={fmtPct(t.avgAttendance)} hint={`Target ${d.settings.attendanceThresholdPct}%`} tone="cyan" />
        <StatCard label="Assignment completion" value={fmtPct(t.assignmentCompletion)} hint="Submissions vs expected" tone="green" />
        <StatCard label="Pending interventions" value={t.pendingInterventions} hint={`${t.openAlerts} open early warnings`} tone="amber" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="High-risk students" value={dist.high} tone="red" hint="Latest assessment" />
        <StatCard label="Medium-risk students" value={dist.medium} tone="amber" hint="Latest assessment" />
        <StatCard label="Low-risk students" value={dist.low} tone="green" hint={`${d.risk.improving} improving · ${d.risk.declining} declining`} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card title="Student risk distribution" subtitle={`Method: ${d.risk.method === "ml" ? `ML model (${d.risk.modelAlgorithm})` : "rule-based screening"}`}>
          <DonutChart data={[{ name: "Low", value: dist.low, color: "#10b981" }, { name: "Medium", value: dist.medium, color: "#f59e0b" }, { name: "High", value: dist.high, color: "#f43f5e" }]} />
        </Card>
        <Card title="Historical risk trend" subtitle="Assessments recorded per day">
          <TrendChart data={d.risk.trend} xKey="day" series={[{ key: "low", label: "Low", color: "#10b981" }, { key: "medium", label: "Medium", color: "#f59e0b" }, { key: "high", label: "High", color: "#f43f5e" }]} />
        </Card>
        <Card title="Academic performance distribution" subtitle="Students by average exam percentage">
          <BarChartCard data={d.charts.performanceDistribution} xKey="label" yKey="count" name="Students" />
        </Card>
        <Card title="Attendance trend" subtitle="Monthly attendance rate (present or late)">
          <AreaTrend data={d.charts.attendanceTrend} xKey="month" yKey="pct" />
        </Card>
        <Card title="Subject-wise performance" subtitle="Average exam percentage per subject">
          <BarChartCard data={d.charts.subjectPerformance} xKey="code" yKey="pct" colorByIndex />
        </Card>
        <Card title="Semester-wise performance" subtitle="Average exam percentage per semester">
          <BarChartCard data={d.charts.semesterPerformance} xKey="semester" yKey="pct" />
        </Card>
        <Card title="Assignment completion" subtitle="Submissions against expected students (latest assignments)">
          <BarChartCard data={d.charts.assignmentCompletion} xKey="title" yKey="pct" name="Completion %" />
        </Card>
        <Card title="Quiz performance" subtitle="Average adaptive-quiz score by subject">
          <BarChartCard data={d.charts.quizPerformance} xKey="name" yKey="pct" name="Average %" />
        </Card>
        <Card title="Learning engagement" subtitle="Average logged learning minutes per student, by week">
          <AreaTrend data={d.charts.engagement} xKey="week" yKey="avgMinutes" color="#2f78e8" />
        </Card>
        <Card title="Department comparison" subtitle="Average performance by department">
          <BarChartCard data={d.charts.departmentComparison} xKey="name" yKey="pct" />
        </Card>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Recommendation effectiveness" subtitle="Completion rate and measured score change after follow-up assessments">
          <DataTable
            rows={d.charts.recommendationEffectiveness}
            rowKey={(r: Dash) => r.category}
            empty="No recommendations have been generated yet."
            columns={[
              { key: "category", header: "Category", render: (r: Dash) => labelize(r.category) },
              { key: "total", header: "Total" },
              { key: "completed", header: "Completed" },
              { key: "completionRate", header: "Completion", render: (r: Dash) => fmtPct(r.completionRate) },
              { key: "avgEffectiveness", header: "Avg score change (pts)", render: (r: Dash) => (r.avgEffectiveness === null ? "—" : r.avgEffectiveness) },
              { key: "avgRating", header: "Avg rating (1-5)", render: (r: Dash) => r.avgRating ?? "—" },
            ]}
          />
        </Card>
        <Card title="Students requiring attention" subtitle="High-risk students (latest assessment)">
          <DataTable
            rows={d.attention}
            rowKey={(r: Dash) => r.id}
            empty="No high-risk students in the latest assessment."
            columns={[
              { key: "name", header: "Student", render: (r: Dash) => <Link className="font-medium text-brand-600 hover:underline dark:text-cyan-300" href={`/students/${r.id}`}>{r.name}</Link> },
              { key: "score", header: "Score", render: (r: Dash) => <Badge value="high">{r.score}</Badge> },
            ]}
          />
        </Card>
        <Card title="Upcoming examinations">
          <DataTable rows={d.upcomingExams} rowKey={(r: Dash) => r.id} empty="No upcoming examinations." columns={[
            { key: "name", header: "Examination" },
            { key: "subject_name", header: "Subject" },
            { key: "exam_date", header: "Date", render: (r: Dash) => formatDate(r.exam_date) },
          ]} />
        </Card>
        <Card title="Upcoming academic events">
          <DataTable rows={d.upcomingEvents} rowKey={(r: Dash) => r.id} empty="No upcoming events." columns={[
            { key: "title", header: "Event" },
            { key: "event_type", header: "Type", render: (r: Dash) => labelize(r.event_type) },
            { key: "event_date", header: "Date", render: (r: Dash) => formatDate(r.event_date) },
          ]} />
        </Card>
        <Card title="Recent activity" subtitle="Latest audited actions">
          <DataTable rows={d.recentActivity} rowKey={(r: Dash, i: number) => `${r.created_at}-${i}`} empty="No activity recorded." columns={[
            { key: "action", header: "Action", render: (r: Dash) => <span className="font-mono text-xs">{r.action}</span> },
            { key: "actor_role", header: "Role", render: (r: Dash) => labelize(r.actor_role) },
            { key: "created_at", header: "When", render: (r: Dash) => formatDateTime(r.created_at) },
          ]} />
        </Card>
      </div>
    </>
  );
}
