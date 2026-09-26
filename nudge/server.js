// Nudge server: serves the pages in public/ and relays WebSocket messages between them
// (phone "eyes" page → laptop "hands" page).
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

const PORT = 8080;
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

// Every message from one client goes to all the others.
const wss = new WebSocketServer({ server, path: "/ws" });
const latest = { eyes: null, beacon: null }; // for the status line below
wss.on("connection", (ws, req) => {
  const role = new URL(req.url, "http://x").searchParams.get("role") || "unknown";
  const device = /iPhone|Android|Windows|Mac/.exec(req.headers["user-agent"] || "")?.[0] || "?";
  console.log(`${role} page connected (${device}); ${wss.clients.size} connected`);
  ws.on("close", () => console.log(`${role} page disconnected (${device}); ${wss.clients.size} connected`));
  ws.on("message", (data, isBinary) => {
    for (const client of wss.clients) {
      if (client !== ws && client.readyState === 1) client.send(data, { binary: isBinary });
    }
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type in latest) latest[msg.type] = { msg, at: Date.now() };
    } catch {}
  });
});

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
    `markers ${eyes?.msg.markers?.length ?? 0} | beacon ${ago(beacon)}: ${b ? `±${b.acc.toFixed(0)} m` : "none"}`;
  if (g && b) line += ` | distance ${distanceM(g, b).toFixed(0)} m`;
  console.log(line);
}, 3000);

server.listen(PORT, () => {
  console.log(`Laptop (hands): http://localhost:${PORT}/`);
  console.log(`Phone (eyes):   https://<tunnel address>/eyes.html`);
});
