// Depth: Depth Anything V2 small (8-bit), in its own process (depth-worker.js). Turns the phone's
// preview frames into distances, using the floor as the ruler, and reports obstacles in the walking
// path that YOLO can't name: walls, poles, doors, boxes… (details in depth-worker.js).
//
// ~80 ms a frame on an M3 Pro's CPU. The model (27 MB) downloads into models/ on the first start.

import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

export const depth = { status: "loading" };
// Its own process: the ONNX runtime crashes when two threads of one process use it at once, and
// this way a crash in the model can't take the relay (and its safety stops) down with it. If it
// does crash, whatever it was working on fails, and it starts again (a few times at most).
const waiting = new Map(); // id → resolve
let worker, nextId = 0, restarts = 0;
function start() {
  worker = fork(fileURLToPath(new URL("./depth-worker.js", import.meta.url)));
  worker.on("message", (msg) => {
    if (msg.type === "status") { depth.status = msg.status; console.log(`depth: ${msg.status}`); }
    if (msg.type === "result") {
      waiting.get(msg.id)?.(msg.error ? `failed: ${msg.error}` : msg.result);
      waiting.delete(msg.id);
    }
  });
  worker.on("exit", (code, signal) => {
    depth.status = `failed: stopped (${signal || code})`;
    for (const resolve of waiting.values()) resolve(depth.status);
    waiting.clear();
    if (signal === "SIGINT" || signal === "SIGTERM") return; // Ctrl + C: everything's stopping
    console.log(`depth: ${depth.status}${restarts < 3 ? ", starting it again" : ""}`);
    if (restarts++ < 3) { depth.status = "loading"; setTimeout(start, 2000); }
  });
}
start();

// (data:image/jpeg;base64,…, { focal, camH, pitch }) → { ok, why?, floor, found: [{ kind, distance,
// angle }] }, or a reason string when it can't run right now. Skipped while busy: the next preview
// frame is a quarter of a second away.
export function findHazards(image, cam) {
  if (depth.status !== "ready") return Promise.resolve(depth.status);
  if (waiting.size) return Promise.resolve("busy");
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker.send({ id, image, cam });
  });
}
