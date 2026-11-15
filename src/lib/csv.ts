import { ApiError } from "@/lib/http";

/** RFC-4180 style CSV parser (handles quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

/** Reads the first worksheet of an .xlsx file, or parses CSV text. Returns string cells. */
export async function parseTabular(buffer: Buffer, filename: string): Promise<string[][]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new ApiError(400, "The Excel file could not be read. Save it as .xlsx and try again.");
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new ApiError(400, "The Excel file contains no worksheet");
    const out: string[][] = [];
    ws.eachRow((row) => {
      const values = (row.values as unknown[]).slice(1).map((v) => {
        if (v === null || v === undefined) return "";
        if (typeof v === "object" && v !== null && "text" in v) return String((v as { text: unknown }).text);
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        return String(v);
      });
      if (values.some((v) => v.trim() !== "")) out.push(values);
    });
    return out;
  }
  if (lower.endsWith(".csv")) return parseCsv(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  throw new ApiError(415, "Only .csv and .xlsx files are supported");
}

export const STUDENT_IMPORT_COLUMNS = {
  required: ["full_name", "course_code", "semester"],
  optional: ["student_code", "class_code", "email", "phone", "guardian_name", "guardian_email", "guardian_phone", "daily_study_goal_minutes", "historical_outcome"],
};

export type ImportRowResult = {
  line: number;
  data: Record<string, string>;
  errors: string[];
  warnings: string[];
};

export type ImportReport = {
  headers: string[];
  missingColumns: string[];
  unknownColumns: string[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateCodesInFile: string[];
  existingCodesInDatabase: string[];
  missingValueCounts: Record<string, number>;
  rows: ImportRowResult[];
};

/**
 * Validates a student import table without touching the database except for the lookups supplied by the caller.
 * Rows with errors are reported and are never inserted.
 */
export function validateStudentTable(
  table: string[][],
  lookup: { courseCodes: Set<string>; classCodes: Set<string>; existingCodes: Set<string> },
): ImportReport {
  const [rawHeaders = [], ...body] = table;
  const headers = rawHeaders.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const known = new Set([...STUDENT_IMPORT_COLUMNS.required, ...STUDENT_IMPORT_COLUMNS.optional]);
  const missingColumns = STUDENT_IMPORT_COLUMNS.required.filter((c) => !headers.includes(c));
  const unknownColumns = headers.filter((h) => h && !known.has(h));
  const missingValueCounts: Record<string, number> = {};
  const codesInFile = new Map<string, number>();
  const rows: ImportRowResult[] = [];

  if (missingColumns.length > 0) {
    return {
      headers,
      missingColumns,
      unknownColumns,
      totalRows: body.length,
      validRows: 0,
      invalidRows: body.length,
      duplicateCodesInFile: [],
      existingCodesInDatabase: [],
      missingValueCounts,
      rows: [],
    };
  }

  body.forEach((cells, idx) => {
    const data: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) data[h] = (cells[i] ?? "").trim();
    });
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const req of STUDENT_IMPORT_COLUMNS.required) {
      if (!data[req]) errors.push(`${req} is required`);
    }
    if (data.course_code && !lookup.courseCodes.has(data.course_code)) errors.push(`Unknown course_code "${data.course_code}"`);
    if (data.class_code && !lookup.classCodes.has(data.class_code)) errors.push(`Unknown class_code "${data.class_code}"`);
    const sem = Number(data.semester);
    if (data.semester && (!Number.isInteger(sem) || sem < 1 || sem > 12)) errors.push("semester must be an integer between 1 and 12");
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push("email is not valid");
    if (data.guardian_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.guardian_email)) errors.push("guardian_email is not valid");
    if (data.daily_study_goal_minutes && (!/^\d+$/.test(data.daily_study_goal_minutes) || Number(data.daily_study_goal_minutes) > 600)) {
      errors.push("daily_study_goal_minutes must be a whole number up to 600");
    }
    if (data.historical_outcome && !["at_risk", "on_track"].includes(data.historical_outcome)) {
      errors.push("historical_outcome must be at_risk or on_track");
    }
    if (data.student_code) {
      codesInFile.set(data.student_code, (codesInFile.get(data.student_code) ?? 0) + 1);
      if (lookup.existingCodes.has(data.student_code)) errors.push(`student_code "${data.student_code}" already exists`);
    }
    for (const opt of STUDENT_IMPORT_COLUMNS.optional) {
      if (headers.includes(opt) && !data[opt]) {
        missingValueCounts[opt] = (missingValueCounts[opt] ?? 0) + 1;
        if (opt === "class_code" || opt === "historical_outcome") warnings.push(`${opt} is empty`);
      }
    }
    rows.push({ line: idx + 2, data, errors, warnings });
  });

  const duplicateCodesInFile = [...codesInFile.entries()].filter(([, c]) => c > 1).map(([code]) => code);
  for (const r of rows) {
    if (r.data.student_code && duplicateCodesInFile.includes(r.data.student_code)) {
      r.errors.push(`student_code "${r.data.student_code}" is duplicated in this file`);
    }
  }
  const existingCodesInDatabase = rows
    .map((r) => r.data.student_code)
    .filter((c): c is string => !!c && lookup.existingCodes.has(c));
  const invalid = rows.filter((r) => r.errors.length > 0).length;
  return {
    headers,
    missingColumns,
    unknownColumns,
    totalRows: rows.length,
    validRows: rows.length - invalid,
    invalidRows: invalid,
    duplicateCodesInFile,
    existingCodesInDatabase,
    missingValueCounts,
    rows,
  };
}
