"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LogIn } from "lucide-react";
import { AuthShell } from "@/components/AuthShell";
import { Button, Field, Input, Notice } from "@/components/ui";
import { api, errorMessage } from "@/lib/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ redirect: string }>("/api/auth/login", { body: { email, password } });
      router.push(res.redirect);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Use your institutional email and password. Accounts are locked for 15 minutes after five failed attempts."
      footer={
        <div className="flex flex-col gap-2">
          <p>
            New student or guardian? <Link href="/register" className="font-medium text-brand-600 hover:underline dark:text-cyan-300">Request an account</Link>
          </p>
          <p>
            Forgot your password? <Link href="/forgot-password" className="font-medium text-brand-600 hover:underline dark:text-cyan-300">Reset it</Link>
          </p>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Email address">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@institution.edu" />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>
          <LogIn className="h-4 w-4" /> {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
