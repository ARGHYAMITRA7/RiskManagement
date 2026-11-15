import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { ApiError } from "@/lib/http";

export const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

type Rule = { maxBytes: number; types: Record<string, string[]> };

/** Allow-lists per upload category: extension -> permitted MIME types. */
const RULES: Record<"avatar" | "document" | "spreadsheet", Rule> = {
  avatar: {
    maxBytes: 2 * 1024 * 1024,
    types: { jpg: ["image/jpeg"], jpeg: ["image/jpeg"], png: ["image/png"], webp: ["image/webp"] },
  },
  document: {
    maxBytes: 10 * 1024 * 1024,
    types: {
      pdf: ["application/pdf"],
      docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      txt: ["text/plain"],
      png: ["image/png"],
      jpg: ["image/jpeg"],
      jpeg: ["image/jpeg"],
    },
  },
  spreadsheet: {
    maxBytes: 5 * 1024 * 1024,
    types: {
      csv: ["text/csv", "application/vnd.ms-excel", "text/plain", "application/csv"],
      xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    },
  },
};

function matchesSignature(ext: string, buf: Buffer): boolean {
  switch (ext) {
    case "pdf":
      return buf.subarray(0, 4).toString("latin1") === "%PDF";
    case "png":
      return buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG";
    case "jpg":
    case "jpeg":
      return buf[0] === 0xff && buf[1] === 0xd8;
    case "webp":
      return buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
    case "docx":
    case "xlsx":
      return buf[0] === 0x50 && buf[1] === 0x4b; // ZIP container
    case "txt":
    case "csv":
      return !buf.includes(0);
    default:
      return false;
  }
}

/** Validates size, extension, declared MIME type and file signature, then stores the file under a random name. */
export async function saveUpload(
  file: File,
  category: keyof typeof RULES,
  folder: string,
): Promise<{ relPath: string; fileName: string; mimeType: string; size: number }> {
  const rule = RULES[category];
  if (file.size === 0) throw new ApiError(400, "The uploaded file is empty");
  if (file.size > rule.maxBytes) {
    throw new ApiError(413, `The file exceeds the ${Math.round(rule.maxBytes / (1024 * 1024))} MB limit`);
  }
  const original = path.basename(file.name || "upload").slice(0, 200);
  const ext = path.extname(original).slice(1).toLowerCase();
  const allowed = rule.types[ext];
  if (!allowed) throw new ApiError(415, `Files with the extension .${ext || "?"} are not allowed`);
  const mime = (file.type || "").toLowerCase();
  if (!allowed.includes(mime) && !(mime === "" && ext === "csv")) {
    throw new ApiError(415, `MIME type "${mime || "unknown"}" does not match the .${ext} extension`);
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!matchesSignature(ext, buffer)) throw new ApiError(415, "The file contents do not match its extension");

  const storedName = `${randomBytes(16).toString("hex")}.${ext}`;
  const relPath = path.posix.join(folder, storedName);
  const abs = path.join(UPLOAD_ROOT, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buffer);
  return { relPath, fileName: original, mimeType: mime || "application/octet-stream", size: buffer.length };
}

export async function readUpload(relPath: string): Promise<Buffer> {
  const normalized = path.posix.normalize(relPath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized) || normalized.includes("\0")) {
    throw new ApiError(400, "Invalid file path");
  }
  return readFile(path.join(UPLOAD_ROOT, normalized));
}

export function contentTypeFor(relPath: string): string {
  const ext = path.extname(relPath).slice(1).toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    txt: "text/plain; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return map[ext] ?? "application/octet-stream";
}
