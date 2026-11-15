"use client";

import { useState, type FormEvent } from "react";
import { BookmarkCheck, CheckCircle2, ExternalLink, Upload } from "lucide-react";
import { Badge, Button, Card, DataTable, Field, Input, Loading, Notice, PageHeader, Select, Tabs, Textarea } from "@/components/ui";
import { api, errorMessage, useFetch } from "@/lib/client";
import { labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Msg = { tone: "success" | "error" | "info"; text: string } | null;
const TYPES = ["pdf", "note", "presentation", "video", "external_link", "practice", "reference"];

export default function ResourcesPage() {
  const me = useFetch<{ user: { role: string } }>("/api/auth/me");
  const role = me.data?.user.role;
  const [tab, setTab] = useState<"library" | "add" | "review">("library");
  const [msg, setMsg] = useState<Msg>(null);
  if (!me.data) return me.error ? <Notice tone="error">{me.error}</Notice> : <Loading />;
  const staff = role === "admin" || role === "teacher";
  const tabs = [{ id: "library" as const, label: "Library" }, ...(staff ? [{ id: "add" as const, label: "Add resource" }] : []), ...(role === "admin" ? [{ id: "review" as const, label: "Approve submissions" }] : [])];
  return (
    <>
      <PageHeader title="Learning Resource Library" description="Approved notes, references, videos, external links and practice sets, categorised by subject, topic and difficulty. Recommendations draw from this library." />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setTab} />}
      {tab === "library" && <Library role={role ?? "student"} onMsg={setMsg} />}
      {tab === "add" && <AddResource onMsg={setMsg} onSaved={() => setTab("library")} />}
      {tab === "review" && <Review onMsg={setMsg} />}
    </>
  );
}

function Library({ role, onMsg }: { role: string; onMsg: (m: Msg) => void }) {
  const [q, setQ] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [type, setType] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (subjectId) params.set("subjectId", subjectId);
  if (type) params.set("type", type);
  if (difficulty) params.set("difficulty", difficulty);
  const list = useFetch<{ items: Row[] }>(`/api/resources?${params}`);
  const subjects = useFetch<{ items: Row[] }>("/api/academics/subjects");
  const student = role === "student";

  async function toggle(r: Row, action: "bookmark" | "complete") {
    try {
      await api(`/api/resources/${r.id}`, { method: "PATCH", body: { action, value: !(action === "bookmark" ? r.bookmarked : r.completed) } });
      list.reload();
    } catch (e) {
      onMsg({ tone: "error", text: errorMessage(e) });
    }
  }

  return (
    <>
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-5">
          <Input className="md:col-span-2" placeholder="Search title or description" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search resources" />
          <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="Subject"><option value="">All subjects</option>{(subjects.data?.items ?? []).map((s: Row) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select>
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{labelize(t)}</option>)}</Select>
          <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} aria-label="Difficulty"><option value="">Any difficulty</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></Select>
        </div>
      </Card>
      <Card>
        {list.error && <Notice tone="error">{list.error}</Notice>}
        {list.loading && !list.data ? <Loading /> : (
          <DataTable rows={list.data?.items ?? []} rowKey={(r: Row) => r.id} empty="No resources match the filters." columns={[
            { key: "title", header: "Resource", render: (r: Row) => (
              <div><p className="font-medium text-slate-900 dark:text-white">{r.title}</p><p className="max-w-md text-xs text-slate-500">{r.description}</p></div>
            ) },
            { key: "subjectCode", header: "Subject", render: (r: Row) => `${r.subjectCode}${r.topicName ? ` · ${r.topicName}` : ""}` },
            { key: "resourceType", header: "Type", render: (r: Row) => labelize(r.resourceType) },
            { key: "difficulty", header: "Level", render: (r: Row) => <Badge value={r.difficulty === "hard" ? "high" : r.difficulty === "medium" ? "medium" : "approved"}>{labelize(r.difficulty)}</Badge> },
            { key: "open", header: "Open", render: (r: Row) => (r.externalUrl ? <a className="inline-flex items-center gap-1 text-brand-600 underline dark:text-cyan-300" href={r.externalUrl} target="_blank" rel="noreferrer">Link <ExternalLink className="h-3 w-3" /></a> : r.fileUrl ? <a className="text-brand-600 underline dark:text-cyan-300" href={r.fileUrl}>{r.fileName}</a> : <span className="text-xs text-slate-400">In-app practice</span>) },
            ...(student ? [{ key: "actions", header: "Progress", render: (r: Row) => (
              <div className="flex gap-1.5">
                <Button size="sm" variant={r.bookmarked ? "primary" : "secondary"} onClick={() => toggle(r, "bookmark")} aria-pressed={r.bookmarked}><BookmarkCheck className="h-3.5 w-3.5" /> {r.bookmarked ? "Saved" : "Save"}</Button>
                <Button size="sm" variant={r.completed ? "primary" : "ghost"} onClick={() => toggle(r, "complete")} aria-pressed={r.completed}><CheckCircle2 className="h-3.5 w-3.5" /> {r.completed ? "Done" : "Mark done"}</Button>
              </div>
            ) }] : []),
            ...(!student ? [{ key: "status", header: "Status", render: (r: Row) => <Badge value={r.status}>{labelize(r.status)}</Badge> }, { key: "uploaderName", header: "Uploaded by" }] : []),
          ]} />
        )}
      </Card>
    </>
  );
}

function AddResource({ onMsg, onSaved }: { onMsg: (m: Msg) => void; onSaved: () => void }) {
  const subjects = useFetch<{ items: Row[] }>("/api/academics/subjects");
  const [f, setF] = useState({ title: "", description: "", resourceType: "note", externalUrl: "", subjectId: "", topicId: "", difficulty: "medium" });
  const [file, setFile] = useState<File | null>(null);
  const topics = useFetch<{ items: Row[] }>(f.subjectId ? `/api/academics/topics?subjectId=${f.subjectId}` : null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const form = new FormData();
      Object.entries(f).forEach(([k, v]) => { if (v) form.append(k, v); });
      if (file) form.append("file", file);
      await api("/api/resources", { form });
      onMsg({ tone: "success", text: "Resource submitted. Administrators approve resources before students can see them." });
      onSaved();
    } catch (err) {
      onMsg({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Add a learning resource" subtitle="Upload a document (PDF, DOCX, TXT, PNG, JPG up to 10 MB, verified by content) or add an external link (http/https).">
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <Field label="Title" className="md:col-span-2"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Description" className="md:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Subject"><Select required value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value, topicId: "" })}><option value="">Select</option>{(subjects.data?.items ?? []).map((s: Row) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select></Field>
        <Field label="Topic (optional)"><Select value={f.topicId} onChange={(e) => setF({ ...f, topicId: e.target.value })}><option value="">General</option>{(topics.data?.items ?? []).map((t: Row) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <Field label="Type"><Select value={f.resourceType} onChange={(e) => setF({ ...f, resourceType: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{labelize(t)}</option>)}</Select></Field>
        <Field label="Difficulty"><Select value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></Select></Field>
        <Field label="External link (optional)" className="md:col-span-2"><Input type="url" placeholder="https://" value={f.externalUrl} onChange={(e) => setF({ ...f, externalUrl: e.target.value })} /></Field>
        <Field label="File (optional)" className="md:col-span-2"><Input type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <div className="md:col-span-2 flex justify-end"><Button type="submit" disabled={busy}><Upload className="h-4 w-4" /> {busy ? "Submitting…" : "Submit resource"}</Button></div>
      </form>
    </Card>
  );
}

function Review({ onMsg }: { onMsg: (m: Msg) => void }) {
  const pending = useFetch<{ items: Row[] }>("/api/resources?status=pending");
  async function decide(id: number, action: "approve" | "reject") {
    try {
      await api(`/api/resources/${id}`, { method: "PATCH", body: { action } });
      onMsg({ tone: "success", text: action === "approve" ? "Resource approved and visible to students." : "Resource rejected." });
      pending.reload();
    } catch (e) {
      onMsg({ tone: "error", text: errorMessage(e) });
    }
  }
  return (
    <Card title="Pending resources">
      <DataTable rows={pending.data?.items ?? []} rowKey={(r: Row) => r.id} empty="No resources awaiting approval." columns={[
        { key: "title", header: "Title" },
        { key: "subjectCode", header: "Subject" },
        { key: "uploaderName", header: "By" },
        { key: "actions", header: "", render: (r: Row) => <div className="flex gap-1.5"><Button size="sm" onClick={() => decide(r.id, "approve")}>Approve</Button><Button size="sm" variant="ghost" onClick={() => decide(r.id, "reject")}>Reject</Button></div> },
      ]} />
    </Card>
  );
}
