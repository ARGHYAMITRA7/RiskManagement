"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, DataTable, Field, Input, Loading, Notice, PageHeader, StatCard, Badge, fmtPct } from "@/components/ui";
import { AreaTrend, TrendChart } from "@/components/charts";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDate, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dash = any;

/** Read-only guardian portal: approved academic information only. Teacher observations are never included. */
export default function GuardianPage() {
  const { data, error, loading, reload } = useFetch<{ role: string; linked: Dash[]; data: Dash }>("/api/analytics");
  const links = useFetch<{ items: Dash[] }>("/api/guardians");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function requestLink(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api("/api/guardians", { body: { studentCode: code } });
      setCode("");
      setMsg({ tone: "success", text: "Link request sent. The administrator must approve it before you can view the record." });
      links.reload();
      reload();
    } catch (err) {
      setMsg({ tone: "error", text: errorMessage(err) });
    }
  }

  if (loading) return <Loading />;
  if (error) return <Notice tone="error">{error}</Notice>;
  const d: Dash = data?.data;
  const linkRows = links.data?.items ?? [];

  return (
    <>
      <PageHeader title="Guardian Portal" description="Read-only view of published results, attendance, assignment status and examination schedules for approved links." />
      {msg && <div className="mb-4"><Notice tone={msg.tone === "error" ? "error" : "success"}>{msg.text}</Notice></div>}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Linked students" subtitle="Approved links allow read-only access">
          <DataTable rows={linkRows} rowKey={(r: Dash) => r.linkId} empty="No student is linked to your account yet." columns={[
            { key: "studentName", header: "Student" },
            { key: "studentCode", header: "Student ID" },
            { key: "approved", header: "Status", render: (r: Dash) => (r.approved ? <Badge value="approved">Approved</Badge> : <Badge value="pending">Awaiting approval</Badge>) },
          ]} />
        </Card>
        <Card title="Request access" subtitle="Enter the student's ID from the institution">
          <form onSubmit={requestLink} className="space-y-3">
            <Field label="Student ID"><Input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SYN-0001" /></Field>
            <Button type="submit" className="w-full">Request link</Button>
          </form>
        </Card>
      </div>

      {!d ? (
        <div className="mt-6"><Notice tone="info">Your link to a student record will appear here once an administrator approves it.</Notice></div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Student" value={d.profile.full_name} hint={`${d.profile.student_code} · Semester ${d.profile.current_semester}`} />
            <StatCard label="Attendance" value={fmtPct(d.attendance.overallPct)} hint={`Target ${d.settings.attendanceThresholdPct}%`} tone="cyan" />
            <StatCard label="Latest published result" value={fmtPct(d.progress.lastPct)} tone="green" />
            <StatCard label="Upcoming examinations" value={d.upcomingExams.length} tone="amber" />
          </div>
          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <Card title="Academic progress" subtitle="Published exam percentages">
              <TrendChart data={d.progress.timeline} xKey="label" series={[{ key: "pct", label: "Score %", color: "#2f78e8" }]} domain={[0, 100]} />
            </Card>
            <Card title="Attendance trend" subtitle="Monthly rate">
              <AreaTrend data={d.attendance.monthly} xKey="month" yKey="pct" color="#22d3ee" />
            </Card>
            <Card title="Published results">
              <DataTable rows={d.results} rowKey={(r: Dash, i: number) => `${r.exam_id}-${i}`} empty="No results have been published yet." columns={[
                { key: "subject_name", header: "Subject" },
                { key: "exam_name", header: "Examination" },
                { key: "marks_obtained", header: "Marks", render: (r: Dash) => (r.marks_obtained === null ? "Not entered" : `${r.marks_obtained}/${r.max_marks}`) },
              ]} />
            </Card>
            <Card title="Assignment status">
              <DataTable rows={d.assignments} rowKey={(r: Dash) => r.id} empty="No assignments yet." columns={[
                { key: "title", header: "Assignment" },
                { key: "deadline", header: "Due", render: (r: Dash) => formatDate(r.deadline) },
                { key: "status", header: "Status", render: (r: Dash) => (r.submission_id ? (r.is_late ? "Submitted late" : "Submitted") : new Date(r.deadline) < new Date() ? "Not submitted" : "Pending") },
              ]} />
            </Card>
            <Card title="Examination schedule">
              <DataTable rows={d.upcomingExams} rowKey={(r: Dash) => r.id} empty="No upcoming examinations." columns={[
                { key: "name", header: "Examination" },
                { key: "subject_name", header: "Subject" },
                { key: "exam_date", header: "Date", render: (r: Dash) => formatDate(r.exam_date) },
              ]} />
            </Card>
            <Card title="Recent history" subtitle="Assessment changes are summarised here without internal notes.">
              <DataTable rows={d.quizHistory} rowKey={(r: Dash) => r.id} empty="No practice quiz activity." columns={[
                { key: "title", header: "Practice quiz" },
                { key: "percentage", header: "Score", render: (r: Dash) => fmtPct(r.percentage === null ? null : Number(r.percentage)) },
                { key: "status", header: "Status", render: (r: Dash) => labelize(r.status) },
              ]} />
            </Card>
          </div>
        </>
      )}
    </>
  );
}
