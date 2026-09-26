// Nudge server: serves the pages in public/, relays WebSocket messages between them
// (phone "eyes" page → laptop "hands" page), recognizes Waymos in car crops (clip.js) and finds
// things described in words (a door handle, a water bottle) in camera frames (object-finder.js,
// with a second opinion from clip.js).
//
//   npm install
//   npm start
//   laptop: http://localhost:8080/               (hands.html)
//   phone:  https://<tunnel address>/eyes.html   (the camera needs https; see README.md)

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { finder, findObjects } from "./object-finder.js";
import { clip, classifyCars, checkBoxes } from "./clip.js";

const PORT = Number(process.env.PORT) || 8080;
const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  // The tunnel makes this reachable from outside: a malformed address (bad %-escapes) gets a
  // 400, not a crash.
  let path;
  try { path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)); } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  const file = join(ROOT, path === sep ? "hands.html" : path);
  // Only serve page files inside public/ (the tunnel makes this reachable from outside).
  if (!file.startsWith(ROOT) || !TYPES[extname(file)]) {
    res.writeHead(404).end("Not found");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)], "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

// Every message from one client goes to all the others, except messages with a "to" field,
// which only go to pages with that role, or to this server ("to": "server": camera frames and
// car crops).
const wss = new WebSocketServer({ server, path: "/ws" });
const latest = { eyes: null, beacon: null, objects: [] }; // for the status line below
wss.on("connection", (ws, req) => {
  const role = new URL(req.url, "http://x").searchParams.get("role") || "unknown";
  ws.role = role;
  const device = /iPhone|Android|Windows|Mac/.exec(req.headers["user-agent"] || "")?.[0] || "?";
  console.log(`${role} page connected (${device}); ${wss.clients.size} connected`);
  ws.on("close", () => console.log(`${role} page disconnected (${device}); ${wss.clients.size} connected`));
  ws.on("message", (data, isBinary) => {
    let msg = null;
    try { msg = JSON.parse(data.toString()); } catch {}
    if (msg?.to === "server") {
      // Anything can arrive here (the tunnel is public): a bad message is logged, never fatal.
      const job = msg.type === "frame" ? onFrame(msg) : msg.type === "cars" ? onCars(msg) : null;
      job?.catch((err) => console.log(`bad ${msg.type} message: ${err.message}`));
      return;
    }
    for (const client of wss.clients) {
      if (client === ws || client.readyState !== 1) continue;
      if (msg?.to && client.role !== msg.to) continue;
      client.send(data, { binary: isBinary });
    }
    if (msg?.type === "eyes" || msg?.type === "beacon") latest[msg.type] = { msg, at: Date.now() };
    if (msg?.type === "eyes" && msg.objects) latest.objects = msg.objects; // only sent when new
  });
});

// A camera frame from the phone → boxes for what the laptop page asked to find in it ("prompt",
// e.g. "a car door handle."). With "check" ({ what, same }), CLIP gives its second opinion on the
// best few boxes (verified: true/false); the object finder alone boxes something almost every time.
async function onFrame({ id, image, w, h, focal, prompt, check }) {
  const t0 = Date.now();
  let boxes = null, reason = "", note = "";
  try {
    const result = await findObjects(image, prompt);
    if (typeof result === "string") reason = result;
    else boxes = result;
    if (boxes && check) {
      const best = boxes.filter((b) => b.score >= 0.2 && b.x2 - b.x1 < 0.8 * w && b.y2 - b.y1 < 0.9 * h)
        .sort((a, b) => b.score - a.score).slice(0, 3);
      const ok = best.length ? await checkBoxes(image, best, String(check.what), check.same || []) : [];
      if (Array.isArray(ok)) best.forEach((b, i) => (b.verified = ok[i]));
      else note = `second opinion unavailable: ${ok}`; // CLIP loading or failed: say so, don't just find nothing
    }
  } catch (err) { reason = `failed: ${err.message}`; }
  const ms = Date.now() - t0;
  // For the status line; boxes this wide are the whole scene, not the thing.
  if (boxes) latest.found = { prompt, best: Math.max(0, ...boxes.filter((b) => b.x2 - b.x1 < 0.8 * w).map((b) => b.score)), ms, at: Date.now() };
  const reply = JSON.stringify({ type: "found", id, boxes, reason, note, w, h, focal, ms });
  for (const client of wss.clients) if (client.role === "hands" && client.readyState === 1) client.send(reply);
}

// Car crops from the phone → how sure each is a Waymo, for the laptop page. The compass reading
// from when the crops were taken goes back with them, so the laptop can turn angles into headings.
async function onCars({ cars, compass }) {
  if (!Array.isArray(cars) || !cars.length) return;
  const probs = await classifyCars(cars.map((c) => c.image)).catch((err) => `failed: ${err.message}`);
  if (typeof probs === "string") return; // loading or busy: the phone sends more soon
  latest.waymo = { best: Math.max(...probs), at: Date.now() };
  const reply = JSON.stringify({ type: "waymo", compass, cars: cars.map((c, i) => ({ angle: c.angle, distance: c.distance, prob: probs[i] })) });
  for (const client of wss.clients) if (client.role === "hands" && client.readyState === 1) client.send(reply);
}

// Every 3 s, print what the phones are sending (accuracy and distance only, no coordinates),
// so problems show up in this terminal.
const rad = (d) => (d * Math.PI) / 180;
function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
setInterval(() => {
  try { printStatus(); } catch (err) { console.log(`[status] couldn't print: ${err.message}`); } // odd data: skip a line, don't crash
}, 3000);
function printStatus() {
  const { eyes, beacon } = latest;
  const recent = (x) => x && Date.now() - x.at < 10000;
  if (!recent(eyes) && !recent(beacon)) return;
  const ago = (x) => (x ? `${((Date.now() - x.at) / 1000).toFixed(0)}s ago` : "never");
  const g = eyes?.msg.gps, b = beacon?.msg;
  const compass = typeof eyes?.msg.compass === "number" ? `${eyes.msg.compass.toFixed(0)}°` : "none";
  let line = `[status] chest phone ${ago(eyes)}: gps ${g ? `±${g.acc.toFixed(0)} m` : "none"}, compass ${compass}, ` +
    `sees ${latest.objects.map((o) => o.label).join(", ") || "nothing"} | beacon ${ago(beacon)}: ${b ? `±${b.acc.toFixed(0)} m` : "none"}`;
  if (g && b) line += ` | distance ${distanceM(g, b).toFixed(0)} m`;
  const fd = latest.found;
  if (clip.status !== "ready") line += ` | clip ${clip.status}`;
  else if (recent(latest.waymo)) line += ` | waymo ${Math.round(latest.waymo.best * 100)}%`;
  if (finder.status !== "ready") line += ` | object finder ${finder.status}`;
  else if (recent(fd)) line += ` | finding "${fd.prompt}" best ${Math.round(fd.best * 100)}% (${fd.ms} ms)`;
  console.log(line);
}

// The WebSocket server passes the web server's errors on (it listens first), so listen there.
wss.on("error", (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  console.log(`Port ${PORT} is already in use: is npm start already running in another terminal?`);
  process.exit(1);
});
server.listen(PORT, () => {
  console.log(`Laptop (hands): http://localhost:${PORT}/`);
  console.log(`Phone (eyes):   https://<tunnel address>/eyes.html`);
});
