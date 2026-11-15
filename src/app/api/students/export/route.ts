import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ApiError, handle } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { accessibleStudentIds } from "@/lib/access";
import { toCsv } from "@/lib/csv";
import { audit } from "@/lib/events";
import ExcelJS from "exceljs";

export const dynamic = "force-dynamic";

/** Bulk export of the caller's visible student list as CSV or Excel. */
export const GET = handle(async (req) => {
  const user = await requireUser(["admin", "teacher"]);
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const scope = await accessibleStudentIds(user);
  if (scope !== "all" && scope.length === 0) throw new ApiError(404, "No students are visible to your account");
  const filter = scope === "all" ? sql`` : sql`where s.id in (${sql.join((scope as number[]).map((i) => sql`${i}`), sql`, `)})`;
  const res = await db.execute(sql`
    select s.student_code, s.full_name, s.email, s.phone, co.code as course_code, c.code as class_code, s.current_semester, s.status,
           s.guardian_name, s.guardian_email, r.risk_category, r.risk_score
    from students s
    left join courses co on co.id = s.course_id
    left join classes c on c.id = s.class_id
    left join lateral (select p.risk_category, p.risk_score from risk_predictions p where p.student_id = s.id order by p.predicted_at desc limit 1) r on true
    ${filter}
    order by s.student_code`);
  const headers = ["student_code", "full_name", "email", "phone", "course_code", "class_code", "current_semester", "status", "guardian_name", "guardian_email", "risk_category", "risk_score"];
  const rows = (res.rows as Record<string, unknown>[]).map((r) => headers.map((h) => (r[h] as string | number | null) ?? null));
  await audit({ id: user.id, role: user.role }, "students.export", "student", null, { format, rows: rows.length });
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    return new Response(toCsv(headers, rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="students-${stamp}.csv"` },
    });
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Students");
  ws.addRow(headers).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="students-${stamp}.xlsx"`,
    },
  });
});
