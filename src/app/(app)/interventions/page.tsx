"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, Card, DataTable, Field, Input, Loading, Modal, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDate, formatDateTime, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Msg = { tone: "success" | "error" | "info"; text: string } | null;

/** Staff: manage interventions (private observations are staff-only). Students: read-only view of their own plans. */
export default function InterventionsPage() {
  const me = useFetch<{ user: { role: string } }>("/api/auth/me");
  const isStudent = me.data?.user.role === "student";
  const list = useFetch<{ items: Row[]; counts: Row[] }>(me.data ? "/api/interventions" : null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  if (!me.data) return me.error ? <Notice tone="error">{me.error}</Notice> : <Loading />;
  const counts = Object.fromEntries((list.data?.counts ?? []).map((c: Row) => [c.status, c.n]));

  return (
    <>
      <PageHeader
        title={isStudent ? "My Support Plans" : "Academic Interventions"}
        description={isStudent ? "Plans agreed with your teachers, their status, follow-up dates and history." : "Plan support for struggling students, log support sessions, set targets, assign revision tasks, schedule follow-ups and close cases."}
        actions={!isStudent && <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New intervention</Button>}
      />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {["pending", "in_progress", "follow_up_required", "completed"].map((s) => (
          <Card key={s}><p className="text-xs uppercase tracking-wide text-slate-500">{labelize(s)}</p><p className="text-2xl font-semibold">{counts[s] ?? 0}</p></Card>
        ))}
      </div>
      {list.error && <Notice tone="error">{list.error}</Notice>}
      <Card>
        <DataTable rows={list.data?.items ?? []} rowKey={(r: Row) => r.id} onRowClick={(r: Row) => setOpenId(r.id)} empty="No interventions yet." columns={[
          { key: "studentName", header: "Student", render: (r: Row) => `${r.studentName} (${r.studentCode})` },
          { key: "subjectName", header: "Subject", render: (r: Row) => r.subjectName ?? "General" },
          { key: "status", header: "Status", render: (r: Row) => <Badge value={r.status}>{labelize(r.status)}</Badge> },
          { key: "followUpDate", header: "Follow-up", render: (r: Row) => formatDate(r.followUpDate) },
          { key: "target", header: "Target" },
          { key: "updatedAt", header: "Updated", render: (r: Row) => formatDateTime(r.updatedAt) },
        ]} />
      </Card>
      {openId && <CaseModal id={openId} isStudent={isStudent} onClose={() => setOpenId(null)} onMsg={setMsg} onChanged={list.reload} />}
      {createOpen && <CreateModal onClose={() => setCreateOpen(false)} onDone={(t) => { setMsg({ tone: "success", text: t }); setCreateOpen(false); list.reload(); }} />}
    </>
  );
}

function CaseModal({ id, isStudent, onClose, onMsg, onChanged }: { id: number; isStudent: boolean; onClose: () => void; onMsg: (m: Msg) => void; onChanged: () => void }) {
  const { data, error, loading, reload } = useFetch<Row>(`/api/interventions/${id}`);
  const [note, setNote] = useState("");
  const [obs, setObs] = useState("");
  const [status, setStatus] = useState("in_progress");
  const [follow, setFollow] = useState("");
  const [task, setTask] = useState({ title: "", taskDate: "", minutes: "45" });

  async function act(body: Record<string, unknown>, ok: string) {
    try {
      await api(`/api/interventions/${id}`, { method: "PATCH", body });
      onMsg({ tone: "success", text: ok });
      reload();
      onChanged();
    } catch (e) {
      onMsg({ tone: "error", text: errorMessage(e) });
    }
  }

  return (
    <Modal open onClose={onClose} title="Intervention case" wide>
      {loading && !data ? <Loading /> : error ? <Notice tone="error">{error}</Notice> : data && (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            <div><p className="text-xs text-slate-500">Student</p><p className="font-medium">{data.student.name} ({data.student.code})</p></div>
            <div><p className="text-xs text-slate-500">Status</p><Badge value={data.intervention.status}>{labelize(data.intervention.status)}</Badge></div>
            <div><p className="text-xs text-slate-500">Follow-up</p><p className="font-medium">{formatDate(data.intervention.followUpDate)}</p></div>
          </div>
          <Card title="Support plan" subtitle={data.intervention.target ? `Target: ${data.intervention.target}` : undefined}>
            <p className="whitespace-pre-line text-sm">{data.intervention.plan}</p>
          </Card>
          <Card title="History" subtitle="Status changes, support sessions and revision tasks">
            <DataTable rows={data.history} rowKey={(r: Row) => r.id} empty="No history." columns={[
              { key: "createdAt", header: "When", render: (r: Row) => formatDateTime(r.createdAt) },
              { key: "kind", header: "Event", render: (r: Row) => labelize(r.kind) },
              { key: "status", header: "Status", render: (r: Row) => labelize(r.status) },
              { key: "note", header: "Note" },
              { key: "changedBy", header: "By", render: (r: Row) => r.changedBy ?? "System" },
            ]} />
          </Card>
          {!isStudent && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card title="Update status">
                <div className="space-y-2">
                  <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="follow_up_required">Follow-up required</option><option value="completed">Completed (close case)</option></Select>
                  <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <Button className="w-full" onClick={() => act({ action: "status", status, note: note || undefined }, "Status updated. The student and guardian were notified.")}>Update status</Button>
                </div>
              </Card>
              <Card title="Log a support session">
                <div className="space-y-2">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was discussed and agreed?" />
                  <Button variant="secondary" className="w-full" disabled={note.trim().length < 5} onClick={() => { act({ action: "session", note }, "Support session recorded."); setNote(""); }}>Record session</Button>
                </div>
              </Card>
              <Card title="Follow-up" subtitle="Schedules a follow-up and sets status to follow-up required">
                <div className="flex gap-2"><Input type="date" value={follow} onChange={(e) => setFollow(e.target.value)} /><Button disabled={!follow} onClick={() => act({ action: "followup", followUpDate: follow }, "Follow-up scheduled.")}>Schedule</Button></div>
              </Card>
              <Card title="Assign revision task" subtitle="Adds a task to the student's planner">
                <div className="grid gap-2 md:grid-cols-3">
                  <Input className="md:col-span-3" placeholder="Task title" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} />
                  <Input type="date" value={task.taskDate} onChange={(e) => setTask({ ...task, taskDate: e.target.value })} />
                  <Input type="number" min={15} max={240} value={task.minutes} onChange={(e) => setTask({ ...task, minutes: e.target.value })} aria-label="Minutes" />
                  <Button disabled={!task.title || !task.taskDate} onClick={() => { act({ action: "task", title: task.title, taskDate: task.taskDate, minutes: Number(task.minutes) }, "Revision task assigned."); setTask({ title: "", taskDate: "", minutes: "45" }); }}>Assign</Button>
                </div>
              </Card>
              <Card title="Private teacher observations" subtitle="Visible to staff only">
                <div className="space-y-2">
                  <Textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observation for staff records" />
                  <Button variant="secondary" className="w-full" disabled={obs.trim().length < 3} onClick={() => { act({ action: "observation", body: obs }, "Private observation saved."); setObs(""); }}>Save observation</Button>
                  <DataTable rows={data.observations ?? []} rowKey={(r: Row) => r.id} empty="No observations." columns={[{ key: "body", header: "Observation" }, { key: "authorName", header: "By" }]} />
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: (t: string) => void }) {
  const students = useFetch<{ items: Row[] }>("/api/students?pageSize=100&sort=name");
  const [f, setF] = useState({ studentId: "", plan: "", target: "", followUpDate: "", status: "pending" });
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/interventions", { body: { studentId: Number(f.studentId), plan: f.plan, target: f.target, followUpDate: f.followUpDate || null, status: f.status } });
      onDone("Intervention created. The student and guardian were notified.");
    } catch (x) {
      setErr(errorMessage(x));
    }
  }
  return (
    <Modal open onClose={onClose} title="New intervention plan" wide>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        {err && <div className="md:col-span-2"><Notice tone="error">{err}</Notice></div>}
        <Field label="Student"><Select required value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })}><option value="">Select student</option>{(students.data?.items ?? []).map((s: Row) => <option key={s.id} value={s.id}>{s.full_name} ({s.student_code})</option>)}</Select></Field>
        <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="pending">Pending</option><option value="in_progress">In progress</option></Select></Field>
        <Field label="Support plan" className="md:col-span-2"><Textarea required minLength={10} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} /></Field>
        <Field label="Measurable target"><Input value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
        <Field label="Follow-up date"><Input type="date" value={f.followUpDate} onChange={(e) => setF({ ...f, followUpDate: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 md:col-span-2"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit">Create</Button></div>
      </form>
    </Modal>
  );
}
