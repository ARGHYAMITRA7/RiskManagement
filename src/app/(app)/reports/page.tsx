"use client";

import { useState } from "react";
import { Download, FileBarChart } from "lucide-react";
import { Button, Card, Field, Loading, Notice, PageHeader, Select } from "@/components/ui";
import { useFetch } from "@/lib/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/** Role-based report generator. Every download is access-checked by the server and logged. */
export default function ReportsPage() {
  const me = useFetch<{ user: { role: string; fullName: string }; profile: { studentId?: number; guardianId?: number } | null }>("/api/auth/me");
  const role = me.data?.user.role;
  const classes = useFetch<{ items: Row[] }>(role === "admin" || role === "teacher" ? "/api/academics/classes" : null);
  const students = useFetch<{ items: Row[] }>(role === "admin" || role === "teacher" ? "/api/students?pageSize=100&sort=name" : null);
  const linked = useFetch<{ linked: Row[] }>(role === "guardian" ? "/api/analytics" : null);
  const [classId, setClassId] = useState("");
  const [studentId, setStudentId] = useState("");
  if (!me.data) return me.error ? <Notice tone="error">{me.error}</Notice> : <Loading />;
  const formats = ["pdf", "csv", "xlsx"] as const;
  const link = (params: Record<string, string>) => `/api/reports?${new URLSearchParams(params).toString()}`;

  const Downloads = ({ params }: { params: Record<string, string> }) => (
    <div className="flex flex-wrap gap-2">
      {formats.map((f) => (
        <a key={f} href={link({ ...params, format: f })} className="inline-flex" download>
          <Button variant={f === "pdf" ? "primary" : "secondary"} size="sm"><Download className="h-3.5 w-3.5" /> {f.toUpperCase()}</Button>
        </a>
      ))}
    </div>
  );

  const ownStudentId = me.data.profile?.studentId;
  const guardianStudent = linked.data?.linked?.[0]?.id;

  return (
    <>
      <PageHeader title="Reports & Exports" description="Download PDF, CSV or Excel reports. Each report shows the generation date, the requester and the scope. Demonstration data is labelled SYNTHETIC." />
      <div className="grid gap-4 xl:grid-cols-2">
        {role === "student" && ownStudentId && (
          <Card title="My academic report" subtitle="Profile, marks, attendance, assignments, quizzes, risk explanation, recommendations and improvement history.">
            <Downloads params={{ type: "student", studentId: String(ownStudentId) }} />
          </Card>
        )}
        {role === "guardian" && (
          <Card title="Published student report" subtitle="Academic report for your approved linked student. Teacher observations are never included.">
            {guardianStudent ? <Downloads params={{ type: "student", studentId: String(guardianStudent) }} /> : <Notice tone="info">No approved student link yet.</Notice>}
          </Card>
        )}
        {(role === "admin" || role === "teacher") && (
          <>
            <Card title="Student report" subtitle="Select a student in your scope">
              <div className="space-y-3">
                <Field label="Student"><Select value={studentId} onChange={(e) => setStudentId(e.target.value)}><option value="">Select student</option>{(students.data?.items ?? []).map((s: Row) => <option key={s.id} value={s.id}>{s.student_code} · {s.full_name}</option>)}</Select></Field>
                {studentId ? <Downloads params={{ type: "student", studentId }} /> : <p className="text-xs text-slate-500">Choose a student to enable downloads.</p>}
              </div>
            </Card>
            <Card title="Class performance report" subtitle="Students, averages, attendance, missed assignments, risk and alert counts for a class">
              <div className="space-y-3">
                <Field label="Class"><Select value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">Select class</option>{(classes.data?.items ?? []).map((c: Row) => <option key={c.id} value={c.id}>{c.code}</option>)}</Select></Field>
                {classId ? <Downloads params={{ type: "class", classId }} /> : <p className="text-xs text-slate-500">Choose a class to enable downloads.</p>}
              </div>
            </Card>
            <Card title="Risk distribution report" subtitle="Latest risk category, score, method and suggested intervention for each student in scope">
              <div className="space-y-3">
                <Field label="Class (optional)"><Select value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">All students in scope</option>{(classes.data?.items ?? []).map((c: Row) => <option key={c.id} value={c.id}>{c.code}</option>)}</Select></Field>
                <Downloads params={classId ? { type: "risk", classId } : { type: "risk" }} />
              </div>
            </Card>
          </>
        )}
        {role === "admin" && (
          <Card title="Institutional analytics report" subtitle="Key indicators, department performance, semester comparison, risk distribution, attendance trend, recommendation effectiveness, ML evaluation and system usage.">
            <Downloads params={{ type: "institution" }} />
          </Card>
        )}
      </div>
      <div className="mt-6 flex items-center gap-2 text-xs text-slate-500"><FileBarChart className="h-4 w-4" /> Reports are generated from live data at the time of download and recorded in the audit log.</div>
    </>
  );
}
