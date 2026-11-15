"use client";

import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Card, DataTable, Field, Input, Modal, Notice, PageHeader, Select, Tabs, Textarea } from "@/components/ui";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDate, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Field_ = { name: string; label: string; type?: "text" | "number" | "date" | "select" | "checkbox" | "textarea"; required?: boolean; options?: { value: string; label: string }[]; lookup?: string; def?: string | number | boolean };
type EntityId = "departments" | "courses" | "academic-years" | "classes" | "subjects" | "topics" | "events";

const CONFIG: Record<EntityId, { label: string; fields: Field_[]; columns: { key: string; header: string; render?: (r: Row) => string }[] }> = {
  departments: {
    label: "Departments",
    fields: [{ name: "name", label: "Name", required: true }, { name: "code", label: "Code", required: true }, { name: "description", label: "Description", type: "textarea" }],
    columns: [{ key: "name", header: "Name" }, { key: "code", header: "Code" }, { key: "description", header: "Description" }],
  },
  courses: {
    label: "Courses / programmes",
    fields: [
      { name: "departmentId", label: "Department", type: "select", required: true, lookup: "departments" },
      { name: "name", label: "Programme name", required: true },
      { name: "code", label: "Code", required: true },
      { name: "durationSemesters", label: "Semesters", type: "number", def: 6 },
    ],
    columns: [{ key: "code", header: "Code" }, { key: "name", header: "Programme" }, { key: "durationSemesters", header: "Semesters" }],
  },
  "academic-years": {
    label: "Academic years",
    fields: [
      { name: "label", label: "Label (e.g. 2026-2027)", required: true },
      { name: "startDate", label: "Start date", type: "date", required: true },
      { name: "endDate", label: "End date", type: "date", required: true },
      { name: "isCurrent", label: "Current academic year", type: "checkbox", def: false },
    ],
    columns: [{ key: "label", header: "Year" }, { key: "startDate", header: "Start", render: (r) => formatDate(r.startDate) }, { key: "endDate", header: "End", render: (r) => formatDate(r.endDate) }, { key: "isCurrent", header: "Current", render: (r) => (r.isCurrent ? "Yes" : "No") }],
  },
  classes: {
    label: "Classes & divisions",
    fields: [
      { name: "code", label: "Class code", required: true },
      { name: "name", label: "Name", required: true },
      { name: "courseId", label: "Course", type: "select", required: true, lookup: "courses" },
      { name: "academicYearId", label: "Academic year", type: "select", lookup: "academic-years" },
      { name: "semester", label: "Semester", type: "number", required: true, def: 1 },
      { name: "division", label: "Division", def: "A" },
    ],
    columns: [{ key: "code", header: "Code" }, { key: "name", header: "Name" }, { key: "semester", header: "Semester" }, { key: "division", header: "Division" }],
  },
  subjects: {
    label: "Subjects & codes",
    fields: [
      { name: "code", label: "Subject code", required: true },
      { name: "name", label: "Subject name", required: true },
      { name: "courseId", label: "Course", type: "select", required: true, lookup: "courses" },
      { name: "semester", label: "Semester", type: "number", required: true, def: 1 },
      { name: "credits", label: "Credits", type: "number", def: 4 },
      { name: "passMarks", label: "Pass marks (absolute)", type: "number", def: 40 },
      { name: "maxInternalMarks", label: "Max internal marks", type: "number", def: 40 },
      { name: "isActive", label: "Active", type: "checkbox", def: true },
    ],
    columns: [{ key: "code", header: "Code" }, { key: "name", header: "Subject" }, { key: "semester", header: "Sem" }, { key: "credits", header: "Credits" }, { key: "passMarks", header: "Pass" }, { key: "isActive", header: "Active", render: (r) => (r.isActive ? "Yes" : "No") }],
  },
  topics: {
    label: "Chapters & topics",
    fields: [
      { name: "subjectId", label: "Subject", type: "select", required: true, lookup: "subjects" },
      { name: "name", label: "Topic name", required: true },
      { name: "chapterNo", label: "Chapter number", type: "number", def: 1 },
    ],
    columns: [{ key: "chapterNo", header: "Chapter" }, { key: "name", header: "Topic" }],
  },
  events: {
    label: "Calendar & holidays",
    fields: [
      { name: "title", label: "Title", required: true },
      { name: "eventType", label: "Type", type: "select", required: true, options: [{ value: "holiday", label: "Holiday" }, { value: "exam", label: "Examination" }, { value: "deadline", label: "Deadline" }, { value: "event", label: "Academic event" }] },
      { name: "eventDate", label: "Date", type: "date", required: true },
      { name: "endDate", label: "End date (optional)", type: "date" },
      { name: "description", label: "Description", type: "textarea" },
    ],
    columns: [{ key: "title", header: "Title" }, { key: "eventType", header: "Type", render: (r) => labelize(r.eventType) }, { key: "eventDate", header: "Date", render: (r) => formatDate(r.eventDate) }, { key: "endDate", header: "End", render: (r) => formatDate(r.endDate) }],
  },
};

export default function AcademicsPage() {
  const [tab, setTab] = useState<EntityId>("departments");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  return (
    <>
      <PageHeader title="Academic Setup" description="Departments, programmes, academic years, classes, subjects, topics and the academic calendar. Changes are audited." />
      {msg && <div className="mb-4"><Notice tone={msg.tone === "error" ? "error" : "success"}>{msg.text}</Notice></div>}
      <Tabs tabs={(Object.keys(CONFIG) as EntityId[]).map((id) => ({ id, label: CONFIG[id].label }))} active={tab} onChange={setTab} />
      <Entity key={tab} entity={tab} onMsg={setMsg} />
    </>
  );
}

function Entity({ entity, onMsg }: { entity: EntityId; onMsg: (m: { tone: "success" | "error"; text: string } | null) => void }) {
  const cfg = CONFIG[entity];
  const rows = useFetch<{ items: Row[] }>(`/api/academics/${entity}`);
  const lookups = {
    departments: useFetch<{ items: Row[] }>("/api/academics/departments"),
    courses: useFetch<{ items: Row[] }>("/api/academics/courses"),
    "academic-years": useFetch<{ items: Row[] }>("/api/academics/academic-years"),
    subjects: useFetch<{ items: Row[] }>("/api/academics/subjects"),
  };
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string | boolean>>({});

  const options = (lookup: string) => (lookups[lookup as keyof typeof lookups]?.data?.items ?? []).map((r: Row) => ({ value: String(r.id), label: r.code ? `${r.code} · ${r.name ?? r.label ?? ""}` : r.label ?? r.name ?? String(r.id) }));

  function openNew() {
    const init: Record<string, string | boolean> = {};
    cfg.fields.forEach((f) => (init[f.name] = f.def !== undefined ? (typeof f.def === "boolean" ? f.def : String(f.def)) : f.type === "checkbox" ? false : ""));
    setValues(init);
    setEditing(null);
    setOpen(true);
  }
  function openEdit(row: Row) {
    const init: Record<string, string | boolean> = {};
    cfg.fields.forEach((f) => {
      const v = row[f.name];
      init[f.name] = f.type === "checkbox" ? Boolean(v) : v === null || v === undefined ? "" : String(v);
    });
    setValues(init);
    setEditing(row);
    setOpen(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const f of cfg.fields) {
      const v = values[f.name];
      if (f.type === "checkbox") body[f.name] = Boolean(v);
      else if (f.type === "number") body[f.name] = v === "" || v === undefined ? undefined : Number(v);
      else if (f.type === "select" && f.name !== "eventType") body[f.name] = v === "" ? null : Number(v);
      else body[f.name] = v === "" ? null : v;
    }
    try {
      if (editing) await api(`/api/academics/${entity}`, { method: "PATCH", body: { id: editing.id, ...body } });
      else await api(`/api/academics/${entity}`, { body });
      onMsg({ tone: "success", text: `${cfg.label} ${editing ? "updated" : "created"}.` });
      setOpen(false);
      rows.reload();
      Object.values(lookups).forEach((l) => l.reload());
    } catch (err) {
      onMsg({ tone: "error", text: errorMessage(err) });
    }
  }

  async function remove(row: Row) {
    if (!confirm("Delete this record? This is only possible when nothing depends on it.")) return;
    try {
      await api(`/api/academics/${entity}?id=${row.id}`, { method: "DELETE" });
      onMsg({ tone: "success", text: "Record deleted." });
      rows.reload();
    } catch (err) {
      onMsg({ tone: "error", text: errorMessage(err) });
    }
  }

  return (
    <Card title={cfg.label} actions={<Button onClick={openNew}><Plus className="h-4 w-4" /> Add</Button>}>
      {rows.error && <Notice tone="error">{rows.error}</Notice>}
      <DataTable
        rows={rows.data?.items ?? []}
        rowKey={(r: Row) => r.id}
        empty={`No ${cfg.label.toLowerCase()} yet.`}
        columns={[
          ...cfg.columns.map((c) => ({ key: c.key, header: c.header, render: c.render ? (r: Row) => c.render!(r) : undefined })),
          { key: "actions", header: "", render: (r: Row) => (
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ) },
        ]}
      />
      <Modal open={open} onClose={() => setOpen(false)} title={`${editing ? "Edit" : "Add"} ${cfg.label.toLowerCase().replace(/s$/, "")}`} wide>
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
          {cfg.fields.map((f) => {
            const v = values[f.name];
            if (f.type === "checkbox") {
              return (
                <label key={f.name} className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={Boolean(v)} onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                  {f.label}
                </label>
              );
            }
            if (f.type === "textarea") return <Field key={f.name} label={f.label} className="md:col-span-2"><Textarea value={String(v ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} /></Field>;
            if (f.type === "select") {
              const opts = f.options ?? (f.lookup ? options(f.lookup) : []);
              return (
                <Field key={f.name} label={f.label}>
                  <Select required={f.required} value={String(v ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                    <option value="">{f.required ? "Select…" : "None"}</option>
                    {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </Field>
              );
            }
            return (
              <Field key={f.name} label={f.label}>
                <Input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} required={f.required} value={String(v ?? "")} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
              </Field>
            );
          })}
          <div className="flex justify-end gap-2 md:col-span-2">
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit">{editing ? "Save changes" : "Create"}</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
