// Step 2: download the photos into data/img/pos and data/img/neg (up to 700 negatives).
// Your own photos can go straight into those folders too: they're the best training data.

import { mkdirSync as _mkdir } from "node:fs";
import { fileURLToPath as _path } from "node:url";
// Everything (photos, crops, vectors) lives in training/data/, which git ignores.
_mkdir(new URL("./data/", import.meta.url), { recursive: true });
process.chdir(_path(new URL("./data/", import.meta.url)));
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
const UA = { "User-Agent": "NudgeTraining/0.1 (hackathon research)" };
const { pos, neg } = JSON.parse(readFileSync("lists.json"));
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
const jobs = [...pos.map((x) => ({ ...x, cls: "pos" })), ...shuffle(neg).slice(0, 700).map((x) => ({ ...x, cls: "neg" }))];
for (const d of ["img/pos", "img/neg"]) mkdirSync(d, { recursive: true });
let done = 0, failed = 0;
const meta = {};
async function worker() {
  while (jobs.length) {
    const j = jobs.shift();
    const file = `img/${j.cls}/${createHash("md5").update(j.id).digest("hex").slice(0, 12)}.jpg`;
    meta[file] = { id: j.id, src: j.src, url: j.url };
    if (existsSync(file)) { done++; continue; }
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(j.url, { headers: UA });
        if (r.status === 429) { await new Promise((s) => setTimeout(s, 3000 * (i + 1))); continue; }
        if (!r.ok || !/image/.test(r.headers.get("content-type") || "")) { failed++; break; }
        writeFileSync(file, Buffer.from(await r.arrayBuffer()));
        done++;
        break;
      } catch { await new Promise((s) => setTimeout(s, 2000)); }
    }
    if ((done + failed) % 100 === 0) console.log(`done ${done}, failed ${failed}, left ${jobs.length}`);
  }
}
await Promise.all([worker(), worker(), worker()]);
writeFileSync("meta.json", JSON.stringify(meta, null, 1));
console.log(`finished: ${done} downloaded, ${failed} failed`);
