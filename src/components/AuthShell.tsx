"use client";

import type { ReactNode } from "react";
import { BookOpen, ShieldCheck, Sparkles, LineChart } from "lucide-react";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-navy-950 via-navy-900 to-navy-700 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-brand-500/30 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-cyan-400">
            <BookOpen className="h-6 w-6" />
          </span>
          <div>
            <p className="text-lg font-semibold">Student Risk &amp; Recommendation</p>
            <p className="text-sm text-slate-300">Academic support, powered by explainable AI</p>
          </div>
        </div>
        <div className="relative space-y-6">
          <h2 className="text-4xl font-semibold leading-tight">Turn academic records into timely, explainable support.</h2>
          <ul className="space-y-4 text-slate-200">
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-cyan-300" /> Role-based access with object-level checks for students, teachers, guardians and administrators.</li>
            <li className="flex gap-3"><LineChart className="mt-0.5 h-5 w-5 text-cyan-300" /> Risk estimates with the factors behind each result, and an honest rule-based fallback.</li>
            <li className="flex gap-3"><Sparkles className="mt-0.5 h-5 w-5 text-cyan-300" /> Personalised recommendations, adaptive quizzes and a study planner that adjusts to mastery.</li>
          </ul>
        </div>
        <p className="relative text-xs text-slate-400">Predictions are decision-support estimates. Demonstration data is synthetic and labelled as such.</p>
      </aside>
      <main className="flex items-center justify-center bg-slate-50 px-6 py-12 dark:bg-navy-950">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <p className="text-sm font-semibold text-brand-600 dark:text-cyan-300">Student Risk &amp; Recommendation</p>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-navy-900 dark:text-white">{title}</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 border-t border-slate-200 pt-6 text-sm text-slate-600 dark:border-navy-800 dark:text-slate-400">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
