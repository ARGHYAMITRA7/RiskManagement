"use client";

import Link from "next/link";
import { useState } from "react";
import { Radar } from "lucide-react";
import { Badge, Button, Card, DataTable, Loading, Notice, PageHeader, Select, fmtPct } from "@/components/ui";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDateTime, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export default function AlertsPage() {
  const [status, setStatus] = useState("active");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const params = new URLSearchParams({ status });
  if (severity) params.set("severity", severity);
  if (category) params.set("category", category);
  const { data, loading, error, reload } = useFetch<{ items: Row[]; counts: Record<string, number> }>(`/api/alerts?${params}`);

  async function act(id: number, action: "acknowledge" | "resolve" | "reopen") {
    try {
      await api(`/api/alerts/${id}`, { method: "PATCH", body: { action } });
      setMsg({ tone: "success", text: `Alert ${action === "acknowledge" ? "acknowledged" : action === "resolve" ? "resolved (kept in history)" : "reopened"}.` });
      reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    }
  }

  async function scan() {
    setMsg({ tone: "info", text: "Scanning student records…" });
    try {
      const r = await api<{ scanned: number; created: number; resolved: number }>("/api/risk", { body: { action: "scan" } });
      setMsg({ tone: "success", text: `Scan complete: ${r.scanned} students checked, ${r.created} new alert(s), ${r.resolved} resolved automatically.` });
      reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    }
  }

  return (
    <>
      <PageHeader
        title="Early Warning System"
        description="Alerts for falling marks, declining attendance, repeated missed assignments, repeated quiz failures, reduced learning activity and subject-level deterioration."
        actions={<Button onClick={scan}><Radar className="h-4 w-4" /> Run scan now</Button>}
      />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {Object.entries(data?.counts ?? {}).map(([k, v]) => (
          <Card key={k}><p className="text-xs uppercase tracking-wide text-slate-500">{labelize(k)}</p><p className="text-2xl font-semibold">{v}</p></Card>
        ))}
      </div>
      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="active">Active (open & acknowledged)</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved (history)</option><option value="all">All</option></Select>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity"><option value="">Any severity</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category"><option value="">Any category</option><option value="falling_marks">Falling marks</option><option value="attendance_decline">Attendance decline</option><option value="missed_assignments">Missed assignments</option><option value="quiz_failures">Quiz failures</option><option value="reduced_activity">Reduced activity</option><option value="subject_deterioration">Subject deterioration</option></Select>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {loading && !data ? <Loading /> : (
          <DataTable rows={data?.items ?? []} rowKey={(r: Row) => r.id} empty="No alerts match these filters." columns={[
            { key: "full_name", header: "Student", render: (r: Row) => <Link className="font-medium text-brand-600 hover:underline dark:text-cyan-300" href={`/students/${r.student_id}`}>{r.full_name}</Link> },
            { key: "class_code", header: "Class" },
            { key: "category", header: "Category", render: (r: Row) => labelize(r.category) },
            { key: "severity", header: "Severity", render: (r: Row) => <Badge value={r.severity}>{labelize(r.severity)}</Badge> },
            { key: "title", header: "Alert & factors", render: (r: Row) => (
              <div className="max-w-md"><p className="font-medium">{r.title}</p><ul className="mt-1 list-disc pl-4 text-xs text-slate-500">{(r.factors ?? []).map((f: string, i: number) => <li key={i}>{f}</li>)}</ul><p className="mt-1 text-xs text-brand-700 dark:text-cyan-300">Action: {r.recommended_action}</p></div>
            ) },
            { key: "created_at", header: "Raised", render: (r: Row) => formatDateTime(r.created_at) },
            { key: "status", header: "Status", render: (r: Row) => <Badge value={r.status}>{labelize(r.status)}</Badge> },
            { key: "actions", header: "", render: (r: Row) => (
              <div className="flex flex-col gap-1">
                {r.status === "open" && <Button size="sm" variant="secondary" onClick={() => act(r.id, "acknowledge")}>Acknowledge</Button>}
                {r.status !== "resolved" && <Button size="sm" onClick={() => act(r.id, "resolve")}>Resolve</Button>}
                {r.status === "resolved" && <Button size="sm" variant="ghost" onClick={() => act(r.id, "reopen")}>Reopen</Button>}
              </div>
            ) },
          ]} />
        )}
      </Card>
      <p className="mt-4 text-xs text-slate-500">Alerts prompt human review. They are not disciplinary records. Average attendance threshold reference: {fmtPct(null)}.</p>
    </>
  );
}
