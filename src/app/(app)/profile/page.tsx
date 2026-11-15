"use client";

import { useState, type FormEvent } from "react";
import { Camera, KeyRound, Save } from "lucide-react";
import { Button, Card, Field, Input, Loading, Notice, PageHeader, DataTable, Badge } from "@/components/ui";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDateTime, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Msg = { tone: "success" | "error"; text: string } | null;

export default function ProfilePage() {
  const me = useFetch<Row>("/api/auth/me");
  const history = useFetch<{ history: Row[] }>("/api/auth/me?history=1");
  const [msg, setMsg] = useState<Msg>(null);
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  if (me.loading && !me.data) return <Loading />;
  if (me.error) return <Notice tone="error">{me.error}</Notice>;
  const u = me.data?.user;
  if (!u) return null;

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/api/auth/me", { method: "PATCH", body: { fullName: name ?? u.fullName, phone: phone ?? me.data?.phone ?? "" } });
      setMsg({ tone: "success", text: "Profile updated." });
      setName(null);
      setPhone(null);
      me.reload();
    } catch (err) {
      setMsg({ tone: "error", text: errorMessage(err) });
    }
  }

  async function uploadAvatar(file: File) {
    const form = new FormData();
    form.append("avatar", file);
    try {
      await api("/api/users/avatar", { form });
      setMsg({ tone: "success", text: "Profile image updated." });
      me.reload();
    } catch (err) {
      setMsg({ tone: "error", text: errorMessage(err) });
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) return setMsg({ tone: "error", text: "The new passwords do not match." });
    setBusy(true);
    try {
      await api("/api/auth/password", { body: { action: "change", currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      setMsg({ tone: "success", text: "Password changed. Use the new password the next time you sign in." });
    } catch (err) {
      setMsg({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Profile & Security" description="Update your details, profile image and password, and review recent sign-in activity." />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Profile">
          <div className="flex items-center gap-4">
            {u.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={u.avatarUrl} alt="Profile" className="h-20 w-20 rounded-2xl object-cover" />
            ) : (
              <span className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-cyan-400 text-2xl font-semibold text-white">{u.fullName.slice(0, 1)}</span>
            )}
            <div>
              <p className="font-semibold">{u.fullName}</p>
              <p className="text-sm text-slate-500">{u.email}</p>
              <Badge value="active">{labelize(u.role)}</Badge>
              <label className="mt-2 inline-flex cursor-pointer items-center gap-1 text-xs text-brand-600 underline dark:text-cyan-300">
                <Camera className="h-3.5 w-3.5" /> Change image (JPG, PNG or WEBP, 2 MB)
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
              </label>
            </div>
          </div>
          <form onSubmit={saveProfile} className="mt-5 space-y-3">
            <Field label="Full name"><Input value={name ?? u.fullName} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Phone"><Input value={phone ?? me.data?.phone ?? ""} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Button type="submit" className="w-full"><Save className="h-4 w-4" /> Save profile</Button>
          </form>
          {me.data?.profile && (
            <dl className="mt-5 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 text-xs dark:border-navy-800">
              {Object.entries(me.data.profile).map(([k, v]) => (
                <div key={k}><dt className="text-slate-500">{labelize(k)}</dt><dd className="font-medium">{String(v ?? "—")}</dd></div>
              ))}
            </dl>
          )}
          <p className="mt-4 text-xs text-slate-500">Member since {formatDateTime(me.data?.memberSince)} · Last sign-in {formatDateTime(me.data?.lastLoginAt)}</p>
        </Card>

        <Card title="Change password" subtitle="At least 8 characters with letters and numbers. Cannot contain your email name.">
          <form onSubmit={changePassword} className="space-y-3">
            <Field label="Current password"><Input type="password" required autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
            <Field label="New password"><Input type="password" required minLength={8} autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
            <Field label="Confirm new password"><Input type="password" required minLength={8} autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
            <Button type="submit" className="w-full" disabled={busy}><KeyRound className="h-4 w-4" /> {busy ? "Updating…" : "Update password"}</Button>
          </form>
          <p className="mt-4 text-xs text-slate-500">Forgotten your password? Use <a className="underline" href="/forgot-password">Reset password</a> from the sign-in page.</p>
        </Card>

        <Card title="Sign-in history" subtitle="Successful and failed attempts on your account">
          <DataTable rows={history.data?.history ?? []} rowKey={(r: Row, i: number) => `${r.createdAt}-${i}`} empty="No sign-in events yet." columns={[
            { key: "createdAt", header: "When", render: (r: Row) => formatDateTime(r.createdAt) },
            { key: "success", header: "Result", render: (r: Row) => (r.success ? <Badge value="active">Success</Badge> : <Badge value="absent">Failed</Badge>) },
            { key: "reason", header: "Note", render: (r: Row) => labelize(r.reason) },
          ]} />
        </Card>
      </div>
    </>
  );
}
