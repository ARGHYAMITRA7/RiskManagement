"use client";

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, DataTable, Field, Input, Loading, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { api, errorMessage, useFetch } from "@/lib/client";
import { DAY_NAMES, formatDate, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Msg = { tone: "success" | "error" | "info"; text: string } | null;

export default function TimetablePage() {
  const me = useFetch<{ user: { role: string } }>("/api/auth/me");
  const [msg, setMsg] = useState<Msg>(null);
  const [tick, setTick] = useState(0);
  const role = me.data?.user.role;
  const slots = useFetch<{ items: Row[] }>(me.data && role !== "guardian" ? `/api/timetable?t=${tick}` : null);
  const events = useFetch<{ items: Row[] }>(me.data ? "/api/academics/events" : null);
  if (!me.data) return me.error ? <Notice tone="error">{me.error}</Notice> : <Loading />;
  const canManage = role === "admin" || role === "teacher";

  async function remove(id: number) {
    try {
      await api(`/api/timetable?id=${id}`, { method: "DELETE" });
      setMsg({ tone: "success", text: "Timetable slot removed." });
      setTick(tick + 1);
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    }
  }

  return (
    <>
      <PageHeader title="Timetable & Academic Calendar" description="Weekly timetable with conflict validation (a teacher or class cannot be double-booked), examinations, deadlines, holidays and events." />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Weekly timetable">
          {slots.loading && !slots.data ? <Loading /> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((day) => {
                const items = (slots.data?.items ?? []).filter((s) => s.dayOfWeek === day);
                return (
                  <div key={day} className="rounded-xl border border-slate-200 p-3 dark:border-navy-700">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{DAY_NAMES[day]}</p>
                    <ul className="space-y-2">
                      {items.map((s) => (
                        <li key={s.id} className="rounded-lg bg-brand-500/5 p-2 text-xs dark:bg-navy-800">
                          <p className="font-semibold text-slate-800 dark:text-slate-100">{s.startTime}–{s.endTime} · {s.subjectCode}</p>
                          <p className="text-slate-600 dark:text-slate-300">{s.classCode} · {s.teacherName}{s.room ? ` · ${s.room}` : ""}</p>
                          {canManage && <button className="mt-1 inline-flex items-center gap-1 text-rose-600" onClick={() => remove(s.id)}><Trash2 className="h-3 w-3" /> Remove</button>}
                        </li>
                      ))}
                      {items.length === 0 && <li className="text-xs text-slate-400">No sessions</li>}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card title="Academic calendar" subtitle="Holidays, examinations, deadlines and events">
          <DataTable rows={events.data?.items ?? []} rowKey={(r: Row) => r.id} empty="No calendar items." columns={[
            { key: "eventDate", header: "Date", render: (r: Row) => formatDate(r.eventDate) },
            { key: "title", header: "Event" },
            { key: "eventType", header: "Type", render: (r: Row) => labelize(r.eventType) },
          ]} />
        </Card>
      </div>
      {canManage && (
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          <SlotForm onDone={(t) => { setMsg({ tone: "success", text: t }); setTick(tick + 1); }} onError={(t) => setMsg({ tone: "error", text: t })} />
          <EventForm onDone={(t) => { setMsg({ tone: "success", text: t }); events.reload(); }} onError={(t) => setMsg({ tone: "error", text: t })} />
        </div>
      )}
    </>
  );
}

function SlotForm({ onDone, onError }: { onDone: (t: string) => void; onError: (t: string) => void }) {
  const alloc = useFetch<{ items: Row[] }>("/api/allocations");
  const [key, setKey] = useState("");
  const [f, setF] = useState({ dayOfWeek: "1", startTime: "09:00", endTime: "10:00", room: "" });
  const pairs = alloc.data?.items ?? [];
  const sel = pairs.find((p) => `${p.teacherId}:${p.subjectId}:${p.classId}` === key);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!sel) return;
    try {
      await api("/api/timetable", { body: { classId: sel.classId, subjectId: sel.subjectId, teacherId: sel.teacherId, dayOfWeek: Number(f.dayOfWeek), startTime: f.startTime, endTime: f.endTime, room: f.room || null } });
      onDone("Slot added. No conflicts were found.");
    } catch (err) {
      onError(errorMessage(err));
    }
  }
  return (
    <Card title="Add timetable slot" subtitle="Allocated subject and class only">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Allocation" className="md:col-span-2"><Select required value={key} onChange={(e) => setKey(e.target.value)}><option value="">Select</option>{pairs.map((p) => <option key={`${p.teacherId}:${p.subjectId}:${p.classId}`} value={`${p.teacherId}:${p.subjectId}:${p.classId}`}>{p.teacherName} · {p.subjectCode} · {p.classCode}</option>)}</Select></Field>
        <Field label="Day"><Select value={f.dayOfWeek} onChange={(e) => setF({ ...f, dayOfWeek: e.target.value })}>{[1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}</Select></Field>
        <Field label="Room"><Input value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} /></Field>
        <Field label="Start (HH:MM)"><Input type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></Field>
        <Field label="End (HH:MM)"><Input type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></Field>
        <div className="md:col-span-2 flex justify-end"><Button type="submit" disabled={!sel}><Plus className="h-4 w-4" /> Add slot</Button></div>
      </form>
    </Card>
  );
}

function EventForm({ onDone, onError }: { onDone: (t: string) => void; onError: (t: string) => void }) {
  const [f, setF] = useState({ title: "", eventType: "event", eventDate: "", endDate: "", description: "" });
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/academics/events", { body: { ...f, endDate: f.endDate || null, description: f.description || null } });
      onDone("Calendar item added.");
      setF({ ...f, title: "", eventDate: "", endDate: "", description: "" });
    } catch (err) {
      onError(errorMessage(err));
    }
  }
  return (
    <Card title="Add calendar item" subtitle="Holidays, examinations, deadlines and events">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Title" className="md:col-span-2"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Type"><Select value={f.eventType} onChange={(e) => setF({ ...f, eventType: e.target.value })}><option value="event">Event</option><option value="holiday">Holiday</option><option value="exam">Examination</option><option value="deadline">Deadline</option></Select></Field>
        <Field label="Date"><Input type="date" required value={f.eventDate} onChange={(e) => setF({ ...f, eventDate: e.target.value })} /></Field>
        <Field label="End date (optional)"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        <Field label="Description" className="md:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="md:col-span-2 flex justify-end"><Button type="submit"><Plus className="h-4 w-4" /> Add to calendar</Button></div>
      </form>
    </Card>
  );
}
