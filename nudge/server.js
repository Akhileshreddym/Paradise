// Nudge server: serves the pages in public/, relays WebSocket messages between them
// (phone "eyes" page → laptop "hands" page), recognizes Waymos in car crops
// (waymo-classifier.js) and finds door handles in camera frames (handle-finder.js).
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
import { finder, findHandles } from "./handle-finder.js";
import { classifier, classifyCars } from "./waymo-classifier.js";

const PORT = Number(process.env.PORT) || 8080;
const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
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
      if (msg.type === "frame") onFrame(msg);
      if (msg.type === "cars") onCars(msg);
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

// A camera frame from the phone → door handle boxes for the laptop page, which asked for it.
async function onFrame({ id, image, w, h, focal }) {
  const t0 = Date.now();
  let boxes = null, reason = "";
  try {
    const result = await findHandles(image);
    if (typeof result === "string") reason = result;
    else boxes = result;
  } catch (err) { reason = `failed: ${err.message}`; }
  const ms = Date.now() - t0;
  // For the status line; boxes this wide are the whole car, not a handle.
  if (boxes) latest.handle = { best: Math.max(0, ...boxes.filter((b) => b.x2 - b.x1 < 0.4 * w).map((b) => b.score)), ms, at: Date.now() };
  const reply = JSON.stringify({ type: "handle", id, boxes, reason, w, h, focal, ms });
  for (const client of wss.clients) if (client.role === "hands" && client.readyState === 1) client.send(reply);
}

// Car crops from the phone → how sure each is a Waymo, for the laptop page. The compass reading
// from when the crops were taken goes back with them, so the laptop can turn angles into headings.
async function onCars({ cars, compass }) {
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
  const { eyes, beacon } = latest;
  const recent = (x) => x && Date.now() - x.at < 10000;
  if (!recent(eyes) && !recent(beacon)) return;
  const ago = (x) => (x ? `${((Date.now() - x.at) / 1000).toFixed(0)}s ago` : "never");
  const g = eyes?.msg.gps, b = beacon?.msg;
  const compass = typeof eyes?.msg.compass === "number" ? `${eyes.msg.compass.toFixed(0)}°` : "none";
  let line = `[status] chest phone ${ago(eyes)}: gps ${g ? `±${g.acc.toFixed(0)} m` : "none"}, compass ${compass}, ` +
    `sees ${latest.objects.map((o) => o.label).join(", ") || "nothing"} | beacon ${ago(beacon)}: ${b ? `±${b.acc.toFixed(0)} m` : "none"}`;
  if (g && b) line += ` | distance ${distanceM(g, b).toFixed(0)} m`;
  const hd = latest.handle;
  if (classifier.status !== "ready") line += ` | waymo classifier ${classifier.status}`;
  else if (recent(latest.waymo)) line += ` | waymo ${Math.round(latest.waymo.best * 100)}%`;
  if (finder.status !== "ready") line += ` | door handle finder ${finder.status}`;
  else if (recent(hd)) line += ` | door handle ${hd.best >= 0.12 ? `${Math.round(hd.best * 100)}%` : "none"} (${hd.ms} ms)`;
  console.log(line);
}, 3000);

server.listen(PORT, () => {
  console.log(`Laptop (hands): http://localhost:${PORT}/`);
  console.log(`Phone (eyes):   https://<tunnel address>/eyes.html`);
});
