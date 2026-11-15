"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Lock, Plus, ShieldOff, Trash2, UserCheck, XCircle } from "lucide-react";
import { Badge, Button, Card, DataTable, Field, Input, Modal, Notice, PageHeader, Pager, Select, Tabs, fmtPct } from "@/components/ui";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDateTime, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Tab = "accounts" | "teachers" | "allocations" | "guardians";
type Msg = { tone: "success" | "error"; text: string } | null;

export default function PeoplePage() {
  const [tab, setTab] = useState<Tab>("accounts");
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <>
      <PageHeader title="People & Accounts" description="Approve accounts, provision teachers and administrators, allocate teachers to subjects and classes, and approve guardian links." />
      {msg && <div className="mb-4"><Notice tone={msg.tone === "error" ? "error" : "success"}>{msg.text}</Notice></div>}
      <Tabs
        tabs={[
          { id: "accounts", label: "Accounts & approvals" },
          { id: "teachers", label: "Teachers" },
          { id: "allocations", label: "Allocations" },
          { id: "guardians", label: "Guardian links" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "accounts" && <AccountsTab onMsg={setMsg} />}
      {tab === "teachers" && <TeachersTab onMsg={setMsg} />}
      {tab === "allocations" && <AllocationsTab onMsg={setMsg} />}
      {tab === "guardians" && <GuardiansTab onMsg={setMsg} />}
    </>
  );
}

function AccountsTab({ onMsg }: { onMsg: (m: Msg) => void }) {
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const params = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (status) params.set("status", status);
  if (role) params.set("role", role);
  if (q) params.set("q", q);
  const { data, error, loading, reload } = useFetch<{ items: Row[]; total: number; page: number; pageSize: number }>(`/api/users?${params}`);

  async function setUser(id: number, body: Record<string, unknown>, text: string) {
    try {
      await api("/api/users", { method: "PATCH", body: { id, ...body } });
      onMsg({ tone: "success", text });
      reload();
    } catch (e) {
      onMsg({ tone: "error", text: errorMessage(e) });
    }
  }

  return (
    <Card
      title="User accounts"
      subtitle="Pending accounts (self-registration) must be approved before sign-in is possible."
      actions={<Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Provision admin / guardian</Button>}
    >
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name or email" aria-label="Search accounts" />
        <Select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}><option value="">All roles</option><option value="admin">Administrator</option><option value="teacher">Teacher</option><option value="student">Student</option><option value="guardian">Guardian</option></Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option value="pending">Pending approval</option><option value="active">Active</option><option value="suspended">Suspended</option></Select>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data ? null : (
        <>
          <DataTable
            rows={data?.items ?? []}
            rowKey={(r: Row) => r.id}
            empty="No accounts match the filters."
            columns={[
              { key: "fullName", header: "Name" },
              { key: "email", header: "Email" },
              { key: "role", header: "Role", render: (r: Row) => labelize(r.role) },
              { key: "status", header: "Status", render: (r: Row) => <Badge value={r.status}>{labelize(r.status)}</Badge> },
              { key: "lastLoginAt", header: "Last sign-in", render: (r: Row) => formatDateTime(r.lastLoginAt) },
              { key: "failedLoginCount", header: "Failed attempts", render: (r: Row) => (r.lockedUntil && new Date(r.lockedUntil) > new Date() ? <span className="text-rose-600">Locked</span> : r.failedLoginCount) },
              {
                key: "actions",
                header: "Actions",
                render: (r: Row) => (
                  <div className="flex flex-wrap gap-1.5">
                    {r.status !== "active" && <Button size="sm" variant="secondary" onClick={() => setUser(r.id, { status: "active" }, `${r.fullName} approved and activated.`)}><UserCheck className="h-3.5 w-3.5" /> Approve</Button>}
                    {r.status === "active" && <Button size="sm" variant="ghost" onClick={() => setUser(r.id, { status: "suspended" }, `${r.fullName} suspended.`)}><ShieldOff className="h-3.5 w-3.5" /> Suspend</Button>}
                    {r.lockedUntil && new Date(r.lockedUntil) > new Date() && <Button size="sm" variant="ghost" onClick={() => setUser(r.id, { unlock: true }, `${r.fullName} unlocked.`)}><Lock className="h-3.5 w-3.5" /> Unlock</Button>}
                  </div>
                ),
              },
            ]}
          />
          {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
        </>
      )}
      <ProvisionModal open={addOpen} onClose={() => setAddOpen(false)} onDone={(t) => { onMsg({ tone: "success", text: t }); setAddOpen(false); reload(); }} />
    </Card>
  );
}

function ProvisionModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (t: string) => void }) {
  const [f, setF] = useState({ email: "", fullName: "", role: "admin", password: "" });
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/users", { body: f });
      setF({ email: "", fullName: "", role: "admin", password: "" });
      onDone("Account provisioned and active.");
    } catch (x) {
      setErr(errorMessage(x));
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Provision account">
      <form onSubmit={submit} className="grid gap-4">
        {err && <Notice tone="error">{err}</Notice>}
        <Field label="Full name"><Input required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="admin">Administrator</option><option value="guardian">Guardian (link later)</option></Select></Field>
        <Field label="Temporary password" hint="At least 8 characters with letters and numbers. Share it securely."><Input type="password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit">Create account</Button></div>
      </form>
    </Modal>
  );
}

function TeachersTab({ onMsg }: { onMsg: (m: Msg) => void }) {
  const { data, error, reload } = useFetch<{ items: Row[] }>("/api/teachers");
  const depts = useFetch<{ items: Row[] }>("/api/academics/departments");
  const [f, setF] = useState({ fullName: "", email: "", password: "", departmentId: "", designation: "", phone: "" });
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const res = await api<{ teacherCode: string }>("/api/teachers", { body: { ...f, departmentId: Number(f.departmentId) } });
      onMsg({ tone: "success", text: `Teacher ${res.teacherCode} registered. Allocate subjects and classes in the Allocations tab.` });
      setF({ fullName: "", email: "", password: "", departmentId: "", designation: "", phone: "" });
      reload();
    } catch (x) {
      setErr(errorMessage(x));
    }
  }
  async function deactivate(row: Row) {
    if (!confirm(`Suspend the login for ${row.fullName}?`)) return;
    try {
      await api(`/api/teachers/${row.id}`, { method: "DELETE" });
      onMsg({ tone: "success", text: `${row.fullName} has been suspended.` });
      reload();
    } catch (x) {
      onMsg({ tone: "error", text: errorMessage(x) });
    }
  }
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2" title="Teacher register">
        {error && <Notice tone="error">{error}</Notice>}
        <DataTable rows={data?.items ?? []} rowKey={(r: Row) => r.id} empty="No teachers registered." columns={[
          { key: "teacherCode", header: "Teacher ID" },
          { key: "fullName", header: "Name" },
          { key: "email", header: "Email" },
          { key: "departmentName", header: "Department" },
          { key: "allocations", header: "Allocations" },
          { key: "status", header: "Account", render: (r: Row) => <Badge value={r.status}>{labelize(r.status)}</Badge> },
          { key: "actions", header: "", render: (r: Row) => <Button size="sm" variant="ghost" onClick={() => deactivate(r)}><Trash2 className="h-3.5 w-3.5" /> Suspend</Button> },
        ]} />
      </Card>
      <Card title="Register teacher">
        <form onSubmit={submit} className="space-y-3">
          {err && <Notice tone="error">{err}</Notice>}
          <Field label="Full name"><Input required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Temporary password"><Input type="password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <Field label="Department"><Select required value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}><option value="">Select</option>{(depts.data?.items ?? []).map((d: Row) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Designation"><Input value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
          <Button type="submit" className="w-full"><Plus className="h-4 w-4" /> Register teacher</Button>
        </form>
      </Card>
    </div>
  );
}

function AllocationsTab({ onMsg }: { onMsg: (m: Msg) => void }) {
  const alloc = useFetch<{ items: Row[] }>("/api/allocations");
  const teachers = useFetch<{ items: Row[] }>("/api/teachers");
  const subjects = useFetch<{ items: Row[] }>("/api/academics/subjects");
  const classes = useFetch<{ items: Row[] }>("/api/academics/classes");
  const [f, setF] = useState({ teacherId: "", subjectId: "", classId: "" });
  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/allocations", { body: { teacherId: Number(f.teacherId), subjectId: Number(f.subjectId), classId: Number(f.classId) } });
      onMsg({ tone: "success", text: "Allocation saved. The teacher can now manage this subject for the class." });
      alloc.reload();
    } catch (x) {
      onMsg({ tone: "error", text: errorMessage(x) });
    }
  }
  async function remove(id: number) {
    try {
      await api(`/api/allocations?id=${id}`, { method: "DELETE" });
      onMsg({ tone: "success", text: "Allocation removed." });
      alloc.reload();
    } catch (x) {
      onMsg({ tone: "error", text: errorMessage(x) });
    }
  }
  const validSubjects = (subjects.data?.items ?? []).filter((s: Row) => !f.classId || (classes.data?.items ?? []).find((c: Row) => String(c.id) === f.classId)?.semester === s.semester);
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2" title="Current allocations" subtitle="Teachers see only students in the classes they are allocated to.">
        <DataTable rows={alloc.data?.items ?? []} rowKey={(r: Row) => r.id} empty="No allocations yet." columns={[
          { key: "teacherName", header: "Teacher" },
          { key: "subjectCode", header: "Subject", render: (r: Row) => `${r.subjectCode} ${r.subjectName}` },
          { key: "classCode", header: "Class" },
          { key: "semester", header: "Sem" },
          { key: "actions", header: "", render: (r: Row) => <Button size="sm" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-3.5 w-3.5" /> Remove</Button> },
        ]} />
      </Card>
      <Card title="Allocate teacher">
        <form onSubmit={add} className="space-y-3">
          <Field label="Teacher"><Select required value={f.teacherId} onChange={(e) => setF({ ...f, teacherId: e.target.value })}><option value="">Select teacher</option>{(teachers.data?.items ?? []).map((t: Row) => <option key={t.id} value={t.id}>{t.teacherCode} · {t.fullName}</option>)}</Select></Field>
          <Field label="Class"><Select required value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value, subjectId: "" })}><option value="">Select class</option>{(classes.data?.items ?? []).map((c: Row) => <option key={c.id} value={c.id}>{c.code} (Sem {c.semester})</option>)}</Select></Field>
          <Field label="Subject" hint="Only subjects in the class's semester are listed"><Select required value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })}><option value="">Select subject</option>{validSubjects.map((s: Row) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select></Field>
          <Button type="submit" className="w-full"><CheckCircle2 className="h-4 w-4" /> Save allocation</Button>
        </form>
      </Card>
    </div>
  );
}

function GuardiansTab({ onMsg }: { onMsg: (m: Msg) => void }) {
  const { data, reload } = useFetch<{ items: Row[] }>("/api/guardians");
  async function decide(id: number, decision: "approve" | "reject") {
    try {
      await api("/api/guardians", { method: "PATCH", body: { id, decision } });
      onMsg({ tone: "success", text: decision === "approve" ? "Guardian link approved. The guardian can now view approved records." : "Guardian link rejected and removed." });
      reload();
    } catch (x) {
      onMsg({ tone: "error", text: errorMessage(x) });
    }
  }
  return (
    <Card title="Guardian links" subtitle="Guardians gain read-only access only after approval.">
      <DataTable rows={data?.items ?? []} rowKey={(r: Row) => r.linkId} empty="No guardian links." columns={[
        { key: "guardianName", header: "Guardian" },
        { key: "relation", header: "Relation" },
        { key: "studentName", header: "Student", render: (r: Row) => `${r.studentName} (${r.studentCode})` },
        { key: "approved", header: "Status", render: (r: Row) => (r.approved ? <Badge value="approved">Approved</Badge> : <Badge value="pending">Pending</Badge>) },
        { key: "actions", header: "", render: (r: Row) => r.approved ? null : (
          <div className="flex gap-1.5"><Button size="sm" onClick={() => decide(r.linkId, "approve")}><CheckCircle2 className="h-3.5 w-3.5" /> Approve</Button><Button size="sm" variant="ghost" onClick={() => decide(r.linkId, "reject")}><XCircle className="h-3.5 w-3.5" /> Reject</Button></div>
        ) },
      ]} />
      <p className="mt-3 text-xs text-slate-500">Accuracy note: {fmtPct(null)} is shown where no data exists; nothing is assumed.</p>
    </Card>
  );
}
