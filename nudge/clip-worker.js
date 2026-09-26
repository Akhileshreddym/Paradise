// Runs CLIP in its own process (see clip.js): the Waymo classifier, and second opinions for the
// object finder. Neither holds up the relay or waits behind the object finder.

import {
  AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, env, RawImage,
} from "@huggingface/transformers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

env.cacheDir = env.localModelPath = fileURLToPath(new URL("./models/", import.meta.url));
const MODEL = "Xenova/clip-vit-base-patch32";
// Trained by training/train.mjs: standardize the 512 CLIP numbers, then logistic regression.
const HEAD = JSON.parse(readFileSync(new URL("./waymo-head.json", import.meta.url)));

// What a found box might be instead of the thing asked for: YOLO's everyday classes plus things
// the object finder confused in tests (plastic bags, kettles…).
const OTHERS = [
  "person", "bicycle", "car", "motorcycle", "bus", "truck", "traffic light", "fire hydrant", "stop sign", "bench",
  "bird", "cat", "dog", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "sports ball",
  "kite", "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon",
  "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "pizza", "donut", "cake", "chair",
  "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard",
  "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors",
  "teddy bear", "toothbrush", "plastic bag", "box", "wall", "floor", "window", "door", "shelf", "cabinet",
  "lamp", "kettle", "sign", "paper", "bag", "shoe", "jacket", "pillow", "blanket", "trash can",
];

const ready = Promise.all([
  AutoProcessor.from_pretrained(MODEL),
  CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: "q8" }),
  AutoTokenizer.from_pretrained(MODEL),
  CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: "q8" }),
]);
ready.then(
  () => process.send({ type: "status", status: "ready" }),
  (err) => process.send({ type: "status", status: `failed: ${err.message}` }),
);

const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
const fromDataUrl = (url) => RawImage.fromBlob(new Blob([Buffer.from(url.split(",")[1], "base64")]));
async function imageFeatures(img) {
  const [processor, vision] = await ready;
  return Array.from((await vision(await processor(img))).image_embeds.data);
}
const textCache = new Map(); // label → unit vector
async function textFeatures(labels) {
  const [, , tokenizer, text] = await ready;
  const missing = labels.filter((l) => !textCache.has(l));
  if (missing.length) {
    const { text_embeds } = await text(tokenizer(missing.map((l) => `a photo of a ${l}.`), { padding: true, truncation: true }));
    const D = text_embeds.dims[1];
    missing.forEach((l, i) => textCache.set(l, unit(Array.from(text_embeds.data.slice(i * D, (i + 1) * D)))));
  }
  return labels.map((l) => textCache.get(l));
}

const jobs = {
  // { images: [data URL…] } → [probability it's a Waymo…]
  async waymo({ images }) {
    const probs = [];
    for (const image of images) {
      let z = HEAD.b;
      (await imageFeatures(await fromDataUrl(image))).forEach((x, i) => (z += ((x - HEAD.mean[i]) / HEAD.std[i]) * HEAD.w[i]));
      probs.push(1 / (1 + Math.exp(-z)));
    }
    return probs;
  },
  // { image, boxes, what, same } → [does each box look like `what`?]: the thing has to be CLIP's
  // top pick among itself and OTHERS (leaving out words that mean the same, like cup for mug).
  // Each box is cropped with 15% extra around it, as in the tests.
  async check({ image, boxes, what, same }) {
    const img = await fromDataUrl(image);
    const words = [what, ...same].map((w) => w.toLowerCase());
    const labels = [what, ...OTHERS.filter((o) => !words.some((w) => w.includes(o) || o.includes(w)))];
    const texts = await textFeatures(labels);
    const out = [];
    for (const b of boxes) {
      const w = b.x2 - b.x1, h = b.y2 - b.y1;
      const x1 = Math.max(0, Math.round(b.x1 - 0.15 * w)), y1 = Math.max(0, Math.round(b.y1 - 0.15 * h));
      const x2 = Math.min(img.width - 1, Math.round(b.x2 + 0.15 * w)), y2 = Math.min(img.height - 1, Math.round(b.y2 + 0.15 * h));
      const v = unit(await imageFeatures(await img.crop([x1, y1, x2, y2])));
      const scores = texts.map((t) => t.reduce((s, x, i) => s + x * v[i], 0));
      out.push(scores.every((s, i) => i === 0 || s <= scores[0]));
    }
    return out;
  },
};

process.on("message", async ({ id, job, ...args }) => {
  try {
    process.send({ type: "result", id, result: await jobs[job](args) });
  } catch (err) {
    process.send({ type: "result", id, error: err.message });
  }
});
