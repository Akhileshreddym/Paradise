// Runs the door handle model on its own thread (see handle-finder.js): on the server's main
// thread each frame held up the phone → laptop relay for over a second, long enough for the
// laptop's link-lost safety stop.

import { env, pipeline, RawImage } from "@huggingface/transformers";
import { parentPort } from "node:worker_threads";
import { fileURLToPath } from "node:url";

env.cacheDir = env.localModelPath = fileURLToPath(new URL("./models/", import.meta.url));

const MODEL = "onnx-community/grounding-dino-tiny-ONNX";
const PROMPT = "a car door handle."; // one phrase: mixing phrases in one prompt made it worse

let shown = 0;
const ready = pipeline("zero-shot-object-detection", MODEL, {
  dtype: "q8", // the fp16 and WebGPU versions gave wrong scores or ran slower
  progress_callback: (p) => {
    if (p.status !== "progress" || p.total < 5e6 || p.loaded - shown < 20e6) return;
    shown = p.loaded;
    parentPort.postMessage({ type: "log", text: `downloading ${(p.loaded / 1e6).toFixed(0)} / ${(p.total / 1e6).toFixed(0)} MB` });
  },
});
ready.then(
  () => parentPort.postMessage({ type: "status", status: "ready" }),
  (err) => parentPort.postMessage({ type: "status", status: `failed: ${err.message}` }),
);

// { id, image: data URL } → { id, boxes: [{ score, x1, y1, x2, y2 }] in the image's pixels }
parentPort.on("message", async ({ id, image }) => {
  try {
    const detect = await ready;
    const img = await RawImage.fromBlob(new Blob([Buffer.from(image.split(",")[1], "base64")]));
    const out = await detect(img, [PROMPT], { threshold: 0.1, top_k: 10 });
    const boxes = out.map((o) => ({ score: o.score, x1: o.box.xmin, y1: o.box.ymin, x2: o.box.xmax, y2: o.box.ymax }));
    parentPort.postMessage({ type: "boxes", id, boxes });
  } catch (err) {
    parentPort.postMessage({ type: "boxes", id, error: err.message });
  }
});
