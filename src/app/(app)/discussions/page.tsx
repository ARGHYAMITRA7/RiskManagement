"use client";

import { useState, type FormEvent } from "react";
import { Flag, MessageSquare, Plus } from "lucide-react";
import { Badge, Button, Card, Field, Input, Loading, Modal, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDateTime, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Msg = { tone: "success" | "error" | "info"; text: string } | null;

export default function DiscussionsPage() {
  const me = useFetch<{ user: { role: string } }>("/api/auth/me");
  const role = me.data?.user.role;
  const [subjectId, setSubjectId] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const params = new URLSearchParams();
  if (subjectId) params.set("subjectId", subjectId);
  if (flagged) params.set("flagged", "1");
  if (q) params.set("q", q);
  const list = useFetch<{ items: Row[] }>(me.data ? `/api/discussions?${params}` : null);
  const subjects = useFetch<{ items: Row[] }>("/api/academics/subjects");
  if (!me.data) return me.error ? <Notice tone="error">{me.error}</Notice> : <Loading />;
  const staff = role === "admin" || role === "teacher";

  return (
    <>
      <PageHeader title="Academic Discussions" description="Ask subject questions, get answers from teachers, and report inappropriate content. Only members of a subject can read its discussions." actions={<Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> Ask a question</Button>} />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Input className="md:col-span-2" placeholder="Search titles and messages" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search discussions" />
          <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="Subject"><option value="">All subjects</option>{(subjects.data?.items ?? []).map((s: Row) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select>
          {staff && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} /> Show flagged only</label>}
        </div>
      </Card>
      <Card>
        {list.error && <Notice tone="error">{list.error}</Notice>}
        {list.loading && !list.data ? <Loading /> : (list.data?.items ?? []).length === 0 ? <Notice tone="info">No discussions yet. Start one with “Ask a question”.</Notice> : (
          <ul className="divide-y divide-slate-100 dark:divide-navy-800">
            {(list.data?.items ?? []).map((t: Row) => (
              <li key={t.id}>
                <button onClick={() => setOpenId(t.id)} className="flex w-full flex-wrap items-center justify-between gap-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-navy-800/50">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">{t.title}</p>
                    <p className="text-xs text-slate-500">{t.subject_code} · {labelize(t.category)} · {t.author_name} · {formatDateTime(t.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.is_flagged && <Badge value="rejected">Flagged</Badge>}
                    <Badge value={t.status}>{labelize(t.status)}</Badge>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500"><MessageSquare className="h-3.5 w-3.5" /> {t.replies}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {openId && <ThreadModal id={openId} staff={staff} onClose={() => setOpenId(null)} onMsg={setMsg} onChanged={list.reload} />}
      {newOpen && <NewThread subjects={subjects.data?.items ?? []} onClose={() => setNewOpen(false)} onDone={() => { setNewOpen(false); list.reload(); setMsg({ tone: "success", text: "Question posted." }); }} />}
    </>
  );
}

function ThreadModal({ id, staff, onClose, onMsg, onChanged }: { id: number; staff: boolean; onClose: () => void; onMsg: (m: Msg) => void; onChanged: () => void }) {
  const { data, loading, error, reload } = useFetch<Row>(`/api/discussions?threadId=${id}`);
  const [reply, setReply] = useState("");
  const [reportReason, setReportReason] = useState("");
  async function post(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/discussions", { body: { type: "reply", threadId: id, body: reply } });
      setReply("");
      reload();
      onChanged();
    } catch (x) {
      onMsg({ tone: "error", text: errorMessage(x) });
    }
  }
  async function report(kind: "thread" | "reply", targetId: number) {
    if (reportReason.trim().length < 5) return onMsg({ tone: "error", text: "Give a short reason (5+ characters) before reporting." });
    try {
      await api("/api/discussions", { body: { type: "report", kind, id: targetId, reason: reportReason } });
      setReportReason("");
      onMsg({ tone: "success", text: "Report submitted for moderation." });
      reload();
    } catch (x) {
      onMsg({ tone: "error", text: errorMessage(x) });
    }
  }
  async function moderate(kind: "thread" | "reply", targetId: number, action: string) {
    try {
      await api("/api/discussions", { method: "PATCH", body: { kind, id: targetId, action } });
      onMsg({ tone: "success", text: `Moderation: ${labelize(action)} applied.` });
      if (action === "delete" && kind === "thread") onClose();
      reload();
      onChanged();
    } catch (x) {
      onMsg({ tone: "error", text: errorMessage(x) });
    }
  }
  return (
    <Modal open onClose={onClose} title={data?.thread?.title ?? "Discussion"} wide>
      {loading && !data ? <Loading /> : error ? <Notice tone="error">{error}</Notice> : data && (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-navy-800">
            <p className="text-xs text-slate-500">{data.thread.authorName} · {formatDateTime(data.thread.createdAt)} · {data.thread.subjectCode}</p>
            <p className="mt-2 whitespace-pre-line text-sm">{data.thread.body}</p>
            {data.thread.isFlagged && <p className="mt-2 text-xs text-rose-600">Flagged: {data.thread.flagReason}</p>}
          </div>
          <ul className="space-y-3">
            {data.replies.map((r: Row) => (
              <li key={r.id} className={`rounded-xl border p-3 text-sm ${r.isStaff ? "border-brand-500/30 bg-brand-500/5 dark:bg-navy-800" : "border-slate-200 dark:border-navy-700"}`}>
                <p className="text-xs text-slate-500">{r.authorName} {r.isStaff && <Badge value="approved">Staff</Badge>} · {formatDateTime(r.createdAt)} {r.isFlagged && <span className="text-rose-600">· flagged</span>}</p>
                <p className="mt-1 whitespace-pre-line">{r.body}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {staff && r.isFlagged && <button className="text-brand-600 underline dark:text-cyan-300" onClick={() => moderate("reply", r.id, "unflag")}>Clear flag</button>}
                  {staff && <button className="text-rose-600 underline" onClick={() => moderate("reply", r.id, "delete")}>Remove</button>}
                </div>
              </li>
            ))}
          </ul>
          {!data.thread.status || data.thread.status !== "closed" ? (
            <form onSubmit={post} className="space-y-2">
              <Textarea required minLength={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply" aria-label="Reply" />
              <div className="flex justify-end"><Button type="submit"><MessageSquare className="h-4 w-4" /> Reply</Button></div>
            </form>
          ) : <Notice tone="info">This discussion is closed.</Notice>}
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4 dark:border-navy-800">
            <Field label="Report reason" className="min-w-[240px] flex-1"><Input value={reportReason} onChange={(e) => setReportReason(e.target.value)} placeholder="Why is this inappropriate?" /></Field>
            <Button variant="secondary" onClick={() => report("thread", id)}><Flag className="h-4 w-4" /> Report thread</Button>
          </div>
          {staff && (
            <div className="flex flex-wrap gap-2">
              {data.thread.status !== "closed" ? <Button variant="secondary" size="sm" onClick={() => moderate("thread", id, "close")}>Close discussion</Button> : <Button variant="secondary" size="sm" onClick={() => moderate("thread", id, "reopen")}>Reopen</Button>}
              {data.thread.isFlagged && <Button variant="secondary" size="sm" onClick={() => moderate("thread", id, "unflag")}>Clear thread flag</Button>}
              <Button variant="danger" size="sm" onClick={() => moderate("thread", id, "delete")}>Delete thread</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function NewThread({ subjects, onClose, onDone }: { subjects: Row[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ subjectId: "", title: "", body: "", category: "concept" });
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/discussions", { body: { type: "thread", subjectId: Number(f.subjectId), title: f.title, body: f.body, category: f.category } });
      onDone();
    } catch (x) {
      setErr(errorMessage(x));
    }
  }
  return (
    <Modal open onClose={onClose} title="Ask a question" wide>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        {err && <div className="md:col-span-2"><Notice tone="error">{err}</Notice></div>}
        <Field label="Subject"><Select required value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })}><option value="">Select</option>{subjects.map((s: Row) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select></Field>
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{["concept", "assignment", "exam", "resource", "other"].map((c) => <option key={c} value={c}>{labelize(c)}</option>)}</Select></Field>
        <Field label="Title" className="md:col-span-2"><Input required minLength={5} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Question" className="md:col-span-2"><Textarea required minLength={10} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 md:col-span-2"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit">Post question</Button></div>
      </form>
    </Modal>
  );
}
