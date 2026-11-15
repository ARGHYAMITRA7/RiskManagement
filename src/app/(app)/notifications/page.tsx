"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { Badge, Button, Card, Loading, Notice, PageHeader, Tabs } from "@/components/ui";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDateTime, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Msg = { tone: "success" | "error"; text: string } | null;

export default function NotificationsPage() {
  const [tab, setTab] = useState<"inbox" | "prefs">("inbox");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const list = useFetch<{ items: Row[]; unread: number }>(`/api/notifications${unreadOnly ? "?unread=1" : ""}`);

  async function setRead(id: number, isRead: boolean) {
    try {
      await api("/api/notifications", { method: "PATCH", body: { id, isRead } });
      list.reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    }
  }
  async function readAll() {
    try {
      await api("/api/notifications", { method: "PATCH", body: { all: true } });
      setMsg({ tone: "success", text: "All notifications marked as read." });
      list.reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    }
  }

  return (
    <>
      <PageHeader title="Notifications" description="Assignments, deadlines, examinations, published results, attendance, risk alerts, recommendations, feedback and interventions. Email is optional and not required." actions={tab === "inbox" && <Button variant="secondary" onClick={readAll}><CheckCheck className="h-4 w-4" /> Mark all read</Button>} />
      {msg && <div className="mb-4"><Notice tone={msg.tone === "error" ? "error" : "success"}>{msg.text}</Notice></div>}
      <Tabs tabs={[{ id: "inbox", label: `Inbox${list.data?.unread ? ` (${list.data.unread} unread)` : ""}` }, { id: "prefs", label: "Preferences" }]} active={tab} onChange={setTab} />
      {tab === "inbox" ? (
        <Card>
          <div className="mb-4 flex gap-2">
            <Button variant={unreadOnly ? "secondary" : "primary"} size="sm" onClick={() => setUnreadOnly(false)}>All</Button>
            <Button variant={unreadOnly ? "primary" : "secondary"} size="sm" onClick={() => setUnreadOnly(true)}>Unread</Button>
          </div>
          {list.error && <Notice tone="error">{list.error}</Notice>}
          {list.loading && !list.data ? <Loading /> : (list.data?.items ?? []).length === 0 ? (
            <Notice tone="info">{unreadOnly ? "No unread notifications." : "You have no notifications yet."}</Notice>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-navy-800">
              {(list.data?.items ?? []).map((n: Row) => (
                <li key={n.id} className={`flex flex-wrap items-start justify-between gap-3 py-3 ${n.isRead ? "" : "bg-brand-500/5 dark:bg-navy-800/50"}`}>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">{!n.isRead && <span className="h-2 w-2 rounded-full bg-brand-500" aria-label="Unread" />}{n.title}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{n.message}</p>
                    <p className="mt-1 text-xs text-slate-500"><Badge value={n.category}>{labelize(n.category)}</Badge> · {formatDateTime(n.createdAt)}{n.link && <> · <Link href={n.link} className="text-brand-600 underline dark:text-cyan-300">Open</Link></>}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setRead(n.id, !n.isRead)}>{n.isRead ? "Mark unread" : "Mark read"}</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Preferences onMsg={setMsg} />
      )}
    </>
  );
}

function Preferences({ onMsg }: { onMsg: (m: Msg) => void }) {
  const prefs = useFetch<{ categories: string[]; preferences: Record<string, boolean> }>("/api/notifications?prefs=1");
  const [local, setLocal] = useState<Record<string, boolean> | null>(null);
  if (prefs.loading && !prefs.data) return <Loading />;
  const current = local ?? prefs.data?.preferences ?? {};
  async function save() {
    const categories = Object.fromEntries((prefs.data?.categories ?? []).map((c) => [c, current[c] !== false]));
    try {
      await api("/api/notifications", { method: "PUT", body: { categories } });
      onMsg({ tone: "success", text: "Preferences saved." });
      setLocal(null);
      prefs.reload();
    } catch (e) {
      onMsg({ tone: "error", text: errorMessage(e) });
    }
  }
  return (
    <Card title="Notification preferences" subtitle="Turn off categories you do not want delivered to your inbox. Critical account and approval messages are still required for some workflows.">
      <div className="grid gap-3 sm:grid-cols-2">
        {(prefs.data?.categories ?? []).map((c) => (
          <label key={c} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 dark:border-navy-700">
            <span className="flex items-center gap-2 text-sm">{current[c] === false ? <BellOff className="h-4 w-4 text-slate-400" /> : <Bell className="h-4 w-4 text-brand-600" />} {labelize(c)}</span>
            <input type="checkbox" className="h-4 w-4" checked={current[c] !== false} onChange={(e) => setLocal({ ...current, [c]: e.target.checked })} />
          </label>
        ))}
      </div>
      <div className="mt-4 flex justify-end"><Button onClick={save} disabled={local === null}>Save preferences</Button></div>
    </Card>
  );
}
