// Step 4: CLIP image features (512 numbers) for every crop, the same model the server runs.

import { mkdirSync as _mkdir } from "node:fs";
import { fileURLToPath as _path } from "node:url";
// Everything (photos, crops, vectors) lives in training/data/, which git ignores.
_mkdir(new URL("./data/", import.meta.url), { recursive: true });
process.chdir(_path(new URL("./data/", import.meta.url)));
import { CLIPVisionModelWithProjection, AutoProcessor, RawImage, env } from "@huggingface/transformers";
import { readdirSync, writeFileSync } from "node:fs";
env.cacheDir = env.localModelPath = _path(new URL("../models/", import.meta.url)); // same copy the server uses
const proc = await AutoProcessor.from_pretrained("Xenova/clip-vit-base-patch32");
const model = await CLIPVisionModelWithProjection.from_pretrained("Xenova/clip-vit-base-patch32", { dtype: "q8" });
const rows = [];
for (const cls of ["pos", "neg"]) for (const f of readdirSync(`crops/${cls}`)) {
  const { image_embeds } = await model(await proc(await RawImage.read(`crops/${cls}/${f}`)));
  rows.push({ file: `${cls}/${f}`, y: cls === "pos" ? 1 : 0, v: Array.from(image_embeds.data) });
}
writeFileSync("emb_clip.json", JSON.stringify(rows));
console.log("clip vectors", rows.length, rows[0].v.length);
