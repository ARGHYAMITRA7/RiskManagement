"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { api, errorMessage } from "@/lib/client";

export default function RegisterPage() {
  const [form, setForm] = useState({ role: "student", fullName: "", email: "", password: "", studentCode: "", relation: "Parent" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string }>("/api/auth/register", { body: form });
      setDone(res.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Request an account"
      subtitle="Your account is linked to an existing student record and must be approved by the administration office before you can sign in."
      footer={<p>Already approved? <Link href="/login" className="font-medium text-brand-600 hover:underline dark:text-cyan-300">Sign in</Link></p>}
    >
      {done ? (
        <Notice tone="success">{done}</Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="I am a">
              <Select value={form.role} onChange={set("role")}>
                <option value="student">Student</option>
                <option value="guardian">Parent / guardian</option>
              </Select>
            </Field>
            <Field label="Student ID" hint="Provided by the institution">
              <Input required value={form.studentCode} onChange={set("studentCode")} placeholder="e.g. STU20260001" />
            </Field>
          </div>
          <Field label="Full name"><Input required value={form.fullName} onChange={set("fullName")} /></Field>
          {form.role === "guardian" && (
            <Field label="Relationship"><Input value={form.relation} onChange={set("relation")} /></Field>
          )}
          <Field label="Email address"><Input type="email" required value={form.email} onChange={set("email")} /></Field>
          <Field label="Password" hint="At least 8 characters with letters and numbers.">
            <Input type="password" required minLength={8} value={form.password} onChange={set("password")} autoComplete="new-password" />
          </Field>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Submitting…" : "Submit request"}</Button>
        </form>
      )}
    </AuthShell>
  );
}
