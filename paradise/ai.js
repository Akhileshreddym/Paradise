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
// Needs GEMINI_API_KEY in paradise/.env (loaded by npm start). GEMINI_MODEL there picks the model.

const KEY = process.env.GEMINI_API_KEY || "";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite"; // fast and cheap; "gemini-3.8-flash" to try a stronger one
const URL_ = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
// Guards for the key and the bill: the pages are reachable through the tunnel (server.js also only
// takes these from the laptop's own page), and a bug shouldn't be able to call it in a loop.
const PER_MINUTE = 6, PER_RUN = 100, MAX_SHOTS = 12, MAX_IMAGE = 200_000; // chars of base64 per photo

export const ai = { status: KEY ? `ready (${MODEL})` : "off: no GEMINI_API_KEY in paradise/.env", calls: 0, tokens: 0 };
console.log(`ai (where to look next): ${ai.status}`);
const recent = [];

// ("water bottle", [{ rel: degrees clockwise from the first photo, image: JPEG data URL }, …]) →
// { visible, view, rel (the chosen photo's), x, target, distance_m, reason, tokens, ms }, or a reason string when there's
// no usable answer (no key, too many calls, network, a reply that doesn't make sense).
export async function whereToLook(what, shots) {
  if (!KEY) return ai.status;
  what = String(what).slice(0, 80);
  shots = shots.slice(0, MAX_SHOTS).filter((s) => typeof s?.image === "string" && s.image.length < MAX_IMAGE &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s.image) && Number.isFinite(s.rel));
  if (!what || !shots.length) return "nothing to ask about";
  const now = Date.now();
  while (recent.length && now - recent[0] > 60000) recent.shift();
  if (recent.length >= PER_MINUTE) return `over ${PER_MINUTE} calls a minute: skipped`;
  if (ai.calls >= PER_RUN) return `over ${PER_RUN} calls since the server started: skipped`;
  recent.push(now); ai.calls++;

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
  let reply;
  try {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { response_mime_type: "application/json", temperature: 0.2 } }),
      signal: AbortSignal.timeout(20000),
    });
    reply = await res.json();
    if (!res.ok) return `Gemini said ${res.status}: ${reply?.error?.message?.slice(0, 120) || "error"}`;
  } catch (err) {
    return `couldn't reach Gemini: ${err.cause?.code || err.message}`;
  }
  const tokens = reply.usageMetadata?.totalTokenCount ?? 0;
  ai.tokens += tokens;
  const text = (reply.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  let a;
  try { a = JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, "")); } catch { return "Gemini's answer wasn't JSON"; }
  const view = Number(a?.view), x = Number(a?.x);
  if (view === -1) return `no good place to look (${String(a?.reason || "").slice(0, 120)})`;
  if (!Number.isInteger(view) || view < 0 || view >= shots.length || !Number.isFinite(x)) return "Gemini's answer didn't point at a photo";
  const dist = Number(a.distance_m);
  return {
    visible: a.visible === true, view, rel: shots[view].rel, x: Math.min(1000, Math.max(0, x)),
    target: String(a.target || "that spot").slice(0, 60), reason: String(a.reason || "").slice(0, 160),
    distance_m: Number.isFinite(dist) && dist > 0 ? Math.min(dist, 15) : null, tokens, ms: Date.now() - t0,
  };
}
