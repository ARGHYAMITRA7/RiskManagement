"use client";

import { useState, type FormEvent } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge, Button, Card, DataTable, Field, Input, Notice, PageHeader, Select, Tabs } from "@/components/ui";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDateTime, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Band = { min: number; grade: string; gpa: number };
type Settings = {
  institutionName: string;
  attendanceThresholdPct: number;
  passPercentage: number;
  riskThresholds: { low: number; high: number };
  masteryThresholds: { needsImprovement: number; developing: number; proficient: number; minEvidence: number };
  gradingScale: Band[];
  gamificationEnabled: boolean;
  quizDefaultTimeSeconds: number;
  quizDefaultQuestions: number;
};

export default function SettingsPage() {
  const [tab, setTab] = useState<"policy" | "dataset" | "audit" | "logins">("policy");
  return (
    <>
      <PageHeader title="Institutional Policies & Audit" description="Attendance thresholds, pass marks, grading, risk and mastery thresholds, gamification, dataset tools and the audit trail." />
      <Tabs tabs={[{ id: "policy", label: "Policies & grading" }, { id: "dataset", label: "Demo dataset" }, { id: "audit", label: "Audit log" }, { id: "logins", label: "Login history" }]} active={tab} onChange={setTab} />
      {tab === "policy" && <PolicyForm />}
      {tab === "dataset" && <DatasetTools />}
      {tab === "audit" && <AuditTab />}
      {tab === "logins" && <LoginsTab />}
    </>
  );
}

function PolicyForm() {
  const { data, error, reload } = useFetch<Settings>("/api/settings");
  const [draft, setDraft] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const s = (draft ?? data) as Settings;
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!s) return null;
  const update = (patch: Partial<Settings>) => setDraft({ ...s, ...patch });

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const body = { ...s, attendanceThresholdPct: Number(s.attendanceThresholdPct), passPercentage: Number(s.passPercentage), riskThresholds: { low: Number(s.riskThresholds.low), high: Number(s.riskThresholds.high) }, masteryThresholds: { needsImprovement: Number(s.masteryThresholds.needsImprovement), developing: Number(s.masteryThresholds.developing), proficient: Number(s.masteryThresholds.proficient), minEvidence: Number(s.masteryThresholds.minEvidence) }, gradingScale: s.gradingScale.map((b) => ({ min: Number(b.min), grade: b.grade, gpa: Number(b.gpa) })) };
      await api("/api/settings", { method: "PATCH", body });
      setMsg({ tone: "success", text: "Policies saved. New thresholds apply to the next assessment and quiz." });
      setDraft(null);
      reload();
    } catch (err) {
      setMsg({ tone: "error", text: errorMessage(err) });
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4 xl:grid-cols-2">
      {msg && <div className="xl:col-span-2"><Notice tone={msg.tone === "error" ? "error" : "success"}>{msg.text}</Notice></div>}
      <Card title="Institution" subtitle="Shown on reports and dashboards.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Institution name" className="md:col-span-2"><Input value={s.institutionName} onChange={(e) => update({ institutionName: e.target.value })} /></Field>
          <Field label="Attendance target (%)" hint="Used for low-attendance alerts and shortage projections"><Input type="number" min={0} max={100} value={s.attendanceThresholdPct} onChange={(e) => update({ attendanceThresholdPct: Number(e.target.value) })} /></Field>
          <Field label="Pass percentage (%)" hint="Used for weak-subject and deterioration indicators"><Input type="number" min={0} max={100} value={s.passPercentage} onChange={(e) => update({ passPercentage: Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={s.gamificationEnabled} onChange={(e) => update({ gamificationEnabled: e.target.checked })} className="h-4 w-4" /> Enable student gamification (streaks, badges, goals)</label>
        </div>
      </Card>
      <Card title="Risk thresholds" subtitle="Probability cut-offs. Low must be below high.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Medium risk from (probability)"><Input type="number" step="0.01" min={0.01} max={0.99} value={s.riskThresholds.low} onChange={(e) => update({ riskThresholds: { ...s.riskThresholds, low: Number(e.target.value) } })} /></Field>
          <Field label="High risk from (probability)"><Input type="number" step="0.01" min={0.01} max={0.99} value={s.riskThresholds.high} onChange={(e) => update({ riskThresholds: { ...s.riskThresholds, high: Number(e.target.value) } })} /></Field>
        </div>
      </Card>
      <Card title="Topic mastery bands" subtitle="Lower bounds on a 0–1 scale; Proficient and Strong need minimum evidence.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Needs improvement below"><Input type="number" step="0.05" value={s.masteryThresholds.needsImprovement} onChange={(e) => update({ masteryThresholds: { ...s.masteryThresholds, needsImprovement: Number(e.target.value) } })} /></Field>
          <Field label="Developing below"><Input type="number" step="0.05" value={s.masteryThresholds.developing} onChange={(e) => update({ masteryThresholds: { ...s.masteryThresholds, developing: Number(e.target.value) } })} /></Field>
          <Field label="Proficient below (Strong at or above)"><Input type="number" step="0.05" value={s.masteryThresholds.proficient} onChange={(e) => update({ masteryThresholds: { ...s.masteryThresholds, proficient: Number(e.target.value) } })} /></Field>
          <Field label="Minimum answers as evidence"><Input type="number" min={1} value={s.masteryThresholds.minEvidence} onChange={(e) => update({ masteryThresholds: { ...s.masteryThresholds, minEvidence: Number(e.target.value) } })} /></Field>
        </div>
      </Card>
      <Card title="Quiz defaults">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Time limit (seconds)"><Input type="number" min={30} max={3600} value={s.quizDefaultTimeSeconds} onChange={(e) => update({ quizDefaultTimeSeconds: Number(e.target.value) })} /></Field>
          <Field label="Questions per quiz"><Input type="number" min={1} max={30} value={s.quizDefaultQuestions} onChange={(e) => update({ quizDefaultQuestions: Number(e.target.value) })} /></Field>
        </div>
      </Card>
      <Card title="Grading scale" subtitle="Percentage bands → grade and grade points (GPA). Bands are applied from highest minimum downwards." className="xl:col-span-2"
        actions={<Button variant="secondary" size="sm" onClick={() => update({ gradingScale: [...s.gradingScale, { min: 0, grade: "F", gpa: 0 }] })}><Plus className="h-3.5 w-3.5" /> Add band</Button>}>
        <div className="space-y-2">
          {s.gradingScale.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-3">
              <Field label="Minimum %"><Input type="number" value={b.min} onChange={(e) => update({ gradingScale: s.gradingScale.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)) })} /></Field>
              <Field label="Grade"><Input value={b.grade} onChange={(e) => update({ gradingScale: s.gradingScale.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)) })} /></Field>
              <Field label="Grade points"><Input type="number" step="0.5" value={b.gpa} onChange={(e) => update({ gradingScale: s.gradingScale.map((x, j) => (j === i ? { ...x, gpa: Number(e.target.value) } : x)) })} /></Field>
              <Button variant="ghost" size="sm" onClick={() => update({ gradingScale: s.gradingScale.filter((_, j) => j !== i) })} aria-label="Remove band"><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      </Card>
      <div className="flex justify-end gap-2 xl:col-span-2">
        {draft && <Button variant="secondary" type="button" onClick={() => setDraft(null)}>Discard changes</Button>}
        <Button type="submit" disabled={!draft}>Save policies</Button>
      </div>
    </form>
  );
}

function DatasetTools() {
  const [confirm, setConfirm] = useState("");
  const [mode, setMode] = useState<"reset" | "append">("reset");
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function seed() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ summary: Row }>("/api/admin", { body: { action: "seed", confirm, mode } });
      setMsg({ tone: "success", text: `Synthetic dataset generated: ${res.summary.students} students, ${res.summary.examResults} exam results, ${res.summary.attendanceRecords} attendance records, ${res.summary.quizAttempts} quiz attempts, ${res.summary.labelledOutcomes} synthetic outcome labels. Model ${res.summary.model ?? "not trained"}; ${res.summary.riskAssessments} risk assessments stored.` });
      setConfirm("");
    } catch (err) {
      setMsg({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Regenerate SYNTHETIC demonstration dataset" subtitle="Generates 520 clearly labelled synthetic students (IDs beginning SYN-), with attendance, exams, assignments, quizzes, activity and synthetic outcome labels. Then trains the demonstration model and runs assessments.">
        {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        <div className="space-y-4">
          <Notice tone="warning">Resetting deletes all existing application data, including real records. Use only on a demonstration database.</Notice>
          <Field label="Mode"><Select value={mode} onChange={(e) => setMode(e.target.value as "reset" | "append")}><option value="reset">Reset all data, then generate</option><option value="append">Append (fails if data exists)</option></Select></Field>
          <Field label="Type RESET to confirm"><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RESET" /></Field>
          <Button variant="danger" disabled={confirm !== "RESET" || busy} onClick={seed}><RefreshCw className="h-4 w-4" /> {busy ? "Generating…" : "Generate synthetic dataset"}</Button>
        </div>
      </Card>
      <Card title="Demo accounts" subtitle="Credentials are documented in the project README, not shown in the application.">
        <p className="text-sm text-slate-600 dark:text-slate-300">Administrator, teacher, student (linked to synthetic record SYN-0001), guardian and a second teacher are created by the seed process.</p>
      </Card>
    </div>
  );
}

function AuditTab() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading } = useFetch<{ items: Row[]; total: number; counts: Row }>(`/api/admin?page=${page}&pageSize=25${action ? `&action=${encodeURIComponent(action)}` : ""}`);
  return (
    <Card title="Audit trail" subtitle="Records authentication, academic-data changes, approvals, ML runs and exports.">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="Filter by action (e.g. attendance)" aria-label="Filter audit by action" />
        {data?.counts && <p className="text-xs text-slate-500">Students {data.counts.students} · Users {data.counts.users} · Results {data.counts.results} · Attendance rows {data.counts.attendance}</p>}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data ? null : (
        <>
          <DataTable rows={data?.items ?? []} rowKey={(r: Row) => r.id} empty="No audit records." columns={[
            { key: "createdAt", header: "When", render: (r: Row) => formatDateTime(r.createdAt) },
            { key: "actorName", header: "Actor", render: (r: Row) => `${r.actorName ?? "System"} (${labelize(r.actorRole)})` },
            { key: "action", header: "Action", render: (r: Row) => <span className="font-mono text-xs">{r.action}</span> },
            { key: "entityType", header: "Entity", render: (r: Row) => `${r.entityType}${r.entityId ? ` #${r.entityId}` : ""}` },
            { key: "ipAddress", header: "IP" },
          ]} />
          <div className="mt-3 flex items-center justify-between text-sm">
            <span>Page {page} · {data?.total ?? 0} entries</span>
            <div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={(data?.items?.length ?? 0) < 25} onClick={() => setPage(page + 1)}>Next</Button></div>
          </div>
        </>
      )}
    </Card>
  );
}

function LoginsTab() {
  const { data, error } = useFetch<{ items: Row[]; failedTotal: number }>("/api/admin?logins=1&pageSize=50");
  return (
    <Card title="Login history" subtitle={`Failed attempts recorded: ${data?.failedTotal ?? 0}. Accounts lock for 15 minutes after five consecutive failures.`}>
      {error && <Notice tone="error">{error}</Notice>}
      <DataTable rows={data?.items ?? []} rowKey={(r: Row) => r.id} empty="No sign-in events." columns={[
        { key: "createdAt", header: "When", render: (r: Row) => formatDateTime(r.createdAt) },
        { key: "email", header: "Email" },
        { key: "fullName", header: "User", render: (r: Row) => r.fullName ?? "—" },
        { key: "success", header: "Result", render: (r: Row) => (r.success ? <Badge value="active">Success</Badge> : <Badge value="absent">Failed</Badge>) },
        { key: "reason", header: "Reason", render: (r: Row) => labelize(r.reason) },
        { key: "ipAddress", header: "IP" },
      ]} />
    </Card>
  );
}
