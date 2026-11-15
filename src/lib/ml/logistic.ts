/**
 * Dependency-free machine-learning primitives used by the risk engine.
 * Everything here is deterministic given a seed, so experiments are reproducible.
 *
 * Preprocessing (median imputation + standardisation) is fitted ONLY on the
 * training rows that are passed to fitPreprocessor(); evaluation rows are transformed
 * with those statistics. Cross-validation refits preprocessing inside each fold.
 */

export type Vec = (number | null)[];

export type Preprocessor = { medians: number[]; means: number[]; stds: number[] };

export type LogisticParams = { type: "logistic"; weights: number[]; intercept: number; lambda: number };

export type NaiveBayesParams = {
  type: "gaussian_nb";
  prior1: number;
  means: [number[], number[]];
  variances: [number[], number[]];
  smoothing: number;
};

export type ModelParams = LogisticParams | NaiveBayesParams;

export type Metrics = {
  threshold: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  f2: number;
  specificity: number;
  falsePositiveRate: number;
  rocAuc: number | null;
  confusionMatrix: { tp: number; fp: number; tn: number; fn: number };
  support: { positive: number; negative: number };
  classificationReport: { class: string; precision: number; recall: number; f1: number; support: number }[];
};

/* ---------- Random & splitting ---------- */

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Stratified train/test split. Returns row indices. */
export function stratifiedSplit(y: number[], testFraction: number, seed: number) {
  const rand = mulberry32(seed);
  const pos: number[] = [];
  const neg: number[] = [];
  y.forEach((v, i) => (v === 1 ? pos : neg).push(i));
  const take = (idx: number[]) => {
    const s = shuffle(idx, rand);
    const nTest = Math.max(1, Math.round(s.length * testFraction));
    return { test: s.slice(0, nTest), train: s.slice(nTest) };
  };
  const p = take(pos);
  const n = take(neg);
  return {
    train: [...p.train, ...n.train].sort((a, b) => a - b),
    test: [...p.test, ...n.test].sort((a, b) => a - b),
  };
}

/** Stratified k-fold partition: returns k arrays of validation indices. */
export function stratifiedFolds(y: number[], k: number, seed: number): number[][] {
  const rand = mulberry32(seed);
  const folds: number[][] = Array.from({ length: k }, () => []);
  for (const cls of [1, 0]) {
    const idx = shuffle(
      y.map((v, i) => (v === cls ? i : -1)).filter((i) => i >= 0),
      rand,
    );
    idx.forEach((id, j) => folds[j % k].push(id));
  }
  return folds;
}

/* ---------- Preprocessing ---------- */

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((v) => (v - m) ** 2)));
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Fits median imputation + standardisation on the rows given (training data only). */
export function fitPreprocessor(X: Vec[]): Preprocessor {
  const d = X[0]?.length ?? 0;
  const medians: number[] = [];
  const means: number[] = [];
  const stds: number[] = [];
  for (let j = 0; j < d; j++) {
    const observed = X.map((r) => r[j]).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const med = quantile(observed, 0.5);
    medians.push(med);
    const filled = X.map((r) => r[j] ?? med);
    const m = mean(filled);
    const sd = std(filled);
    means.push(m);
    stds.push(sd > 1e-9 ? sd : 1);
  }
  return { medians, means, stds };
}

/** Missing values are imputed with the TRAINING median (never zero). */
export function transform(X: Vec[], p: Preprocessor): number[][] {
  return X.map((row) => row.map((v, j) => ((v ?? p.medians[j]) - p.means[j]) / p.stds[j]));
}

/* ---------- Models ---------- */

export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** L2-regularised logistic regression fitted by full-batch gradient descent with balanced class weights. */
export function fitLogistic(Z: number[][], y: number[], lambda: number, epochs = 800, lr = 0.2) {
  const n = Z.length;
  const d = Z[0]?.length ?? 0;
  const npos = y.filter((v) => v === 1).length;
  const nneg = n - npos;
  const wPos = n / (2 * Math.max(npos, 1));
  const wNeg = n / (2 * Math.max(nneg, 1));
  const w = new Array(d).fill(0);
  let b = 0;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    let totalW = 0;
    for (let i = 0; i < n; i++) {
      const sw = y[i] === 1 ? wPos : wNeg;
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const err = (sigmoid(z) - y[i]) * sw;
      for (let j = 0; j < d; j++) gw[j] += err * Z[i][j];
      gb += err;
      totalW += sw;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / totalW + lambda * w[j]);
    b -= lr * (gb / totalW);
  }
  return { weights: w, intercept: b };
}

/** Gaussian Naive Bayes with variance smoothing. */
export function fitGaussianNB(Z: number[][], y: number[], smoothing = 0.05): NaiveBayesParams {
  const d = Z[0]?.length ?? 0;
  const groups: [number[][], number[][]] = [[], []];
  Z.forEach((row, i) => groups[y[i] === 1 ? 1 : 0].push(row));
  const means: [number[], number[]] = [[], []];
  const variances: [number[], number[]] = [[], []];
  for (const c of [0, 1] as const) {
    for (let j = 0; j < d; j++) {
      const col = groups[c].map((r) => r[j]);
      means[c].push(mean(col));
      variances[c].push(std(col) ** 2 + smoothing);
    }
  }
  return { type: "gaussian_nb", prior1: groups[1].length / Math.max(Z.length, 1), means, variances, smoothing };
}

export function scoreModel(params: ModelParams, Z: number[][]): number[] {
  if (params.type === "logistic") {
    return Z.map((row) => {
      let z = params.intercept;
      for (let j = 0; j < row.length; j++) z += params.weights[j] * row[j];
      return sigmoid(z);
    });
  }
  return Z.map((row) => {
    let ll0 = Math.log(Math.max(1 - params.prior1, 1e-9));
    let ll1 = Math.log(Math.max(params.prior1, 1e-9));
    row.forEach((x, j) => {
      ll0 += logNormal(x, params.means[0][j], params.variances[0][j]);
      ll1 += logNormal(x, params.means[1][j], params.variances[1][j]);
    });
    return sigmoid(ll1 - ll0);
  });
}

function logNormal(x: number, m: number, v: number): number {
  return -0.5 * Math.log(2 * Math.PI * v) - ((x - m) ** 2) / (2 * v);
}

/* ---------- Evaluation ---------- */

/** ROC-AUC via the Mann-Whitney U statistic (average ranks for ties). */
export function rocAuc(y: number[], scores: number[]): number | null {
  const pos = y.filter((v) => v === 1).length;
  const neg = y.length - pos;
  if (pos === 0 || neg === 0) return null;
  const idx = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  const ranks = new Array(y.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && scores[idx[j + 1]] === scores[idx[i]]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]] = avgRank;
    i = j + 1;
  }
  let sumPos = 0;
  for (let k = 0; k < y.length; k++) if (y[k] === 1) sumPos += ranks[k];
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

export function fbeta(precision: number, recall: number, beta = 2): number {
  const b2 = beta * beta;
  const denom = b2 * precision + recall;
  return denom === 0 ? 0 : ((1 + b2) * precision * recall) / denom;
}

export function classificationMetrics(y: number[], scores: number[], threshold: number): Metrics {
  const yhat = scores.map((s) => (s >= threshold ? 1 : 0));
  let tp = 0, fp = 0, tn = 0, fn = 0;
  y.forEach((actual, i) => {
    if (actual === 1 && yhat[i] === 1) tp++;
    else if (actual === 0 && yhat[i] === 1) fp++;
    else if (actual === 0 && yhat[i] === 0) tn++;
    else fn++;
  });
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const negPrecision = tn + fn ? tn / (tn + fn) : 0;
  const negRecall = tn + fp ? tn / (tn + fp) : 0;
  const negF1 = negPrecision + negRecall ? (2 * negPrecision * negRecall) / (negPrecision + negRecall) : 0;
  const pos = tp + fn;
  const neg = tn + fp;
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return {
    threshold: r(threshold),
    accuracy: r((tp + tn) / Math.max(y.length, 1)),
    precision: r(precision),
    recall: r(recall),
    f1: r(f1),
    f2: r(fbeta(precision, recall, 2)),
    specificity: r(negRecall),
    falsePositiveRate: r(neg ? fp / neg : 0),
    rocAuc: (() => {
      const a = rocAuc(y, scores);
      return a === null ? null : r(a);
    })(),
    confusionMatrix: { tp, fp, tn, fn },
    support: { positive: pos, negative: neg },
    classificationReport: [
      { class: "at_risk (1)", precision: r(precision), recall: r(recall), f1: r(f1), support: pos },
      { class: "on_track (0)", precision: r(negPrecision), recall: r(negRecall), f1: r(negF1), support: neg },
    ],
  };
}

/** Threshold that maximises F-beta (default F2, which weights recall above precision). */
export function bestThresholdForFbeta(y: number[], scores: number[], beta = 2): { threshold: number; score: number } {
  let best = { threshold: 0.5, score: -1 };
  for (let t = 0.05; t <= 0.95 + 1e-9; t += 0.01) {
    const m = classificationMetrics(y, scores, t);
    const score = fbeta(m.precision, m.recall, beta);
    if (score > best.score + 1e-12) best = { threshold: Math.round(t * 100) / 100, score };
  }
  return best;
}

/** Permutation importance: drop in ROC-AUC when one feature column is shuffled. */
export function permutationImportance(
  params: ModelParams,
  Z: number[][],
  y: number[],
  names: string[],
  seed = 7,
  repeats = 5,
): { feature: string; importance: number }[] {
  const base = rocAuc(y, scoreModel(params, Z)) ?? 0.5;
  const rand = mulberry32(seed);
  return names
    .map((name, j) => {
      let drop = 0;
      for (let r = 0; r < repeats; r++) {
        const col = shuffle(
          Z.map((row) => row[j]),
          rand,
        );
        const permuted = Z.map((row, i) => row.map((v, k) => (k === j ? col[i] : v)));
        drop += base - (rocAuc(y, scoreModel(params, permuted)) ?? 0.5);
      }
      return { feature: name, importance: Math.round((drop / repeats) * 10000) / 10000 };
    })
    .sort((a, b) => b.importance - a.importance);
}
