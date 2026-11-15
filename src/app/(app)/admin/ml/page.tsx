"use client";

import { useState } from "react";
import { Brain, PlayCircle, Radar, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, DataTable, Field, Loading, Notice, PageHeader, StatCard, Textarea, fmtPct } from "@/components/ui";
import { BarChartCard, TrendChart } from "@/components/charts";
import { api, errorMessage, useFetch } from "@/lib/client";
import { formatDateTime, labelize } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export default function MlPage() {
  const { data, error, loading, reload } = useFetch<Row>("/api/ml");
  const [selected, setSelected] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading label="Loading model registry…" />;
  if (error) return <Notice tone="error">{error}</Notice>;
  const versions: Row[] = data?.versions ?? [];
  const current: Row | null = versions.find((v) => v.id === selected) ?? versions.find((v) => v.isActive) ?? versions[0] ?? null;

  async function run(action: () => Promise<Row>, ok: (r: Row) => string) {
    setBusy(true);
    setMsg({ tone: "info", text: "Working… this can take a few seconds." });
    try {
      const r = await action();
      setMsg({ tone: "success", text: ok(r) });
      reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const m = current?.metrics ?? {};
  const cm = m.confusionMatrix;
  const quality = current?.dataQuality ?? {};
  const missing = Object.entries(quality.missingRateByFeature ?? {}).map(([k, v]) => ({ feature: labelize(k), rate: Math.round(Number(v) * 1000) / 10 }));
  const importance = current?.params?.permutationImportance ?? [];
  const cvResults = current?.params?.cvResults ?? [];

  return (
    <>
      <PageHeader
        title="Risk & AI Models"
        description="Train and compare the risk models, inspect evaluation results and data quality, activate a model version, and run assessments."
        actions={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => run(() => api("/api/risk", { body: { action: "scan" } }), (r) => `Early-warning scan complete: ${r.created} new alert(s), ${r.resolved} resolved, ${r.scanned} students scanned.`)}>
              <Radar className="h-4 w-4" /> Run early-warning scan
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => run(() => api("/api/risk", { body: { action: "assess" } }), (r) => `Assessed ${r.count} students using ${labelize(r.method)}. High: ${r.byCategory.high}, medium: ${r.byCategory.medium}, low: ${r.byCategory.low}.`)}>
              <PlayCircle className="h-4 w-4" /> Run risk assessments
            </Button>
          </>
        }
      />
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active model" value={data?.active ? labelize(data.active.algorithm) : "None (rule screening)"} hint={data?.active?.name ?? "Train a model to enable ML risk estimates"} tone="cyan" />
        <StatCard label="Active students" value={data?.dataset?.activeStudents ?? 0} hint="Eligible for assessment" />
        <StatCard label="Labelled outcomes" value={(data?.dataset?.labels ?? []).reduce((a: number, r: Row) => a + r.n, 0)} hint={(data?.dataset?.labels ?? []).map((r: Row) => `${labelize(r.source)} ${labelize(r.outcome)}: ${r.n}`).join(" · ") || "None"} tone="amber" />
        <StatCard label="Label source (active)" value={data?.active ? labelize(data.active.labelSource) : "—"} hint={data?.active?.labelSource === "synthetic-demo" ? "Demonstration only: no real-world validity" : "Institutional labels"} tone="slate" />
      </div>

      {data?.active?.labelSource === "synthetic-demo" && (
        <div className="mt-4"><Notice tone="warning"><strong>Demonstration model.</strong> It was trained on SYNTHETIC outcome labels. The metrics below verify the pipeline and must not be presented as real-world predictive accuracy. Train on validated institutional outcome labels (import them with the historical_outcome column) before operational use.</Notice></div>
      )}

      <Card className="mt-6" title="Train a new model version" subtitle="Stratified 80/20 split · 5-fold CV for hyperparameters · class-balanced loss · preprocessing fitted on training data only · selection by cross-validated F2 (recall-weighted).">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Notes (optional)" className="md:col-span-2"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Describe the dataset, labels and purpose of this training run" /></Field>
          <div className="flex items-end"><Button className="w-full" disabled={busy} onClick={() => run(() => api("/api/ml", { body: { action: "train", notes: notes || undefined } }), (r) => `Trained ${r.name} (${labelize(r.algorithm)}). Test recall ${fmtPct((r.metrics?.recall ?? 0) * 100)}, ROC-AUC ${r.metrics?.rocAuc ?? "n/a"}.`)}><Brain className="h-4 w-4" /> Train models</Button></div>
        </div>
      </Card>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1" title="Model versions" subtitle="Select a version to inspect; activate one to use it for predictions.">
          <DataTable rows={versions} rowKey={(r: Row) => r.id} empty="No model has been trained yet." columns={[
            { key: "name", header: "Version", render: (r: Row) => <button className="text-left font-mono text-xs text-brand-600 underline dark:text-cyan-300" onClick={() => setSelected(r.id)}>{r.name}</button> },
            { key: "algorithm", header: "Algorithm", render: (r: Row) => labelize(r.algorithm) },
            { key: "isActive", header: "Status", render: (r: Row) => (r.isActive ? <Badge value="active">Active</Badge> : <Button size="sm" variant="ghost" onClick={() => run(() => api("/api/ml", { body: { action: "activate", modelId: r.id } }), () => "Model version activated.")}>Activate</Button>) },
            { key: "createdAt", header: "Trained", render: (r: Row) => formatDateTime(r.createdAt) },
          ]} />
        </Card>
        <Card className="xl:col-span-2" title="Evaluation (held-out test split)" subtitle={current ? `${current.name} · threshold ${current.threshold} · ${current.datasetSize} labelled records (${current.positiveCount} at risk)` : ""}>
          {!current ? <Notice tone="info">No evaluation available yet.</Notice> : (
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard label="Accuracy" value={fmtPct((m.accuracy ?? 0) * 100)} />
              <StatCard label="Precision" value={fmtPct((m.precision ?? 0) * 100)} tone="cyan" />
              <StatCard label="Recall (at-risk)" value={fmtPct((m.recall ?? 0) * 100)} tone="green" hint="Prioritised metric" />
              <StatCard label="F1-score" value={fmtPct((m.f1 ?? 0) * 100)} tone="slate" />
              <StatCard label="ROC-AUC" value={m.rocAuc ?? "n/a"} tone="blue" />
              <StatCard label="False-positive rate" value={fmtPct((m.falsePositiveRate ?? 0) * 100)} tone="amber" />
              <StatCard label="Train ROC-AUC" value={m.trainRocAuc ?? "n/a"} hint={`Overfit gap ${m.overfitGapAuc ?? "n/a"}`} tone="slate" />
              <StatCard label="Test split" value={`${m.splitSizes?.test ?? "—"} rows`} hint={`Train ${m.splitSizes?.train ?? "—"}`} tone="slate" />
              {cm && (
                <div className="md:col-span-4">
                  <h4 className="mb-2 text-sm font-semibold">Confusion matrix (test)</h4>
                  <div className="inline-grid grid-cols-3 gap-1 text-center text-sm">
                    <div /><div className="px-3 py-1 text-xs text-slate-500">Predicted on-track</div><div className="px-3 py-1 text-xs text-slate-500">Predicted at-risk</div>
                    <div className="px-3 py-2 text-xs text-slate-500">Actual on-track</div><div className="rounded-lg bg-emerald-50 px-5 py-3 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">TN {cm.tn}</div><div className="rounded-lg bg-rose-50 px-5 py-3 font-semibold text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">FP {cm.fp}</div>
                    <div className="px-3 py-2 text-xs text-slate-500">Actual at-risk</div><div className="rounded-lg bg-amber-50 px-5 py-3 font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">FN {cm.fn}</div><div className="rounded-lg bg-emerald-50 px-5 py-3 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">TP {cm.tp}</div>
                  </div>
                </div>
              )}
              {m.classificationReport && (
                <div className="md:col-span-4">
                  <DataTable rows={m.classificationReport} rowKey={(r: Row) => r.class} columns={[
                    { key: "class", header: "Class" }, { key: "precision", header: "Precision" }, { key: "recall", header: "Recall" }, { key: "f1", header: "F1" }, { key: "support", header: "Support" },
                  ]} />
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card title="Algorithm comparison" subtitle="Selection uses cross-validated F2 on the training split. The test split is reported once.">
          <DataTable rows={current?.comparison ?? []} rowKey={(r: Row) => r.model} empty="Train a model to compare." columns={[
            { key: "model", header: "Model" },
            { key: "selected", header: "Selected", render: (r: Row) => (r.selected ? <Badge value="active">Selected</Badge> : "—") },
            { key: "cvPooledF2", header: "CV F2", render: (r: Row) => (r.cvPooledF2 ?? "—") },
            { key: "testRecall", header: "Test recall", render: (r: Row) => fmtPct((r.testRecall ?? 0) * 100) },
            { key: "testFpr", header: "Test FPR", render: (r: Row) => fmtPct((r.testFpr ?? 0) * 100) },
            { key: "testRocAuc", header: "Test AUC", render: (r: Row) => r.testRocAuc ?? "n/a" },
          ]} />
          <p className="mt-3 text-xs text-slate-500">Random Forest and Gradient Boosting are not implemented in this Node.js runtime. They are listed as future work in the documentation.</p>
        </Card>
        <Card title="Cross-validation (logistic regression grid)" subtitle="Regularisation strength (λ) search on the training split">
          <DataTable rows={cvResults} rowKey={(r: Row) => r.lambda} empty="No CV results." columns={[
            { key: "lambda", header: "λ" }, { key: "pooledF2", header: "Pooled F2" }, { key: "pooledRecall", header: "Recall" }, { key: "pooledFpr", header: "FPR" }, { key: "meanFoldAuc", header: "Mean fold AUC" },
          ]} />
        </Card>
        <Card title="Feature importance (permutation)" subtitle="Drop in test ROC-AUC when a feature is shuffled. Association, not causation.">
          <BarChartCard data={importance.map((i: Row) => ({ feature: labelize(i.feature.replace(/Pct$/, " %")), importance: i.importance }))} xKey="feature" yKey="importance" height={280} />
        </Card>
        <Card title="Data quality" subtitle={`Records ${quality.records ?? 0} · at risk ${quality.positives ?? 0} (${fmtPct((quality.positiveRate ?? 0) * 100)}) · duplicate feature rows ${quality.duplicateFeatureRows ?? 0}`}>
          <BarChartCard data={missing} xKey="feature" yKey="rate" height={280} name="Missing %" color="#f59e0b" />
          {quality.imbalanceHandling && <p className="mt-2 text-xs text-slate-500">{quality.imbalanceHandling}</p>}
        </Card>
        <Card title="Leakage & validity controls" className="xl:col-span-2">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
            {(current?.params?.leakageControls ?? ["Median imputation and standardisation are fitted on training rows only.", "Cross-validation refits preprocessing inside every fold.", "End-semester results are excluded from features, because they define the outcome label."]).map((t: string) => <li key={t}>{t}</li>)}
          </ul>
          <Notice tone="info">{current?.notes ?? "No notes recorded."}</Notice>
        </Card>
        <Card title="Feature set" subtitle="Protected personal characteristics are not used as predictors." className="xl:col-span-2">
          <DataTable rows={data?.features ?? []} rowKey={(r: Row) => r.key} columns={[
            { key: "label", header: "Feature" }, { key: "unit", header: "Unit" }, { key: "description", header: "Definition" },
          ]} />
        </Card>
      </div>
      <div className="mt-6"><Card title="Model history"><TrendChart data={versions.map((v) => ({ name: v.name, recall: Math.round(((v.metrics?.recall ?? 0) * 100) * 10) / 10 })).reverse()} xKey="name" series={[{ key: "recall", label: "Test recall %", color: "#10b981" }]} height={200} /></Card></div>
      <div className="mt-4 flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4" /> Every training and assessment run is written to the audit trail.</div>
    </>
  );
}
