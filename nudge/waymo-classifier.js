// Waymo classifier: is this car a Waymo? CLIP image features + a small logistic regression
// trained on openly licensed photos (training/). Runs in its own process
// (waymo-classifier-worker.js). The phone sends crops of the cars YOLO finds while the laptop page
// is in Waymo mode.
//
// Cross-validated on 779 crops (125 Waymo, 654 other cars), at the 0.9 cutoff the laptop page
// uses: about 90% of Waymo crops recognized (88–91% across runs), 4 false alarms among the 654
// other cars (other robotaxis with roof sensors, plain Jaguar I-Paces).

import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

export const classifier = { status: "loading" };
// Its own process: the ONNX runtime crashes when two threads of one process use it at once, and
// this way a crash in the model can't take the relay (and its safety stops) down with it.
const worker = fork(fileURLToPath(new URL("./waymo-classifier-worker.js", import.meta.url)));
const waiting = new Map(); // id → resolve
let nextId = 0;

worker.on("message", (msg) => {
  if (msg.type === "status") { classifier.status = msg.status; console.log(`waymo classifier: ${msg.status}`); }
  if (msg.type === "probs") {
    waiting.get(msg.id)?.(msg.error ? `failed: ${msg.error}` : msg.probs);
    waiting.delete(msg.id);
  }
});
worker.on("exit", (code) => { classifier.status = `failed: stopped (${code})`; console.log(`waymo classifier: ${classifier.status}`); });

// [data URL, …] → [probability it's a Waymo, …], or a reason string when it can't run right
// now. One batch at a time; the phone sends a new one every half second anyway.
export function classifyCars(images) {
  if (classifier.status !== "ready") return Promise.resolve(classifier.status);
  if (waiting.size) return Promise.resolve("busy");
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker.send({ id, images });
  });
}
