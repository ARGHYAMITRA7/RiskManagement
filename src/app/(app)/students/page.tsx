"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Archive, Download, FileUp, Plus, RotateCcw, Search } from "lucide-react";
import { Badge, Button, Card, DataTable, Field, Input, Loading, Modal, Notice, PageHeader, Pager, Select } from "@/components/ui";
import { api, errorMessage, useFetch } from "@/lib/client";
import { labelize, riskColor } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

type Lookup = { id: number; code: string; name: string; courseId?: number; semester?: number };

export default function StudentsPage() {
  const [q, setQ] = useState("");
  const [classId, setClassId] = useState("");
  const [semester, setSemester] = useState("");
  const [risk, setRisk] = useState("");
  const [status, setStatus] = useState("active");
  const [sort, setSort] = useState("code");
  const [order, setOrder] = useState("asc");
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const me = useFetch<{ user: { role: string } }>("/api/auth/me");
  const isAdmin = me.data?.user.role === "admin";
  const classes = useFetch<{ items: Lookup[] }>("/api/academics/classes");
  const courses = useFetch<{ items: Lookup[] }>("/api/academics/courses");

  const qs = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: "20", status, sort, order });
    if (q) p.set("q", q);
    if (classId) p.set("classId", classId);
    if (semester) p.set("semester", semester);
    if (risk) p.set("risk", risk);
    return p.toString();
  }, [q, classId, semester, risk, status, sort, order, page]);
  const list = useFetch<{ items: Row[]; total: number; page: number; pageSize: number }>(me.data ? `/api/students?${qs}` : null);

  useEffect(() => setPage(1), [q, classId, semester, risk, status, sort, order]);

  async function archive(row: Row) {
    if (!confirm(`Archive ${row.full_name}? The record and history are kept and the login is suspended.`)) return;
    try {
      await api(`/api/students/${row.id}`, { method: "DELETE" });
      setMsg({ tone: "success", text: `${row.full_name} has been archived.` });
      list.reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    }
  }

  async function restore(row: Row) {
    try {
      await api(`/api/students/${row.id}`, { method: "PUT" });
      setMsg({ tone: "success", text: `${row.full_name} has been restored.` });
      list.reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    }
  }

  const exportUrl = (format: "csv" | "xlsx") => `/api/students/export?format=${format}`;

  return (
    <>
      <PageHeader
        title="Students"
        description="Search, filter and sort student records. Risk badges show the latest assessment; open a student to see the explainable factors."
        actions={
          isAdmin ? (
            <>
              <Button variant="secondary" onClick={() => setImportOpen(true)}><FileUp className="h-4 w-4" /> Import CSV / Excel</Button>
              <a href={exportUrl("xlsx")} className="inline-flex"><Button variant="secondary"><Download className="h-4 w-4" /> Excel</Button></a>
              <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add student</Button>
            </>
          ) : (
            <a href={exportUrl("csv")} className="inline-flex"><Button variant="secondary"><Download className="h-4 w-4" /> Export CSV</Button></a>
          )
        }
      />
      {msg && <div className="mb-4"><Notice tone={msg.tone === "error" ? "error" : "success"}>{msg.text}</Notice></div>}

      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Field label="Search" className="md:col-span-2 xl:col-span-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or student ID" aria-label="Search students" />
            </div>
          </Field>
          <Field label="Class">
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">All classes</option>
              {(classes.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
            </Select>
          </Field>
          <Field label="Semester">
            <Select value={semester} onChange={(e) => setSemester(e.target.value)}>
              <option value="">All</option>
              {[1, 2, 3, 4, 5, 6].map((s) => <option key={s} value={s}>Semester {s}</option>)}
            </Select>
          </Field>
          <Field label="Risk">
            <Select value={risk} onChange={(e) => setRisk(e.target.value)}>
              <option value="">Any</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-500">Sort by</span>
          <Select className="w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
            <option value="code">Student ID</option>
            <option value="name">Name</option>
            <option value="class">Class</option>
            <option value="semester">Semester</option>
            <option value="risk">Risk score</option>
          </Select>
          <Select className="w-auto" value={order} onChange={(e) => setOrder(e.target.value)} aria-label="Sort order">
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </Select>
        </div>
      </Card>

      <Card>
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <Notice tone="error">{list.error}</Notice>
        ) : (
          <>
            <DataTable
              rows={list.data?.items ?? []}
              rowKey={(r: Row) => r.id}
              empty="No students match these filters."
              columns={[
                { key: "student_code", header: "ID", render: (r: Row) => (
                  <span className="flex items-center gap-2 font-mono text-xs">{r.student_code}{String(r.student_code).startsWith("SYN-") && <Badge value="pending">Synthetic</Badge>}</span>
                ) },
                { key: "full_name", header: "Name", render: (r: Row) => <Link href={`/students/${r.id}`} className="font-medium text-brand-600 hover:underline dark:text-cyan-300">{r.full_name}</Link> },
                { key: "class_code", header: "Class", render: (r: Row) => r.class_code ?? "—" },
                { key: "course_code", header: "Course", render: (r: Row) => r.course_code ?? "—" },
                { key: "current_semester", header: "Sem" },
                { key: "risk_category", header: "Risk", render: (r: Row) => r.risk_category ? (
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${riskColor(r.risk_category)}`}>{labelize(r.risk_category)} · {r.risk_score}</span>
                ) : <span className="text-xs text-slate-400">Not assessed</span> },
                { key: "account_status", header: "Account", render: (r: Row) => (r.user_id ? <Badge value={r.account_status}>{labelize(r.account_status)}</Badge> : <span className="text-xs text-slate-400">No login</span>) },
                { key: "actions", header: "", render: (r: Row) => isAdmin ? (
                  r.status === "active" ? (
                    <Button variant="ghost" size="sm" onClick={() => archive(r)}><Archive className="h-4 w-4" /> Archive</Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => restore(r)}><RotateCcw className="h-4 w-4" /> Restore</Button>
                  )
                ) : null },
              ]}
            />
            <Pager page={list.data?.page ?? page} pageSize={list.data?.pageSize ?? 20} total={list.data?.total ?? 0} onPage={setPage} />
          </>
        )}
      </Card>

      {isAdmin && <AddStudentModal open={addOpen} onClose={() => setAddOpen(false)} courses={courses.data?.items ?? []} classes={classes.data?.items ?? []} onDone={(text) => { setMsg({ tone: "success", text }); list.reload(); }} />}
      {isAdmin && <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={(text) => { setMsg({ tone: "success", text }); list.reload(); }} />}
    </>
  );
}

function AddStudentModal({ open, onClose, courses, classes, onDone }: { open: boolean; onClose: () => void; courses: Lookup[]; classes: Lookup[]; onDone: (t: string) => void }) {
  const [f, setF] = useState({ fullName: "", email: "", phone: "", courseId: "", classId: "", currentSemester: "1", studentCode: "", guardianName: "", guardianEmail: "", guardianPhone: "", dailyStudyGoalMinutes: "60" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const classOptions = classes.filter((c) => String(c.courseId) === f.courseId && String(c.semester) === f.currentSemester);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { ...f, courseId: Number(f.courseId), currentSemester: Number(f.currentSemester), dailyStudyGoalMinutes: Number(f.dailyStudyGoalMinutes), classId: f.classId ? Number(f.classId) : null };
      for (const k of Object.keys(body)) if (body[k] === "") delete body[k];
      const res = await api<{ studentCode: string }>("/api/students", { body });
      onDone(`Student ${res.studentCode} created and enrolled in the semester's subjects.`);
      onClose();
      setF({ ...f, fullName: "", email: "", phone: "", studentCode: "", guardianName: "", guardianEmail: "", guardianPhone: "" });
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add student" wide>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        {err && <div className="md:col-span-2"><Notice tone="error">{err}</Notice></div>}
        <Field label="Full name"><Input required value={f.fullName} onChange={set("fullName")} /></Field>
        <Field label="Student ID" hint="Leave blank to generate one automatically"><Input value={f.studentCode} onChange={set("studentCode")} /></Field>
        <Field label="Email (optional)"><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Phone (optional)"><Input value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Course">
          <Select required value={f.courseId} onChange={set("courseId")}>
            <option value="">Select course</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </Select>
        </Field>
        <Field label="Current semester">
          <Select value={f.currentSemester} onChange={set("currentSemester")}>
            {[1, 2, 3, 4, 5, 6].map((s) => <option key={s} value={s}>Semester {s}</option>)}
          </Select>
        </Field>
        <Field label="Class" hint="Classes matching the course and semester">
          <Select value={f.classId} onChange={set("classId")}>
            <option value="">Not assigned</option>
            {classOptions.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </Select>
        </Field>
        <Field label="Daily study goal (minutes)"><Input type="number" min={15} max={600} value={f.dailyStudyGoalMinutes} onChange={set("dailyStudyGoalMinutes")} /></Field>
        <Field label="Guardian name"><Input value={f.guardianName} onChange={set("guardianName")} /></Field>
        <Field label="Guardian email"><Input type="email" value={f.guardianEmail} onChange={set("guardianEmail")} /></Field>
        <div className="flex justify-end gap-2 md:col-span-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Create student"}</Button>
        </div>
      </form>
    </Modal>
  );
}

type ImportReport = {
  headers: string[];
  missingColumns: string[];
  unknownColumns: string[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateCodesInFile: string[];
  missingValueCounts: Record<string, number>;
  rows: { line: number; data: Record<string, string>; errors: string[]; warnings: string[] }[];
};

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (t: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(mode: "preview" | "confirm") {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", mode);
      const res = await api<{ report?: ImportReport; previewRows?: Record<string, string>[]; summary?: { imported: number; skippedInvalid: number } }>("/api/students/import", { form });
      if (mode === "preview") {
        setReport(res.report ?? null);
        setPreviewRows(res.previewRows ?? []);
      } else {
        onDone(`Import complete: ${res.summary?.imported ?? 0} student(s) stored; ${res.summary?.skippedInvalid ?? 0} invalid row(s) skipped.`);
        setReport(null);
        setFile(null);
        onClose();
      }
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Import students" wide>
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Required columns: <code>full_name, course_code, semester</code>. Optional: <code>student_code, class_code, email, phone, guardian_name, guardian_email, guardian_phone, daily_study_goal_minutes, historical_outcome</code> (at_risk or on_track, stored as institutional labels for model training).
        </p>
        <a className="text-sm text-brand-600 underline dark:text-cyan-300" href="/api/students/template">Download a CSV template</a>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <Input type="file" accept=".csv,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} />
          <Button variant="secondary" disabled={!file || busy} onClick={() => send("preview")}>Preview &amp; validate</Button>
          <Button disabled={!report || busy || report.validRows === 0} onClick={() => send("confirm")}>Confirm import ({report?.validRows ?? 0} valid rows)</Button>
        </div>
        {report && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <Notice tone="info">{report.totalRows} data rows</Notice>
              <Notice tone="success">{report.validRows} valid</Notice>
              <Notice tone={report.invalidRows ? "warning" : "info"}>{report.invalidRows} with errors</Notice>
              <Notice tone="info">Missing optional values: {Object.values(report.missingValueCounts).reduce((a, b) => a + b, 0)}</Notice>
            </div>
            {report.missingColumns.length > 0 && <Notice tone="error">Missing required columns: {report.missingColumns.join(", ")}</Notice>}
            {report.duplicateCodesInFile.length > 0 && <Notice tone="warning">Duplicate student IDs in file: {report.duplicateCodesInFile.join(", ")}</Notice>}
            {report.unknownColumns.length > 0 && <Notice tone="warning">Unrecognised columns will be ignored: {report.unknownColumns.join(", ")}</Notice>}
            <div className="max-h-72 overflow-auto rounded-xl border border-slate-200 dark:border-navy-700">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-navy-800"><tr><th className="px-2 py-2 text-left">Line</th><th className="px-2 py-2 text-left">Name</th><th className="px-2 py-2 text-left">Course</th><th className="px-2 py-2 text-left">Errors / warnings</th></tr></thead>
                <tbody>
                  {report.rows.slice(0, 200).map((r) => (
                    <tr key={r.line} className="border-t border-slate-100 dark:border-navy-800">
                      <td className="px-2 py-1.5">{r.line}</td>
                      <td className="px-2 py-1.5">{r.data.full_name || "—"}</td>
                      <td className="px-2 py-1.5">{r.data.course_code || "—"}</td>
                      <td className="px-2 py-1.5">{r.errors.length ? <span className="text-rose-600">{r.errors.join("; ")}</span> : r.warnings.length ? <span className="text-amber-600">{r.warnings.join("; ")}</span> : <span className="text-emerald-600">OK</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previewRows.length > 0 && <p className="text-xs text-slate-500">First valid rows: {previewRows.slice(0, 3).map((r) => r.full_name).join(", ")}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
