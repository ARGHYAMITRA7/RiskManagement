import { db } from "@/db";
import { reportLogs } from "@/db/schema";
import { ApiError, handle, paramNumber } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { assertStudentAccess } from "@/lib/access";
import { gatherReport, renderCsv, renderPdf, renderXlsx } from "@/lib/reports";
import { manageableClassIds } from "@/lib/api-helpers";
import { audit } from "@/lib/events";

export const dynamic = "force-dynamic";

/**
 * Downloadable reports (PDF, CSV, Excel).
 *  type=student     studentId=..   (student: own; guardian: linked; teacher/admin: access-checked)
 *  type=class       classId=..     (teacher: allocated classes; admin: any)
 *  type=risk        classId=?      (teacher/admin scope)
 *  type=institution                (administrator only)
 */
export const GET = handle(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const format = url.searchParams.get("format") ?? "pdf";
  if (!["student", "class", "risk", "institution"].includes(String(type))) throw new ApiError(400, "Unknown report type");
  if (!["pdf", "csv", "xlsx"].includes(format)) throw new ApiError(400, "Format must be pdf, csv or xlsx");

  let studentId: number | undefined;
  let classId: number | null = null;
  if (type === "student") {
    studentId = paramNumber(url.searchParams.get("studentId") ?? "", "studentId");
    await assertStudentAccess(user, studentId);
  } else if (type === "institution") {
    if (user.role !== "admin") throw new ApiError(403, "Institutional reports are available to administrators only");
  } else if (user.role === "student" || user.role === "guardian") {
    throw new ApiError(403, "This report is available to staff only");
  } else if (type === "class") {
    classId = paramNumber(url.searchParams.get("classId") ?? "", "classId");
    const scope = await manageableClassIds(user);
    if (scope !== "all" && !scope.includes(classId)) throw new ApiError(403, "You are not allocated to this class");
  } else {
    const q = url.searchParams.get("classId");
    classId = q ? paramNumber(q, "classId") : null;
    const scope = await manageableClassIds(user);
    if (classId && scope !== "all" && !scope.includes(classId)) throw new ApiError(403, "You are not allocated to this class");
  }

  const generatedBy = `${user.fullName} (${user.role})`;
  const report = await gatherReport(type as "student" | "class" | "risk" | "institution", { studentId, classId, generatedBy });
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${type}-report-${stamp}`;

  await db.insert(reportLogs).values({ userId: user.id, reportType: String(type), format, filters: { studentId, classId } });
  await audit({ id: user.id, role: user.role }, "report.generate", "report", null, { type, format, studentId, classId });

  if (format === "csv") {
    return new Response(renderCsv(report), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` },
    });
  }
  if (format === "xlsx") {
    const buf = await renderXlsx(report);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
      },
    });
  }
  const pdf = await renderPdf(report);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` },
  });
});
