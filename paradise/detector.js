// Detector: YOLOv8n (80 COCO classes), on the laptop, for find mode. The same detector, settings
// and rules as Lumen (github.com/diaabadaha/lumen-graduation-project): 640 px frames, boxes under
// 35% confidence dropped. The laptop page sends it frames from the live video (~5+ a second) and
// applies Lumen's rules to what comes back (see "Find mode" in hands.html).
//
// ~40–110 ms a frame on a laptop CPU. The model (12 MB, a plain ultralytics ONNX export) downloads
// into models/ the first time the server starts. It runs in its own process (detector-worker.js),
// so the relay never waits for it.

import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

export const detector = { status: "loading" };
// Its own process: the ONNX runtime crashes when two threads of one process use it at once, and
// this way a crash in the model can't take the relay (and its safety stops) down with it. If it
// does crash, whatever it was working on fails, and it starts again (a few times at most).
const waiting = new Map(); // id → resolve
let worker, nextId = 0, restarts = 0;
function start() {
  worker = fork(fileURLToPath(new URL("./detector-worker.js", import.meta.url)));
  worker.on("message", (msg) => {
    if (msg.type === "status") { detector.status = msg.status; console.log(`detector: ${msg.status}`); }
    if (msg.type === "boxes") {
      waiting.get(msg.id)?.(msg.error ? `failed: ${msg.error}` : msg);
      waiting.delete(msg.id);
    }
  });
  worker.on("exit", (code, signal) => {
    detector.status = `failed: stopped (${signal || code})`;
    for (const resolve of waiting.values()) resolve(detector.status);
    waiting.clear();
    if (signal === "SIGINT" || signal === "SIGTERM") return; // Ctrl + C: everything's stopping
    console.log(`detector: ${detector.status}${restarts < 3 ? ", starting it again" : ""}`);
    if (restarts++ < 3) { detector.status = "loading"; setTimeout(start, 2000); }
  });
}
start();

// (data:image/jpeg;base64,…) → { boxes: [{ label, score, x1, y1, x2, y2 }], w, h } in the image's
// pixels, or a reason string when it can't run right now. One frame at a time.
export function detect(dataUrl) {
  if (detector.status !== "ready") return Promise.resolve(detector.status);
  if (waiting.size) return Promise.resolve("busy");
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker.send({ id, image: dataUrl });
  });
}
