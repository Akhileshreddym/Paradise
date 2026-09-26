// Door handle finder: Grounding DINO (finds things described in words) running in this server,
// on the laptop's CPU (~1.2 s a frame on an M3 Pro; faster than it runs in a browser). The phone
// sends a camera frame when the laptop page asks for one, once the wearer is near the car.
//
// Tested on photos of Waymos and other cars: its best small box is a door handle most of the
// time (sometimes the charging-port flap). It also scores the whole car as "handle"; the laptop
// page drops boxes that big.
//
// The model (~200 MB) downloads into models/ the first time the server starts. It runs on its
// own thread (handle-finder-worker.js) so the relay never waits for it.

import { Worker } from "node:worker_threads";

export const finder = { status: "loading" };
const worker = new Worker(new URL("./handle-finder-worker.js", import.meta.url));
const waiting = new Map(); // id → resolve
let nextId = 0;

worker.on("message", (msg) => {
  if (msg.type === "log") console.log(`door handle model: ${msg.text}`);
  if (msg.type === "status") { finder.status = msg.status; console.log(`door handle finder: ${msg.status}`); }
  if (msg.type === "boxes") {
    waiting.get(msg.id)?.(msg.error ? `failed: ${msg.error}` : msg.boxes);
    waiting.delete(msg.id);
  }
});
worker.on("error", (err) => { finder.status = `failed: ${err.message}`; console.log(`door handle finder: ${finder.status}`); });

// data:image/jpeg;base64,… → [{ score, x1, y1, x2, y2 }] in the image's pixels, or a reason
// string when it can't run right now. One frame at a time.
export function findHandles(dataUrl) {
  if (finder.status !== "ready") return Promise.resolve(finder.status);
  if (waiting.size) return Promise.resolve("busy");
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker.postMessage({ id, image: dataUrl });
  });
}
