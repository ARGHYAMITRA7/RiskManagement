"use client";

import { useMemo, useState, type FormEvent } from "react";
import { FileUp, Plus } from "lucide-react";
import { Badge, Button, Card, DataTable, Field, Input, Loading, Modal, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDateTime, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Msg = { tone: "success" | "error" | "info"; text: string } | null;

export default function AssignmentsPage() {
  const me = useFetch<{ user: { role: string } }>("/api/auth/me");
  if (!me.data) return me.error ? <Notice tone="error">{me.error}</Notice> : <Loading />;
  if (me.data.user.role === "student") return <StudentAssignments />;
  if (me.data.user.role === "guardian") return <Notice tone="info">Assignment status for your linked student is shown in the Guardian Portal.</Notice>;
  return <StaffAssignments />;
}

function StudentAssignments() {
  const { data, loading, error, reload } = useFetch<{ items: Row[] }>("/api/assignments");
  const [open, setOpen] = useState<Row | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const items = data?.items ?? [];
  const status = (r: Row) => (r.my_submission_id ? (r.my_is_late ? "late" : "submitted") : r.overdue ? "absent" : "pending");
  return (
    <>
      <PageHeader title="Assignments" description="Submit text or documents before the deadline. Late submissions are accepted and flagged. Your teacher's feedback appears here." />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data ? <Loading /> : (
        <Card>
          <DataTable rows={items} rowKey={(r: Row) => r.id} onRowClick={(r: Row) => setOpen(r)} empty="No assignments for your class yet." columns={[
            { key: "title", header: "Assignment" },
            { key: "subject_name", header: "Subject", render: (r: Row) => `${r.subject_code} ${r.subject_name}` },
            { key: "deadline", header: "Deadline", render: (r: Row) => formatDateTime(r.deadline) },
            { key: "my_status", header: "My status", render: (r: Row) => <Badge value={status(r)}>{labelize(status(r))}</Badge> },
            { key: "my_marks", header: "Marks", render: (r: Row) => (r.my_marks === null || r.my_marks === undefined ? "—" : `${r.my_marks}/${r.max_marks}`) },
          ]} />
        </Card>
      )}
      {open && <StudentSubmit assignment={open} onClose={() => setOpen(null)} onDone={(t) => { setMsg({ tone: "success", text: t }); setOpen(null); reload(); }} onError={(t) => setMsg({ tone: "error", text: t })} />}
    </>
  );
}

function StudentSubmit({ assignment, onClose, onDone, onError }: { assignment: Row; onClose: () => void; onDone: (t: string) => void; onError: (t: string) => void }) {
  const detail = useFetch<Row>(`/api/assignments/${assignment.id}`);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = detail.data?.mySubmission;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const form = new FormData();
      if (text.trim()) form.append("submissionText", text);
      if (file) form.append("submission", file);
      await api(`/api/assignments/${assignment.id}`, { form });
      onDone("Submission received.");
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={assignment.title} wide>
      {detail.loading ? <Loading /> : (
        <div className="space-y-4">
          <p className="whitespace-pre-line text-sm text-slate-700 dark:text-slate-200">{detail.data?.assignment.instructions}</p>
          {detail.data?.assignment.attachmentName && <p className="text-sm">Attachment: <a className="text-brand-600 underline dark:text-cyan-300" href={`/api/files/attachments/${detail.data.assignment.attachmentPath?.split("/").pop()}`}>{detail.data.assignment.attachmentName}</a></p>}
          <p className="text-sm text-slate-500">Deadline {formatDateTime(assignment.deadline)} · Max {assignment.max_marks} marks · {assignment.allow_resubmission ? "Resubmission allowed" : "Single submission"}</p>
          {mine && (
            <Notice tone={mine.marks !== null ? "success" : "info"}>
              Submitted {formatDateTime(mine.submittedAt)}{mine.isLate ? " (late)" : ""} · attempt {mine.attemptNo}.
              {mine.marks !== null && <> Marks: <strong>{mine.marks}</strong>.</>}
              {mine.feedback && <> Feedback: {mine.feedback}</>}
              {mine.status === "resubmission_requested" && <> <strong>Resubmission requested.</strong></>}
            </Notice>
          )}
          {(!mine || assignment.allow_resubmission || mine.status === "resubmission_requested") && (
            <form onSubmit={submit} className="space-y-3">
              <Field label="Written answer (optional)"><Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answer here" /></Field>
              <Field label="Document (optional)" hint="PDF, DOCX, TXT, PNG or JPG up to 10 MB. The file type is verified by its contents."><Input type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
              <Button type="submit" disabled={busy || (!text.trim() && !file)}><FileUp className="h-4 w-4" /> {busy ? "Submitting…" : mine ? "Resubmit" : "Submit assignment"}</Button>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}

function StaffAssignments() {
  const { data, loading, error, reload } = useFetch<{ items: Row[] }>("/api/assignments");
  const [msg, setMsg] = useState<Msg>(null);
  const [open, setOpen] = useState<Row | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <>
      <PageHeader title="Assignments" description="Create assignments for your classes with instructions and attachments, then evaluate submissions with marks and feedback." actions={<Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New assignment</Button>} />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data ? <Loading /> : (
        <Card>
          <DataTable rows={data?.items ?? []} rowKey={(r: Row) => r.id} onRowClick={(r: Row) => setOpen(r)} empty="No assignments yet." columns={[
            { key: "title", header: "Assignment" },
            { key: "subject_code", header: "Subject", render: (r: Row) => `${r.subject_code} · ${r.class_code}` },
            { key: "deadline", header: "Deadline", render: (r: Row) => formatDateTime(r.deadline) },
            { key: "submitted", header: "Submitted", render: (r: Row) => `${r.submitted}/${r.expected}` },
            { key: "late", header: "Late" },
            { key: "graded", header: "Graded" },
            { key: "overdue", header: "State", render: (r: Row) => <Badge value={r.overdue ? "medium" : "approved"}>{r.overdue ? "Closed" : "Open"}</Badge> },
          ]} />
        </Card>
      )}
      {createOpen && <CreateAssignment onClose={() => setCreateOpen(false)} onDone={(t) => { setMsg({ tone: "success", text: t }); setCreateOpen(false); reload(); }} onError={(t) => setMsg({ tone: "error", text: t })} />}
      {open && <GradePanel assignment={open} onClose={() => setOpen(null)} onMsg={setMsg} />}
    </>
  );
}

function useAllocationPairs() {
  const alloc = useFetch<{ items: Row[] }>("/api/allocations");
  return useMemo(() => {
    const map = new Map<string, Row>();
    for (const a of alloc.data?.items ?? []) map.set(`${a.subjectId}:${a.classId}`, a);
    return [...map.values()];
  }, [alloc.data]);
}

function CreateAssignment({ onClose, onDone, onError }: { onClose: () => void; onDone: (t: string) => void; onError: (t: string) => void }) {
  const pairs = useAllocationPairs();
  const [key, setKey] = useState("");
  const selected = pairs.find((p) => `${p.subjectId}:${p.classId}` === key);
  const topics = useFetch<{ items: Row[] }>(selected ? `/api/academics/topics?subjectId=${selected.subjectId}` : null);
  const [f, setF] = useState({ title: "", topicId: "", instructions: "", deadline: "", maxMarks: "10", allowResubmission: false });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("title", f.title);
      form.append("subjectId", String(selected.subjectId));
      form.append("classId", String(selected.classId));
      if (f.topicId) form.append("topicId", f.topicId);
      form.append("instructions", f.instructions);
      form.append("deadline", new Date(f.deadline).toISOString());
      form.append("maxMarks", f.maxMarks);
      form.append("allowResubmission", String(f.allowResubmission));
      if (file) form.append("attachment", file);
      await api("/api/assignments", { form });
      onDone("Assignment published. Students in the class have been notified.");
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Create assignment" wide>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <Field label="Subject & class"><Select required value={key} onChange={(e) => setKey(e.target.value)}><option value="">Select</option>{pairs.map((p) => <option key={`${p.subjectId}:${p.classId}`} value={`${p.subjectId}:${p.classId}`}>{p.subjectCode} · {p.classCode}</option>)}</Select></Field>
        <Field label="Topic (optional)"><Select value={f.topicId} onChange={(e) => setF({ ...f, topicId: e.target.value })}><option value="">None</option>{(topics.data?.items ?? []).map((t: Row) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <Field label="Title" className="md:col-span-2"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Instructions" className="md:col-span-2"><Textarea required minLength={10} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>
        <Field label="Deadline"><Input type="datetime-local" required value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
        <Field label="Maximum marks"><Input type="number" min={1} value={f.maxMarks} onChange={(e) => setF({ ...f, maxMarks: e.target.value })} /></Field>
        <Field label="Attachment (optional)" hint="Validated: extension, MIME type and file signature"><Input type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={f.allowResubmission} onChange={(e) => setF({ ...f, allowResubmission: e.target.checked })} /> Allow resubmission</label>
        <div className="flex justify-end gap-2 md:col-span-2"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !selected}>Publish assignment</Button></div>
      </form>
    </Modal>
  );
}

function GradePanel({ assignment, onClose, onMsg }: { assignment: Row; onClose: () => void; onMsg: (m: Msg) => void }) {
  const { data, reload, loading } = useFetch<Row>(`/api/assignments/${assignment.id}`);
  const [edits, setEdits] = useState<Record<number, { marks: string; feedback: string }>>({});
  async function grade(sub: Row, status: "graded" | "resubmission_requested") {
    const e = edits[sub.id] ?? { marks: sub.marks === null ? "" : String(sub.marks), feedback: sub.feedback ?? "" };
    try {
      await api(`/api/assignments/submissions/${sub.id}`, { method: "PATCH", body: { status, marks: e.marks === "" ? null : Number(e.marks), feedback: e.feedback || null } });
      onMsg({ tone: "success", text: status === "graded" ? `Evaluated ${sub.fullName}.` : `Resubmission requested from ${sub.fullName}.` });
      reload();
    } catch (err) {
      onMsg({ tone: "error", text: errorMessage(err) });
    }
  }
  return (
    <Modal open onClose={onClose} title={`Evaluate: ${assignment.title}`} wide>
      {loading && !data ? <Loading /> : (
        <div className="space-y-4">
          <DataTable rows={data?.submissions ?? []} rowKey={(r: Row) => r.id} empty="No submissions yet." columns={[
            { key: "fullName", header: "Student", render: (r: Row) => `${r.fullName} (${r.studentCode})` },
            { key: "submittedAt", header: "Submitted", render: (r: Row) => `${formatDateTime(r.submittedAt)}${r.isLate ? " · late" : ""}` },
            { key: "file", header: "Work", render: (r: Row) => (r.filePath ? <a className="text-brand-600 underline dark:text-cyan-300" href={`/api/files/${r.filePath}`}>{r.fileName}</a> : <span className="line-clamp-2 max-w-xs text-xs">{r.submissionText}</span>) },
            { key: "marks", header: "Marks", render: (r: Row) => (
              <Input className="w-20 py-1" type="number" min={0} max={assignment.max_marks} value={edits[r.id]?.marks ?? (r.marks === null ? "" : String(r.marks))} onChange={(e) => setEdits({ ...edits, [r.id]: { marks: e.target.value, feedback: edits[r.id]?.feedback ?? r.feedback ?? "" } })} aria-label={`Marks for ${r.fullName}`} />
            ) },
            { key: "feedback", header: "Feedback", render: (r: Row) => (
              <Input className="py-1" value={edits[r.id]?.feedback ?? r.feedback ?? ""} onChange={(e) => setEdits({ ...edits, [r.id]: { marks: edits[r.id]?.marks ?? (r.marks === null ? "" : String(r.marks)), feedback: e.target.value } })} aria-label={`Feedback for ${r.fullName}`} />
            ) },
            { key: "actions", header: "", render: (r: Row) => (
              <div className="flex flex-col gap-1">
                <Button size="sm" onClick={() => grade(r, "graded")}>Save evaluation</Button>
                {assignment.allow_resubmission && <Button size="sm" variant="ghost" onClick={() => grade(r, "resubmission_requested")}>Request resubmission</Button>}
              </div>
            ) },
          ]} />
          <div>
            <h4 className="mb-2 text-sm font-semibold">Not submitted</h4>
            <p className="text-sm text-slate-600 dark:text-slate-300">{(data?.notSubmitted ?? []).map((s: Row) => s.fullName).join(", ") || "Everyone has submitted."}</p>
          </div>
        </div>
      )}
    </Modal>
  );
}
