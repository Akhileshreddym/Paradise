// Paradise object detector: YOLOv10s (80 COCO classes: car, person, chair, …) in a worker, so a
// slow phone never stalls the camera preview or the 10-a-second link to the laptop (which gives
// up after half a second of silence).
//
// YOLOv10 needs no NMS: the model outputs its best 300 boxes as
// [x1, y1, x2, y2, score, class] in 640 × 640 input pixels.
import * as ort from "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.bundle.min.mjs";

// The small model, not the nano one: clearly more accurate (COCO mAP 46 vs 39), 29 MB instead of
// 9 MB (downloaded once, then cached), and still fast on a phone's GPU.
const MODEL = "https://huggingface.co/onnx-community/yolov10s/resolve/main/onnx/model.onnx";
const SIZE = 640;
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

ort.env.logLevel = "error"; // it warns about routine CPU fallbacks for shape ops
ort.env.wasm.numThreads = 1; // threads need cross-origin isolation, which the CDN scripts rule out

// GPU when the phone has WebGPU (fast), plain WebAssembly otherwise (works everywhere, slower).
let backend = "";
// The download reports its progress (the page's setup bar), then one warm-up run on a blank image
// compiles everything, so the first real frame isn't the slow one.
async function download(url) {
  const res = await fetch(url);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader(), chunks = [];
  let got = 0, told = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    if (Date.now() - told > 150) { told = Date.now(); postMessage({ type: "progress", loaded: got, total }); }
  }
  postMessage({ type: "progress", loaded: got, total: total || got });
  const model = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) { model.set(c, at); at += c.length; }
  return model;
}
const ready = (async () => {
  const model = await download(MODEL);
  postMessage({ type: "status", text: "Starting the model…" });
  let lastErr;
  for (const ep of self.navigator.gpu ? ["webgpu", "wasm"] : ["wasm"]) {
    try {
      const session = await ort.InferenceSession.create(model, { executionProviders: [ep] });
      backend = ep;
      postMessage({ type: "status", text: "Warming up…" });
      await session.run({ images: new ort.Tensor("float32", new Float32Array(3 * SIZE * SIZE), [1, 3, SIZE, SIZE]) });
      return session;
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
})();
ready.then(
  () => postMessage({ type: "ready", backend }),
  (err) => postMessage({ type: "error", message: String(err?.message || err) }),
);

// Letterbox: scale the longest side to 640, pad the rest with grey (bottom/right), as in training.
const canvas = new OffscreenCanvas(SIZE, SIZE);
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const input = new Float32Array(3 * SIZE * SIZE);

// One frame at a time: the page sends the next frame only after this answers.
self.onmessage = async ({ data: { bitmap, minScore } }) => {
  let session;
  try { session = await ready; } catch { bitmap.close(); return; }
  const k = SIZE / Math.max(bitmap.width, bitmap.height);
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(bitmap, 0, 0, Math.round(bitmap.width * k), Math.round(bitmap.height * k));
  bitmap.close();
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data, n = SIZE * SIZE;
  for (let i = 0; i < n; i++) { // RGBA bytes → planar RGB floats 0–1
    input[i] = px[i * 4] / 255;
    input[n + i] = px[i * 4 + 1] / 255;
    input[2 * n + i] = px[i * 4 + 2] / 255;
  }
  const t0 = performance.now();
  try {
    const { output0 } = await session.run({ images: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
    const d = output0.data, boxes = [];
    for (let i = 0; i < d.length; i += 6) {
      if (d[i + 4] < minScore) continue;
      // Back to the page's frame pixels.
      boxes.push({ label: LABELS[d[i + 5]], score: d[i + 4], x1: d[i] / k, y1: d[i + 1] / k, x2: d[i + 2] / k, y2: d[i + 3] / k });
    }
    postMessage({ type: "boxes", boxes, ms: performance.now() - t0, backend });
  } catch (err) {
    postMessage({ type: "boxes", boxes: [], error: String(err?.message || err), backend });
  }
};
