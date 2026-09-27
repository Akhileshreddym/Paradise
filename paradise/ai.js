// The cloud AI Paradise asks (Google Gemini), for a few small jobs. Seeing, distances, obstacles and
// steering all stay on the phone and this laptop (YOLO, the object finder, CLIP, the depth model).
//
// "Have we really arrived?": in find mode, once the camera's distance says the wearer is close to
// the thing, a photo from the chest camera → is it within arm's reach? The laptop page stops the
// wearer while it asks, then either buzzes "reached" or takes them one more step and asks again.
//
// A request in plain language ("something to drink", "somewhere to sit") → the thing to look for
// ("water bottle", "chair"), since the detector needs a thing's name. Text only.
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
// takes these from the laptop's own page), and a bug shouldn't be able to call it in a loop. Each
// job has its own budget, so a chatty wearer can't use up the arrival checks, nor the other way
// round. Both give up after 8 s: the laptop page then goes on without the answer.
const MAX_IMAGE = 300_000; // chars of base64 per photo
const ARRIVALS = { perMinute: 20, perRun: 300, timeout: 8000, recent: [], calls: 0 };
const COMMANDS = { perMinute: 20, perRun: 400, timeout: 8000, recent: [], calls: 0 };

export const ai = { status: KEY ? `ready (${MODEL})` : "off: no GEMINI_API_KEY in paradise/.env", calls: 0, tokens: 0 }; // all jobs
console.log(`ai (arrival checks, commands): ${ai.status}`);

// ("bottle", JPEG data URL of the chest camera now, whether the detector still sees it) →
// { arrived, distance_m, reason, tokens, ms }, or a reason string when there's no usable answer.
export async function checkArrived(what, image, inView) {
  what = String(what).slice(0, 80);
  if (!what || typeof image !== "string" || image.length > MAX_IMAGE || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image)) return "nothing to ask about";
  const t0 = Date.now();
  const a = await ask([
    { text:
      `A blind person is walking to a ${JSON.stringify(what)}, guided by a phone on their chest (about 1.3 m above ` +
      `the floor, camera facing forward). This is what the camera sees right now. ` +
      (inView ? "" : `The detector lost sight of the ${what} a moment ago; up close it usually drops off the bottom ` +
        `edge of the view (below the chest). `) +
      `Are they right next to it: the ${what} within arm's reach, about 0.6 m or less from their chest, so they ` +
      `could reach out and touch it without another step? If it isn't in the photo, judge from what is (the ` +
      `edge of the table or counter it was on, right below the camera, means yes). When unsure, say no.\n` +
      `Answer with JSON only: {"arrived": true|false, "distance_m": your estimate of how far it is in meters, or ` +
      `null, "reason": "one short sentence"}` },
    { inline_data: { mime_type: "image/jpeg", data: image.slice(image.indexOf(",") + 1) } },
  ], ARRIVALS);
  if (typeof a === "string") return a;
  if (typeof a?.arrived !== "boolean") return "Gemini's answer didn't say yes or no";
  const dist = Number(a.distance_m);
  return { arrived: a.arrived, distance_m: Number.isFinite(dist) && dist >= 0 ? Math.round(Math.min(dist, 20) * 10) / 10 : null,
    reason: String(a.reason || "").slice(0, 160), tokens: a.tokens, ms: Date.now() - t0 };
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
// own (COMMANDS, unless told otherwise); ai.calls and ai.tokens count them all.
async function ask(parts, job = COMMANDS) {
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
