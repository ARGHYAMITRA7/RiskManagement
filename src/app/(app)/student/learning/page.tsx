"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Bookmark, Check, CheckCircle2, MessageCircle, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, Card, DataTable, Field, Input, Loading, Notice, PageHeader, Progress, Select, Stars, Tabs, Textarea, fmtPct } from "@/components/ui";
import { BarChartCard, TrendChart } from "@/components/charts";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDate, labelize, toDateInput } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Msg = { tone: "success" | "error" | "info"; text: string } | null;
type TabId = "recommendations" | "mastery" | "planner" | "assistant";

export default function LearningPage() {
  const me = useFetch<{ user: { role: string }; profile: { studentId?: number } | null }>("/api/auth/me");
  const [tab, setTab] = useState<TabId>("recommendations");
  const [msg, setMsg] = useState<Msg>(null);
  if (!me.data) return me.error ? <Notice tone="error">{me.error}</Notice> : <Loading />;
  const studentId = me.data.profile?.studentId;
  if (!studentId) return <Notice tone="warning">No student record is linked to your account. Ask the administrator to link it.</Notice>;
  return (
    <>
      <PageHeader title="Learning Plan & AI Assistant" description="Personalised recommendations, topic mastery, your study planner and an assistant that answers from approved resources and your own records." />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <Tabs tabs={[{ id: "recommendations", label: "Recommendations" }, { id: "mastery", label: "Topic mastery" }, { id: "planner", label: "Study planner" }, { id: "assistant", label: "AI assistant" }]} active={tab} onChange={setTab} />
      {tab === "recommendations" && <Recommendations studentId={studentId} onMsg={setMsg} />}
      {tab === "mastery" && <Mastery />}
      {tab === "planner" && <Planner onMsg={setMsg} />}
      {tab === "assistant" && <Assistant />}
    </>
  );
}

function Recommendations({ studentId, onMsg }: { studentId: number; onMsg: (m: Msg) => void }) {
  const recs = useFetch<{ items: Row[] }>(`/api/recommendations?studentId=${studentId}`);
  const risk = useFetch<{ items: Row[] }>(`/api/risk?studentId=${studentId}`);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Record<number, { rating: number; text: string }>>({});
  const latest = risk.data?.items?.[0];
  const ex = latest?.explanation ?? {};

  async function generate() {
    setBusy(true);
    try {
      const r = await api<Row>("/api/recommendations", { body: { studentId } });
      onMsg({ tone: "success", text: `Recommendations refreshed: ${r.created} new, ${r.updated} updated, ${r.closed} closed automatically. Duplicates are never created.` });
      recs.reload();
    } catch (e) {
      onMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  async function act(id: number, action: string, extra: Record<string, unknown> = {}) {
    try {
      await api(`/api/recommendations/${id}`, { method: "PATCH", body: { action, ...extra } });
      recs.reload();
    } catch (e) {
      onMsg({ tone: "error", text: errorMessage(e) });
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2" title="Your recommendations" subtitle="Each item lists a measurable goal. Mark progress, then rate how useful it was." actions={<Button onClick={generate} disabled={busy}><Sparkles className="h-4 w-4" /> {busy ? "Generating…" : "Refresh recommendations"}</Button>}>
        {recs.loading && !recs.data ? <Loading /> : (recs.data?.items ?? []).length === 0 ? (
          <Notice tone="info">No recommendations yet. Refresh to generate personalised actions from your records.</Notice>
        ) : (
          <ul className="space-y-3">
            {(recs.data?.items ?? []).map((r: Row) => (
              <li key={r.id} className="rounded-xl border border-slate-200 p-4 dark:border-navy-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white">{r.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{labelize(r.category)} · priority {({ 1: "high", 2: "medium", 3: "low" } as Record<number, string>)[r.priority]}</p>
                    <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{r.description}</p>
                    {r.effectiveness !== null && r.effectiveness !== undefined && (
                      <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Measured change after follow-up: <strong>{r.effectiveness > 0 ? "+" : ""}{r.effectiveness} pts</strong> (baseline {fmtPct(r.baselineScore)} → {fmtPct(r.followUpScore)})</p>
                    )}
                  </div>
                  <Badge value={r.status}>{labelize(r.status)}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {r.status === "suggested" && <Button size="sm" variant="secondary" onClick={() => act(r.id, "start")}>Start</Button>}
                  {(r.status === "suggested" || r.status === "in_progress") && <Button size="sm" onClick={() => act(r.id, "complete")}><CheckCircle2 className="h-3.5 w-3.5" /> Mark complete</Button>}
                  {(r.status === "suggested" || r.status === "in_progress") && <Button size="sm" variant="ghost" onClick={() => act(r.id, "dismiss")}>Not relevant</Button>}
                  {(r.status === "dismissed" || r.status === "completed") && <Button size="sm" variant="ghost" onClick={() => act(r.id, "reopen")}>Reopen</Button>}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 dark:border-navy-800">
                  <span className="text-xs text-slate-500">How useful was this?</span>
                  <Stars value={feedback[r.id]?.rating ?? r.feedbackRating ?? null} onChange={(v) => setFeedback({ ...feedback, [r.id]: { rating: v, text: feedback[r.id]?.text ?? "" } })} />
                  <Input className="max-w-xs py-1 text-xs" placeholder="Optional comment" value={feedback[r.id]?.text ?? ""} onChange={(e) => setFeedback({ ...feedback, [r.id]: { rating: feedback[r.id]?.rating ?? r.feedbackRating ?? 3, text: e.target.value } })} />
                  <Button size="sm" variant="ghost" disabled={!feedback[r.id]?.rating} onClick={() => act(r.id, "feedback", { rating: feedback[r.id].rating, feedbackText: feedback[r.id].text || undefined })}>Send feedback</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Why this assessment?" subtitle="Explainable factors from your latest risk estimate">
        {!latest ? <Notice tone="info">No risk assessment is available for your record yet.</Notice> : (
          <div className="space-y-3 text-sm">
            <p><Badge value={latest.risk_category}>{labelize(latest.risk_category)} risk</Badge> <span className="ml-2 text-slate-500">score {latest.risk_score}/100</span></p>
            <p className="text-slate-600 dark:text-slate-300">{ex.headline}</p>
            <div>
              <p className="font-medium text-rose-700 dark:text-rose-300">Factors that increase risk</p>
              <ul className="list-disc pl-5">{(ex.riskIncreasingFactors ?? []).map((f: Row) => <li key={f.feature}>{f.text}</li>)}{(ex.riskIncreasingFactors ?? []).length === 0 && <li className="text-slate-500">None identified.</li>}</ul>
            </div>
            <div>
              <p className="font-medium text-emerald-700 dark:text-emerald-300">Strengths</p>
              <ul className="list-disc pl-5">{(ex.protectiveFactors ?? []).map((f: Row) => <li key={f.feature}>{f.text}</li>)}{(ex.protectiveFactors ?? []).length === 0 && <li className="text-slate-500">None identified.</li>}</ul>
            </div>
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-navy-800 dark:text-slate-300">{ex.disclaimer}</p>
            <p className="text-xs text-slate-500">{ex.causalNote}</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function Mastery() {
  const analytics = useFetch<{ data: Row }>("/api/analytics");
  const [topicKey, setTopicKey] = useState<number | null>(null);
  const mastery: Row[] = analytics.data?.data?.mastery ?? [];
  const selected = mastery.find((m, i) => i === topicKey) ?? mastery[0];
  if (analytics.loading) return <Loading />;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2" title="Topic mastery" subtitle="Levels: Needs improvement · Developing · Proficient · Strong. Evidence is required before high levels.">
        <DataTable rows={mastery} rowKey={(r: Row, i: number) => `${r.topic}-${i}`} onRowClick={(r: Row) => setTopicKey(mastery.indexOf(r))} empty="Complete an adaptive quiz to build mastery estimates." columns={[
          { key: "subject", header: "Subject" },
          { key: "topic", header: "Topic" },
          { key: "attempted", header: "Answered" },
          { key: "mastery_score", header: "Mastery", render: (r: Row) => (<div className="w-40"><Progress value={Number(r.mastery_score) * 100} tone={Number(r.mastery_score) >= 0.7 ? "green" : Number(r.mastery_score) >= 0.5 ? "amber" : "red"} /><span className="text-xs text-slate-500">{Math.round(Number(r.mastery_score) * 100)}%</span></div>) },
          { key: "level", header: "Level", render: (r: Row) => <Badge value={r.level}>{labelize(r.level)}</Badge> },
          { key: "trend", header: "Trend", render: (r: Row) => labelize(r.trend) },
        ]} />
      </Card>
      <Card title={selected ? `History: ${selected.topic}` : "Performance trend"} subtitle="Accuracy per practice session">
        <TrendChart data={(selected?.history ?? []).map((h: Row) => ({ date: formatDate(h.date), accuracy: Math.round(h.accuracy * 1000) / 10 }))} xKey="date" series={[{ key: "accuracy", label: "Accuracy %", color: "#10b981" }]} domain={[0, 100]} height={240} />
      </Card>
    </div>
  );
}

function Planner({ onMsg }: { onMsg: (m: Msg) => void }) {
  const today = toDateInput();
  const plan = useFetch<{ tasks: Row[]; goalMinutesPerDay: number; totals: { planned: number; completed: number } }>(`/api/planner?from=${today}&to=${toDateInput(new Date(Date.now() + 6 * 86400000))}`);
  const [f, setF] = useState({ title: "", taskDate: today, minutes: "45" });
  const [busy, setBusy] = useState(false);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => toDateInput(new Date(Date.now() + i * 86400000))), []);
  const byDay = (d: string) => (plan.data?.tasks ?? []).filter((t) => t.taskDate === d);

  async function generate() {
    setBusy(true);
    try {
      const r = await api<Row>("/api/planner", { body: { action: "generate", days: 7 } });
      onMsg({ tone: "success", text: `Plan generated: ${r.generated} task(s) across 7 days, targeting ${r.goalMinutesPerDay} minutes per day (weak topics ${r.basedOn.weakTopics}, upcoming exams ${r.basedOn.upcomingExams}, pending assignments ${r.basedOn.pendingAssignments}).` });
      plan.reload();
    } catch (e) {
      onMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  async function act(id: number, body: Record<string, unknown>) {
    try {
      await api(`/api/planner/${id}`, { method: "PATCH", body });
      plan.reload();
    } catch (e) {
      onMsg({ tone: "error", text: errorMessage(e) });
    }
  }
  async function remove(id: number) {
    try {
      await api(`/api/planner/${id}`, { method: "DELETE" });
      plan.reload();
    } catch (e) {
      onMsg({ tone: "error", text: errorMessage(e) });
    }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/planner", { body: { action: "create", title: f.title, taskDate: f.taskDate, minutes: Number(f.minutes) } });
      setF({ ...f, title: "" });
      plan.reload();
    } catch (x) {
      onMsg({ tone: "error", text: errorMessage(x) });
    }
  }

  const done = plan.data?.totals.completed ?? 0;
  const planned = plan.data?.totals.planned ?? 0;
  return (
    <div className="space-y-4">
      <Card title="Weekly study plan" subtitle={`Goal ${plan.data?.goalMinutesPerDay ?? 60} minutes/day · ${done} of ${planned} planned minutes completed this week`} actions={<Button onClick={generate} disabled={busy}><Sparkles className="h-4 w-4" /> {busy ? "Generating…" : "Generate weekly plan"}</Button>}>
        <Progress value={planned ? (done / planned) * 100 : 0} tone="green" />
        {plan.loading && !plan.data ? <Loading /> : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {days.map((d) => (
              <div key={d} className="rounded-xl border border-slate-200 p-3 dark:border-navy-700">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{formatDate(d)}</p>
                <ul className="space-y-2">
                  {byDay(d).map((t) => (
                    <li key={t.id} className={`rounded-lg border p-2 text-xs ${t.status === "completed" ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" : "border-slate-200 dark:border-navy-700"}`}>
                      <p className="font-medium text-slate-800 dark:text-slate-100">{t.title}</p>
                      <p className="text-slate-500">{t.minutes} min · {labelize(t.source)}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <button className="rounded px-1.5 py-0.5 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300" onClick={() => act(t.id, { action: "complete", completed: t.status !== "completed" })}><Check className="inline h-3 w-3" /> {t.status === "completed" ? "Undo" : "Done"}</button>
                        <input type="date" aria-label="Reschedule date" className="rounded border border-slate-200 bg-transparent px-1 text-[11px] dark:border-navy-700" defaultValue={t.taskDate} min={today} onChange={(e) => act(t.id, { action: "reschedule", taskDate: e.target.value })} />
                        {t.status !== "completed" && <button className="rounded px-1.5 py-0.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40" onClick={() => remove(t.id)} aria-label="Delete task"><Trash2 className="inline h-3 w-3" /></button>}
                      </div>
                    </li>
                  ))}
                  {byDay(d).length === 0 && <li className="text-xs text-slate-400">No tasks</li>}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Add your own study session" subtitle="Edit the schedule to fit your availability">
        <form onSubmit={create} className="grid gap-3 md:grid-cols-5">
          <Input className="md:col-span-2" required placeholder="What will you study?" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <Input type="date" min={today} value={f.taskDate} onChange={(e) => setF({ ...f, taskDate: e.target.value })} />
          <Select value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })}>{[30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}</Select>
          <Button type="submit"><Plus className="h-4 w-4" /> Add</Button>
        </form>
      </Card>
    </div>
  );
}

function Assistant() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ answer: string[]; sources: Row[]; practice: Row | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  async function ask(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setPicked(null);
    try {
      setAnswer(await api("/api/assistant", { body: { question: q } }));
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2" title="Ask the academic assistant" subtitle="Explains concepts from approved resources, reviews your last mistakes, suggests practice and planning steps. It cannot change marks, attendance or risk results.">
        <form onSubmit={ask} className="flex flex-col gap-3 md:flex-row">
          <Input className="flex-1" required minLength={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Why did I get the normalization question wrong? Or: help me plan my database revision" aria-label="Question for the assistant" />
          <Button type="submit" disabled={busy}><MessageCircle className="h-4 w-4" /> {busy ? "Thinking…" : "Ask"}</Button>
        </form>
        {msg && <div className="mt-4"><Notice tone="error">{msg}</Notice></div>}
        {answer && (
          <div className="mt-5 space-y-4">
            {answer.answer.map((p, i) => <p key={i} className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{p}</p>)}
            {answer.sources.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approved resources</p>
                <ul className="mt-1 list-disc pl-5 text-sm">{answer.sources.map((s: Row, i: number) => <li key={i}>{s.url ? <a className="text-brand-600 underline dark:text-cyan-300" href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title} <span className="text-xs text-slate-500">({labelize(s.type)})</span></li>)}</ul>
              </div>
            )}
            {answer.practice && (
              <Card title="Practice question" subtitle="Answer it to test yourself. Submit real answers through a quiz so mastery is updated.">
                <p className="mb-3 text-sm">{answer.practice.prompt}</p>
                {answer.practice.options?.length > 0 && (
                  <div className="grid gap-2">{answer.practice.options.map((o: string) => (
                    <button key={o} onClick={() => setPicked(picked === null ? 1 : picked)} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-navy-700 dark:hover:bg-navy-800">{o}</button>
                  ))}</div>
                )}
                {picked !== null && <p className="mt-2 text-xs text-slate-500">Practice answers are checked in a timed quiz from the Adaptive Quizzes page.</p>}
              </Card>
            )}
          </div>
        )}
      </Card>
      <Card title="Good questions to ask" subtitle="Try these">
        <ul className="space-y-2 text-sm">
          {["Explain normalization in simple terms", "Why was my last deadlock answer wrong?", "Suggest practice questions for SQL queries", "Help me plan my revision for Operating Systems", "What topics should I focus on this week?"].map((s) => (
            <li key={s}><button onClick={() => setQ(s)} className="text-left text-brand-600 underline-offset-2 hover:underline dark:text-cyan-300">{s}</button></li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-500">The assistant uses rule-based retrieval over approved resources and your own records. No external AI service is required.</p>
      </Card>
    </div>
  );
}
