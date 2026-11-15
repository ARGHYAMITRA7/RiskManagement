"use client";

import Link from "next/link";
import { Button, Card, DataTable, Loading, Notice, PageHeader, StatCard, Badge, fmtPct } from "@/components/ui";
import { BarChartCard, DonutChart } from "@/components/charts";
import { useFetch } from "@/lib/client";
import { formatDate, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dash = any;

export default function TeacherDashboard() {
  const { data, error, loading } = useFetch<{ role: string; data: Dash }>("/api/analytics");
  if (loading) return <Loading label="Loading your classes…" />;
  if (error) return <Notice tone="error">{error}</Notice>;
  const d: Dash = data?.data;
  if (!d) return null;
  if (!d.classes.length) {
    return (
      <>
        <PageHeader title="Teacher Dashboard" />
        <Notice tone="warning">You have no class or subject allocations yet. Ask an administrator to allocate you in People &amp; Accounts.</Notice>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Teacher Dashboard"
        description={`Classes: ${d.classes.map((c: Dash) => c.code).join(", ")} · Subjects: ${d.subjects.map((s: Dash) => s.code).join(", ")}`}
        actions={
          <>
            <Link href="/attendance"><Button variant="secondary">Record attendance</Button></Link>
            <Link href="/exams"><Button variant="secondary">Enter marks</Button></Link>
            <Link href="/alerts"><Button>Review early warnings</Button></Link>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="My students" value={d.totals.students} hint={`${d.classes.length} class(es)`} />
        <StatCard label="At risk (medium + high)" value={d.totals.atRisk} tone="amber" hint="Latest assessment" />
        <StatCard label="Open early warnings" value={d.totals.openAlerts} tone="red" hint="Open or acknowledged" />
        <StatCard label="Interventions" value={d.interventions.reduce((a: number, i: Dash) => a + i.n, 0)} tone="cyan" hint={d.interventions.map((i: Dash) => `${labelize(i.status)}: ${i.n}`).join(" · ") || "None created yet"} />
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card title="Risk distribution" subtitle="My students, latest assessment">
          <DonutChart data={[{ name: "Low", value: d.charts.risk.low, color: "#10b981" }, { name: "Medium", value: d.charts.risk.medium, color: "#f59e0b" }, { name: "High", value: d.charts.risk.high, color: "#f43f5e" }]} />
        </Card>
        <Card title="Subject performance" subtitle="Average exam percentage in my subjects">
          <BarChartCard data={d.charts.subjectPerformance} xKey="code" yKey="pct" colorByIndex />
        </Card>
        <Card title="Attendance by subject" subtitle="Present or late, my classes">
          <BarChartCard data={d.charts.attendanceBySubject} xKey="name" yKey="pct" color="#22d3ee" />
        </Card>
        <Card title="Assignment completion" subtitle="Recent assignments in my classes">
          <DataTable rows={d.charts.assignmentStats} rowKey={(r: Dash, i: number) => `${r.title}-${i}`} empty="No assignments yet." columns={[
            { key: "title", header: "Assignment" },
            { key: "subject", header: "Subject" },
            { key: "submitted", header: "Submitted", render: (r: Dash) => `${r.submitted}/${r.expected}` },
            { key: "pct", header: "%", render: (r: Dash) => fmtPct(r.pct) },
          ]} />
        </Card>
        <Card title="Open early warnings" actions={<Link href="/alerts" className="text-sm text-brand-600 hover:underline dark:text-cyan-300">View all</Link>}>
          <DataTable rows={d.alerts} rowKey={(r: Dash) => r.id} empty="No open alerts. Good work." columns={[
            { key: "full_name", header: "Student", render: (r: Dash) => <Link className="font-medium text-brand-600 hover:underline dark:text-cyan-300" href={`/students/${r.student_id}`}>{r.full_name}</Link> },
            { key: "title", header: "Alert" },
            { key: "severity", header: "Severity", render: (r: Dash) => <Badge value={r.severity}>{labelize(r.severity)}</Badge> },
          ]} />
        </Card>
        <Card title="Upcoming examinations">
          <DataTable rows={d.upcomingExams} rowKey={(r: Dash) => r.id} empty="No upcoming examinations for my subjects." columns={[
            { key: "name", header: "Examination" },
            { key: "subject_name", header: "Subject" },
            { key: "exam_date", header: "Date", render: (r: Dash) => formatDate(r.exam_date) },
          ]} />
        </Card>
      </div>
    </>
  );
}
