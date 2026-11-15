import { z } from "zod";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { getSettings, setSettings } from "@/lib/settings";
import { audit } from "@/lib/events";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireUser();
  return jsonOk(await getSettings());
});

const schema = z.object({
  institutionName: z.string().trim().min(3).max(120).optional(),
  attendanceThresholdPct: z.number().min(0).max(100).optional(),
  passPercentage: z.number().min(0).max(100).optional(),
  riskThresholds: z
    .object({ low: z.number().min(0.01).max(0.99), high: z.number().min(0.01).max(0.99) })
    .refine((v) => v.low < v.high, { message: "The low-risk threshold must be below the high-risk threshold" })
    .optional(),
  masteryThresholds: z
    .object({
      needsImprovement: z.number().min(0).max(1),
      developing: z.number().min(0).max(1),
      proficient: z.number().min(0).max(1),
      minEvidence: z.number().int().min(1).max(50),
    })
    .refine((v) => v.needsImprovement < v.developing && v.developing < v.proficient, {
      message: "Mastery thresholds must increase: needs improvement < developing < proficient",
    })
    .optional(),
  gradingScale: z
    .array(z.object({ min: z.number().min(0).max(100), grade: z.string().trim().min(1).max(5), gpa: z.number().min(0).max(10) }))
    .min(2)
    .refine((g) => g.some((b) => b.min === 0), { message: "The grading scale needs a band starting at 0" })
    .optional(),
  gamificationEnabled: z.boolean().optional(),
  quizDefaultTimeSeconds: z.number().int().min(30).max(3600).optional(),
  quizDefaultQuestions: z.number().int().min(1).max(30).optional(),
});

export const PATCH = handle(async (req) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const body = await readJson(req, schema);
  if (body.gradingScale) body.gradingScale.sort((a, b) => b.min - a.min);
  if (Object.keys(body).length === 0) throw new ApiError(400, "No settings were provided");
  await setSettings(body as Record<string, never>, admin.id);
  await audit({ id: admin.id, role: admin.role }, "settings.update", "system_settings", null, body as Record<string, unknown>);
  return jsonOk(await getSettings());
});
