"use client";

import Link from "next/link";
import { use, useState, type FormEvent } from "react";
import { Download, FileText, Pencil, Sparkles, Target, Wand2 } from "lucide-react";
import { Badge, Button, Card, DataTable, Field, Input, Loading, Modal, Notice, PageHeader, Select, Tabs, Textarea, fmtPct } from "@/components/ui";
import { AreaTrend, BarChartCard, TrendChart } from "@/components/charts";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDate, formatDateTime, labelize, riskColor } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type TabId = "overview" | "attendance" | "results" | "assignments" | "risk" | "recommendations" | "mastery" | "interventions" | "records";

export default function StudentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useFetch<{ user: { role: string } }>("/api/auth/me");
  const isAdmin = me.data?.user.role === "admin";
  const { data, error, loading, reload } = useFetch<Row>(`/api/students/${id}`);
  const preds = useFetch<{ items: Row[] }>(`/api/risk?studentId=${id}`);
  const [tab, setTab] = useState<TabId>("overview");
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [ivOpen, setIvOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading || !data) return error ? <Notice tone="error">{error}</Notice> : <Loading label="Loading student profile…" />;
  const s = data.student;
  const d = data.dashboard;
  const staff = me.data?.user.role !== "student" && me.data?.user.role !== "guardian";
  const latest = preds.data?.items?.[0];
  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "attendance", label: "Attendance" },
    { id: "results", label: "Results" },
    { id: "assignments", label: "Assignments" },
    { id: "risk", label: "Risk & explainable AI" },
    { id: "recommendations", label: "Recommendations" },
    { id: "mastery", label: "Topic mastery" },
    ...(staff ? [{ id: "interventions" as TabId, label: "Interventions" }, { id: "records" as TabId, label: "Private records" }] : []),
  ];

  async function run(action: () => Promise<unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      setMsg({ tone: "success", text: okText });
      reload();
      preds.reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const assess = () => run(() => api("/api/risk", { body: { action: "assess", studentIds: [Number(id)] } }), "Risk assessment completed and stored in the prediction history.");
  const recs = () => run(() => api("/api/recommendations", { body: { studentId: Number(id) } }), "Recommendations generated. Duplicate actions were not created.");

  return (
    <>
      <PageHeader
        title={s.fullName}
        description={`${s.studentCode} · ${s.courseName ?? ""} · Semester ${s.currentSemester} · Class ${s.className ?? "not assigned"}`}
        actions={
          <>
            {String(s.studentCode).startsWith("SYN-") && <Badge value="pending">SYNTHETIC record</Badge>}
            {!staff && <Link href="/student/learning"><Button variant="secondary"><Target className="h-4 w-4" /> Learning plan</Button></Link>}
            {staff && (
              <>
                <Button variant="secondary" disabled={busy} onClick={assess}><Sparkles className="h-4 w-4" /> Run risk assessment</Button>
                <Button variant="secondary" disabled={busy} onClick={recs}><Wand2 className="h-4 w-4" /> Generate recommendations</Button>
                <Button onClick={() => setIvOpen(true)}><Target className="h-4 w-4" /> New intervention</Button>
              </>
            )}
            {isAdmin && <Button variant="secondary" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" /> Edit</Button>}
            {["pdf", "csv", "xlsx"].map((f) => (
              <a key={f} href={`/api/reports?type=student&studentId=${id}&format=${f}`} className="inline-flex">
                <Button variant="ghost"><Download className="h-4 w-4" /> {f.toUpperCase()}</Button>
              </a>
            ))}
          </>
        }
      />
      {msg && <div className="mb-4"><Notice tone={msg.tone === "error" ? "error" : msg.tone === "success" ? "success" : "info"}>{msg.text}</Notice></div>}
      {latest && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 dark:border-navy-700 dark:bg-navy-900">
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${riskColor(latest.risk_category)}`}>{labelize(latest.risk_category)} risk · {latest.risk_score}/100</span>
          <span className="text-sm text-slate-600 dark:text-slate-300">{labelize(latest.method)} · assessed {formatDateTime(latest.predicted_at)}</span>
          <span className="text-xs text-slate-500">Decision-support estimate, not a certainty.</span>
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card title="Personal & academic details" className="xl:col-span-1">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[
                ["Student ID", s.studentCode],
                ["Email", s.email ?? "—"],
                ["Phone", s.phone ?? "—"],
                ["Course", s.courseName ?? "—"],
                ["Class", s.className ?? "—"],
                ["Semester", s.currentSemester],
                ["Daily study goal", `${s.dailyStudyGoalMinutes} min`],
                ["Status", labelize(s.status)],
                ["Guardian", s.guardianName ?? "—"],
                ["Guardian email", s.guardianEmail ?? "—"],
                ["Login account", s.account ? `${s.account.email} (${labelize(s.account.status)})` : "Not linked"],
              ].map(([k, v]) => (
                <div key={String(k)}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium text-slate-800 dark:text-slate-100">{String(v)}</dd></div>
              ))}
            </dl>
            <h3 className="mb-2 mt-5 text-sm font-semibold">Enrolled subjects</h3>
            <div className="flex flex-wrap gap-2">{data.enrolled.map((e: Row) => <Badge key={e.id} value="approved">{e.code} {e.name}</Badge>)}</div>
          </Card>
          <Card title="Academic progress" subtitle="Exam percentages over time" className="xl:col-span-2">
            <TrendChart data={d?.progress.timeline ?? []} xKey="label" series={[{ key: "pct", label: "Score %", color: "#2f78e8" }]} domain={[0, 100]} />
          </Card>
          <Card title="Summary indicators" className="xl:col-span-3">
            <div className="grid gap-4 sm:grid-cols-4">
              <div><p className="text-xs text-slate-500">Overall attendance</p><p className="text-xl font-semibold">{fmtPct(d?.attendance.overallPct)}</p></div>
              <div><p className="text-xs text-slate-500">Latest exam</p><p className="text-xl font-semibold">{fmtPct(d?.progress.lastPct)}</p></div>
              <div><p className="text-xs text-slate-500">Learning streak</p><p className="text-xl font-semibold">{d?.progress.streakDays ?? 0} days</p></div>
              <div><p className="text-xs text-slate-500">Assignments past due, not submitted</p><p className="text-xl font-semibold">{(d?.assignments ?? []).filter((a: Row) => !a.submission_id && new Date(a.deadline) < new Date()).length}</p></div>
            </div>
          </Card>
        </div>
      )}

      {tab === "attendance" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Attendance by subject" subtitle={`Overall ${fmtPct(d?.attendance.overallPct)} · target ${d?.settings.attendanceThresholdPct}%`}>
            <DataTable rows={d?.attendance.bySubject ?? []} rowKey={(r: Row) => r.id} empty="No attendance recorded." columns={[
              { key: "name", header: "Subject" },
              { key: "present", header: "Present" },
              { key: "late", header: "Late" },
              { key: "absent", header: "Absent" },
              { key: "excused", header: "Excused" },
              { key: "pct", header: "%", render: (r: Row) => fmtPct(((Number(r.present) + Number(r.late)) / Math.max(1, Number(r.present) + Number(r.late) + Number(r.absent))) * 100) },
            ]} />
          </Card>
          <Card title="Monthly attendance trend"><AreaTrend data={d?.attendance.monthly ?? []} xKey="month" yKey="pct" color="#22d3ee" /></Card>
        </div>
      )}

      {tab === "results" && (
        <div className="grid gap-4">
          <Card title="Subject-wise marks" subtitle="Published results are shown to the student; staff also see unpublished marks.">
            <DataTable rows={d?.results ?? []} rowKey={(r: Row, i: number) => `${r.exam_id}-${i}`} empty="No results recorded." columns={[
              { key: "subject_code", header: "Subject", render: (r: Row) => `${r.subject_code} ${r.subject_name}` },
              { key: "exam_name", header: "Examination" },
              { key: "exam_type", header: "Type", render: (r: Row) => labelize(r.exam_type) },
              { key: "exam_date", header: "Date", render: (r: Row) => formatDate(r.exam_date) },
              { key: "marks_obtained", header: "Marks", render: (r: Row) => (r.marks_obtained === null ? <span className="text-amber-600">Not entered</span> : `${r.marks_obtained}/${r.max_marks}`) },
              { key: "status", header: "Publication", render: (r: Row) => <Badge value={r.status}>{labelize(r.status)}</Badge> },
            ]} />
          </Card>
          <Card title="Subject averages"><BarChartCard data={Object.values((d?.results ?? []).filter((r: Row) => r.marks_obtained !== null).reduce((acc: Record<string, Row>, r: Row) => { acc[r.subject_code] = acc[r.subject_code] ?? { code: r.subject_code, s: 0, n: 0 }; acc[r.subject_code].s += (r.marks_obtained / r.max_marks) * 100; acc[r.subject_code].n += 1; return acc; }, {})).map((x: Row) => ({ code: x.code, pct: Math.round((x.s / x.n) * 10) / 10 }))} xKey="code" yKey="pct" colorByIndex /></Card>
        </div>
      )}

      {tab === "assignments" && (
        <Card title="Assignments and submissions">
          <DataTable rows={d?.assignments ?? []} rowKey={(r: Row) => r.id} empty="No assignments for this class." columns={[
            { key: "title", header: "Assignment" },
            { key: "subject_name", header: "Subject" },
            { key: "deadline", header: "Deadline", render: (r: Row) => formatDateTime(r.deadline) },
            { key: "submitted_at", header: "Submitted", render: (r: Row) => (r.submission_id ? formatDateTime(r.submitted_at) : "Not submitted") },
            { key: "is_late", header: "Late", render: (r: Row) => (r.is_late ? "Yes" : "No") },
            { key: "marks", header: "Marks", render: (r: Row) => (r.marks === null ? "—" : `${r.marks}/${r.max_marks}`) },
          ]} />
        </Card>
      )}

      {tab === "risk" && <RiskPanel preds={preds.data?.items ?? []} loading={preds.loading} error={preds.error} />}

      {tab === "recommendations" && (
        <Card title="Personalised recommendations" subtitle="Each item explains why it was suggested, with a measurable goal.">
          <DataTable rows={data.recommendations ?? []} rowKey={(r: Row) => r.id} empty="No recommendations yet. Generate them from the header actions." columns={[
            { key: "category", header: "Category", render: (r: Row) => labelize(r.category) },
            { key: "title", header: "Title" },
            { key: "priority", header: "Priority", render: (r: Row) => ({ 1: "High", 2: "Medium", 3: "Low" } as Record<number, string>)[r.priority] ?? r.priority },
            { key: "status", header: "Status", render: (r: Row) => <Badge value={r.status}>{labelize(r.status)}</Badge> },
            { key: "effectiveness", header: "Score change (pts)", render: (r: Row) => (r.effectiveness === null ? "—" : r.effectiveness) },
          ]} />
        </Card>
      )}

      {tab === "mastery" && (
        <Card title="Topic mastery" subtitle="Updated from completed adaptive quizzes.">
          <DataTable rows={d?.mastery ?? []} rowKey={(r: Row, i: number) => `${r.topic}-${i}`} empty="No quiz evidence yet." columns={[
            { key: "subject", header: "Subject" },
            { key: "topic", header: "Topic" },
            { key: "attempted", header: "Answered" },
            { key: "mastery_score", header: "Mastery", render: (r: Row) => fmtPct(Number(r.mastery_score) * 100) },
            { key: "level", header: "Level", render: (r: Row) => <Badge value={r.level}>{labelize(r.level)}</Badge> },
            { key: "trend", header: "Trend", render: (r: Row) => labelize(r.trend) },
          ]} />
        </Card>
      )}

      {tab === "interventions" && staff && (
        <div className="grid gap-4">
          {(data.interventions ?? []).length === 0 && <Notice tone="info">No interventions for this student. Create one from the header.</Notice>}
          {(data.interventions ?? []).map((iv: Row) => (
            <Card key={iv.id} title={`Plan #${iv.id}`} subtitle={`Created ${formatDate(iv.createdAt)} · Follow-up ${formatDate(iv.followUpDate)}`} actions={<Badge value={iv.status}>{labelize(iv.status)}</Badge>}>
              <p className="text-sm text-slate-700 dark:text-slate-200">{iv.plan}</p>
              {iv.target && <p className="mt-2 text-sm text-slate-500">Target: {iv.target}</p>}
              <Link href="/interventions" className="mt-3 inline-block text-sm text-brand-600 underline dark:text-cyan-300">Manage in Interventions</Link>
            </Card>
          ))}
        </div>
      )}

      {tab === "records" && staff && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Teacher observations (private)" subtitle="Visible to staff only. Never shown to students or guardians.">
            <DataTable rows={data.observations ?? []} rowKey={(r: Row) => r.id} empty="No private observations." columns={[
              { key: "body", header: "Observation" },
              { key: "authorName", header: "By" },
              { key: "createdAt", header: "When", render: (r: Row) => formatDateTime(r.createdAt) },
            ]} />
          </Card>
          <Card title="Early-warning alerts">
            <DataTable rows={data.alerts ?? []} rowKey={(r: Row) => r.id} empty="No alerts for this student." columns={[
              { key: "title", header: "Alert" },
              { key: "severity", header: "Severity", render: (r: Row) => <Badge value={r.severity}>{labelize(r.severity)}</Badge> },
              { key: "status", header: "Status", render: (r: Row) => <Badge value={r.status}>{labelize(r.status)}</Badge> },
              { key: "createdAt", header: "Raised", render: (r: Row) => formatDate(r.createdAt) },
            ]} />
          </Card>
        </div>
      )}

      {isAdmin && <EditStudentModal open={editOpen} onClose={() => setEditOpen(false)} student={s} onSaved={() => { setEditOpen(false); reload(); }} />}
      {staff && <InterventionModal open={ivOpen} onClose={() => setIvOpen(false)} studentId={Number(id)} onSaved={() => { setIvOpen(false); reload(); setMsg({ tone: "success", text: "Intervention plan created. The student and guardian were notified." }); }} />}
    </>
  );
}

function RiskPanel({ preds, loading, error }: { preds: Row[]; loading: boolean; error: string | null }) {
  if (loading) return <Loading label="Loading risk explanation…" />;
  if (error) return <Notice tone="error">{error}</Notice>;
  if (preds.length === 0) return <Notice tone="info">No risk assessment yet. Run one from the header actions.</Notice>;
  const p = preds[0];
  const ex = p.explanation ?? {};
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title="Assessment" subtitle={ex.disclaimer} className="xl:col-span-1">
        <div className="space-y-3 text-sm">
          <p className={`inline-flex rounded-full px-3 py-1 font-semibold ring-1 ring-inset ${riskColor(p.risk_category)}`}>{labelize(p.risk_category)} risk</p>
          <p><span className="text-slate-500">Risk score:</span> {p.risk_score}/100</p>
          <p><span className="text-slate-500">Probability:</span> {p.probability === null ? "Not computed (rule screening)" : fmtPct(p.probability * 100)}</p>
          <p><span className="text-slate-500">Method:</span> {p.method === "ml" ? `Machine learning (${ex.modelName ?? "active model"})` : "Transparent rule-based screening"}</p>
          <p><span className="text-slate-500">Assessed:</span> {formatDateTime(p.predicted_at)}</p>
          <p><span className="text-slate-500">Change since previous:</span> {ex.previous ? `${labelize(ex.previous.change)} (was ${labelize(ex.previous.riskCategory)}, ${ex.previous.riskScore})` : "First assessment"}</p>
          <p className="rounded-xl bg-brand-500/5 p-3 dark:bg-navy-800"><strong>Suggested intervention:</strong> {p.suggested_intervention}</p>
          <p className="text-xs text-slate-500">{ex.causalNote}</p>
        </div>
      </Card>
      <Card title="Contributing factors" subtitle="Risk-increasing and protective factors from the model (correlational, not causal)." className="xl:col-span-2">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h4 className="mb-2 text-sm font-semibold text-rose-700 dark:text-rose-300">Risk-increasing indicators</h4>
            <ul className="space-y-2 text-sm">{(ex.riskIncreasingFactors ?? []).map((f: Row) => <li key={f.feature} className="rounded-lg bg-rose-50 p-2.5 dark:bg-rose-950/30"><strong>{f.label}:</strong> {f.text}</li>)}{(ex.riskIncreasingFactors ?? []).length === 0 && <li className="text-slate-500">None identified.</li>}</ul>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">Protective indicators</h4>
            <ul className="space-y-2 text-sm">{(ex.protectiveFactors ?? []).map((f: Row) => <li key={f.feature} className="rounded-lg bg-emerald-50 p-2.5 dark:bg-emerald-950/30"><strong>{f.label}:</strong> {f.text}</li>)}{(ex.protectiveFactors ?? []).length === 0 && <li className="text-slate-500">None identified.</li>}</ul>
          </div>
        </div>
        {ex.globalImportance && (
          <div className="mt-5">
            <h4 className="mb-1 text-sm font-semibold">Global feature importance (permutation, ROC-AUC drop)</h4>
            <BarChartCard data={ex.globalImportance} xKey="label" yKey="importance" height={220} />
          </div>
        )}
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <h4 className="mb-2 text-sm font-semibold">Plain-language summary</h4>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">{(ex.narrative ?? []).map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold">Rule-based screening</h4>
            <p className="text-sm text-slate-600 dark:text-slate-300">{ex.ruleScreening?.count ?? 0} indicator(s) triggered → {labelize(ex.ruleScreening?.category)} (transparent fallback)</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{(ex.ruleScreening?.triggered ?? []).map((t: Row) => <li key={t.feature}>{t.message}</li>)}</ul>
          </div>
        </div>
      </Card>
      <Card title="Prediction history" className="xl:col-span-3">
        <TrendChart data={[...preds].reverse().map((p) => ({ date: formatDate(p.predicted_at), score: p.risk_score }))} xKey="date" series={[{ key: "score", label: "Risk score", color: "#f43f5e" }]} domain={[0, 100]} />
        <div className="mt-4"><DataTable rows={preds} rowKey={(r: Row) => r.id} columns={[
          { key: "predicted_at", header: "Date", render: (r: Row) => formatDateTime(r.predicted_at) },
          { key: "risk_category", header: "Risk", render: (r: Row) => labelize(r.risk_category) },
          { key: "risk_score", header: "Score" },
          { key: "method", header: "Method", render: (r: Row) => labelize(r.method) },
          { key: "suggested_intervention", header: "Suggested intervention" },
        ]} /></div>
      </Card>
    </div>
  );
}

function EditStudentModal({ open, onClose, student, onSaved }: { open: boolean; onClose: () => void; student: Row; onSaved: () => void }) {
  const [f, setF] = useState({ fullName: student.fullName, email: student.email ?? "", phone: student.phone ?? "", currentSemester: String(student.currentSemester), dailyStudyGoalMinutes: String(student.dailyStudyGoalMinutes), guardianName: student.guardianName ?? "", guardianEmail: student.guardianEmail ?? "", guardianPhone: student.guardianPhone ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/students/${student.id}`, { method: "PATCH", body: { ...f, currentSemester: Number(f.currentSemester), dailyStudyGoalMinutes: Number(f.dailyStudyGoalMinutes), email: f.email || null, phone: f.phone || null } });
      onSaved();
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Edit student">
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        {err && <div className="md:col-span-2"><Notice tone="error">{err}</Notice></div>}
        <Field label="Full name"><Input value={f.fullName} onChange={set("fullName")} /></Field>
        <Field label="Semester (re-enrols subjects)"><Input type="number" min={1} max={12} value={f.currentSemester} onChange={set("currentSemester")} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Daily study goal (min)"><Input type="number" value={f.dailyStudyGoalMinutes} onChange={set("dailyStudyGoalMinutes")} /></Field>
        <Field label="Guardian name"><Input value={f.guardianName} onChange={set("guardianName")} /></Field>
        <Field label="Guardian email"><Input type="email" value={f.guardianEmail} onChange={set("guardianEmail")} /></Field>
        <Field label="Guardian phone"><Input value={f.guardianPhone} onChange={set("guardianPhone")} /></Field>
        <div className="flex justify-end gap-2 md:col-span-2"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit">Save changes</Button></div>
      </form>
    </Modal>
  );
}

function InterventionModal({ open, onClose, studentId, onSaved }: { open: boolean; onClose: () => void; studentId: number; onSaved: () => void }) {
  const [plan, setPlan] = useState("");
  const [target, setTarget] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [status, setStatus] = useState("pending");
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/interventions", { body: { studentId, plan, target, status, followUpDate: followUpDate || null } });
      onSaved();
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Create intervention plan" wide>
      <form onSubmit={submit} className="grid gap-4">
        {err && <Notice tone="error">{err}</Notice>}
        <Field label="Support plan (visible to the student)"><Textarea required minLength={10} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="Describe the actions, sessions and revision expected" /></Field>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Measurable target"><Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. attendance 75%, quiz average 60%" /></Field>
          <Field label="Follow-up date"><Input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} /></Field>
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">Pending</option><option value="in_progress">In progress</option></Select></Field>
        </div>
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit"><FileText className="h-4 w-4" /> Create plan</Button></div>
      </form>
    </Modal>
  );
}
