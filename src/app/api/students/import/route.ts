import { db } from "@/db";
import { academicOutcomes, classes, courses, students } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/events";
import { parseBody } from "@/lib/api-helpers";
import { parseTabular, validateStudentTable } from "@/lib/csv";
import { nextStudentCode, syncEnrolments } from "@/lib/students";

export const dynamic = "force-dynamic";

/**
 * Two-step CSV/Excel import.
 *  mode=preview -> parses, validates and reports (nothing is stored)
 *  mode=confirm -> stores VALID rows only, inside one transaction, and returns an import summary
 */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const { json, files } = await parseBody(req);
  const file = files.file;
  if (!(file instanceof File)) throw new ApiError(400, "Upload a .csv or .xlsx file");
  if (file.size > 5 * 1024 * 1024) throw new ApiError(413, "Import files must be 5 MB or smaller");
  const lower = file.name.toLowerCase();
  if (!(lower.endsWith(".csv") || lower.endsWith(".xlsx"))) throw new ApiError(415, "Only .csv and .xlsx files are supported");

  const table = await parseTabular(Buffer.from(await file.arrayBuffer()), file.name);
  if (table.length < 2) throw new ApiError(400, "The file must contain a header row and at least one data row");

  const courseRows = await db.select({ id: courses.id, code: courses.code }).from(courses);
  const classRows = await db.select({ id: classes.id, code: classes.code, courseId: classes.courseId, semester: classes.semester }).from(classes);
  const existing = await db.select({ code: students.studentCode }).from(students);
  const report = validateStudentTable(table, {
    courseCodes: new Set(courseRows.map((c) => c.code)),
    classCodes: new Set(classRows.map((c) => c.code)),
    existingCodes: new Set(existing.map((e) => e.code)),
  });

  const mode = json.mode === "confirm" ? "confirm" : "preview";
  const previewRows = report.rows.filter((r) => r.errors.length === 0).slice(0, 10).map((r) => r.data);
  if (mode === "preview") {
    return jsonOk({ mode, report: { ...report, rows: report.rows.slice(0, 200) }, previewRows });
  }

  const validRows = report.rows.filter((r) => r.errors.length === 0);
  if (validRows.length === 0) throw new ApiError(422, "No valid rows to import. Correct the errors and upload again.", { report: { ...report, rows: report.rows.slice(0, 200) } });

  const courseId = new Map(courseRows.map((c) => [c.code, c.id]));
  const classId = new Map(classRows.map((c) => [c.code, c]));
  let outcomesStored = 0;
  const createdCodes: string[] = [];
  await db.transaction(async (tx) => {
    for (const r of validRows) {
      const d = r.data;
      const cId = courseId.get(d.course_code)!;
      const sem = Number(d.semester);
      const cls = d.class_code ? classId.get(d.class_code) : undefined;
      const code = d.student_code || (await nextStudentCode("STU", tx));
      const [row] = await tx
        .insert(students)
        .values({
          studentCode: code,
          fullName: d.full_name,
          email: d.email || null,
          phone: d.phone || null,
          courseId: cId,
          classId: cls?.id ?? null,
          currentSemester: sem,
          guardianName: d.guardian_name || null,
          guardianPhone: d.guardian_phone || null,
          guardianEmail: d.guardian_email || null,
          dailyStudyGoalMinutes: d.daily_study_goal_minutes ? Number(d.daily_study_goal_minutes) : 60,
        })
        .returning({ id: students.id });
      createdCodes.push(code);
      await syncEnrolments(tx, row.id, cId, sem);
      if (d.historical_outcome) {
        await tx.insert(academicOutcomes).values({
          studentId: row.id,
          semester: sem,
          outcome: d.historical_outcome,
          source: "institutional",
        });
        outcomesStored++;
      }
    }
  });
  const summary = {
    fileName: file.name,
    totalRows: report.totalRows,
    imported: createdCodes.length,
    skippedInvalid: report.invalidRows,
    duplicatesInFile: report.duplicateCodesInFile,
    institutionalOutcomesStored: outcomesStored,
    missingValueCounts: report.missingValueCounts,
  };
  await audit({ id: admin.id, role: admin.role }, "students.import", "student", null, summary);
  return jsonOk({ mode, summary, createdCodes: createdCodes.slice(0, 50) }, 201);
});
