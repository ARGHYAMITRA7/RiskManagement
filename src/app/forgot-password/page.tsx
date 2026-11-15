"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Button, Field, Input, Notice } from "@/components/ui";
import { api, errorMessage } from "@/lib/client";

/** Requests a reset link, or (when opened from a link) sets a new password. Works without email delivery. */
export default function ForgotPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
  }, []);

  async function requestLink(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string; resetLink?: string }>("/api/auth/password", { body: { action: "forgot", email } });
      setMessage(res.message);
      setLink(res.resetLink ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string }>("/api/auth/password", { body: { action: "reset", token, password } });
      setMessage(res.message);
      setToken(null);
      setPassword("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={token ? "Choose a new password" : "Reset your password"}
      subtitle={token ? "Reset links expire after 30 minutes and can be used once." : "Enter your account email. Email delivery is optional; when it is not configured the reset link is shown here."}
      footer={<p>Remembered it? <Link href="/login" className="font-medium text-brand-600 hover:underline dark:text-cyan-300">Back to sign in</Link></p>}
    >
      <div className="space-y-5">
        {error && <Notice tone="error">{error}</Notice>}
        {message && <Notice tone="success">{message}</Notice>}
        {link && (
          <Notice tone="info">
            Email delivery is not configured. Open this link to continue: <Link className="font-medium underline" href={link}>{link}</Link>
          </Notice>
        )}
        {token ? (
          <form onSubmit={reset} className="space-y-5">
            <Field label="New password" hint="At least 8 characters, including a letter and a number.">
              <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <Button type="submit" className="w-full" disabled={busy}>Set new password</Button>
          </form>
        ) : (
          <form onSubmit={requestLink} className="space-y-5">
            <Field label="Email address"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Button type="submit" className="w-full" disabled={busy}>Request reset link</Button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
