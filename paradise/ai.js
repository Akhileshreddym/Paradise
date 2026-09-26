// "Where should I look next?": the one place Paradise asks a cloud AI (Google Gemini), and only
// when a full 360° scan of the room found nothing. Seeing, distances, obstacles and steering all
// stay on the phone and this laptop (YOLO, the object finder, CLIP, the depth model).
//
// The laptop page sends the scan's small photos (the preview frames, 202 × 360: 258 tokens each),
// one per stop, with how far round from the start each was taken. Gemini says either where the
// thing is (it can see it), or the best place to walk to next to look for it ("the kitchen
// counter", "the doorway on the left"), as a view number and a position across that view. The
// laptop page turns that into a direction and walks the wearer there; the phone's detectors still
// have to find the thing before the "found it" buzz.
//
// And one smaller job, text only: a request in plain language ("something to drink", "somewhere to
// sit") → the thing to look for ("water bottle", "chair"), since the detectors need a thing's name.
//
// And spoken commands, text only: what the wearer said after "Paradise" ("take me somewhere to sit",
// "go to test north", "never mind") → one of the few things the laptop page can do. The page has its
// own simple grammar too and uses that when this is slow or off.
//
// Needs GEMINI_API_KEY in paradise/.env (loaded by npm start). GEMINI_MODEL there picks the model.

const KEY = process.env.GEMINI_API_KEY || "";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite"; // fast and cheap; "gemini-3.8-flash" to try a stronger one
const URL_ = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
// Guards for the key and the bill: the pages are reachable through the tunnel (server.js also only
// takes these from the laptop's own page), and a bug shouldn't be able to call it in a loop.
// Commands get their own, bigger budget (they're small, text only, and a few a minute is normal
// talking), so a chatty wearer can't use up the room scans' calls, nor a scan loop the commands'.
// Commands also give up sooner: the laptop page falls back to its own grammar after 5 s anyway.
const MAX_SHOTS = 12, MAX_IMAGE = 200_000; // chars of base64 per photo
const SCANS = { perMinute: 6, perRun: 100, timeout: 20000, recent: [], calls: 0 };
const COMMANDS = { perMinute: 20, perRun: 400, timeout: 8000, recent: [], calls: 0 };

export const ai = { status: KEY ? `ready (${MODEL})` : "off: no GEMINI_API_KEY in paradise/.env", calls: 0, tokens: 0 }; // all jobs
console.log(`ai (where to look next, commands): ${ai.status}`);

// ("water bottle", [{ rel: degrees clockwise from the first photo, image: JPEG data URL }, …]) →
// { visible, view, rel (the chosen photo's), x, target, distance_m, reason, tokens, ms }, or a reason string when there's
// no usable answer (no key, too many calls, network, a reply that doesn't make sense).
export async function whereToLook(what, shots) {
  what = String(what).slice(0, 80);
  shots = shots.slice(0, MAX_SHOTS).filter((s) => typeof s?.image === "string" && s.image.length < MAX_IMAGE &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s.image) && Number.isFinite(s.rel));
  if (!what || !shots.length) return "nothing to ask about";

  const parts = [{ text:
    `You are helping a blind person find: "${what}". They wear a phone on their chest, camera facing forward. ` +
    `They just turned in a full circle where they stand; here is one photo per stop, in order. ` +
    `A small on-device detector looked at every photo and did NOT find "${what}", but it misses small, ` +
    `partly hidden or unusual-looking things.\n` +
    `1. If "${what}" is visible in any photo, answer with that photo and where it is.\n` +
    `2. Otherwise pick the one place, visible in a photo, that they should walk to next to find it: ` +
    `where it's most likely to be (think about where people usually keep it), or a doorway or hallway ` +
    `to where it's likely to be. It must be reachable on foot across open floor. ` +
    `If no photo shows anywhere worth walking to, use view -1.\n` +
    `Answer with JSON only: {"visible": true|false, "view": photo number, "x": horizontal position of ` +
    `the thing or place in that photo, 0 = left edge, 1000 = right edge, "target": a short name for it ` +
    `("the desk", "the doorway"), "distance_m": your rough guess of how far away it is, in meters, ` +
    `"reason": one short sentence}` }];
  shots.forEach((s, i) => parts.push(
    { text: `Photo ${i}: ${Math.round(s.rel)}° clockwise from the first photo.` },
    { inline_data: { mime_type: "image/jpeg", data: s.image.slice(s.image.indexOf(",") + 1) } },
  ));

  const t0 = Date.now();
  const a = await ask(parts);
  if (typeof a === "string") return a;
  const view = Number(a?.view), x = Number(a?.x);
  if (view === -1) return `no good place to look (${String(a?.reason || "").slice(0, 120)})`;
  if (!Number.isInteger(view) || view < 0 || view >= shots.length || !Number.isFinite(x)) return "Gemini's answer didn't point at a photo";
  const dist = Number(a.distance_m);
  return {
    visible: a.visible === true, view, rel: shots[view].rel, x: Math.min(1000, Math.max(0, x)),
    target: String(a.target || "that spot").slice(0, 60), reason: String(a.reason || "").slice(0, 160),
    distance_m: Number.isFinite(dist) && dist > 0 ? Math.min(dist, 15) : null, tokens: a.tokens, ms: Date.now() - t0,
  };
}

// "something to drink" → { thing: "water bottle", reason, tokens, ms }, or a reason string.
export async function whatToFind(request) {
  request = String(request).slice(0, 80);
  if (!request) return "nothing to ask about";
  const t0 = Date.now();
  const a = await ask([{ text:
    `A blind person asked the device on their chest to find: "${request}". Name the one kind of ` +
    `physical object its camera should look for to do that, in 1 to 3 plain words an object detector ` +
    `understands ("water bottle", "chair", "trash can", "cup", "pen"): the most likely one nearby in an ` +
    `ordinary home, office or classroom. Answer with JSON only: {"thing": "…", "reason": "one short sentence"}` }]);
  if (typeof a === "string") return a;
  const thing = String(a?.thing || "").toLowerCase().trim();
  if (!/^[a-z][a-z' -]{1,38}$/.test(thing)) return "Gemini's answer wasn't a thing's name";
  return { thing, reason: String(a.reason || "").slice(0, 160), tokens: a.tokens, ms: Date.now() - t0 };
}

// What the wearer said after "Paradise" ("take me somewhere to sit"), the saved places' names, and
// what the device is doing now ('find "cup"', "none") → { intent, place, thing, reason, tokens, ms },
// or a reason string. intent is one of INTENTS; place is only set for "place" (spelled as in the
// list), thing only for "find". An answer that doesn't check out (a place that isn't in the list, a
// thing that isn't a thing's name) is a reason string too, like no answer: the page then tries its
// own grammar, which may well understand "go to test north" even when Gemini misspelled it. Never
// a guess: walking the wearer somewhere they didn't ask for isn't safe. Gemini's own "none" stays
// "none" (not a request, or unclear): the page says it didn't understand.
const INTENTS = ["waymo", "place", "find", "stop", "repeat", "none"];
// A place's name as Gemini might write it back: "Test North." → "test north".
const placeKey = (p) => String(p ?? "").replace(/\s+/g, " ").trim().replace(/^["'“”‘’]+|[\s.,;:!?"'“”‘’]+$/g, "").toLowerCase();
export async function understandCommand(text, places, current = "none") {
  text = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  places = (Array.isArray(places) ? places : []).map((p) => String(p ?? "").replace(/\s+/g, " ").trim().slice(0, 40))
    .filter(Boolean).slice(0, 20);
  current = String(current || "none").slice(0, 80);
  if (!text) return "nothing to ask about";
  const t0 = Date.now();
  const a = await ask([{ text:
    `A blind and deaf person wears a guidance device on their chest. They said "Paradise" and then: ` +
    `${JSON.stringify(text)} (speech to text, so words may be misheard). It is doing now: ${current}. ` +
    `Their saved places: ${JSON.stringify(places)}.\n` +
    `Which one command did they mean?\n` +
    `- "waymo": go to their Waymo, the car, their ride, the taxi.\n` +
    `- "place": go to one of the saved places; "place" must be copied exactly from the list. ` +
    `If they named a place that isn't in the list, use "none".\n` +
    `- "find": find, get, bring or lead them to a physical thing, or "where is …". "thing" is the one ` +
    `kind of object the camera should look for, in 1 to 3 plain words an object detector understands ` +
    `("something to drink" → "water bottle", "somewhere to sit" → "chair", "the bin" → "trash can").\n` +
    `- "stop": stop, cancel, never mind, that's enough.\n` +
    `- "repeat": what are we doing, say that again, repeat.\n` +
    `- "none": not a request to the device (talking to someone else, small talk), or unclear.\n` +
    `Answer with JSON only: {"intent": "waymo"|"place"|"find"|"stop"|"repeat"|"none", ` +
    `"place": name or null, "thing": "…" or null, "reason": "one short sentence"}` }], COMMANDS);
  if (typeof a === "string") return a;
  if (!INTENTS.includes(a?.intent)) return "Gemini's answer wasn't one of the commands";
  const { intent } = a;
  let place = null, thing = null;
  if (intent === "place") {
    const said = placeKey(a.place);
    place = said ? places.find((p) => placeKey(p) === said) ?? null : null;
    if (!place) return said ? `Gemini named "${said.slice(0, 40)}", which isn't a saved place` : "Gemini named no saved place";
  } else if (intent === "find") {
    thing = String(a.thing ?? "").toLowerCase().trim();
    if (!/^[a-z][a-z' -]{1,38}$/.test(thing)) return "Gemini's answer wasn't a thing's name";
  }
  return { intent, place, thing, reason: String(a.reason || "").slice(0, 160), tokens: a.tokens, ms: Date.now() - t0 };
}

// One call, JSON back: the parsed answer (+ tokens), or a reason string. Each job's limits are its
// own (SCANS, unless told otherwise); ai.calls and ai.tokens count them all.
async function ask(parts, job = SCANS) {
  if (!KEY) return ai.status;
  const now = Date.now();
  while (job.recent.length && now - job.recent[0] > 60000) job.recent.shift();
  if (job.recent.length >= job.perMinute) return `over ${job.perMinute} calls a minute: skipped`;
  if (job.calls >= job.perRun) return `over ${job.perRun} calls since the server started: skipped`;
  job.recent.push(now); job.calls++; ai.calls++;
  let reply;
  try {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { response_mime_type: "application/json", temperature: 0.2 } }),
      signal: AbortSignal.timeout(job.timeout),
    });
    reply = await res.json();
    if (!res.ok) return `Gemini said ${res.status}: ${reply?.error?.message?.slice(0, 120) || "error"}`;
  } catch (err) {
    return `couldn't reach Gemini: ${err.cause?.code || err.message}`;
  }
  const tokens = reply.usageMetadata?.totalTokenCount ?? 0;
  ai.tokens += tokens;
  const text = (reply.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  try {
    const a = JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, ""));
    return a && typeof a === "object" ? { ...a, tokens } : "Gemini's answer wasn't JSON";
  } catch { return "Gemini's answer wasn't JSON"; }
}
