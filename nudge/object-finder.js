// Object finder: Grounding DINO (finds whatever is described in words: "a car door handle.",
// "a water bottle.", "a trash can.") running in this server, on the laptop's CPU (~1.2 s a frame
// on an M3 Pro; faster than it runs in a browser). The phone sends a camera frame when the laptop
// page asks for one: near the Waymo (door handle), or while finding an object.
//
// Tested on photos: its best small box is a Waymo's door handle most of the time (sometimes the
// charging-port flap), and it found every bottle, mug, backpack and trash can in 11 everyday
// scenes, including ones YOLO missed. It also scores whole scenes/cars; the laptop page drops
// boxes that big.
//
// The model (~200 MB) downloads into models/ the first time the server starts. It runs in its
// own process (object-finder-worker.js) so the relay never waits for it.

import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

export const finder = { status: "loading" };
// Its own process: the ONNX runtime crashes when two threads of one process use it at once, and
// this way a crash in the model can't take the relay (and its safety stops) down with it.
const worker = fork(fileURLToPath(new URL("./object-finder-worker.js", import.meta.url)));
const waiting = new Map(); // id → resolve
let nextId = 0;

worker.on("message", (msg) => {
  if (msg.type === "log") console.log(`object finder model: ${msg.text}`);
  if (msg.type === "status") { finder.status = msg.status; console.log(`object finder: ${msg.status}`); }
  if (msg.type === "boxes") {
    waiting.get(msg.id)?.(msg.error ? `failed: ${msg.error}` : msg.boxes);
    waiting.delete(msg.id);
  }
});
worker.on("exit", (code) => { finder.status = `failed: stopped (${code})`; console.log(`object finder: ${finder.status}`); });

// (data:image/jpeg;base64,…, "a water bottle.") → [{ score, x1, y1, x2, y2 }] in the image's
// pixels, or a reason string when it can't run right now. One frame at a time.
export function findObjects(dataUrl, prompt) {
  if (finder.status !== "ready") return Promise.resolve(finder.status);
  if (waiting.size) return Promise.resolve("busy");
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker.send({ id, image: dataUrl, prompt });
  });
}
