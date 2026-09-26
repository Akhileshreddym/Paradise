// CLIP (an image model that also understands words), in its own process (clip-worker.js). Two jobs:
//
// 1. Waymo classifier: is this car a Waymo? CLIP image features + a small logistic regression
//    trained on openly licensed photos (training/, weights in waymo-head.json). The phone sends
//    crops of the cars YOLO finds while the laptop page is in Waymo mode. Cross-validated on 779
//    crops (125 Waymo, 654 other cars), at the 0.9 cutoff the laptop page uses: about 90% of
//    Waymo crops recognized (88–91% across runs), 4 false alarms among the 654 other cars (other
//    robotaxis with roof sensors, plain Jaguar I-Paces).
//
// 2. Second opinion for the object finder, which nearly always boxes *something* even when the
//    thing isn't there (asked for "a water bottle" it boxed a mug at 83%). Each box is checked:
//    does CLIP think it looks more like the thing than like any of ~80 other everyday things?
//    On 21 test cases: 10 of 11 real finds passed, 9 of 10 false alarms were rejected.

import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

export const clip = { status: "loading" };
// Its own process: the ONNX runtime crashes when two threads of one process use it at once, and
// this way a crash in the model can't take the relay (and its safety stops) down with it. If it
// does crash, whatever it was working on fails, and it starts again (a few times at most).
const waiting = new Map(); // id → resolve
let worker, nextId = 0, restarts = 0;
function start() {
  worker = fork(fileURLToPath(new URL("./clip-worker.js", import.meta.url)));
  worker.on("message", (msg) => {
    if (msg.type === "status") { clip.status = msg.status; console.log(`clip (waymo classifier, second opinions): ${msg.status}`); }
    if (msg.type === "result") {
      waiting.get(msg.id)?.(msg.error ? `failed: ${msg.error}` : msg.result);
      waiting.delete(msg.id);
    }
  });
  worker.on("exit", (code, signal) => {
    clip.status = `failed: stopped (${signal || code})`;
    for (const resolve of waiting.values()) resolve(clip.status);
    waiting.clear();
    if (signal === "SIGINT" || signal === "SIGTERM") return; // Ctrl + C: everything's stopping
    console.log(`clip: ${clip.status}${restarts < 3 ? ", starting it again" : ""}`);
    if (restarts++ < 3) { clip.status = "loading"; setTimeout(start, 2000); }
  });
}
start();

function ask(job, { skipIfBusy }) {
  if (clip.status !== "ready") return Promise.resolve(clip.status);
  if (skipIfBusy && waiting.size) return Promise.resolve("busy");
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker.send({ id, ...job });
  });
}

// [data URL, …] → [probability it's a Waymo, …], or a reason string when it can't run right
// now. Skipped while busy: the phone sends new car crops every half second anyway.
export const classifyCars = (images) => ask({ job: "waymo", images }, { skipIfBusy: true });

// (frame data URL, [{ x1, y1, x2, y2 }] in its pixels, "water bottle", ["bottle", …] words that
// mean the same) → [true/false, …]: does each box look like the thing? Queued, never skipped:
// the object finder waits for it.
export const checkBoxes = (image, boxes, what, same) => ask({ job: "check", image, boxes, what, same }, { skipIfBusy: false });
