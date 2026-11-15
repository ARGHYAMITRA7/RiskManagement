"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { Badge, Button, Card, DataTable, Field, Input, Loading, Modal, Notice, PageHeader, Select, Tabs, fmtPct } from "@/components/ui";
import { AreaTrend, BarChartCard } from "@/components/charts";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDate, labelize, toDateInput } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
const STATUSES = ["present", "absent", "late", "excused"] as const;

export default function AttendancePage() {
  const me = useFetch<{ user: { role: string } }>("/api/auth/me");
  if (me.loading || !me.data) return <Loading />;
  if (me.data.user.role === "student") return <StudentAttendance />;
  return <StaffAttendance role={me.data.user.role} />;
}

function StudentAttendance() {
  const analytics = useFetch<{ data: Row }>("/api/analytics");
  const daily = useFetch<{ items: Row[] }>("/api/attendance");
  if (analytics.loading) return <Loading />;
  const d = analytics.data?.data;
  return (
    <>
      <PageHeader title="My Attendance" description="Your attendance by subject, monthly trend and daily record. Absences are shown only for sessions that were actually marked." />
      {d && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Card title="Overall attendance"><p className="text-3xl font-semibold">{fmtPct(d.attendance.overallPct)}</p><p className="text-sm text-slate-500">Institutional target {d.settings.attendanceThresholdPct}%</p></Card>
            <Card title="Absent sessions"><p className="text-3xl font-semibold">{d.attendance.bySubject.reduce((a: number, r: Row) => a + Number(r.absent), 0)}</p><p className="text-sm text-slate-500">Across all subjects</p></Card>
            <Card title="Excused sessions"><p className="text-3xl font-semibold">{d.attendance.bySubject.reduce((a: number, r: Row) => a + Number(r.excused), 0)}</p><p className="text-sm text-slate-500">Excused sessions do not reduce the rate</p></Card>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="By subject"><BarChartCard data={d.attendance.bySubject.map((a: Row) => ({ name: a.name, pct: Math.round(((Number(a.present) + Number(a.late)) / Math.max(1, Number(a.present) + Number(a.late) + Number(a.absent))) * 1000) / 10 }))} xKey="name" yKey="pct" color="#22d3ee" /></Card>
            <Card title="Monthly trend"><AreaTrend data={d.attendance.monthly} xKey="month" yKey="pct" /></Card>
          </div>
        </>
      )}
      <Card className="mt-6" title="Daily record">
        <DataTable rows={daily.data?.items ?? []} rowKey={(r: Row, i: number) => `${r.session_date}-${i}`} empty="No attendance has been marked yet." columns={[
          { key: "session_date", header: "Date", render: (r: Row) => formatDate(r.session_date) },
          { key: "subject_name", header: "Subject", render: (r: Row) => `${r.subject_code} ${r.subject_name}` },
          { key: "status", header: "Status", render: (r: Row) => <Badge value={r.status === "present" ? "present" : r.status === "absent" ? "absent" : r.status}>{labelize(r.status)}</Badge> },
        ]} />
      </Card>
    </>
  );
}

function StaffAttendance({ role }: { role: string }) {
  const [tab, setTab] = useState<"sessions" | "record" | "shortage">("sessions");
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  return (
    <>
      <PageHeader title="Attendance" description="Record sessions for your allocated subjects and classes. Duplicate sessions are blocked; corrections keep the full history." />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <Tabs tabs={[{ id: "sessions", label: "Sessions & corrections" }, { id: "record", label: "Record attendance" }, { id: "shortage", label: "Shortage monitor" }]} active={tab} onChange={setTab} />
      {tab === "sessions" && <SessionList role={role} />}
      {tab === "record" && <RecordForm onMsg={setMsg} onSaved={() => setTab("sessions")} />}
      {tab === "shortage" && <Shortage />}
    </>
  );
}

function SessionList({ role }: { role: string }) {
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const { data, loading, error } = useFetch<{ items: Row[]; total: number }>(`/api/attendance?page=${page}&pageSize=20`);
  return (
    <Card title="Recorded sessions" subtitle={role === "admin" ? "All classes" : "Your allocated classes"}>
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data ? <Loading /> : (
        <>
          <DataTable rows={data?.items ?? []} rowKey={(r: Row) => r.id} onRowClick={(r: Row) => setOpenId(r.id)} empty="No sessions yet. Use Record attendance to create one." columns={[
            { key: "session_date", header: "Date", render: (r: Row) => formatDate(r.session_date) },
            { key: "subject_code", header: "Subject", render: (r: Row) => `${r.subject_code} ${r.subject_name}` },
            { key: "class_code", header: "Class" },
            { key: "marked", header: "Marked", render: (r: Row) => `${r.marked}/${r.class_size}` },
            { key: "present", header: "Present / late", render: (r: Row) => `${r.present} / ${r.late}` },
            { key: "absent", header: "Absent" },
            { key: "excused", header: "Excused" },
          ]} />
          <div className="mt-3 flex items-center justify-between text-sm"><span>{data?.total ?? 0} sessions · page {page}</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={(data?.items?.length ?? 0) < 20} onClick={() => setPage(page + 1)}>Next</Button></div></div>
        </>
      )}
      {openId && <SessionDetail id={openId} onClose={() => setOpenId(null)} />}
    </Card>
  );
}

function SessionDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, error, reload } = useFetch<Row>(`/api/attendance/${id}`);
  const [changes, setChanges] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  async function save() {
    const list = Object.entries(changes).map(([studentId, status]) => ({ studentId: Number(studentId), status }));
    try {
      await api(`/api/attendance/${id}`, { method: "PUT", body: { reason, changes: list } });
      setMsg({ tone: "success", text: `${list.length} correction(s) saved with the reason and audit trail.` });
      setChanges({});
      setReason("");
      reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    }
  }
  return (
    <Modal open onClose={onClose} title={data ? `${data.session.subjectCode} · ${data.session.classCode} · ${formatDate(data.session.sessionDate)}` : "Session"} wide>
      {error && <Notice tone="error">{error}</Notice>}
      {!data ? <Loading /> : (
        <div className="space-y-4">
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <div className="max-h-96 overflow-auto rounded-xl border border-slate-200 dark:border-navy-700">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 dark:bg-navy-800"><tr><th className="px-3 py-2 text-left">Student</th><th className="px-3 py-2 text-left">Current</th><th className="px-3 py-2 text-left">Change to</th></tr></thead>
              <tbody>
                {data.roster.map((r: Row) => (
                  <tr key={r.studentId} className="border-t border-slate-100 dark:border-navy-800">
                    <td className="px-3 py-2">{r.fullName} <span className="text-xs text-slate-500">{r.studentCode}</span></td>
                    <td className="px-3 py-2">{r.status === "unmarked" ? <span className="text-amber-600">Not marked</span> : labelize(r.status)}</td>
                    <td className="px-3 py-2">
                      <Select className="py-1" value={changes[r.studentId] ?? ""} onChange={(e) => setChanges({ ...changes, [r.studentId]: e.target.value })}>
                        <option value="">No change</option>
                        {STATUSES.filter((s) => s !== r.status).map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Reason for correction (required when changing)" className="md:col-span-2"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. late roll-call correction" /></Field>
            <div className="flex items-end"><Button className="w-full" disabled={Object.keys(changes).length === 0 || reason.trim().length < 5} onClick={save}><Save className="h-4 w-4" /> Save corrections</Button></div>
          </div>
          <Card title="Correction history" subtitle="Every change is recorded">
            <DataTable rows={data.corrections} rowKey={(r: Row) => r.id} empty="No corrections." columns={[
              { key: "createdAt", header: "When", render: (r: Row) => formatDate(r.createdAt) },
              { key: "oldStatus", header: "From", render: (r: Row) => labelize(r.oldStatus) },
              { key: "newStatus", header: "To", render: (r: Row) => labelize(r.newStatus) },
              { key: "reason", header: "Reason" },
            ]} />
          </Card>
        </div>
      )}
    </Modal>
  );
}

function RecordForm({ onMsg, onSaved }: { onMsg: (m: { tone: "success" | "error" | "info"; text: string } | null) => void; onSaved: () => void }) {
  const alloc = useFetch<{ items: Row[] }>("/api/allocations");
  const pairs = useMemo(() => {
    const map = new Map<string, Row>();
    for (const a of alloc.data?.items ?? []) map.set(`${a.subjectId}:${a.classId}`, a);
    return [...map.values()];
  }, [alloc.data]);
  const [key, setKey] = useState("");
  const [date, setDate] = useState(toDateInput());
  const [marks, setMarks] = useState<Record<number, string>>({});
  const [remarks, setRemarks] = useState<Record<number, string>>({});
  const selected = pairs.find((p) => `${p.subjectId}:${p.classId}` === key);
  const roster = useFetch<{ items: Row[] }>(selected ? `/api/students?classId=${selected.classId}&pageSize=100&sort=name` : null);
  const students: Row[] = roster.data?.items ?? [];
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      const records = students.map((s) => ({ studentId: s.id, status: marks[s.id] ?? "present", remarks: remarks[s.id] || null }));
      await api("/api/attendance", { body: { subjectId: selected.subjectId, classId: selected.classId, sessionDate: date, records } });
      onMsg({ tone: "success", text: `Attendance saved for ${students.length} student(s).` });
      onSaved();
    } catch (err) {
      onMsg({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Create attendance session" subtitle="Every enrolled student in the class is included. Choose a status for each; the default is Present.">
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Subject & class"><Select required value={key} onChange={(e) => { setKey(e.target.value); setMarks({}); }}><option value="">Select allocation</option>{pairs.map((p) => <option key={`${p.subjectId}:${p.classId}`} value={`${p.subjectId}:${p.classId}`}>{p.subjectCode} · {p.classCode}</option>)}</Select></Field>
          <Field label="Session date"><Input type="date" required max={toDateInput()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="flex items-end"><Button type="button" variant="secondary" className="w-full" onClick={() => setMarks(Object.fromEntries(students.map((s) => [s.id, "present"])))} disabled={!selected}>Mark all present</Button></div>
        </div>
        {!alloc.loading && pairs.length === 0 && <Notice tone="warning">No allocations found. Ask an administrator to allocate you to a subject and class.</Notice>}
        {selected && roster.loading && <Loading label="Loading roster…" />}
        {selected && students.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-navy-700">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-navy-800/60"><tr><th className="px-3 py-2 text-left">Student</th>{STATUSES.map((s) => <th key={s} className="px-3 py-2 text-left">{labelize(s)}</th>)}<th className="px-3 py-2 text-left">Remarks</th></tr></thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100 dark:border-navy-800">
                    <td className="px-3 py-2"><span className="font-medium">{s.full_name}</span> <span className="text-xs text-slate-500">{s.student_code}</span></td>
                    {STATUSES.map((st) => (
                      <td key={st} className="px-3 py-2"><input type="radio" name={`s-${s.id}`} aria-label={`${s.full_name} ${st}`} checked={(marks[s.id] ?? "present") === st} onChange={() => setMarks({ ...marks, [s.id]: st })} /></td>
                    ))}
                    <td className="px-3 py-2"><Input className="py-1" value={remarks[s.id] ?? ""} onChange={(e) => setRemarks({ ...remarks, [s.id]: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {selected && students.length === 0 && !roster.loading && <Notice tone="info">No active students in this class.</Notice>}
        <div className="flex justify-end"><Button type="submit" disabled={!selected || busy || students.length === 0}><Save className="h-4 w-4" /> {busy ? "Saving…" : "Submit attendance"}</Button></div>
        <p className="text-xs text-slate-500">A session can be recorded once per subject, class and date. Use corrections afterwards; unmarked students are not counted as absent.</p>
      </form>
      <div className="mt-4 text-xs"><Link href="/attendance" className="underline">Back to sessions</Link></div>
    </Card>
  );
}

function Shortage() {
  const { data, loading, error } = useFetch<{ threshold: number; plannedSessions: number; assumption: string; items: Row[] }>("/api/attendance/summary");
  if (loading) return <Loading />;
  if (error) return <Notice tone="error">{error}</Notice>;
  return (
    <Card title="Attendance shortage monitor" subtitle={`Target ${data?.threshold}% · projection assumes ${data?.plannedSessions} planned sessions per subject-semester. ${data?.assumption ?? ""}`}>
      <DataTable rows={data?.items ?? []} rowKey={(r: Row) => `${r.studentId}-${r.subjectId}`} empty="No attendance shortages or risks detected in your classes." columns={[
        { key: "fullName", header: "Student", render: (r: Row) => <Link className="font-medium text-brand-600 hover:underline dark:text-cyan-300" href={`/students/${r.studentId}`}>{r.fullName}</Link> },
        { key: "subjectCode", header: "Subject" },
        { key: "currentPct", header: "Current", render: (r: Row) => fmtPct(r.currentPct) },
        { key: "recentPct", header: "Recent (last 5)", render: (r: Row) => fmtPct(r.recentPct) },
        { key: "projectedPct", header: "Projected", render: (r: Row) => fmtPct(r.projectedPct) },
        { key: "sessionsNeededRemaining", header: "Sessions needed", render: (r: Row) => r.sessionsNeededRemaining },
        { key: "status", header: "Status", render: (r: Row) => <Badge value={r.status === "on_track" ? "approved" : r.status === "shortage_likely" ? "high" : "medium"}>{labelize(r.status)}</Badge> },
      ]} />
    </Card>
  );
}
