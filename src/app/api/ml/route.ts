import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { academicOutcomes, modelVersions, students } from "@/db/schema";
import { ApiError, assertSameOrigin, handle, jsonOk, readJson } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/events";
import { trainRiskModel, getActiveModel } from "@/lib/ml/train";
import { FEATURE_META } from "@/lib/ml/features";

export const dynamic = "force-dynamic";

/** Model registry, dataset summary and evaluation results (administrators). */
export const GET = handle(async () => {
  await requireUser(["admin"]);
  const versions = await db
    .select({
      id: modelVersions.id,
      name: modelVersions.name,
      algorithm: modelVersions.algorithm,
      datasetSize: modelVersions.datasetSize,
      positiveCount: modelVersions.positiveCount,
      labelSource: modelVersions.labelSource,
      metrics: modelVersions.metrics,
      comparison: modelVersions.comparison,
      dataQuality: modelVersions.dataQuality,
      threshold: modelVersions.threshold,
      isActive: modelVersions.isActive,
      notes: modelVersions.notes,
      createdAt: modelVersions.createdAt,
    })
    .from(modelVersions)
    .orderBy(desc(modelVersions.createdAt))
    .limit(30);
  const outcomeRows = await db
    .select({ source: academicOutcomes.source, outcome: academicOutcomes.outcome, n: sql<number>`count(*)::int` })
    .from(academicOutcomes)
    .groupBy(academicOutcomes.source, academicOutcomes.outcome);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(students).where(eq(students.status, "active"));
  const active = await getActiveModel();
  return jsonOk({
    active: active ? { id: active.id, name: active.name, algorithm: active.algorithm, threshold: active.threshold, labelSource: active.labelSource } : null,
    versions,
    features: FEATURE_META,
    dataset: { activeStudents: Number(total), labels: outcomeRows },
  });
});

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("train"), notes: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("activate"), modelId: z.coerce.number().int().positive() }),
]);

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const admin = await requireUser(["admin"]);
  const body = await readJson(req, schema);
  if (body.action === "train") {
    const model = await trainRiskModel(admin.id, body.notes || undefined);
    await audit({ id: admin.id, role: admin.role }, "ml.train", "model_version", model.id, { algorithm: model.algorithm, datasetSize: model.datasetSize });
    return jsonOk({ id: model.id, name: model.name, algorithm: model.algorithm, metrics: model.metrics, comparison: model.comparison }, 201);
  }
  const [target] = await db.select().from(modelVersions).where(eq(modelVersions.id, body.modelId)).limit(1);
  if (!target) throw new ApiError(404, "Model version not found");
  await db.update(modelVersions).set({ isActive: false }).where(eq(modelVersions.isActive, true));
  await db.update(modelVersions).set({ isActive: true }).where(eq(modelVersions.id, body.modelId));
  await audit({ id: admin.id, role: admin.role }, "ml.activate", "model_version", body.modelId, {});
  return jsonOk({ ok: true, activeId: body.modelId });
});
