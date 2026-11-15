"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Play, Plus, Send } from "lucide-react";
import { Badge, Button, Card, DataTable, Field, Input, Loading, Notice, PageHeader, Select, Tabs, Textarea, fmtPct } from "@/components/ui";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDateTime, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Msg = { tone: "success" | "error" | "info"; text: string } | null;

export default function QuizzesPage() {
  const me = useFetch<{ user: { role: string } }>("/api/auth/me");
  if (!me.data) return me.error ? <Notice tone="error">{me.error}</Notice> : <Loading />;
  if (me.data.user.role === "student") return <StudentQuizzes />;
  if (me.data.user.role === "guardian") return <Notice tone="info">Practice quiz results for your linked student appear in the Guardian Portal.</Notice>;
  return <StaffQuizzes role={me.data.user.role} />;
}

/* ---------- Student: adaptive timed quizzes ---------- */

function StudentQuizzes() {
  const quizzes = useFetch<{ items: Row[] }>("/api/quizzes");
  const history = useFetch<{ items: Row[] }>("/api/quizzes/attempts");
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [starting, setStarting] = useState<number | null>(null);

  async function start(quizId: number) {
    setStarting(quizId);
    setMsg(null);
    try {
      const res = await api<{ attempt: { id: number }; revisionRecommended?: boolean }>("/api/quizzes/attempts", { body: { quizId } });
      setAttemptId(res.attempt.id);
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setStarting(null);
    }
  }

  if (attemptId) return <AttemptRunner id={attemptId} onExit={() => { setAttemptId(null); history.reload(); quizzes.reload(); }} />;

  return (
    <>
      <PageHeader title="Adaptive Quizzes" description="Timed practice quizzes. Question difficulty adapts to your recent accuracy and topic mastery. Correct answers are revealed only after you submit." />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {quizzes.error && <Notice tone="error">{quizzes.error}</Notice>}
      {quizzes.loading && !quizzes.data ? <Loading /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(quizzes.data?.items ?? []).map((q: Row) => (
            <Card key={q.id} title={q.title} subtitle={`${q.subject_code} · ${q.topic_name ?? "All topics"}`} actions={q.my_last_pct !== null && q.my_last_pct !== undefined ? <Badge value={Number(q.my_last_pct) >= 60 ? "approved" : "pending"}>Last {fmtPct(Number(q.my_last_pct))}</Badge> : null}>
              <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <p>{q.question_count} questions · {Math.round(q.time_limit_seconds / 60)} minutes · {q.my_attempts} attempt(s)</p>
                <p className="text-xs text-slate-500">{q.available_questions} questions available in the bank</p>
                <Button className="w-full" disabled={starting !== null || q.available_questions === 0} onClick={() => start(q.id)}><Play className="h-4 w-4" /> {starting === q.id ? "Starting…" : "Start timed quiz"}</Button>
              </div>
            </Card>
          ))}
          {(quizzes.data?.items ?? []).length === 0 && !quizzes.loading && <div className="md:col-span-2 xl:col-span-3"><Notice tone="info">No quizzes are published for your enrolled subjects yet.</Notice></div>}
        </div>
      )}
      <Card className="mt-6" title="Attempt history" subtitle="Scores, difficulty progression and status">
        <DataTable rows={history.data?.items ?? []} rowKey={(r: Row) => r.id} empty="No attempts yet." columns={[
          { key: "quizTitle", header: "Quiz" },
          { key: "startedAt", header: "Started", render: (r: Row) => formatDateTime(r.startedAt) },
          { key: "status", header: "Status", render: (r: Row) => <Badge value={r.status}>{labelize(r.status)}</Badge> },
          { key: "percentage", header: "Score", render: (r: Row) => (r.percentage === null ? "—" : `${r.score}/${r.maxScore} (${fmtPct(Number(r.percentage))})`) },
          { key: "difficulty", header: "Difficulty", render: (r: Row) => `${r.startDifficulty ?? "—"} → ${r.endDifficulty ?? "—"}` },
          { key: "review", header: "", render: (r: Row) => (r.status === "submitted" ? <Button size="sm" variant="ghost" onClick={() => setAttemptId(r.id)}>Review</Button> : null) },
        ]} />
      </Card>
    </>
  );
}

function AttemptRunner({ id, onExit }: { id: number; onExit: () => void }) {
  const view = useFetch<Row>(`/api/quizzes/attempts/${id}`);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState<Row | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (view.loading && !view.data) return <Loading label="Preparing your quiz…" />;
  if (view.error) return <Notice tone="error">{view.error}</Notice>;
  const data = view.data;
  if (!data) return null;

  // Closed attempt: show review with explanations.
  if (data.review) {
    return (
      <>
        <PageHeader title="Quiz review" description="Correct answers and explanations for each question." actions={<Button variant="secondary" onClick={onExit}>Back to quizzes</Button>} />
        <Card title={`Score: ${data.summary.score ?? 0}/${data.summary.maxScore ?? 0} (${fmtPct(Number(data.summary.percentage ?? 0))})`} subtitle={`Difficulty ${data.summary.startDifficulty ?? "—"} → next ${data.summary.endDifficulty ?? "—"}`}>
          <ReviewList review={data.review} />
        </Card>
      </>
    );
  }

  if (result) {
    return (
      <>
        <PageHeader title="Quiz submitted" actions={<Button onClick={onExit}>Back to quizzes</Button>} />
        <Card title={`Score: ${result.score}/${result.maxScore} (${fmtPct(result.percentage)})`} subtitle={`Next suggested difficulty: ${result.nextDifficulty}. Your topic mastery has been updated.`}>
          <ReviewList review={result.review} />
        </Card>
      </>
    );
  }

  const remaining = Math.max(0, Math.floor((new Date(data.attempt.deadline).getTime() - now) / 1000));
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const expired = remaining === 0;

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<Row>(`/api/quizzes/attempts/${id}`, { body: { answers: data.questions.map((q: Row) => ({ questionId: q.questionId, answer: answers[q.questionId] ?? "" })) } });
      setResult(res);
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Timed quiz" description="Answer each question and submit before the timer ends. Unanswered questions score zero." actions={
        <div className={`rounded-xl px-4 py-2 font-mono text-lg font-semibold ${remaining < 60 ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200" : "bg-brand-600/10 text-brand-600 dark:text-cyan-300"}`} aria-live="polite">{mm}:{ss}</div>
      } />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {expired && <Notice tone="warning">Time is up. Submitting now will be rejected because the attempt has closed.</Notice>}
      <div className="space-y-4">
        {data.questions.map((q: Row) => (
          <Card key={q.questionId} title={`Question ${q.position}`} subtitle={`${labelize(q.type)} · difficulty ${q.difficulty}`}>
            <p className="mb-3 text-base text-slate-800 dark:text-slate-100">{q.prompt}</p>
            {q.type === "short_answer" ? (
              <Input value={answers[q.questionId] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.questionId]: e.target.value })} placeholder="Type your answer" aria-label={`Answer to question ${q.position}`} />
            ) : (
              <div className="grid gap-2">
                {(q.options ?? []).map((o: string) => (
                  <label key={o} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 text-sm transition ${answers[q.questionId] === o ? "border-brand-500 bg-brand-500/5" : "border-slate-200 hover:bg-slate-50 dark:border-navy-700 dark:hover:bg-navy-800"}`}>
                    <input type="radio" name={`q-${q.questionId}`} checked={answers[q.questionId] === o} onChange={() => setAnswers({ ...answers, [q.questionId]: o })} />
                    {o}
                  </label>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <Button onClick={submit} disabled={busy || expired}><Send className="h-4 w-4" /> {busy ? "Submitting…" : "Submit quiz"}</Button>
      </div>
    </>
  );
}

function ReviewList({ review }: { review: Row[] }) {
  return (
    <ol className="space-y-4">
      {review.map((r) => (
        <li key={r.questionId} className="rounded-xl border border-slate-200 p-4 dark:border-navy-700">
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium text-slate-800 dark:text-slate-100">{r.position}. {r.prompt}</p>
            {r.needsReview ? <Badge value="pending">Needs review</Badge> : r.isCorrect ? <Badge value="approved">Correct</Badge> : <Badge value="rejected">Incorrect</Badge>}
          </div>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Your answer: {r.givenAnswer ?? <em>no answer</em>}</p>
          {!r.isCorrect && <p className="text-sm text-slate-600 dark:text-slate-300">Correct answer: <strong>{r.correctAnswer}</strong></p>}
          {r.explanation && <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-navy-800 dark:text-slate-200">{r.explanation}</p>}
        </li>
      ))}
    </ol>
  );
}

/* ---------- Staff: question bank and quiz management ---------- */

function StaffQuizzes({ role }: { role: string }) {
  const [tab, setTab] = useState<"bank" | "quizzes">("bank");
  const [msg, setMsg] = useState<Msg>(null);
  const alloc = useFetch<{ items: Row[] }>("/api/allocations");
  const subjects = useMemo(() => {
    if (role === "admin") return [];
    const map = new Map<number, Row>();
    for (const a of alloc.data?.items ?? []) map.set(a.subjectId, { id: a.subjectId, code: a.subjectCode, name: a.subjectName });
    return [...map.values()];
  }, [alloc.data, role]);
  const adminSubjects = useFetch<{ items: Row[] }>(role === "admin" ? "/api/academics/subjects" : null);
  const subjectList = role === "admin" ? adminSubjects.data?.items ?? [] : subjects;
  const [subjectId, setSubjectId] = useState("");
  return (
    <>
      <PageHeader title="Question Bank & Quizzes" description="Maintain multiple-choice, true/false and short-answer questions by topic and difficulty, and publish adaptive quizzes." />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <Card className="mb-4">
        <Field label="Subject"><Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}><option value="">Select subject</option>{subjectList.map((s: Row) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select></Field>
      </Card>
      <Tabs tabs={[{ id: "bank", label: "Question bank" }, { id: "quizzes", label: "Quizzes & attempts" }]} active={tab} onChange={setTab} />
      {subjectId ? (tab === "bank" ? <QuestionBank subjectId={Number(subjectId)} onMsg={setMsg} /> : <QuizManager subjectId={Number(subjectId)} onMsg={setMsg} />) : <Notice tone="info">Select a subject to manage its questions and quizzes.</Notice>}
    </>
  );
}

function QuestionBank({ subjectId, onMsg }: { subjectId: number; onMsg: (m: Msg) => void }) {
  const bank = useFetch<{ items: Row[] }>(`/api/quizzes/questions?subjectId=${subjectId}`);
  const topics = useFetch<{ items: Row[] }>(`/api/academics/topics?subjectId=${subjectId}`);
  const [f, setF] = useState({ topicId: "", questionType: "mcq", difficulty: "2", prompt: "", optionsText: "", correctAnswer: "", acceptedText: "", explanation: "" });
  async function add(e: FormEvent) {
    e.preventDefault();
    const options = f.questionType === "mcq" ? f.optionsText.split("\n").map((s) => s.trim()).filter(Boolean) : [];
    try {
      await api("/api/quizzes/questions", { body: { subjectId, topicId: Number(f.topicId), questionType: f.questionType, difficulty: Number(f.difficulty), prompt: f.prompt, options, correctAnswer: f.correctAnswer, acceptedAnswers: f.acceptedText.split(",").map((s) => s.trim()).filter(Boolean), explanation: f.explanation } });
      onMsg({ tone: "success", text: "Question added to the bank." });
      setF({ ...f, prompt: "", optionsText: "", correctAnswer: "", acceptedText: "", explanation: "" });
      bank.reload();
    } catch (err) {
      onMsg({ tone: "error", text: errorMessage(err) });
    }
  }
  async function toggle(row: Row) {
    try {
      await api("/api/quizzes/questions", { method: "PATCH", body: { id: row.id, isActive: !row.isActive } });
      bank.reload();
    } catch (err) {
      onMsg({ tone: "error", text: errorMessage(err) });
    }
  }
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2" title={`Questions (${bank.data?.items?.length ?? 0})`}>
        {bank.error && <Notice tone="error">{bank.error}</Notice>}
        <DataTable rows={bank.data?.items ?? []} rowKey={(r: Row) => r.id} empty="No questions yet for this subject." columns={[
          { key: "topicName", header: "Topic" },
          { key: "questionType", header: "Type", render: (r: Row) => labelize(r.questionType) },
          { key: "difficulty", header: "Difficulty" },
          { key: "prompt", header: "Question", render: (r: Row) => <span className="line-clamp-2 max-w-md">{r.prompt}</span> },
          { key: "correctAnswer", header: "Answer" },
          { key: "isActive", header: "Active", render: (r: Row) => <Button size="sm" variant="ghost" onClick={() => toggle(r)}>{r.isActive ? "Deactivate" : "Activate"}</Button> },
        ]} />
      </Card>
      <Card title="Add question">
        <form onSubmit={add} className="space-y-3">
          <Field label="Topic"><Select required value={f.topicId} onChange={(e) => setF({ ...f, topicId: e.target.value })}><option value="">Select</option>{(topics.data?.items ?? []).map((t: Row) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><Select value={f.questionType} onChange={(e) => setF({ ...f, questionType: e.target.value, correctAnswer: e.target.value === "true_false" ? "True" : "" })}><option value="mcq">Multiple choice</option><option value="true_false">True / False</option><option value="short_answer">Short answer</option></Select></Field>
            <Field label="Difficulty"><Select value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}><option value="1">1 · Easy</option><option value="2">2 · Medium</option><option value="3">3 · Hard</option></Select></Field>
          </div>
          <Field label="Question"><Textarea required minLength={8} value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} /></Field>
          {f.questionType === "mcq" && <Field label="Options (one per line)"><Textarea value={f.optionsText} onChange={(e) => setF({ ...f, optionsText: e.target.value })} /></Field>}
          {f.questionType === "true_false" ? (
            <Field label="Correct answer"><Select value={f.correctAnswer || "True"} onChange={(e) => setF({ ...f, correctAnswer: e.target.value })}><option>True</option><option>False</option></Select></Field>
          ) : (
            <Field label="Correct answer"><Input required value={f.correctAnswer} onChange={(e) => setF({ ...f, correctAnswer: e.target.value })} /></Field>
          )}
          {f.questionType === "short_answer" && <Field label="Other accepted answers (comma-separated)"><Input value={f.acceptedText} onChange={(e) => setF({ ...f, acceptedText: e.target.value })} /></Field>}
          <Field label="Explanation shown after submission"><Textarea required minLength={5} value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} /></Field>
          <Button type="submit" className="w-full"><Plus className="h-4 w-4" /> Add to bank</Button>
        </form>
      </Card>
    </div>
  );
}

function QuizManager({ subjectId, onMsg }: { subjectId: number; onMsg: (m: Msg) => void }) {
  const quizzes = useFetch<{ items: Row[] }>(`/api/quizzes?subjectId=${subjectId}`);
  const topics = useFetch<{ items: Row[] }>(`/api/academics/topics?subjectId=${subjectId}`);
  const [quizId, setQuizId] = useState<number | null>(null);
  const attempts = useFetch<{ items: Row[] }>(quizId ? `/api/quizzes/attempts?quizId=${quizId}` : null);
  const [f, setF] = useState({ title: "", topicId: "", timeLimitSeconds: "600", questionCount: "5" });
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api<Row>("/api/quizzes", { body: { title: f.title, subjectId, topicId: f.topicId ? Number(f.topicId) : null, timeLimitSeconds: Number(f.timeLimitSeconds), questionCount: Number(f.questionCount), isPublished: true } });
      onMsg({ tone: res.lowBankWarning ? "info" : "success", text: res.lowBankWarning ? `Quiz published, but only ${res.availableQuestions} question(s) exist; students will receive fewer questions.` : "Quiz published to enrolled students." });
      setF({ ...f, title: "" });
      quizzes.reload();
    } catch (err) {
      onMsg({ tone: "error", text: errorMessage(err) });
    }
  }
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2" title="Quizzes" subtitle="Select a quiz to see its attempts">
        <DataTable rows={quizzes.data?.items ?? []} rowKey={(r: Row) => r.id} onRowClick={(r: Row) => setQuizId(r.id)} empty="No quizzes yet." columns={[
          { key: "title", header: "Quiz" },
          { key: "topic_name", header: "Topic", render: (r: Row) => r.topic_name ?? "All topics" },
          { key: "available_questions", header: "Bank size" },
          { key: "attempts", header: "Attempts" },
          { key: "avg_pct", header: "Average", render: (r: Row) => fmtPct(r.avg_pct === null ? null : Number(r.avg_pct)) },
        ]} />
        {quizId && (
          <div className="mt-5">
            <h4 className="mb-2 text-sm font-semibold">Attempts</h4>
            <DataTable rows={attempts.data?.items ?? []} rowKey={(r: Row) => r.id} empty="No attempts yet." columns={[
              { key: "student_code", header: "Student" },
              { key: "full_name", header: "Name" },
              { key: "started_at", header: "Started", render: (r: Row) => formatDateTime(r.started_at) },
              { key: "status", header: "Status", render: (r: Row) => labelize(r.status) },
              { key: "percentage", header: "Score", render: (r: Row) => (r.percentage === null ? "—" : fmtPct(Number(r.percentage))) },
            ]} />
          </div>
        )}
      </Card>
      <Card title="Create quiz">
        <form onSubmit={create} className="space-y-3">
          <Field label="Title"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Topic (optional)"><Select value={f.topicId} onChange={(e) => setF({ ...f, topicId: e.target.value })}><option value="">All topics (mixed)</option>{(topics.data?.items ?? []).map((t: Row) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Time limit (s)"><Input type="number" min={60} max={3600} value={f.timeLimitSeconds} onChange={(e) => setF({ ...f, timeLimitSeconds: e.target.value })} /></Field>
            <Field label="Questions"><Input type="number" min={1} max={20} value={f.questionCount} onChange={(e) => setF({ ...f, questionCount: e.target.value })} /></Field>
          </div>
          <Button type="submit" className="w-full"><Plus className="h-4 w-4" /> Publish quiz</Button>
        </form>
      </Card>
    </div>
  );
}
