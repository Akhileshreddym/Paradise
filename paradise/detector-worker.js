// Runs YOLOv8n in its own process (see detector.js), so it never holds up the relay.
//
// The model is a plain ultralytics export: input "images" [1, 3, 640, 640] (RGB, 0–1), output
// [1, 84, 8400]: for each of 8400 candidates, box centre x, centre y, width, height (640 px input
// pixels), then 80 class scores. Like ultralytics' own predict: the best class per candidate,
// at least CONF, then non-maximum suppression per class.

import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import ort from "onnxruntime-node";
import sharp from "sharp";

// The server went away (crashed, or stopped): don't linger. (A plain terminate signal: exiting
// normally with the ONNX runtime's threads running prints a scary but harmless C++ error.)
process.on("disconnect", () => process.kill(process.pid, "SIGTERM"));

const URL_ = "https://huggingface.co/Kalray/yolov8/resolve/main/yolov8n.onnx";
const FILE = fileURLToPath(new URL("./models/yolov8n/yolov8n.onnx", import.meta.url));
const SIZE = 640;
const CONF = 0.35; // Lumen's confidence floor (yolo_service.DEFAULT_CONF_THRESHOLD)
const IOU = 0.7;   // ultralytics' default for predict
const LABELS = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
  "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
  "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
  "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
  "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
  "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
  "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard",
  "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase",
  "scissors", "teddy bear", "hair drier", "toothbrush",
];

async function download() {
  try { if ((await stat(FILE)).size > 1e6) return; } catch {}
  process.send({ type: "status", status: "downloading the model (12 MB, first start only)…" });
  await mkdir(dirname(FILE), { recursive: true });
  const res = await fetch(URL_);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${FILE}.part`));
  await rename(`${FILE}.part`, FILE); // only a whole file counts
}
const ready = download().then(() => ort.InferenceSession.create(FILE));
ready.then(
  () => process.send({ type: "status", status: "ready" }),
  (err) => process.send({ type: "status", status: `failed: ${err.message}` }),
);

const input = new Float32Array(3 * SIZE * SIZE);
// { id, image: data URL } → { type: "boxes", id, boxes, w, h, ms }
process.on("message", async ({ id, image }) => {
  const t0 = Date.now();
  try {
    const session = await ready;
    const img = sharp(Buffer.from(String(image).split(",")[1] || "", "base64")).rotate();
    const { width: w, height: h } = await img.metadata();
    // Letterbox: the longest side to 640, grey padding on the right / bottom.
    const k = SIZE / Math.max(w, h);
    const { data } = await img.removeAlpha()
      .resize(Math.round(w * k), Math.round(h * k))
      .extend({ right: SIZE - Math.round(w * k), bottom: SIZE - Math.round(h * k), background: { r: 114, g: 114, b: 114 } })
      .raw().toBuffer({ resolveWithObject: true });
    const n = SIZE * SIZE;
    for (let i = 0; i < n; i++) { // RGB bytes → planar RGB floats 0–1
      input[i] = data[i * 3] / 255;
      input[n + i] = data[i * 3 + 1] / 255;
      input[2 * n + i] = data[i * 3 + 2] / 255;
    }
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
    const t = out[session.outputNames[0]], d = t.data, N = t.dims[2], C = t.dims[1] - 4;
    const cands = [];
    for (let i = 0; i < N; i++) {
      let best = 0, cls = -1;
      for (let c = 0; c < C; c++) { const s = d[(4 + c) * N + i]; if (s > best) { best = s; cls = c; } }
      if (best < CONF) continue;
      const cx = d[i], cy = d[N + i], bw = d[2 * N + i], bh = d[3 * N + i];
      cands.push({ cls, score: best, x1: (cx - bw / 2) / k, y1: (cy - bh / 2) / k, x2: (cx + bw / 2) / k, y2: (cy + bh / 2) / k });
    }
    const boxes = nms(cands).map((b) => ({
      label: LABELS[b.cls], score: Math.round(b.score * 1000) / 1000,
      x1: clamp(b.x1, 0, w), y1: clamp(b.y1, 0, h), x2: clamp(b.x2, 0, w), y2: clamp(b.y2, 0, h),
    }));
    process.send({ type: "boxes", id, boxes, w, h, ms: Date.now() - t0 });
  } catch (err) {
    process.send({ type: "boxes", id, error: err.message });
  }
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)), iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy, union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return union > 0 ? inter / union : 0;
}
// Best first; drop any box that overlaps a better one of the same class by more than IOU.
function nms(cands) {
  cands.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of cands) if (!kept.some((k) => k.cls === c.cls && iou(k, c) > IOU)) kept.push(c);
  return kept.slice(0, 100);
}
