"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Send, Save, Upload, Undo2 } from "lucide-react";
import { Badge, Button, Card, DataTable, Field, Input, Loading, Notice, PageHeader, Select, Tabs, fmtPct } from "@/components/ui";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDate, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Msg = { tone: "success" | "error" | "info"; text: string } | null;
const EXAM_TYPES = ["internal_assessment", "class_test", "mid_semester", "end_semester", "practical", "project"];

export default function ExamsPage() {
  const me = useFetch<{ user: { role: string } }>("/api/auth/me");
  if (!me.data) return me.error ? <Notice tone="error">{me.error}</Notice> : <Loading />;
  if (me.data.user.role === "student") return <StudentExams />;
  if (me.data.user.role === "guardian") return <Notice tone="info">Guardians view published results from the Guardian Portal.</Notice>;
  return <StaffExams role={me.data.user.role} />;
}

function StudentExams() {
  const { data, loading, error } = useFetch<{ items: Row[] }>("/api/exams");
  const items = data?.items ?? [];
  const published = items.filter((r) => r.status === "published");
  const pct = (r: Row) => (r.published_marks === null || r.published_marks === undefined ? null : (Number(r.published_marks) / Number(r.max_marks)) * 100);
  return (
    <>
      <PageHeader title="Examinations & Results" description="Scheduled examinations for your subjects. Marks appear here once the institution publishes them." />
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data ? <Loading /> : (
        <div className="grid gap-4">
          <Card title="Published results" subtitle={`${published.length} result(s) published`}>
            <DataTable rows={published} rowKey={(r: Row) => r.id} empty="No results have been published yet." columns={[
              { key: "subject_code", header: "Subject", render: (r: Row) => `${r.subject_code} ${r.subject_name}` },
              { key: "name", header: "Examination" },
              { key: "exam_type", header: "Type", render: (r: Row) => labelize(r.exam_type) },
              { key: "published_marks", header: "Marks", render: (r: Row) => (r.published_marks === null ? "Not entered" : `${r.published_marks}/${r.max_marks}`) },
              { key: "pct", header: "Percent", render: (r: Row) => fmtPct(pct(r)) },
              { key: "pass", header: "Result", render: (r: Row) => { const p = pct(r); if (p === null) return "—"; return <Badge value={Number(r.published_marks) >= Number(r.pass_marks) ? "approved" : "rejected"}>{Number(r.published_marks) >= Number(r.pass_marks) ? "Pass" : "Below pass"}</Badge>; } },
            ]} />
          </Card>
          <Card title="Upcoming & pending examinations" subtitle="Results pending publication">
            <DataTable rows={items.filter((r) => r.status !== "published")} rowKey={(r: Row) => r.id} empty="No pending examinations." columns={[
              { key: "subject_code", header: "Subject" },
              { key: "name", header: "Examination" },
              { key: "exam_date", header: "Date", render: (r: Row) => formatDate(r.exam_date) },
              { key: "status", header: "Status", render: (r: Row) => <Badge value={r.status}>{labelize(r.status)}</Badge> },
            ]} />
          </Card>
        </div>
      )}
    </>
  );
}

function StaffExams({ role }: { role: string }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const exams = useFetch<{ items: Row[] }>("/api/exams");
  const subjects = useSubjects(role);
  return (
    <>
      <PageHeader title="Examinations & Marks" description="Schedule examinations, enter marks (blank means not entered, never zero), publish results, and manage correction requests." />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Examinations">
          {exams.error && <Notice tone="error">{exams.error}</Notice>}
          <DataTable rows={exams.data?.items ?? []} rowKey={(r: Row) => r.id} onRowClick={(r: Row) => setSelected(r.id)} empty="No examinations scheduled. Create one on the right." columns={[
            { key: "name", header: "Examination" },
            { key: "subject_code", header: "Subject" },
            { key: "exam_type", header: "Type", render: (r: Row) => labelize(r.exam_type) },
            { key: "exam_date", header: "Date", render: (r: Row) => formatDate(r.exam_date) },
            { key: "entered_rows", header: "Entered", render: (r: Row) => `${r.entered_rows}/${r.result_rows}` },
            { key: "status", header: "Status", render: (r: Row) => <Badge value={r.status}>{labelize(r.status)}</Badge> },
          ]} />
        </Card>
        <CreateExam subjects={subjects} onDone={(t) => { setMsg({ tone: "success", text: t }); exams.reload(); }} onError={(t) => setMsg({ tone: "error", text: t })} />
      </div>
      {selected && <MarksEntry examId={selected} role={role} onMsg={setMsg} onChanged={exams.reload} />}
      <CorrectionsPanel role={role} onMsg={setMsg} />
    </>
  );
}

function useSubjects(role: string) {
  const alloc = useFetch<{ items: Row[] }>(role === "teacher" ? "/api/allocations" : null);
  const all = useFetch<{ items: Row[] }>(role === "admin" ? "/api/academics/subjects" : null);
  if (role === "admin") return all.data?.items ?? [];
  const map = new Map<number, Row>();
  for (const a of alloc.data?.items ?? []) map.set(a.subjectId, { id: a.subjectId, code: a.subjectCode, name: a.subjectName });
  return [...map.values()];
}

function CreateExam({ subjects, onDone, onError }: { subjects: Row[]; onDone: (t: string) => void; onError: (t: string) => void }) {
  const [f, setF] = useState({ name: "", examType: "internal_assessment", subjectId: "", examDate: "", maxMarks: "25", passMarks: "10" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/exams", { body: { ...f, subjectId: Number(f.subjectId), maxMarks: Number(f.maxMarks), passMarks: Number(f.passMarks) } });
      onDone("Examination scheduled.");
      setF({ ...f, name: "", examDate: "" });
    } catch (err) {
      onError(errorMessage(err));
    }
  }
  return (
    <Card title="Schedule examination">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name"><Input required value={f.name} onChange={set("name")} placeholder="e.g. Internal Assessment 2" /></Field>
        <Field label="Type"><Select value={f.examType} onChange={set("examType")}>{EXAM_TYPES.map((t) => <option key={t} value={t}>{labelize(t)}</option>)}</Select></Field>
        <Field label="Subject"><Select required value={f.subjectId} onChange={set("subjectId")}><option value="">Select</option>{subjects.map((s: Row) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><Input type="date" required value={f.examDate} onChange={set("examDate")} /></Field>
          <Field label="Max marks"><Input type="number" min={1} value={f.maxMarks} onChange={set("maxMarks")} /></Field>
          <Field label="Pass marks"><Input type="number" min={0} value={f.passMarks} onChange={set("passMarks")} /></Field>
        </div>
        <Button type="submit" className="w-full">Schedule</Button>
      </form>
    </Card>
  );
}

function MarksEntry({ examId, role, onMsg, onChanged }: { examId: number; role: string; onMsg: (m: Msg) => void; onChanged: () => void }) {
  const { data, error, loading, reload } = useFetch<Row>(`/api/exams/${examId}`);
  const [draft, setDraft] = useState<Record<number, { marks: string; absent: boolean }>>({});
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return null;
  const exam = data.exam;
  const published = exam.status === "published";
  const valueOf = (r: Row) => draft[r.studentId] ?? { marks: r.marks === null ? "" : String(r.marks), absent: r.attendanceStatus === "absent" };

  async function save() {
    setBusy(true);
    try {
      const results = data.rows.map((r: Row) => {
        const v = valueOf(r);
        return { studentId: r.studentId, marks: v.absent || v.marks === "" ? null : Number(v.marks), attendanceStatus: v.absent ? "absent" : "present" };
      });
      await api(`/api/exams/${examId}`, { method: "PUT", body: { results } });
      onMsg({ tone: "success", text: "Marks saved. Blank marks are stored as not entered." });
      setDraft({});
      reload();
      onChanged();
    } catch (e) {
      onMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function publish(action: "publish" | "unpublish") {
    try {
      await api(`/api/exams/${examId}`, { method: "PATCH", body: { action } });
      onMsg({ tone: "success", text: action === "publish" ? "Results published. Students and linked guardians have been notified." : "Results moved back to marks entry." });
      reload();
      onChanged();
    } catch (e) {
      onMsg({ tone: "error", text: errorMessage(e) });
    }
  }

  return (
    <Card className="mt-4" title={`Marks: ${exam.name}`} subtitle={`${exam.subjectCode} · max ${exam.maxMarks} · pass ${exam.passMarks} · ${labelize(exam.status)}`}
      actions={
        <>
          {!published && <Button variant="secondary" disabled={busy} onClick={save}><Save className="h-4 w-4" /> Save marks</Button>}
          {!published && <Button onClick={() => publish("publish")}><Send className="h-4 w-4" /> Publish results</Button>}
          {published && role === "admin" && <Button variant="secondary" onClick={() => publish("unpublish")}><Undo2 className="h-4 w-4" /> Unpublish</Button>}
        </>
      }>
      {published && <Notice tone="info">Results are published. Changes require a correction request.</Notice>}
      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-navy-700">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-navy-800/60"><tr><th className="px-3 py-2 text-left">Student</th><th className="px-3 py-2 text-left">Marks</th><th className="px-3 py-2 text-left">Absent</th><th className="px-3 py-2 text-left">%</th><th className="px-3 py-2 text-left">Grade</th></tr></thead>
          <tbody>
            {data.rows.map((r: Row) => {
              const v = valueOf(r);
              const pct = v.marks === "" || v.absent ? null : (Number(v.marks) / exam.maxMarks) * 100;
              return (
                <tr key={r.studentId} className="border-t border-slate-100 dark:border-navy-800">
                  <td className="px-3 py-2"><span className="font-medium">{r.fullName}</span> <span className="text-xs text-slate-500">{r.studentCode}</span></td>
                  <td className="px-3 py-2"><Input className="w-28 py-1" type="number" min={0} max={exam.maxMarks} disabled={published || v.absent} value={v.marks} placeholder="not entered" aria-label={`Marks for ${r.fullName}`} onChange={(e) => setDraft({ ...draft, [r.studentId]: { ...v, marks: e.target.value } })} /></td>
                  <td className="px-3 py-2"><input type="checkbox" disabled={published} checked={v.absent} onChange={(e) => setDraft({ ...draft, [r.studentId]: { ...v, absent: e.target.checked } })} aria-label={`${r.fullName} absent`} /></td>
                  <td className="px-3 py-2">{fmtPct(pct)}</td>
                  <td className="px-3 py-2">{pct === null ? "—" : `${r.grade ?? "—"}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!published && <div className="mt-3"><Button size="sm" variant="secondary" onClick={() => setDraft({})}>Reset edits</Button></div>}
      {role === "teacher" && published && <RequestCorrection rows={data.rows} onMsg={onMsg} />}
      {busy && <p className="mt-2 text-xs text-slate-500">Saving…</p>}
    </Card>
  );
}

function RequestCorrection({ rows, onMsg }: { rows: Row[]; onMsg: (m: Msg) => void }) {
  const [studentId, setStudentId] = useState("");
  const [resultId, setResultId] = useState("");
  const [newMarks, setNewMarks] = useState("");
  const [reason, setReason] = useState("");
  void resultId;
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const row = rows.find((r: Row) => String(r.studentId) === studentId);
      if (!row?.resultId) throw new Error("Select a student with an entered result");
      await api("/api/exams/corrections", { body: { resultId: row.resultId, newMarks: Number(newMarks), reason } });
      onMsg({ tone: "success", text: "Correction requested. An administrator must approve it." });
      setStudentId(""); setNewMarks(""); setReason("");
    } catch (err) {
      onMsg({ tone: "error", text: errorMessage(err) });
    }
  }
  return (
    <form onSubmit={submit} className="mt-5 grid gap-3 md:grid-cols-4">
      <Field label="Student (result)"><Select required value={studentId} onChange={(e) => setStudentId(e.target.value)}><option value="">Select</option>{rows.filter((r: Row) => r.marks !== null).map((r: Row) => <option key={r.studentId} value={r.studentId}>{r.fullName}</option>)}</Select></Field>
      <Field label="Corrected marks"><Input type="number" min={0} required value={newMarks} onChange={(e) => setNewMarks(e.target.value)} /></Field>
      <Field label="Reason" className="md:col-span-2"><Input required minLength={10} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="md:col-span-4"><Button type="submit" variant="secondary"><Upload className="h-4 w-4" /> Request correction</Button></div>
    </form>
  );
}

function CorrectionsPanel({ role, onMsg }: { role: string; onMsg: (m: Msg) => void }) {
  const { data, reload } = useFetch<{ items: Row[] }>("/api/exams/corrections?status=pending");
  async function decide(id: number, decision: "approve" | "reject") {
    try {
      await api("/api/exams/corrections", { method: "PATCH", body: { id, decision } });
      onMsg({ tone: "success", text: decision === "approve" ? "Correction approved and applied to the result." : "Correction rejected." });
      reload();
    } catch (e) {
      onMsg({ tone: "error", text: errorMessage(e) });
    }
  }
  return (
    <Card className="mt-4" title="Pending correction requests" subtitle="Corrections to published results are approved by administrators and audited.">
      <DataTable rows={data?.items ?? []} rowKey={(r: Row) => r.id} empty="No pending correction requests." columns={[
        { key: "studentName", header: "Student" },
        { key: "examName", header: "Examination" },
        { key: "oldMarks", header: "From", render: (r: Row) => r.oldMarks ?? "blank" },
        { key: "newMarks", header: "To" },
        { key: "reason", header: "Reason" },
        { key: "actions", header: "", render: (r: Row) => role === "admin" ? <div className="flex gap-1.5"><Button size="sm" onClick={() => decide(r.id, "approve")}>Approve</Button><Button size="sm" variant="ghost" onClick={() => decide(r.id, "reject")}>Reject</Button></div> : <span className="text-xs text-slate-500">Awaiting admin</span> },
      ]} />
    </Card>
  );
}
