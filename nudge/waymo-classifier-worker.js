// Runs the Waymo classifier in its own process (see waymo-classifier.js), so it neither holds up
// the relay nor waits behind the door handle finder.

import { AutoProcessor, CLIPVisionModelWithProjection, env, RawImage } from "@huggingface/transformers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

env.cacheDir = env.localModelPath = fileURLToPath(new URL("./models/", import.meta.url));
const MODEL = "Xenova/clip-vit-base-patch32";
// Trained by training/train.mjs: standardize the 512 CLIP numbers, then logistic regression.
const HEAD = JSON.parse(readFileSync(new URL("./waymo-head.json", import.meta.url)));

const ready = Promise.all([
  AutoProcessor.from_pretrained(MODEL),
  CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: "q8" }),
]);
ready.then(
  () => process.send({ type: "status", status: "ready" }),
  (err) => process.send({ type: "status", status: `failed: ${err.message}` }),
);

// { id, images: [data URL, …] } → { id, probs: [0–1, …] }: how sure each crop is a Waymo.
process.on("message", async ({ id, images }) => {
  try {
    const [processor, model] = await ready;
    const probs = [];
    for (const image of images) {
      const img = await RawImage.fromBlob(new Blob([Buffer.from(image.split(",")[1], "base64")]));
      const { image_embeds } = await model(await processor(img));
      let z = HEAD.b;
      image_embeds.data.forEach((x, i) => (z += ((x - HEAD.mean[i]) / HEAD.std[i]) * HEAD.w[i]));
      probs.push(1 / (1 + Math.exp(-z)));
    }
    process.send({ type: "probs", id, probs });
  } catch (err) {
    process.send({ type: "probs", id, error: err.message });
  }
});
