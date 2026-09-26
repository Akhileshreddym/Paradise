// Contact sheet of crops, numbered, to check them by eye: node sheet.mjs crops/pos sheet.jpg [start] [count]
import { mkdirSync as _mkdir } from "node:fs";
import { fileURLToPath as _path } from "node:url";
// Everything (photos, crops, vectors) lives in training/data/, which git ignores.
_mkdir(new URL("./data/", import.meta.url), { recursive: true });
process.chdir(_path(new URL("./data/", import.meta.url)));
import sharp from "sharp";
import { readdirSync, writeFileSync } from "node:fs";
const [dir, out, start = 0, count = 120] = process.argv.slice(2);
const files = readdirSync(dir).sort().slice(+start, +start + +count);
const T = 96, cols = 12, rows = Math.ceil(files.length / cols);
const tiles = await Promise.all(files.map(async (f, i) => {
  const img = await sharp(`${dir}/${f}`).resize(T, T).toBuffer();
  const label = Buffer.from(`<svg width="${T}" height="16"><rect width="${T}" height="16" fill="black"/><text x="2" y="12" font-size="12" fill="yellow" font-family="monospace">${+start + i}</text></svg>`);
  return { input: await sharp(img).composite([{ input: label, top: 0, left: 0 }]).toBuffer(), left: (i % cols) * T, top: Math.floor(i / cols) * T };
}));
await sharp({ create: { width: cols * T, height: rows * T, channels: 3, background: "#000" } }).composite(tiles).jpeg({ quality: 80 }).toFile(out);
writeFileSync(out + ".txt", files.map((f, i) => `${+start + i} ${f}`).join("\n"));
