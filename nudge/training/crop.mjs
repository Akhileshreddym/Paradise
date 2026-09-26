// Step 3: YOLO every photo, cut out the cars the same way the phone will: the car's box, widened 5% each
// side and extended 35% of its height upward (so the roof dome is in the crop).
// Positives: the biggest car in each Waymo photo. Negatives: every sizable car in the others.

import { mkdirSync as _mkdir } from "node:fs";
import { fileURLToPath as _path } from "node:url";
// Everything (photos, crops, vectors) lives in training/data/, which git ignores.
_mkdir(new URL("./data/", import.meta.url), { recursive: true });
process.chdir(_path(new URL("./data/", import.meta.url)));
import ort from "onnxruntime-node";
import sharp from "sharp";
import { readdirSync, mkdirSync } from "node:fs";
const S = 640, CAR = new Set([2, 5, 7]); // car, bus, truck (a Zeekr Waymo can read as a truck)
import { existsSync, writeFileSync } from "node:fs";
if (!existsSync("yolov10n.onnx")) { // the same YOLO model the phone uses
  const r = await fetch("https://huggingface.co/onnx-community/yolov10n/resolve/main/onnx/model.onnx");
  writeFileSync("yolov10n.onnx", Buffer.from(await r.arrayBuffer()));
}
const session = await ort.InferenceSession.create("yolov10n.onnx");
export function expand(b, W, H) {
  const w = b.x2 - b.x1, h = b.y2 - b.y1;
  const x1 = Math.max(0, b.x1 - 0.05 * w), x2 = Math.min(W, b.x2 + 0.05 * w);
  const y1 = Math.max(0, b.y1 - 0.35 * h), y2 = Math.min(H, b.y2);
  return { left: Math.round(x1), top: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) };
}
async function cars(file) {
  const img = sharp(file).rotate(), m = await img.metadata();
  const W = m.autoOrient?.width ?? m.width, H = m.autoOrient?.height ?? m.height, k = S / Math.max(W, H);
  const { data } = await sharp(file).rotate().resize(Math.round(W * k), Math.round(H * k)).extend({ right: S - Math.round(W * k), bottom: S - Math.round(H * k), background: { r: 114, g: 114, b: 114 } }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = S * S, x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { x[i] = data[i * 3] / 255; x[n + i] = data[i * 3 + 1] / 255; x[2 * n + i] = data[i * 3 + 2] / 255; }
  const { output0 } = await session.run({ images: new ort.Tensor("float32", x, [1, 3, S, S]) });
  const d = output0.data, out = [];
  for (let i = 0; i < d.length; i += 6) if (d[i + 4] >= 0.4 && CAR.has(d[i + 5])) out.push({ x1: d[i] / k, y1: d[i + 1] / k, x2: d[i + 2] / k, y2: d[i + 3] / k, score: d[i + 4] });
  return { boxes: out, W, H };
}
for (const cls of ["pos", "neg"]) {
  mkdirSync(`crops/${cls}`, { recursive: true });
  let made = 0;
  for (const f of readdirSync(`img/${cls}`)) {
    try {
      const { boxes, W, H } = await cars(`img/${cls}/${f}`);
      const big = boxes.filter((b) => (b.x2 - b.x1) * (b.y2 - b.y1) > 0.03 * W * H && b.x2 - b.x1 > 60);
      const pick = cls === "pos" ? big.sort((a, b) => (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1)).slice(0, 1) : big.slice(0, 3);
      for (const [i, b] of pick.entries()) {
        await sharp(`img/${cls}/${f}`).rotate().extract(expand(b, W, H)).resize(224, 224, { fit: "fill" }).jpeg({ quality: 90 }).toFile(`crops/${cls}/${f.replace(".jpg", "")}_${i}.jpg`);
        made++;
      }
    } catch (e) { /* not an image we can read */ }
  }
  console.log(cls, "crops:", made);
}
