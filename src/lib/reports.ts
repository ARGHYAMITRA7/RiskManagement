import { desc, eq, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "@/db";
import { earlyWarningAlerts, recommendations, riskPredictions, students, classes, auditLogs } from "@/db/schema";
import { adminDashboard, studentDashboard } from "@/lib/analytics";
import { getSettings, gradeFor } from "@/lib/settings";
import { getActiveModel } from "@/lib/ml/train";
import { buildFeatures } from "@/lib/ml/features";
import { labelize, round } from "@/lib/utils";
import { toCsv } from "@/lib/csv";

export type ReportSection = { heading: string; headers: string[]; rows: (string | number | null)[][] };
export type ReportData = {
  title: string;
  institution: string;
  generatedAt: string;
  generatedBy: string;
  scope: string;
  disclaimer: string;
  sections: ReportSection[];
};

const DISCLAIMER =
  "Risk and recommendation values are decision-support outputs. Demonstration models trained on synthetic labels do not establish real-world validity.";

const fmt = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? round(v, 2) : null;
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace("T", " ");
  return String(v);
};

function pct(marks: number | null, max: number): number | null {
  return marks === null || max <= 0 ? null : round((marks / max) * 100, 1);
}

async function studentReport(studentId: number, generatedBy: string): Promise<ReportData> {
  const settings = await getSettings();
  const dash = await studentDashboard(studentId);
  if (!dash) throw new Error("Student not found");
  const p = dash.profile;
  const recs = await db
    .select({ category: recommendations.category, title: recommendations.title, status: recommendations.status, effectiveness: recommendations.effectiveness })
    .from(recommendations)
    .where(eq(recommendations.studentId, studentId))
    .orderBy(desc(recommendations.createdAt))
    .limit(30);
  const latestRisk = dash.riskHistory[0];
  const explanation = latestRisk
    ? (await db.select({ e: riskPredictions.explanation }).from(riskPredictions).where(eq(riskPredictions.studentId, studentId)).orderBy(desc(riskPredictions.predictedAt)).limit(1))[0]?.e as
        | { riskIncreasingFactors?: { label: string; text: string }[]; protectiveFactors?: { label: string; text: string }[]; narrative?: string[] }
        | undefined
    : undefined;
  return {
    title: `Student Academic Report - ${p.full_name}`,
    institution: settings.institutionName,
    generatedAt: new Date().toISOString(),
    generatedBy,
    scope: `Student ${p.student_code}`,
    disclaimer: DISCLAIMER,
    sections: [
      {
        heading: "Profile",
        headers: ["Field", "Value"],
        rows: [
          ["Student ID", fmt(p.student_code)],
          ["Name", fmt(p.full_name)],
          ["Course", fmt(p.course_name)],
          ["Class", fmt(p.class_name)],
          ["Current semester", fmt(p.current_semester)],
          ["Overall attendance (%)", fmt(dash.attendance.overallPct)],
        ],
      },
      {
        heading: "Subject-wise marks",
        headers: ["Subject", "Exam", "Type", "Date", "Marks", "Max", "Percent", "Grade"],
        rows: dash.results.map((r) => {
          const pc = pct(r.marks_obtained === null ? null : Number(r.marks_obtained), Number(r.max_marks));
          return [
            fmt(`${r.subject_code} ${r.subject_name}`),
            fmt(r.exam_name),
            labelize(String(r.exam_type)),
            fmt(String(r.exam_date)),
            r.marks_obtained === null ? "Not entered" : fmt(Number(r.marks_obtained)),
            fmt(Number(r.max_marks)),
            fmt(pc),
            pc === null ? null : gradeFor(pc, settings.gradingScale).grade,
          ];
        }),
      },
      {
        heading: "Attendance by subject",
        headers: ["Subject", "Present", "Late", "Absent", "Excused", "Percentage"],
        rows: dash.attendance.bySubject.map((a) => {
          const present = Number(a.present) + Number(a.late);
          const marked = present + Number(a.absent);
          return [fmt(String(a.name)), Number(a.present), Number(a.late), Number(a.absent), Number(a.excused), marked ? fmt(round((present / marked) * 100, 1)) : null];
        }),
      },
      {
        heading: "Assignments",
        headers: ["Assignment", "Subject", "Deadline", "Submitted", "Late", "Marks"],
        rows: dash.assignments.map((a) => [
          fmt(String(a.title)),
          fmt(String(a.subject_name)),
          fmt(String(a.deadline)),
          a.submission_id ? "Yes" : "No",
          a.is_late ? "Yes" : "No",
          fmt(a.marks === null ? null : Number(a.marks)),
        ]),
      },
      {
        heading: "Practice quizzes",
        headers: ["Quiz", "Subject", "Percent", "Status", "Started"],
        rows: dash.quizHistory.map((q) => [fmt(String(q.title)), fmt(String(q.subject_name)), fmt(q.percentage === null ? null : Number(q.percentage)), fmt(String(q.status)), fmt(String(q.started_at))]),
      },
      {
        heading: "Risk assessment history",
        headers: ["Date", "Method", "Category", "Score", "Headline"],
        rows: dash.riskHistory.map((r) => [fmt(String(r.predictedAt)), labelize(r.method), labelize(r.riskCategory), r.riskScore, fmt(r.headline)]),
      },
      {
        heading: "Explainable AI findings",
        headers: ["Type", "Factor", "Observation"],
        rows: [
          ...(explanation?.riskIncreasingFactors ?? []).map((f) => ["Risk-increasing", f.label, f.text] as (string | null)[]),
          ...(explanation?.protectiveFactors ?? []).map((f) => ["Protective", f.label, f.text] as (string | null)[]),
          ...(explanation?.narrative ?? []).slice(0, 12).map((t) => ["Observation", null, t] as (string | null)[]),
        ],
      },
      {
        heading: "Recommendations",
        headers: ["Category", "Title", "Status", "Effectiveness (pts)"],
        rows: recs.map((r) => [labelize(r.category), fmt(r.title), labelize(r.status), fmt(r.effectiveness)]),
      },
      {
        heading: "Topic mastery",
        headers: ["Subject", "Topic", "Level", "Mastery (%)", "Attempted", "Trend"],
        rows: dash.mastery.map((m) => [fmt(String(m.subject)), fmt(String(m.topic)), labelize(String(m.level)), fmt(round(Number(m.mastery_score) * 100, 1)), Number(m.attempted), labelize(String(m.trend))]),
      },
      {
        heading: "Improvement history (exam percentages)",
        headers: ["Date", "Exam", "Percent"],
        rows: dash.progress.timeline.map((t) => [fmt(String(t.date)), fmt(t.label), fmt(t.pct)]),
      },
    ],
  };
}

async function classReport(classId: number, generatedBy: string): Promise<ReportData> {
  const settings = await getSettings();
  const [cls] = await db.select({ name: classes.name, code: classes.code }).from(classes).where(eq(classes.id, classId));
  const studentRows = await db
    .select({ id: students.id, code: students.studentCode, name: students.fullName })
    .from(students)
    .where(sql`class_id = ${classId} and status = 'active'`)
    .orderBy(students.studentCode);
  const ids = studentRows.map((s) => s.id);
  const feats = await buildFeatures(ids.length ? ids : [-1], settings.passPercentage);
  const latest = ids.length
    ? await db.execute(sql`select distinct on (student_id) student_id, risk_category, risk_score from risk_predictions where student_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) order by student_id, predicted_at desc`)
    : { rows: [] as Record<string, unknown>[] };
  const riskMap = new Map((latest.rows as { student_id: number; risk_category: string; risk_score: number }[]).map((r) => [r.student_id, r]));
  const alerts = ids.length
    ? await db
        .select({ studentId: earlyWarningAlerts.studentId })
        .from(earlyWarningAlerts)
        .where(sql`status <> 'resolved' and student_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
    : [];
  const alertCount = new Map<number, number>();
  for (const a of alerts) alertCount.set(a.studentId, (alertCount.get(a.studentId) ?? 0) + 1);

  const subjectRows = ids.length
    ? await db.execute(sql`
        select sub.code, sub.name, avg(er.marks_obtained * 100.0 / e.max_marks)::float as pct, count(*)::int as n
        from exam_results er join exams e on e.id = er.exam_id join subjects sub on sub.id = e.subject_id
        where er.marks_obtained is not null and er.student_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        group by sub.id, sub.code, sub.name order by sub.code`)
    : { rows: [] as Record<string, unknown>[] };

  const assignRows = await db.execute(sql`
    select a.title, sub.name as subject_name,
      (select count(*) from students st where st.class_id = a.class_id and st.status = 'active')::int as expected,
      (select count(*) from assignment_submissions x where x.assignment_id = a.id)::int as submitted
    from assignments a join subjects sub on sub.id = a.subject_id where a.class_id = ${classId} order by a.created_at desc limit 20`);

  return {
    title: `Class Performance Report - ${cls?.code ?? classId}`,
    institution: settings.institutionName,
    generatedAt: new Date().toISOString(),
    generatedBy,
    scope: `Class ${cls?.name ?? classId}`,
    disclaimer: DISCLAIMER,
    sections: [
      {
        heading: "Students",
        headers: ["Student ID", "Name", "Internal/mid average (%)", "Attendance (%)", "Missed assignments", "Quiz average (%)", "Risk", "Score", "Open alerts"],
        rows: studentRows.map((s) => {
          const v = feats.get(s.id)?.values ?? {};
          const r = riskMap.get(s.id);
          const perf = [v.internalPct, v.midPct].filter((x): x is number => typeof x === "number");
          return [
            s.code,
            s.name,
            perf.length ? round(perf.reduce((a, b) => a + b, 0) / perf.length, 1) : null,
            fmt(v.attendancePct ?? null),
            v.missedAssignments ?? null,
            fmt(v.quizAvgPct ?? null),
            r ? labelize(r.risk_category) : "Not assessed",
            r ? r.risk_score : null,
            alertCount.get(s.id) ?? 0,
          ];
        }),
      },
      {
        heading: "Subject performance",
        headers: ["Subject", "Average (%)", "Results"],
        rows: (subjectRows.rows as { code: string; name: string; pct: number; n: number }[]).map((r) => [`${r.code} ${r.name}`, round(Number(r.pct), 1), Number(r.n)]),
      },
      {
        heading: "Assignment statistics",
        headers: ["Assignment", "Subject", "Expected submissions", "Submitted", "Completion (%)"],
        rows: (assignRows.rows as { title: string; subject_name: string; expected: number; submitted: number }[]).map((a) => [
          a.title,
          a.subject_name,
          Number(a.expected),
          Number(a.submitted),
          Number(a.expected) ? round((Number(a.submitted) / Number(a.expected)) * 100, 1) : null,
        ]),
      },
    ],
  };
}

async function institutionReport(generatedBy: string): Promise<ReportData> {
  const settings = await getSettings();
  const dash = await adminDashboard();
  const model = await getActiveModel();
  const usage = await db
    .select({ action: auditLogs.action, n: sql<number>`count(*)::int` })
    .from(auditLogs)
    .groupBy(auditLogs.action)
    .orderBy(desc(sql`count(*)`))
    .limit(15);
  const cmp = (model?.comparison ?? []) as { model: string; selected: boolean; cvPooledF2: number | null; testRecall: number; testPrecision: number; testFpr: number; testRocAuc: number | null; testAccuracy: number }[];
  return {
    title: "Institutional Analytics Report",
    institution: settings.institutionName,
    generatedAt: new Date().toISOString(),
    generatedBy,
    scope: "Whole institution",
    disclaimer: DISCLAIMER,
    sections: [
      {
        heading: "Key indicators",
        headers: ["Indicator", "Value"],
        rows: [
          ["Active students", dash.totals.students],
          ["Archived students", dash.totals.archived],
          ["Teachers", dash.totals.teachers],
          ["Departments", dash.totals.departments],
          ["Courses", dash.totals.courses],
          ["Subjects", dash.totals.subjects],
          ["Average performance (%)", dash.totals.avgPerformance],
          ["Average attendance (%)", dash.totals.avgAttendance],
          ["Assignment completion (%)", dash.totals.assignmentCompletion],
          ["Pending interventions", dash.totals.pendingInterventions],
          ["Open early-warning alerts", dash.totals.openAlerts],
        ],
      },
      {
        heading: "Department performance",
        headers: ["Department", "Average (%)"],
        rows: dash.charts.departmentComparison.map((d) => [d.name, d.pct]),
      },
      {
        heading: "Semester comparison",
        headers: ["Semester", "Average (%)"],
        rows: dash.charts.semesterPerformance.map((s) => [s.semester, s.pct]),
      },
      {
        heading: "Risk distribution",
        headers: ["Category", "Students"],
        rows: [
          ["Low", dash.risk.distribution.low],
          ["Medium", dash.risk.distribution.medium],
          ["High", dash.risk.distribution.high],
          ["Improving", dash.risk.improving],
          ["Declining", dash.risk.declining],
        ],
      },
      {
        heading: "Attendance trend",
        headers: ["Month", "Attendance (%)"],
        rows: dash.charts.attendanceTrend.map((a) => [a.month, a.pct]),
      },
      {
        heading: "Recommendation effectiveness",
        headers: ["Category", "Total", "Completed", "Completion rate (%)", "Avg effectiveness (pts)", "Avg rating"],
        rows: dash.charts.recommendationEffectiveness.map((r) => [labelize(r.category), r.total, r.completed, r.completionRate, r.avgEffectiveness, r.avgRating]),
      },
      {
        heading: "ML model evaluation (test split)",
        headers: ["Model", "Selected", "CV pooled F2", "Test recall", "Test precision", "Test FPR", "Test ROC-AUC", "Test accuracy"],
        rows: cmp.length
          ? cmp.map((c) => [c.model, c.selected ? "Yes" : "No", c.cvPooledF2, c.testRecall, c.testPrecision, c.testFpr, c.testRocAuc, c.testAccuracy])
          : [["No trained model", "-", null, null, null, null, null, null]],
      },
      {
        heading: "System usage (audit events)",
        headers: ["Action", "Count"],
        rows: usage.map((u) => [labelize(u.action), u.n]),
      },
    ],
  };
}

async function riskReport(classId: number | null, generatedBy: string): Promise<ReportData> {
  const settings = await getSettings();
  const rows = await db.execute(sql`
    select st.student_code, st.full_name, c.name as class_name, p.risk_category, p.risk_score, p.method, p.suggested_intervention, p.predicted_at
    from (select distinct on (student_id) * from risk_predictions order by student_id, predicted_at desc) p
    join students st on st.id = p.student_id
    left join classes c on c.id = st.class_id
    where st.status = 'active' ${classId ? sql`and st.class_id = ${classId}` : sql``}
    order by p.risk_score desc`);
  return {
    title: "Academic Risk Distribution Report",
    institution: settings.institutionName,
    generatedAt: new Date().toISOString(),
    generatedBy,
    scope: classId ? `Class ${classId}` : "All accessible students",
    disclaimer: DISCLAIMER,
    sections: [
      {
        heading: "Students by latest assessment",
        headers: ["Student ID", "Name", "Class", "Risk", "Score", "Method", "Suggested intervention", "Assessed on"],
        rows: (rows.rows as Record<string, any>[]).map((r) => [
          String(r.student_code),
          String(r.full_name),
          fmt(r.class_name as string | null),
          labelize(String(r.risk_category)),
          Number(r.risk_score),
          labelize(String(r.method)),
          fmt(String(r.suggested_intervention)),
          fmt(r.predicted_at as Date),
        ]),
      },
    ],
  };
}

export async function gatherReport(
  type: "student" | "class" | "institution" | "risk",
  params: { studentId?: number; classId?: number | null; generatedBy: string; teacherId?: number },
): Promise<ReportData> {
  switch (type) {
    case "student":
      if (!params.studentId) throw new Error("studentId required");
      return studentReport(params.studentId, params.generatedBy);
    case "class":
      if (!params.classId) throw new Error("classId required");
      return classReport(params.classId, params.generatedBy);
    case "institution":
      return institutionReport(params.generatedBy);
    case "risk":
      return riskReport(params.classId ?? null, params.generatedBy);
  }
}

export function renderCsv(report: ReportData): string {
  const lines: string[] = [
    `# ${report.title}`,
    `# Institution: ${report.institution}`,
    `# Scope: ${report.scope}`,
    `# Generated: ${report.generatedAt} by ${report.generatedBy}`,
    `# ${report.disclaimer}`,
    "",
  ];
  let out = lines.join("\r\n") + "\r\n";
  for (const s of report.sections) {
    out += `## ${s.heading}\r\n`;
    out += toCsv(s.headers, s.rows);
    out += "\r\n";
  }
  return out;
}

export async function renderXlsx(report: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AI Student Risk & Recommendation System";
  wb.created = new Date();
  const summary = wb.addWorksheet("Summary");
  summary.addRows([
    [report.title],
    ["Institution", report.institution],
    ["Scope", report.scope],
    ["Generated", report.generatedAt],
    ["Generated by", report.generatedBy],
    [report.disclaimer],
  ]);
  summary.getColumn(1).width = 22;
  summary.getColumn(2).width = 70;
  summary.getRow(1).font = { bold: true, size: 14 };
  for (const s of report.sections) {
    const name = s.heading.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
    const ws = wb.addWorksheet(name || "Section");
    const header = ws.addRow(s.headers);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    for (const r of s.rows) ws.addRow(r);
    ws.columns.forEach((c) => {
      c.width = 24;
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const safe = (s: string) =>
  s
    .replace(/—|–/g, "-")
    .replace(/→/g, "->")
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");

export async function renderPdf(report: ReportData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  let page = pdf.addPage([W, H]);
  let y = H - 50;
  const navy = rgb(0.06, 0.16, 0.3);
  const grey = rgb(0.35, 0.4, 0.46);

  const ensure = (h: number) => {
    if (y - h < 50) {
      page = pdf.addPage([W, H]);
      y = H - 50;
    }
  };
  const line = (text: string, size = 9, f = font, color = rgb(0.1, 0.12, 0.15), x = 40) => {
    ensure(size + 4);
    page.drawText(safe(text), { x, y, size, font: f, color });
    y -= size + 4;
  };

  page.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: navy });
  page.drawText(safe(report.institution), { x: 40, y: H - 32, size: 11, font: bold, color: rgb(0.8, 0.93, 1) });
  page.drawText(safe(report.title), { x: 40, y: H - 52, size: 16, font: bold, color: rgb(1, 1, 1) });
  y = H - 95;
  line(`Scope: ${report.scope}`, 10, font, grey);
  line(`Generated: ${new Date(report.generatedAt).toUTCString()} by ${report.generatedBy}`, 9, font, grey);
  line(report.disclaimer, 8, font, grey);
  y -= 6;

  for (const s of report.sections) {
    ensure(40);
    y -= 6;
    line(s.heading, 12, bold, navy);
    const cols = Math.max(1, s.headers.length);
    const colW = (W - 80) / cols;
    const maxChars = Math.max(6, Math.floor(colW / 4.6));
    const drawRow = (cells: string[], f: typeof font, color = rgb(0.1, 0.12, 0.15)) => {
      ensure(14);
      cells.forEach((c, i) => {
        const t = safe(c).slice(0, maxChars);
        page.drawText(t, { x: 40 + i * colW, y, size: 8, font: f, color });
      });
      y -= 13;
    };
    drawRow(s.headers, bold, navy);
    if (s.rows.length === 0) line("No records.", 8, font, grey);
    for (const r of s.rows) {
      drawRow(r.map((v) => (v === null || v === undefined ? "-" : String(v))), font);
    }
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(safe(`${report.institution} | Page ${i + 1} of ${pages.length}`), { x: 40, y: 25, size: 7, font, color: grey });
  });
  return Buffer.from(await pdf.save());
}
