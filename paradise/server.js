// Paradise server: serves the pages in public/, relays WebSocket messages between them
// (phone "eyes" page → laptop "hands" page), recognizes Waymos in car crops (clip.js), finds a
// Waymo's door handle in camera frames (object-finder.js), finds the thing being looked for in
// find mode (detector.js: YOLOv8n, as Lumen does), and obstacles in camera frames (depth.js). It
// also turns what the wearer said after "Paradise" into a command (ai.js), and sentences into
// speech for the people around them (tts.js).
//
//   npm install
//   npm start
//   laptop: http://localhost:8080/                  (hands.html)
//   phone:  https://<tunnel address>/eyes?k=<key>   (the camera needs https; npm start prints the
//                                                    link with its key; see ../README.md)

import http from "node:http";
import { randomInt, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { finder, findObjects } from "./object-finder.js";
import { clip, classifyCars, checkBoxes } from "./clip.js";
import { depth, findHazards } from "./depth.js";
import { detector, detect } from "./detector.js";
import { ai, checkArrived, whatToFind, understandCommand } from "./ai.js";
import { tts, speak } from "./tts.js";

const PORT = Number(process.env.PORT) || 8080;
// The phones come in through a public tunnel address, which anyone can find or be sent. So a page
// that isn't the laptop's own must bring this key (the ?k= in the phone links printed below, which
// the phone pages pass on to their WebSocket): without it, it can't see the camera, hear what's
// said, or send the laptop page anything. PARADISE_TOKEN in paradise/.env keeps the same key (and
// links) from one start to the next; otherwise every start makes a new one. No look-alike letters
// (l, 1, o, 0, i): it may be typed on a phone.
const TOKEN = process.env.PARADISE_TOKEN?.trim() || Array.from({ length: 8 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[randomInt(31)]).join("");
const tokenOk = (k) => { // compared in constant time, so the key can't be guessed a letter at a time
  const a = Buffer.from(String(k ?? "")), b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
};
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
  // "/" is the laptop page; an address without an extension is that page ("/legend" → legend.html).
  const file = join(ROOT, path === sep ? "hands.html" : extname(path) ? path : `${path}.html`);
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

// Pages talk to each other through here, but each page may only send what that page sends, and
// only to the page that uses it: anything else is dropped. Otherwise a phone (or anyone with the
// link) could send the laptop page the server's own answers (a fake "speech" clip, a Gemini
// "ai-command", a clear "depth") or fake another page. The server's own answers (found, waymo,
// depth, preview, ai, ai-what, ai-command, speech) come only from the functions below.
//   role → { message type: the role it goes to }
const RELAY = {
  eyes: { eyes: "hands", heard: "hands", rtc: "hands" },                            // updates, what the mic heard, video set-up
  beacon: { beacon: "hands" },                                                      // the Waymo's location
  hands: { "frame-please": "eyes", "want-cars": "eyes", "want-hands": "eyes",       // requests to the chest phone
    rtc: "eyes", "video-ok": "eyes" },                                              // video set-up; "the live video is arriving"
};
// Messages for the server itself ("to": "server"), and which page may send each.
const JOBS = {
  eyes: { frame: onFrame, cars: onCars, preview: onPreview },
  hands: { "depth-frame": onDepthFrame, detect: onDetect, "ask-arrived": onAskArrived, "ask-what": onAskWhat, "ask-command": onAskCommand, say: onSay },
};
const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : null); // (not "constructor" and the like: both come from outside)
// Only one laptop page drives guidance: the one opened (or reloaded) last, or the one that took
// control. The others still get everything to display (and their own live video: "rtc" passes),
// but what they'd ask for (frames, car crops, hand tracking, Gemini, speech) is dropped here: a forgotten tab can't keep guiding,
// searching or talking. Each laptop page is told whether it's the one: { type: "control", yours }.
let leader = null;
function setLeader(ws) {
  leader = ws;
  const tell = (c) => c.send(JSON.stringify({ type: "control", yours: c === leader }));
  for (const c of wss.clients) if (c.role === "hands" && c.readyState === 1) tell(c);
}
const wss = new WebSocketServer({ server, path: "/ws" });
const BUILD = Date.now().toString(36); // this start of the server (see "hello" below)
const latest = { eyes: null, beacon: null, objects: [] }; // for the status line below
const dropped = new Set(); // role + type: each kind of dropped message is logged once, not every time
const refused = { n: 0, loggedAt: -Infinity }; // pages turned away for the key (logged at most every 10 s)
wss.on("connection", (ws, req) => {
  const params = new URL(req.url, "http://x").searchParams;
  const role = params.get("role") || "unknown";
  ws.role = role;
  // The laptop's own page, not something reaching us through the tunnel (cloudflared connects from
  // this machine too, but adds Cf-Connecting-Ip): only it may spend the Gemini key, and only it
  // needs no link key.
  ws.local = !req.headers["cf-connecting-ip"] && /^(?:127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || "");
  const device = /iPhone|Android|Windows|Mac/.exec(req.headers["user-agent"] || "")?.[0] || "?";
  if (!ws.local && !tokenOk(params.get("k"))) {
    // A custom close code (4000–4999) the page can read: it then says to reopen the printed link.
    ws.role = null; // (never relayed to while it closes)
    ws.close(4401, "wrong or missing link key");
    refused.n++;
    if (Date.now() - refused.loggedAt > 10000) {
      refused.loggedAt = Date.now();
      console.log(`refused ${aRole(role)} page (${device}) from outside: wrong or missing link key (?k=…); ${refused.n} refused since start`);
    }
    return;
  }
  console.log(`${role} page connected (${device}); ${wss.clients.size} connected`);
  // Which start of the server this is: a laptop page left open across a restart reloads itself,
  // so it never keeps running the page code from before (it would only reconnect).
  if (role === "hands") ws.send(JSON.stringify({ type: "hello", build: BUILD }));
  if (role === "hands") setLeader(ws); // the newest laptop page takes over
  ws.on("close", () => {
    console.log(`${role} page disconnected (${device}); ${wss.clients.size} connected`);
    if (leader === ws) setLeader([...wss.clients].filter((c) => c.role === "hands" && c.readyState === 1).at(-1) || null);
  });
  ws.on("message", (data) => {
    let msg = null;
    try { msg = JSON.parse(data.toString()); } catch {}
    const type = typeof msg?.type === "string" ? msg.type : "";
    if (role === "hands" && msg?.to === "server" && type === "take-control") return setLeader(ws);
    if (role === "hands" && ws !== leader && type !== "rtc") return; // view only: its requests go nowhere
    if (msg?.to === "server") {
      // Anything can arrive here (the tunnel is public): a bad message is logged, never fatal.
      const job = own(own(JOBS, role), type);
      if (!job) return drop(role, `${type || "?"} to the server`);
      // A picture from the phone is acknowledged the moment it's here: the phone keeps at most two
      // unacknowledged, so pictures can never pile up on the way (in the phone, the Wi-Fi or the
      // tunnel) and arrive minutes late; over a slow link it just sends fewer.
      if (role === "eyes" && (type === "preview" || type === "cars")) ws.send('{"type":"got"}');
      job(msg, ws, data).catch((err) => console.log(`bad ${type} message: ${err.message}`));
      return;
    }
    const to = own(own(RELAY, role), type);
    if (!to) return drop(role, type || "?");
    for (const client of wss.clients) {
      if (client !== ws && client.role === to && client.readyState === 1) client.send(data, { binary: false });
    }
    if (type === "eyes" || type === "beacon") latest[type] = { msg, at: Date.now() };
    if (type === "eyes" && msg.objects) latest.objects = msg.objects; // only sent when new
  });
});
function drop(role, what) {
  role = String(role).slice(0, 20); what = String(what).slice(0, 40);
  const key = `${role}\n${what}`;
  if (dropped.has(key) || dropped.size >= 100) return; // (bounded: the kinds come from outside)
  dropped.add(key);
  console.log(`[relay] dropped "${what}" from ${aRole(role)} page: not something that page sends (logged once)`);
}
const aRole = (role) => { role = String(role).slice(0, 20); return `${/^[aeiou]/i.test(role) ? "an" : "a"} ${role}`; }; // "an eyes", "a beacon"

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
  // Each car's box (0–1 of the frame) goes back with its score, so the laptop can tell which car
  // on screen is the Waymo even when several are side by side.
  const boxOf = (b) => (Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === "number" && v >= -0.1 && v <= 1.1) ? b : null);
  const reply = JSON.stringify({ type: "waymo", compass, cars: cars.map((c, i) => ({ angle: c.angle, distance: c.distance, box: boxOf(c.box), prob: probs[i] })) });
  for (const client of wss.clients) if (client.role === "hands" && client.readyState === 1) client.send(reply);
}

// A preview frame from the phone (4 a second, only while the laptop page isn't getting the live
// video): on to the laptop page for its display, then (unless the depth model is still busy with
// the last one) obstacles in the walking path, for the laptop page.
async function onPreview(msg, _ws, raw) {
  const pages = [...wss.clients].filter((c) => c.role === "hands" && c.readyState === 1);
  for (const client of pages) client.send(raw, { binary: false }); // as text, like it came: a page can't parse a binary frame
  if (!pages.length) return;
  await runDepth(msg);
}
// A small frame the laptop page took from the live video (WebRTC): the same depth run, no relay.
// The page sends the next one when this one's answered, so a "skip" always goes back to it.
async function onDepthFrame(msg, ws) {
  const why = await runDepth(msg);
  if (why && ws.readyState === 1) ws.send(JSON.stringify({ type: "depth-skip", why }));
}
// Obstacles in the walking path, for the laptop pages; a reason string when it didn't run.
async function runDepth({ image, cam }) {
  if (!cam || typeof image !== "string") return "no image";
  const t0 = Date.now();
  const result = await findHazards(image, cam);
  if (typeof result === "string") return result; // loading or busy: another frame comes soon
  latest.depth = { ...result, at: Date.now() };
  const reply = JSON.stringify({ type: "depth", ...result, ms: Date.now() - t0 });
  for (const client of wss.clients) if (client.role === "hands" && client.readyState === 1) client.send(reply);
  return "";
}

// Find mode: a frame the laptop page took from the live video → YOLOv8n's boxes (detector.js),
// back to that page, which applies Lumen's rules to them. The page sends the next frame when this
// one's answered, so there's always an answer (boxes, or why not).
async function onDetect({ id, image }, ws) {
  if (typeof image !== "string") return;
  const r = await detect(image);
  if (typeof r !== "string") latest.detect = { labels: r.boxes.map((b) => b.label), ms: r.ms, at: Date.now() };
  if (ws.readyState === 1) ws.send(JSON.stringify(typeof r === "string" ? { type: "detected", id, reason: r } : { type: "detected", id, boxes: r.boxes, w: r.w, h: r.h, ms: r.ms }));
}

// Find mode, close to the thing: a photo from the chest camera → is it really within reach (ai.js)?
async function onAskArrived({ id, what, image, inView }, ws) {
  const answer = !ws.local ? NOT_LOCAL : await checkArrived(what, image, inView === true);
  latest.ai = { text: typeof answer === "string" ? answer : `${answer.arrived ? "arrived" : "not yet"} (${answer.ms} ms, ${answer.tokens} tokens)`, at: Date.now() };
  console.log(`[ai] arrived at "${String(what).slice(0, 40)}"? ${latest.ai.text}${typeof answer === "string" ? "" : `: ${answer.reason}`} · ${ai.calls} calls, ${ai.tokens} tokens since start`);
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ai-arrived", id, ...(typeof answer === "string" ? { reason: answer } : answer) }));
}

// A request in plain language ("something to drink") → the thing to look for (ai.js).
const NOT_LOCAL = "only the laptop's own page can ask the AI (not through the tunnel)";
async function onAskWhat({ id, request }, ws) {
  const answer = !ws.local ? NOT_LOCAL : await whatToFind(request);
  latest.ai = { text: typeof answer === "string" ? answer : `"${answer.thing}" (${answer.ms} ms, ${answer.tokens} tokens)`, at: Date.now() };
  console.log(`[ai] what "${String(request).slice(0, 40)}" means: ${latest.ai.text} · ${ai.calls} calls, ${ai.tokens} tokens since start`);
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: "ai-what", id, ...(typeof answer === "string" ? { reason: answer } : answer) }));
}

// What the wearer said after "Paradise", the saved places and what the device is doing now → a
// command (ai.js). The page acts on it only if it's still waiting; after 5 s it uses its own grammar.
async function onAskCommand({ id, text, places, current }, ws) {
  const answer = !ws.local ? NOT_LOCAL : await understandCommand(text, places, current);
  const what = typeof answer === "string" ? "" : answer.place ? ` "${answer.place}"` : answer.thing ? ` "${answer.thing}"` : "";
  latest.ai = { text: typeof answer === "string" ? answer : `${answer.intent}${what} (${answer.ms} ms, ${answer.tokens} tokens)`, at: Date.now() };
  console.log(`[ai] command "${String(text).slice(0, 40)}": ${latest.ai.text} · ${ai.calls} calls, ${ai.tokens} tokens since start`);
  if (ws.readyState === 1) ws.send(JSON.stringify(typeof answer === "string" ? { type: "ai-command", id, reason: answer }
    : { type: "ai-command", id, command: { intent: answer.intent, place: answer.place, thing: answer.thing, reason: answer.reason }, tokens: answer.tokens, ms: answer.ms }));
}

// A sentence for the people around the wearer → an MP3 to play on the laptop (tts.js). Same key
// rule as the AI: only the laptop's own page spends the credits.
async function onSay({ id, text }, ws) {
  const answer = !ws.local ? NOT_LOCAL : await speak(text);
  latest.tts = { at: Date.now() };
  console.log(`[tts] "${String(text).slice(0, 40)}": ${typeof answer === "string" ? answer
    : `${answer.chars} chars${answer.cached ? ", cached" : ""} (${answer.ms} ms)`} · ${tts.chars} chars since start`);
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: "speech", id, ...(typeof answer === "string" ? { reason: answer } : { audio: answer.audio, cached: answer.cached }) }));
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
  const dz = latest.depth;
  if (detector.status !== "ready") line += ` | detector ${detector.status}`;
  else if (recent(latest.detect)) line += ` | detector sees ${latest.detect.labels.join(", ") || "nothing"} (${latest.detect.ms} ms)`;
  if (depth.status !== "ready") line += ` | depth ${depth.status}`;
  else if (recent(dz)) line += ` | depth ${!dz.ok ? dz.why : dz.found.length ? dz.found.map((z) => `${z.kind} ${z.distance} m`).join(", ") : "clear"}`;
  if (finder.status !== "ready") line += ` | object finder ${finder.status}`;
  else if (recent(fd)) line += ` | finding "${fd.prompt}" best ${Math.round(fd.best * 100)}% (${fd.ms} ms)`;
  if (recent(latest.ai)) line += ` | ai ${latest.ai.text}`;
  if (recent(latest.tts) && tts.chars) line += ` | tts ${tts.chars} chars`;
  console.log(line);
}

// The WebSocket server passes the web server's errors on (it listens first), so listen there.
wss.on("error", (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  console.log(`Port ${PORT} is already in use: is npm start already running in another terminal?`);
  process.exit(1);
});
server.listen(PORT, () => {
  const k = encodeURIComponent(TOKEN);
  console.log(`Laptop (hands): http://localhost:${PORT}/`);
  console.log(`Phone (eyes):   https://<tunnel address>/eyes?k=${k}`);
  console.log(`Beacon:         https://<tunnel address>/beacon?k=${k}`);
  console.log(process.env.PARADISE_TOKEN?.trim() ? "(link key from PARADISE_TOKEN in .env)"
    : "(a new link key every start: reopen the phone links after a restart, or set PARADISE_TOKEN in .env)");
});
