"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Bell, BookOpen, CalendarDays, ClipboardCheck, FileBarChart, FileText, Gauge, GraduationCap, Home, Layers, LogOut, Menu, MessageSquare, Moon, Settings, ShieldCheck, Sun, Target, UserCircle, Users, X, Brain, AlertTriangle, Library, ClipboardList, BookMarked, Sparkles } from "lucide-react";
import { api } from "@/lib/client";
import { labelize } from "@/lib/utils";

export type ShellUser = { id: number; fullName: string; email: string; role: string; avatarUrl: string | null };

type NavItem = { href: string; label: string; icon: typeof Home };

const NAV: Record<string, NavItem[]> = {
  admin: [
    { href: "/admin", label: "Dashboard", icon: Gauge },
    { href: "/students", label: "Students", icon: Users },
    { href: "/admin/people", label: "People & Accounts", icon: ShieldCheck },
    { href: "/admin/academics", label: "Academic Setup", icon: Layers },
    { href: "/attendance", label: "Attendance", icon: ClipboardCheck },
    { href: "/exams", label: "Examinations", icon: GraduationCap },
    { href: "/assignments", label: "Assignments", icon: ClipboardList },
    { href: "/quizzes", label: "Quizzes", icon: Brain },
    { href: "/alerts", label: "Early Warnings", icon: AlertTriangle },
    { href: "/admin/ml", label: "Risk & AI Models", icon: Sparkles },
    { href: "/interventions", label: "Interventions", icon: Target },
    { href: "/resources", label: "Resource Library", icon: Library },
    { href: "/timetable", label: "Timetable & Calendar", icon: CalendarDays },
    { href: "/discussions", label: "Discussions", icon: MessageSquare },
    { href: "/reports", label: "Reports", icon: FileBarChart },
    { href: "/admin/settings", label: "Settings & Audit", icon: Settings },
  ],
  teacher: [
    { href: "/teacher", label: "Dashboard", icon: Gauge },
    { href: "/students", label: "My Students", icon: Users },
    { href: "/attendance", label: "Attendance", icon: ClipboardCheck },
    { href: "/exams", label: "Examinations & Marks", icon: GraduationCap },
    { href: "/assignments", label: "Assignments", icon: ClipboardList },
    { href: "/quizzes", label: "Question Bank & Quizzes", icon: Brain },
    { href: "/alerts", label: "Early Warnings", icon: AlertTriangle },
    { href: "/interventions", label: "Interventions", icon: Target },
    { href: "/resources", label: "Resource Library", icon: Library },
    { href: "/timetable", label: "Timetable", icon: CalendarDays },
    { href: "/discussions", label: "Discussions", icon: MessageSquare },
    { href: "/reports", label: "Reports", icon: FileBarChart },
  ],
  student: [
    { href: "/student", label: "My Dashboard", icon: Gauge },
    { href: "/student/learning", label: "Learning Plan & AI", icon: Sparkles },
    { href: "/attendance", label: "Attendance", icon: ClipboardCheck },
    { href: "/exams", label: "Exams & Results", icon: GraduationCap },
    { href: "/assignments", label: "Assignments", icon: ClipboardList },
    { href: "/quizzes", label: "Adaptive Quizzes", icon: Brain },
    { href: "/resources", label: "Resource Library", icon: Library },
    { href: "/interventions", label: "My Support Plans", icon: Target },
    { href: "/timetable", label: "Timetable", icon: CalendarDays },
    { href: "/discussions", label: "Discussions", icon: MessageSquare },
    { href: "/reports", label: "My Reports", icon: FileText },
  ],
  guardian: [
    { href: "/guardian", label: "Student Overview", icon: Gauge },
    { href: "/reports", label: "Published Reports", icon: FileText },
  ],
};

const COMMON: NavItem[] = [
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/profile", label: "Profile & Security", icon: UserCircle },
];

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [dark, setDark] = useState(false);
  const items = [...(NAV[user.role] ?? []), ...COMMON];

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    api<{ unreadNotifications: number }>("/api/auth/me")
      .then((r) => setUnread(r.unreadNotifications))
      .catch(() => setUnread(0));
  }, [pathname]);

  useEffect(() => setOpen(false), [pathname]);

  const toggleTheme = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* storage may be unavailable */
    }
    setDark(next);
  };

  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  };

  const nav = (
    <nav className="flex flex-col gap-1 px-3" aria-label="Main navigation">
      {items.map((item) => {
        const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/")) || (item.href !== "/admin" && item.href !== "/teacher" && item.href !== "/student" && item.href !== "/guardian" && pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${active ? "bg-white/15 text-white shadow-inner" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}
            aria-current={active ? "page" : undefined}
          >
            <Icon className={`h-4 w-4 ${active ? "text-cyan-300" : "text-slate-400 group-hover:text-cyan-300"}`} />
            <span className="truncate">{item.label}</span>
            {item.href === "/notifications" && unread > 0 && (
              <span className="ml-auto rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-semibold text-white">{unread}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const current = items.find((i) => pathname === i.href || pathname.startsWith(i.href + "/")) ?? items[0];

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col overflow-y-auto bg-gradient-to-b from-navy-950 via-navy-900 to-navy-800 py-5 text-white lg:flex scroll-thin">
        <div className="mb-6 px-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-cyan-400 shadow-lg shadow-brand-600/30">
              <BookOpen className="h-5 w-5 text-white" />
            </span>
            <div>
              <p className="text-sm font-semibold leading-tight">Risk & Recommendation</p>
              <p className="text-[11px] text-slate-400">AI academic support</p>
            </div>
          </div>
        </div>
        {nav}
        <div className="mt-auto px-5 pt-6 text-[11px] text-slate-500">Demonstration data is labelled SYNTHETIC.</div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-navy-950/70" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-gradient-to-b from-navy-950 to-navy-800 py-5 text-white scroll-thin">
            <div className="mb-4 flex items-center justify-between px-5">
              <p className="font-semibold">Menu</p>
              <button onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200/80 bg-white/85 px-4 py-3 backdrop-blur dark:border-navy-700/60 dark:bg-navy-900/85 sm:px-6">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-navy-800 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">{labelize(user.role)} workspace</p>
              <p className="text-sm font-semibold text-navy-900 dark:text-white">{current?.label ?? "Dashboard"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 dark:border-navy-700 dark:text-slate-300 dark:hover:bg-navy-800" aria-label="Toggle dark mode">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Link href="/notifications" className="relative rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 dark:border-navy-700 dark:text-slate-300 dark:hover:bg-navy-800" aria-label={`Notifications, ${unread} unread`}>
              <Bell className="h-4 w-4" />
              {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">{unread}</span>}
            </Link>
            <Link href="/profile" className="hidden items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-1.5 hover:bg-slate-50 dark:border-navy-700 dark:hover:bg-navy-800 sm:flex">
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{user.fullName.slice(0, 1)}</span>
              )}
              <span className="text-left">
                <span className="block text-xs font-medium text-slate-800 dark:text-slate-100">{user.fullName}</span>
                <span className="block text-[10px] text-slate-500 dark:text-slate-400">{user.email}</span>
              </span>
            </Link>
            <button onClick={logout} className="inline-flex items-center gap-2 rounded-xl bg-navy-900 px-3 py-2 text-xs font-medium text-white hover:bg-navy-800 dark:bg-brand-600 dark:hover:bg-brand-500">
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
        <footer className="px-6 pb-8 text-center text-xs text-slate-500 dark:text-slate-500">
          AI Student Digital Learning Risk &amp; Adaptive Recommendation System · Predictions are decision-support estimates, not certainties.
        </footer>
      </div>
    </div>
  );
}
