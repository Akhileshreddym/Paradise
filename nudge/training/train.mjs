// Step 5: logistic regression on the feature vectors, 5-fold cross-validated; then train on everything
// and save the weights. Standardizes features first (mean/std saved with the weights).

import { mkdirSync as _mkdir } from "node:fs";
import { fileURLToPath as _path } from "node:url";
// Everything (photos, crops, vectors) lives in training/data/, which git ignores.
_mkdir(new URL("./data/", import.meta.url), { recursive: true });
process.chdir(_path(new URL("./data/", import.meta.url)));
import { readFileSync, writeFileSync } from "node:fs";
const [inp = "emb_clip.json", out = "../../waymo-head.json"] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(inp));
const D = rows[0].v.length;
function fit(train) {
  const mean = new Array(D).fill(0), std = new Array(D).fill(0);
  for (const r of train) r.v.forEach((x, i) => (mean[i] += x / train.length));
  for (const r of train) r.v.forEach((x, i) => (std[i] += (x - mean[i]) ** 2 / train.length));
  for (let i = 0; i < D; i++) std[i] = Math.sqrt(std[i]) || 1;
  const X = train.map((r) => r.v.map((x, i) => (x - mean[i]) / std[i])), Y = train.map((r) => r.y);
  const npos = Y.filter(Boolean).length, wpos = (Y.length - npos) / npos; // balance the classes
  let w = new Array(D).fill(0), b = 0;
  const lr = 0.05, l2 = 1e-2;
  for (let ep = 0; ep < 300; ep++) {
    const gw = new Array(D).fill(0); let gb = 0;
    X.forEach((x, n) => {
      const p = 1 / (1 + Math.exp(-(x.reduce((s, xi, i) => s + xi * w[i], b))));
      const e = (p - Y[n]) * (Y[n] ? wpos : 1);
      for (let i = 0; i < D; i++) gw[i] += e * x[i];
      gb += e;
    });
    w = w.map((wi, i) => wi - lr * (gw[i] / X.length + l2 * wi));
    b -= (lr * gb) / X.length;
  }
  return { mean, std, w, b };
}
const prob = (m, v) => 1 / (1 + Math.exp(-v.reduce((s, x, i) => s + ((x - m.mean[i]) / m.std[i]) * m.w[i], m.b)));
// 5-fold CV, grouped by source photo so crops of one photo never sit on both sides.
const photo = (r) => r.file.replace(/_\d+\.jpg$/, "");
const photos = [...new Set(rows.map(photo))].sort(() => Math.random() - 0.5);
const fold = new Map(photos.map((p, i) => [p, i % 5]));
let tp = 0, fp = 0, tn = 0, fn = 0; const wrong = [], cv = [];
for (let k = 0; k < 5; k++) {
  const m = fit(rows.filter((r) => fold.get(photo(r)) !== k));
  for (const r of rows.filter((r) => fold.get(photo(r)) === k)) {
    const p = prob(m, r.v), yes = p >= 0.5;
    cv.push([p, r.y]);
    if (yes && r.y) tp++; else if (yes) { fp++; wrong.push([r.file, p.toFixed(2)]); } else if (r.y) { fn++; wrong.push([r.file, p.toFixed(2)]); } else tn++;
  }
}
console.log(`cross-validated: accuracy ${((tp + tn) / rows.length * 100).toFixed(1)}%  precision ${(tp / (tp + fp) * 100).toFixed(1)}%  recall ${(tp / (tp + fn) * 100).toFixed(1)}%  (tp ${tp} fp ${fp} tn ${tn} fn ${fn})`);
writeFileSync("wrong.json", JSON.stringify(wrong, null, 1)); // what cross-validation got wrong: look at these
for (const t of [0.5, 0.7, 0.8, 0.9, 0.95]) {
  const TP = cv.filter(([p, y]) => p >= t && y).length, FP = cv.filter(([p, y]) => p >= t && !y).length, P = cv.filter(([, y]) => y).length;
  console.log(`  cutoff ${t}: catches ${(TP / P * 100).toFixed(0)}% of Waymos, ${FP} false alarms of ${cv.length - P} other cars (precision ${(TP / (TP + FP) * 100).toFixed(0)}%)`);
}
const m = fit(rows);
writeFileSync(out, JSON.stringify({ mean: m.mean.map((x) => +x.toFixed(6)), std: m.std.map((x) => +x.toFixed(6)), w: m.w.map((x) => +x.toFixed(6)), b: +m.b.toFixed(6) }));
console.log("saved", out);
