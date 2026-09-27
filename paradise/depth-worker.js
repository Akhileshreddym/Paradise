// Runs the depth model in its own process (see depth.js), so it never holds up the relay.

import { env, pipeline, RawImage } from "@huggingface/transformers";
import { fileURLToPath } from "node:url";

// The server went away (crashed, or stopped): don't linger. (A plain terminate signal: exiting
// normally with the ONNX runtime's threads running prints a scary but harmless C++ error.)
process.on("disconnect", () => process.kill(process.pid, "SIGTERM"));

env.cacheDir = env.localModelPath = fileURLToPath(new URL("./models/", import.meta.url));

const MODEL = "onnx-community/depth-anything-v2-small";
const ready = pipeline("depth-estimation", MODEL, { dtype: "q8" }).then((depth) => {
  // 364 px instead of the default 518: ~80 ms a frame instead of ~200 on an M3 Pro, and the
  // preview frames it gets are only 360 px anyway.
  depth.processor.image_processor.size = { width: 364, height: 364 };
  return depth;
});
ready.then(
  () => process.send({ type: "status", status: "ready" }),
  (err) => process.send({ type: "status", status: `failed: ${err.message}` }),
);

// { id, image: data URL, cam: { focal (in this image's pixels), camH (m), pitch (degrees down) } }
// → { id, result: see analyze() }
process.on("message", async ({ id, image, cam }) => {
  try {
    const depth = await ready;
    const img = await RawImage.fromBlob(new Blob([Buffer.from(image.split(",")[1], "base64")]));
    const { predicted_depth: pd } = await depth(img); // same size as the image
    const [H, W] = pd.dims;
    const result = analyze(pd.data, W, H, { f: cam.focal, camH: cam.camH, pitch: ((cam.pitch || 0) * Math.PI) / 180 });
    process.send({ type: "result", id, result });
  } catch (err) {
    process.send({ type: "result", id, error: err.message });
  }
});

// Depth map → hazards in the walking path.
//
// The model's output is relative (bigger = closer, in unknown units). The floor is the ruler: the
// camera's height and tilt say how far away each floor pixel is, so fitting the model's values
// on the floor 1–4 m ahead to those distances turns the whole frame into meters. Then every pixel
// becomes a 3D point, and anything in the walking path (±0.4 m sideways, up to 4 m ahead) that
// sticks up from the floor (12 cm to 2.1 m) is an obstacle; anything that lies well below it is a
// drop-off. No floor that fits at all means something is right in front (a wall, a door): blocked.
//
// Tested on rendered scenes with exact geometry (a box 1.4 m ahead was found at 1.27 m; a clear
// floor gave nothing; a wall 1.2 m ahead gave "blocked") and on photos of corridors, streets and
// stairs. Not seen: low curbs (15 cm) and drop-offs whose edge doesn't show; glass.
function analyze(D, W, H, { f, camH, pitch, corridor = 0.4, near = 4 }) {
  const cx = W / 2, cy = H / 2, cp = Math.cos(pitch), sp = Math.sin(pitch);
  // 1. Where the floor would be 1–4 m ahead: its expected 1/Z (Z = depth along the camera's axis)
  //    against the model's output.
  const inv = [], val = [];
  for (let y = 0; y < H; y++) {
    const a = Math.atan((y + 0.5 - cy) / f), below = pitch + a; // angle below horizontal
    if (below <= 0.03) continue;
    const G = camH / Math.tan(below); // how far ahead that row meets the floor
    if (G < 1 || G > 4) continue;
    const Z = (camH * Math.cos(a)) / Math.sin(below);
    for (let x = Math.round(W * 0.05); x < W * 0.95; x += 2) { inv.push(1 / Z); val.push(D[y * W + x]); }
  }
  if (inv.length < 200) return { ok: false, why: "no floor in view (tilt the phone down a little)" };
  // 2. RANSAC line: the straight line most of those pixels agree on is the floor, even with a box
  //    or a person standing on part of it. Then least squares on the pixels that agree.
  let lo = Infinity, hi = -Infinity;
  for (const v of val) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const tol = 0.05 * (hi - lo || 1);
  let best = { n: 0, s: 0, t: 0 }, seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 150; k++) {
    const i = Math.floor(rand() * inv.length), j = Math.floor(rand() * inv.length);
    if (Math.abs(inv[i] - inv[j]) < 1e-3) continue;
    const s1 = (val[i] - val[j]) / (inv[i] - inv[j]), t1 = val[i] - s1 * inv[i];
    if (!(s1 > 0)) continue; // the floor gets closer lower in the frame: the model's value must rise
    let n = 0;
    for (let q = 0; q < inv.length; q++) if (Math.abs(val[q] - (s1 * inv[q] + t1)) < tol) n++;
    if (n > best.n) best = { n, s: s1, t: t1 };
  }
  const floor = best.n / inv.length; // how much of where the floor should be looks like floor
  if (floor < 0.25) return { ok: false, why: "floor not visible (something close in front?)", floor: round(floor) };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
  for (let q = 0; q < inv.length; q++) {
    if (Math.abs(val[q] - (best.s * inv[q] + best.t)) >= tol) continue;
    sx += inv[q]; sy += val[q]; sxx += inv[q] * inv[q]; sxy += inv[q] * val[q]; m++;
  }
  const s = (m * sxy - sx * sy) / (m * sxx - sx * sx), t = (sy - s * sx) / m;
  if (!(s > 0)) return { ok: false, why: "floor not visible (something close in front?)", floor: round(floor) };
  // 3. Every pixel → 3D: how far ahead, how far to the side, how high above the floor.
  //    Also, for each direction the wearer could walk in (PATHS, degrees from straight ahead), how
  //    far they'd get: the nearest obstacle within ±corridor of that line. The laptop steers round
  //    things with it (the clear direction nearest the target), instead of just stopping.
  const px = { obstacle: [], drop: [] };
  const along = PATHS.map(() => []), solidAt = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = D[y * W + x] - t;
    if (d <= 0) continue; // farther than anything the fit can say
    const Z = s / d, side = ((x + 0.5 - cx) / f) * Z, Yc = ((y + 0.5 - cy) / f) * Z;
    const ahead = Z * cp - Yc * sp, height = camH - (Yc * cp + Z * sp);
    if (ahead < 0.3 || ahead > near) continue;
    const solid = height > 0.12 && height < 2.1;
    if (solid && Math.abs(side) < 3) solidAt.push([ahead, side]);
    if (solid) PATHS.forEach((_, i) => {
      const a = along[i], c = PATH_COS[i], sn = PATH_SIN[i];
      const on = ahead * c + side * sn;       // how far along that walking line
      if (on >= 0.3 && Math.abs(side * c - ahead * sn) <= corridor) a.push(on);
    });
    if (Math.abs(side) > corridor) continue;
    if (solid) px.obstacle.push([ahead, (x + 0.5 - cx) / f]);
    else if (height < -0.12 && y > cy) px.drop.push([ahead, (x + 0.5 - cx) / f]);
  }
  // The thing in the way, if any: how far, and how far to bear left or right to walk past it with
  // room for the shoulders (degrees; null when that edge runs out of the picture, so it's unknown).
  let around = null;
  if (px.obstacle.length >= W * H * 0.004) {
    const near1 = [...px.obstacle].sort((a, b) => a[0] - b[0])[Math.floor(px.obstacle.length * 0.1)][0];
    const sides = solidAt.filter(([ahead]) => ahead >= near1 - 0.1 && ahead <= near1 + 0.6).map(([, side]) => side).sort((a, b) => a - b);
    if (sides.length) {
      const lo = sides[Math.floor(sides.length * 0.03)], hi = sides[Math.floor(sides.length * 0.97)];
      const edge = near1 * Math.tan(Math.atan(W / 2 / f)) - 0.12; // |side| where the picture ends at that distance
      const deg = (v) => Math.round((Math.atan(v / near1) * 180) / Math.PI);
      around = { distance: round(near1), left: lo > -edge ? deg(lo - corridor - 0.1) : null, right: hi < edge ? deg(hi + corridor + 0.1) : null };
    }
  }
  const paths = PATHS.map((angle, i) => {
    const a = along[i];
    if (a.length < W * H * 0.004) return { angle, clear: null }; // nothing solid that way (within `near`)
    a.sort((p, q) => p - q);
    return { angle, clear: round(a[Math.floor(a.length * 0.1)]) };
  });
  const found = [];
  for (const [kind, list] of Object.entries(px)) {
    if (list.length < W * H * 0.004) continue; // a few stray pixels aren't a hazard
    list.sort((a, b) => a[0] - b[0]);
    const [ahead, tan] = list[Math.floor(list.length * 0.1)]; // the near edge, minus the nearest 10% (noise)
    found.push({ kind, distance: round(ahead), angle: Math.round((Math.atan(tan) * 180) / Math.PI) });
  }
  return { ok: true, floor: round(floor), found, paths, around };
}
// Walking directions checked for a way round, degrees from straight ahead (the camera sees ~±20°).
const PATHS = [-20, -16, -12, -8, -4, 0, 4, 8, 12, 16, 20];
const PATH_COS = PATHS.map((a) => Math.cos((a * Math.PI) / 180)), PATH_SIN = PATHS.map((a) => Math.sin((a * Math.PI) / 180));
const round = (v) => Math.round(v * 100) / 100;
