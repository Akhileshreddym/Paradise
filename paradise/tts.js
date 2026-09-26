// Speech for the people around the wearer (ElevenLabs): the wearer is deaf and gets everything by
// touch, but onlookers, helpers and a demo audience can hear what the device is doing ("Finding a
// chair.", "Stop. Person ahead."). The laptop page sends a short sentence, gets an MP3 back as a
// data URL and plays it on the laptop's speakers. Nothing here guides the wearer.
//
// Needs ELEVENLABS_API_KEY in paradise/.env (loaded by npm start); without it the page just stays
// quiet. ELEVENLABS_VOICE_ID and ELEVENLABS_MODEL there pick the voice and the model.

const KEY = process.env.ELEVENLABS_API_KEY || "";
const VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // "Rachel", a clear stock voice
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5"; // the fastest, and cheaper per character
const URL_ = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(VOICE)}?output_format=mp3_44100_64`;
// Guards for the credits (billed per character): only short sentences, the same sentence only once
// (the page says the same few things over and over), and a bug can't speak in a loop. The budget
// counts characters actually sent; cached ones are free.
const MAX_TEXT = 200, PER_MINUTE = 30, PER_RUN = 20_000, MAX_CACHED = 200; // chars, calls, chars, sentences

export const tts = { status: KEY ? `ready (${MODEL})` : "off: no ELEVENLABS_API_KEY in paradise/.env", calls: 0, chars: 0 };
console.log(`tts (speech for onlookers): ${tts.status}`);
const recent = [], cache = new Map(); // text → data URL, oldest first
const pending = new Map(); // text → the call on its way: the same sentence twice at once is paid once

// "Finding a chair." → { audio: "data:audio/mpeg;base64,…", chars, cached, ms }, or a reason string
// (no key, too long, over a limit, network, ElevenLabs said no).
export async function speak(text) {
  text = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "nothing to say";
  if (text.length > MAX_TEXT) return `longer than ${MAX_TEXT} characters: not spoken`;
  if (!KEY) return tts.status;
  const t0 = Date.now();
  const hit = cache.get(text);
  if (hit) {
    cache.delete(text); cache.set(text, hit); // used again: now the newest, dropped last
    return { audio: hit, chars: text.length, cached: true, ms: Date.now() - t0 };
  }
  if (pending.has(text)) {
    const audio = await pending.get(text);
    return audio.startsWith("data:") ? { audio, chars: text.length, cached: true, ms: Date.now() - t0 } : audio;
  }
  const now = Date.now();
  while (recent.length && now - recent[0] > 60000) recent.shift();
  if (recent.length >= PER_MINUTE) return `over ${PER_MINUTE} sentences a minute: skipped`;
  if (tts.chars + text.length > PER_RUN) return `over ${PER_RUN} characters since the server started: skipped`;
  recent.push(now); tts.calls++;
  const call = synthesize(text);
  pending.set(text, call);
  const audio = await call.finally(() => pending.delete(text));
  if (!audio.startsWith("data:")) return audio;
  tts.chars += text.length; // billed only when it worked
  cache.set(text, audio);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
  return { audio, chars: text.length, cached: false, ms: Date.now() - t0 };
}

// One call: the MP3 as a data URL, or a reason string.
async function synthesize(text) {
  try {
    const res = await fetch(URL_, {
      method: "POST",
      headers: { "xi-api-key": KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: MODEL }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return `ElevenLabs said ${res.status}: ${errorMessage(await res.text().catch(() => ""))}`;
    return `data:audio/mpeg;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch (err) {
    return `couldn't reach ElevenLabs: ${err.cause?.code || err.message}`;
  }
}

// ElevenLabs' error body → its message, short: { detail: { status, message } }, { detail: "…" }, or
// (bad request) { detail: [{ msg }] }; anything else as it came.
function errorMessage(body) {
  let d;
  try { d = JSON.parse(body)?.detail; } catch {}
  const text = typeof d === "string" ? d : d?.message || d?.[0]?.msg || d?.status || body;
  return String(text || "error").slice(0, 120);
}
