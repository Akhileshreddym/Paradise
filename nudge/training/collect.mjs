// Step 1: lists of openly licensed photo URLs (Wikimedia Commons, Openverse): positives (Waymo)
// and negatives (other cars, including look-alikes: plain Jaguar I-Paces, other robotaxis).

import { mkdirSync as _mkdir } from "node:fs";
import { fileURLToPath as _path } from "node:url";
// Everything (photos, crops, vectors) lives in training/data/, which git ignores.
_mkdir(new URL("./data/", import.meta.url), { recursive: true });
process.chdir(_path(new URL("./data/", import.meta.url)));
import { writeFileSync } from "node:fs";
const UA = { "User-Agent": "NudgeTraining/0.1 (hackathon research)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Be polite: a pause before every call, and back off when rate-limited.
async function getJson(url) {
  for (let i = 0; i < 6; i++) {
    await sleep(700 * 2 ** i);
    const text = await (await fetch(url, { headers: UA })).text();
    try { return JSON.parse(text); } catch { console.log("rate-limited, waiting…", url.slice(0, 60)); }
  }
  return {};
}
const api = (params) => getJson("https://commons.wikimedia.org/w/api.php?format=json&" + new URLSearchParams(params));

// All files in a Commons category and its subcategories (to a depth), with 640 px thumbnails.
async function category(cat, depth, seen = new Set()) {
  if (seen.has(cat)) return [];
  seen.add(cat);
  const files = [];
  let cont = {};
  do {
    const r = await api({ action: "query", generator: "categorymembers", gcmtitle: cat, gcmlimit: 500, gcmtype: "file|subcat", prop: "imageinfo", iiprop: "url|mime", iiurlwidth: 640, ...cont });
    for (const p of Object.values(r.query?.pages || {})) {
      if (p.ns === 14 && depth > 0) files.push(...await category(p.title, depth - 1, seen));
      const ii = p.imageinfo?.[0];
      if (p.ns === 6 && ii && /jpeg|png/.test(ii.mime)) files.push({ id: "c:" + p.title, url: ii.thumburl, src: cat });
    }
    cont = r.continue || null;
  } while (cont);
  return files;
}
async function search(q, limit) {
  const r = await api({ action: "query", generator: "search", gsrsearch: q, gsrnamespace: 6, gsrlimit: limit, prop: "imageinfo", iiprop: "url|mime", iiurlwidth: 640 });
  return Object.values(r.query?.pages || {}).filter((p) => /jpeg|png/.test(p.imageinfo?.[0]?.mime)).map((p) => ({ id: "c:" + p.title, url: p.imageinfo[0].thumburl, src: "search:" + q }));
}
async function openverse(q, pages) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const r = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=20&page=${page}`);
    for (const x of r.results || []) out.push({ id: "o:" + x.id, url: x.thumbnail || x.url, src: "openverse:" + q, title: x.title });
    if (!r.results?.length) break;
  }
  return out;
}
const uniq = (xs) => [...new Map(xs.map((x) => [x.id, x])).values()];

const pos = uniq([
  ...await category("Category:Waymo vehicles", 3),
  ...await search("Waymo car", 200),
  ...await search("Waymo Jaguar I-Pace", 100),
  ...await openverse("waymo", 12),
  ...await openverse("waymo car", 6),
]).filter((x) => !/logo|\.svg|map|interior|dashboard|screenshot|headquarter|office|sign/i.test(x.id + (x.title || "")));

const negQueries = ["Jaguar I-Pace", "Cruise Origin", "Cruise Chevrolet Bolt autonomous", "Zoox robotaxi", "taxi San Francisco", "Uber car", "Tesla Model Y", "Toyota Camry", "Honda Civic", "Ford F-150", "Chrysler Pacifica", "police car", "parked cars street", "SUV", "sedan", "hatchback"];
let neg = [];
for (const q of negQueries) neg.push(...await search(q, 40), ...await openverse(q, 2));
neg = uniq(neg).filter((x) => !/waymo/i.test(x.id + (x.title || "") + x.src));
writeFileSync("lists.json", JSON.stringify({ pos, neg }, null, 1));
console.log("positives", pos.length, "negatives", neg.length);
