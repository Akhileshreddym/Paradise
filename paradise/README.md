# Paradise

Touch-only guidance for blind and DeafBlind people. Two Joy-Cons, one on each wrist, buzz to steer
the wearer: turn left, turn right, walk, stop, you're there. Nothing is ever said out loud or shown
to the wearer. A phone on the chest is the eyes; a laptop in a backpack does the thinking.

It does three things:

1. **Walks you to a saved place, along sidewalks and footpaths**: a walking route from
   OpenStreetMap, followed by GPS and compass, turning you at corners instead of pointing you
   straight across streets.
2. **Walks you to your Waymo, right up to its door handle** (the walking route toward the car, then
   a camera model that recognizes Waymos, then a door-handle finder).
3. **Finds a thing you ask for** ("water bottle", "my keys", "trash can", or just "something to
   drink": the AI works out what to look for) and walks you to it. Not in view? The wrists **turn you round the room** to look. Still nothing? It **asks an AI (Google
   Gemini) where to go and look next**, from the photos of that turn ("the desk: keys are often left
   on desks"), walks you there, and looks again.

The AI that sees runs on the phone and the laptop (object detection, an object finder that reads
any words, a depth model): seeing, distances and obstacle stops never wait on a cloud service. The
cloud AI is asked only when a full look round finds nothing, at most 3 times a search, and it only
picks where to go look: the detectors on the phone and laptop still have to find the thing.

At the door handle or the thing, it **steers your hand onto it**: the chest camera tracks your hand,
the wrists buzz left, right, up (a high buzz) or down (a low buzz), then "forward", and three quick
high buzzes mean you're touching it.

The whole time, in every mode, it **stops you for obstacles**: things the camera recognizes (people,
cars, bikes…) and, from a depth model, anything else close in the walking path (walls, poles, doors,
boxes).

> **Safety.** This is a prototype. It works *alongside* a white cane, never instead of one. It
> misses low curbs, steps down, holes and glass, and its distances are rough. Always test with a
> sighted spotter walking next to the wearer.

---

## Contents

1. [What it does](#1-what-it-does)
2. [How it's built](#2-how-its-built)
3. [What you need](#3-what-you-need)
4. [Build it, step by step](#4-build-it-step-by-step)
5. [Test it, step by step](#5-test-it-step-by-step)
6. [Page-by-page reference](#6-page-by-page-reference)
7. [How it works, in depth](#7-how-it-works-in-depth)
8. [Tuning and customizing](#8-tuning-and-customizing)
9. [The Waymo classifier](#9-the-waymo-classifier)
10. [Troubleshooting](#10-troubleshooting)
11. [Known limitations](#11-known-limitations)
12. [Privacy and security](#12-privacy-and-security)
13. [Why it's built this way](#13-why-its-built-this-way)
14. [Files](#14-files)
15. [Credits and licenses](#15-credits-and-licenses)

---

## 1. What it does

### The three modes

| Mode | How the wearer picks it | What guides them | How it ends |
|---|---|---|---|
| **Go to a place** | Press a Joy-Con button 2, 3… times (one number per saved place), or say the place's name | GPS + the phone's compass | One long buzz within the arrival radius (default 6 m) |
| **Go to the Waymo** | Press once, or say "Waymo" | GPS toward the car's location, then the camera: a classifier that recognizes Waymos, then a door-handle finder, then hand tracking | One long buzz at arm's length from the door handle, then buzzes that steer the hand onto it, and a "touch" buzz on contact |
| **Find a thing** | Say "find the water bottle", or type it on the laptop page | The camera: an object finder that looks for exactly the words given (plus YOLO for everyday things), then hand tracking. Not in view: the wrists turn you round the room, a stop at a time; only if that finds nothing, an AI (Gemini) picks where to go and look ([7.8a](#78a-not-in-view-the-room-scan-and-asking-the-ai)) | One long buzz at about 1 m (arm's reach), then hand steering and a "touch" buzz, as above |

A mode stays on until another is chosen (or **Stop** is pressed on the laptop page).

### Choosing

- **Buttons (the main way).** Press any Joy-Con button N times: any face button, trigger, `+`/`−`,
  Home/Capture or stick click (not the small SL/SR buttons on the rail). Both Joy-Cons count toward
  the same number. 1.5 s after the last press it counts: **1 = Waymo, 2 = first place, 3 = second
  place**, and so on. The Joy-Cons buzz N times back to confirm (the *echo*). A number with no
  choice behind it gets the search buzz and changes nothing.
- **Voice.** The chest phone listens all the time. Only commands count: what's said has to *start*
  with one (after an optional "please", "hey Paradise" or "can you"), so people talking nearby don't
  change anything. Full grammar in [7.10](#710-choosing-buttons-voice-typing).
- **Typing** (for the team): the laptop page's **Find something** box.

### What each buzz means

| Event | Wrist | Pattern | Strength |
|---|---|---|---|
| Turn left | Left | 150 ms pulse, every 400 ms | Full |
| Turn right | Right | 150 ms pulse, every 400 ms | Full |
| Approaching (you're facing it: walk) | Both | 90 ms pulse, faster as you get closer (1–4 a second) | Half |
| Arrived | Both | One 800 ms buzz, then quiet | Full |
| Stop (obstacle) | Both | 3 × 100 ms pulses, 180 ms apart; repeats every 1.2 s while it's there | Full |
| Searching / no signal | Left, right, left | 200 ms each, at 0, 0.45 and 0.9 s; repeats every 1.6 s | 60% |
| Looking round the room (find mode) | Left or right | Turn pulses (as above) to the next stop, then **quiet: hold still** while it looks | Full |
| Not found (find mode gave up) | Left, right, left | The search buzz once, then quiet | 60% |
| Waymo connected / found it | Both | 2 × 80 ms pulses, 180 ms apart | Full |
| Selection echo | Both | N × 120 ms pulses, 300 ms apart (N = the choice) | 80% |

**While reaching** (at the door handle or the thing, steering the hand onto it):

| Event | Wrist | Pattern | Strength |
|---|---|---|---|
| Move your hand left / right | Left / Right | 100 ms pulse, every 300 ms | 40% to full: stronger the further off |
| Move your hand up | Both | 100 ms **high-pitched** buzz, every 300 ms | 40% to full |
| Move your hand down | Both | 100 ms **low-pitched** buzz, every 300 ms | 40% to full |
| Forward (lined up) | Both | 60 ms pulse, 2–6 a second, faster as the hand gets closer | 40% |
| Reach out (no hand in view yet) | Both | One 250 ms buzz every 1.2 s | 60% |
| Touching it | Both | 3 × 60 ms high-pitched pulses, 110 ms apart | Full |

Normal buzzes play at 160 + 320 Hz (a Joy-Con's two rumble bands). *High-pitched* is 320 + 900 Hz,
*low-pitched* 80 + 160 Hz: Joy-Con "HD rumble" can play any frequency, so up and down feel different
from everything else.

Every strength is multiplied by the **Buzz strength** slider on the laptop page (default 0.7).
Guidance waits until an echo is over, so it can be counted. The laptop page's **Testing** section
plays each pattern.

### What onlookers see (the laptop page is the display)

The wearer never looks at a screen. The laptop page is for everyone else:

- **the chest camera's live view** (4 frames a second), with labelled boxes: **red STOP** on an
  obstacle, **green** on the target (labelled Waymo, or the thing's name), white on everything
  else; in find mode a **dashed green** box is the object finder's latest find; while reaching, a
  **green ring** on the target and a **yellow dot** on the wearer's fingertips, joined by a dashed
  line. With no frames for 2 s it dims and says *Waiting for the chest camera…*;
- **what the wearer is being told right now**, in big letters, coloured by kind: *Turn right* (blue),
  *Approaching*, *Stop* (red), *Arrived* / *Touching* (green), *Reach* (purple), *No signal*
  (orange), with the details underneath (*12°*, *person 1.0 m ahead*), and the last voice command
  heard;
- **two wrist tiles, L and R**, that light up yellow exactly when that wrist buzzes (even with no
  Joy-Con connected, which is handy for demos);
- **Mode** (with a task timer: from the choice to the "touch", or to arriving at a place),
  **Distance** (and how it's measured) and **Obstacle** tiles;
- **the difference**: the same task done without Paradise (the team times it with the **Time it**
  button: start, stop; kept in the browser) next to the last task done with it, and how many times
  faster (`1:30` vs `0:20`: `4.5× faster`);
- in find mode, the **room scan**: each stop's photo round a circle (top = where the turn started),
  the stop being looked at, and, if the AI was asked, the photo it picked (violet) with what it said
  ("look at the desk, about 2 m away. Keys are often left on desks.");
- in Waymo mode, the ride's progress (simulated): *Requested → Arrived → Found by the camera → At
  the door*, with the current step spelled out (*Your Waymo has arrived: guiding you to it*).

Above it: pills for the **Phone** and each **Joy-Con** (green when connected). Below it: the team's
controls (where to go, find something) and three sections that open with a click: **Settings**,
**Testing** (every buzz, the indoor steering test) and **Details** (what the guidance sees). Light
or dark follows the Mac's setting.

---

## 2. How it's built

### The devices

```
 ┌──────────────── chest iPhone (Safari) ─────────────────┐     ┌──── beacon phone ────┐
 │ eyes.html                                              │     │ beacon.html          │
 │  camera → YOLOv10n (runs in the phone, 80 object kinds)│     │  GPS, once a second  │
 │  camera → MediaPipe hand tracking (at the target)      │     │  ("the Waymo")       │
 │  compass, tilt, GPS, microphone (speech → text)        │     │                      │
 └──────────────────────────┬─────────────────────────────┘     └──────────┬───────────┘
                            │  https + WebSocket, through a Cloudflare tunnel │
                            ▼                                                 ▼
 ┌──────────────────────────── Mac, in a backpack ────────────────────────────────────────┐
 │ npm start → server.js: serves the pages, relays messages between them                  │
 │   ├─ object-finder-worker.js  (own process): Grounding DINO, finds things in words     │
 │   ├─ clip-worker.js           (own process): CLIP, "is this a Waymo?" + second opinions│
 │   └─ depth-worker.js          (own process): Depth Anything V2, obstacles in the path  │
 │ Chrome → http://localhost:8080/ → hands.html: all guidance decisions + the display     │
 └──────────────────────────────────────┬─────────────────────────────────────────────────┘
                                        │ Bluetooth (Chrome's WebHID)
                          Joy-Con (L) on the left wrist · Joy-Con (R) on the right wrist
```

### What runs where, and why

| Part | Runs on | Its job | Why there |
|---|---|---|---|
| YOLOv10n (80 everyday object kinds) | Chest iPhone, in a web worker (WebGPU if available, else WebAssembly) | People, cars, bottles, chairs… several times a second: obstacles, cars to check, everyday things to find | Small (9 MB) and fast; only tiny results need sending |
| MediaPipe hand tracking | Chest iPhone, in the page (GPU, else CPU) | At the door handle or the thing: where the wearer's fingertips are and how far away the hand is, ~7 times a second | Small (8 MB model) and fast in a browser; the hand moves quicker than frames could make a round trip to the Mac |
| Compass, tilt, GPS, speech-to-text | Chest iPhone | Which way the wearer faces, how far the camera looks down, where they are, what they said | The sensors are on the phone |
| Beacon | Second phone | Shares "the Waymo's" location | Stands in for Waymo's app: there's no public API |
| `server.js` | Mac (Node.js) | Serves the three pages; relays messages between them; hands frames to the models | One fixed place for everyone to connect to |
| Object finder (Grounding DINO tiny, 8-bit) | Mac, its own process | Finds things described in words in a camera frame: door handles, "a water bottle" | 200 MB; ~1.2 s a frame on a Mac's CPU, ~14 s in a browser |
| CLIP ViT-B/32 (8-bit) | Mac, its own process | "Is this car a Waymo?" (with trained weights); second opinions on the object finder's boxes | 150 MB; ~20–35 ms per image |
| Depth model (Depth Anything V2 small, 8-bit) | Mac, its own process | A distance for every pixel of the small preview frames (4 a second) → obstacles YOLO can't name: walls, poles, doors, boxes | 27 MB; ~80 ms a frame on a Mac's CPU; the preview frames go to the Mac anyway (for the display) |
| `hands.html` | Mac, Chrome | Every guidance decision, driving the Joy-Cons, the display | Chrome can talk to Joy-Cons (WebHID); iPhone Safari can't |

### One Waymo trip, message by message

1. The wearer presses once. `hands.html` buzzes the echo and asks the chest phone for car crops
   every second (`want-cars`).
2. The beacon phone reports its GPS fix every second (`beacon`); the chest phone reports compass,
   GPS and YOLO results 10 times a second (`eyes`). `hands.html` steers toward the beacon by GPS.
3. When YOLO sees cars, the chest phone crops them (twice a second) and sends them to the server
   (`cars`). CLIP scores each; the server sends the scores to `hands.html` (`waymo`).
4. A score of 0.9 or more confirms the Waymo: two quick pulses ("connected"), and the camera takes
   over from GPS, steering by YOLO's view of that car.
5. Within 4 m, `hands.html` asks the chest phone for a bigger frame (`frame-please`); the phone sends
   it to the server (`frame`); the object finder looks for "a car door handle."; the server replies
   (`found`). Steering moves to the handle.
6. At 0.8 m from the handle: one long buzz, and the ride status says "At the door".
7. **The last reach:** the laptop asks the phone to track the wearer's hand (`want-hands`, every
   second). MediaPipe finds the fingertips in the camera view, and the phone adds them to its `eyes`
   messages. `hands.html` buzzes the hand left, right, up or down onto the handle, then "forward",
   and plays the "touch" buzz when the hand is about as far away as the handle: `TOUCHING the door
   handle`.

All along, 4 times a second, the phone's small preview frames go to the server (`preview`), which
passes each to `hands.html` for the display and runs the depth model on it; `hands.html` gets the
obstacles back (`depth`) and stops the wearer for anything close in the walking path.

---

## 3. What you need

### Hardware

| Item | How many | Notes |
|---|---|---|
| Mac laptop with Bluetooth | 1 | Runs the server, the two models and Chrome. Tested on a MacBook Pro (M3 Pro). Needs ~400 MB of disk for the models. It travels with the wearer (a backpack), because the Joy-Cons connect to it over Bluetooth (~10 m range). Windows and Linux should also work (see [Software](#software)), but only macOS was tested. |
| Nintendo Switch Joy-Con **(L)** and **(R)** | 1 each | **Original Switch Joy-Cons** (USB product IDs `0x2006` and `0x2007`). Switch 2 Joy-Cons are **not** supported. Charge them fully. |
| Joy-Con wrist straps | 2 | Any strap that holds a Joy-Con flat against the inside of the wrist. |
| Chest iPhone | 1 | Rear camera, GPS, compass, microphone. iOS 16.4 or newer (the page uses Screen Wake Lock and OffscreenCanvas). Where Safari has WebGPU, YOLO runs on the GPU (faster); otherwise it falls back to WebAssembly. Android Chrome should also work (the compass code handles Android) but wasn't tested. |
| Chest mount / harness | 1 | Holds the phone **upright (portrait), rear camera facing forward**, centered on the chest, ideally tilted down a little (10–20°) so the floor ahead is in view. |
| Beacon phone | 1 | Any phone with GPS and a browser. It plays the Waymo. |
| Internet for all three | — | The phones load the YOLO model and its runtime from CDNs; the laptop page loads the Joy-Con library; the tunnel runs through Cloudflare. Outdoors, an iPhone hotspot for the Mac works well. |
| Optional | — | A power bank for the chest phone (camera + GPS + GPU drain it); a second person as a spotter. |

For testing: an open parking lot with a parked car you're allowed to walk up to, plus a table and a
water bottle indoors.

### Software

| Software | Version tested | Where | Notes |
|---|---|---|---|
| Node.js | 24.13.0 (npm 11.6.2) | Mac | Any current LTS should work. <https://nodejs.org> |
| npm packages | `ws` 8.21.3; `@huggingface/transformers` 3.8.1, which brings `onnxruntime-node` 1.21.0 and `sharp` 0.34.5 | Mac | Installed by `npm install`. `onnxruntime-node` ships prebuilt binaries for macOS, Windows and Linux. |
| Google Chrome (or Edge) | Current | Mac | Needed for WebHID (the Joy-Cons). Safari and Firefox can't. |
| cloudflared | 2026.9.3 | Mac | The https tunnel. `brew install cloudflared` (Windows: `winget install --id Cloudflare.cloudflared`). |
| Safari | Current iOS | Phones | Nothing to install. |
| Loaded by the pages at runtime | `joy-con-webhid` 0.11.0 (laptop page); `onnxruntime-web` 1.22.0 and the YOLOv10n model, `@mediapipe/tasks-vision` 1.0.1 and its hand model (phone) | CDNs: jsDelivr, Hugging Face, Google (`storage.googleapis.com`, the hand model) | Cached by the browser after the first load (~50 MB on the phone: ~30 MB for YOLO, ~20 MB for hand tracking). |
| Downloaded by the server on first start | Grounding DINO tiny, 8-bit (204 MB); CLIP ViT-B/32, 8-bit (vision 89 MB + text 65 MB); Depth Anything V2 small, 8-bit (27 MB) | Mac, into `paradise/models/` | ~390 MB once, then loaded from disk. |

No accounts, no API keys, nothing paid, except one optional part: when find mode can't see the thing
anywhere around you, it can ask Google Gemini where to look next. That needs an API key
([4.2a](#42a-optional-a-gemini-api-key)); without one, everything else works the same.

---

## 4. Build it, step by step

### 4.1 Get the code

```
git clone https://github.com/Akhileshreddym/Paradise.git
cd Paradise/paradise
```

Everything lives in the `paradise/` folder. Run every command below from there.

### 4.2 Install

```
npm install
```

This installs the WebSocket library and the model runtime (`@huggingface/transformers`, with its
native ONNX runtime and the `sharp` image library). It takes a minute and a few hundred MB.

### 4.2a Optional: a Gemini API key

Only for asking the AI where to look ([7.8a](#78a-not-in-view-the-room-scan-and-asking-the-ai)).
Get a key at Google AI Studio (<https://aistudio.google.com/apikey>), then create a file named `.env`
in the `paradise/` folder with:

```
GEMINI_API_KEY=your-key-here
```

- `npm start` reads it (`node --env-file-if-exists=.env`, Node.js 22.9 or newer). The start-up
  output says `ai (where to look next): ready (gemini-3.5-flash-lite)`, or `off: no
  GEMINI_API_KEY…`.
- `.env` is git-ignored: the key never goes into the repository. Each machine needs its own file.
- Never put the key anywhere in `public/`: those files are served to anyone with the tunnel address.
  Only the server uses it.
- Another model: add `GEMINI_MODEL=gemini-3.8-flash` (stronger, slower) to the same file.

### 4.3 First start: the models download

```
npm start
```

Expected output on the very first start (the object finder shows download progress; CLIP and the
depth model download silently):

```
Laptop (hands): http://localhost:8080/
Phone (eyes):   https://<tunnel address>/eyes.html
object finder model: downloading 20 / 204 MB
object finder model: downloading 40 / 204 MB
…
depth: ready
clip (waymo classifier, second opinions): ready
object finder: ready
```

Wait for all three **ready** lines (in any order). On a slow connection the first download can
take a while (at 0.3 MB/s, ~20 minutes); after that every start loads from `paradise/models/` in a
few seconds. The
models are git-ignored, so each machine downloads its own copy.

Leave this terminal running. Every 3 s, while a phone is connected, it prints a status line (see
[6.4](#64-the-server-terminal)).

- **Port already in use?** It says so: `Port 8080 is already in use: is npm start already running in
  another terminal?` Stop the other one, or run on another port: `PORT=8081 npm start` (then use
  that port in the URLs below).
- **Edited a page** (`public/…`)? Just reload it in the browser; pages are never cached.
  **Edited a server file** (`*.js` in `paradise/`) or retrained? Stop with Ctrl + C and `npm start`
  again.

### 4.4 Pair the Joy-Cons with the Mac (once)

1. Quit **Steam**, **BetterJoy** and any other controller tool: they grab the Joy-Cons.
2. Open **System Settings → Bluetooth**.
3. On the left Joy-Con, press and hold the small round **sync button** on the rail (between SL and
   SR) until the green lights run back and forth.
4. **Joy-Con (L)** appears in the list: click **Connect**.
5. Repeat for the right Joy-Con: **Joy-Con (R)**.

Windows: **Settings → Bluetooth & devices → Add device → Bluetooth**, same sync button. (Windows
sometimes names both "Wireless Gamepad"; that's fine, the page goes by hardware ID.)

After pairing, a sleeping Joy-Con reconnects when you press any button on it.

### 4.5 Open the laptop page and connect the Joy-Cons

1. In **Chrome**, open <http://localhost:8080/>.
2. Click **Connect Joy-Con** (top right). Chrome shows a device picker: choose **Joy-Con (L)**,
   click **Connect**.
3. Click **Connect Joy-Con** again for **Joy-Con (R)**.
4. The **Joy-Con L** and **Joy-Con R** pills at the top turn green.
5. Open **Testing** and press a few buzz buttons: the right wrist should buzz, and the L/R tiles
   should light.

Chrome remembers the permission. Next time, the Joy-Cons reconnect by themselves when the page
loads or when they wake up; you only click **Connect Joy-Con** for a new Joy-Con. If one drops out
(battery, out of range), its pill goes grey until it's back.

Strap **Joy-Con (L) on the left wrist and Joy-Con (R) on the right.** Swapping them swaps left and
right steering.

### 4.6 Give the laptop an https address (Cloudflare tunnel)

iPhones only allow the camera, GPS, compass and microphone on **https** pages, and the beacon phone
may be far away on cellular. A free Cloudflare quick tunnel solves both. In a **second terminal**:

```
cloudflared tunnel --protocol http2 --url http://localhost:8080
```

It prints an address like `https://words-words-words-words.trycloudflare.com`. Copy it.

- `--protocol http2`: many venue and campus networks block the default (UDP/QUIC) connection. With
  it blocked and without this flag, cloudflared retries forever with `Failed to dial a quic
  connection`.
- The address **changes every time** the tunnel restarts. Reopen the phone pages with the new one.
- **Anyone with the address can open the pages** (and see the camera view on the laptop page).
  Stop the tunnel (Ctrl + C) when you're done.
- The laptop page itself can stay on `http://localhost:8080/`.

### 4.7 Set up the chest iPhone

Once, in iPhone **Settings**:

1. **Privacy & Security → Location Services**: on. Then **Safari Websites**: *While Using the App*,
   with **Precise Location** on. (Without Precise Location, accuracy is ±100 m or worse.)
2. For voice: Safari's speech recognition uses Apple's dictation. If the phone page's **Voice** row
   later shows `service-not-allowed`, turn on **Settings → General → Keyboard → Enable Dictation**.

Then, each time:

1. In **Safari**, open `https://<your tunnel address>/eyes.html`.
2. Tap **Start** and **allow every prompt**: microphone (speech), motion & orientation (the compass
   and tilt), location, camera. The first load downloads ~50 MB (use Wi-Fi).
3. Check the status rows; each gets a green dot once it works:
   - **Laptop**: `Connected · N updates`;
   - **Objects**: `Ready (webgpu)` (or `wasm` on phones without WebGPU), then `webgpu · N ms a frame`;
   - **Hands**: `Ready (GPU)` (or `CPU`). Setting up hand tracking can freeze the page for a few
     seconds once, right after Start; that's expected;
   - **Voice**: `Listening`;
   - **GPS** `±N m`, **Compass** `N°`, **Tilt** `N° down`.
4. On the laptop page, the camera view appears and the **Phone** pill turns green.

Keep the phone's screen on and this page in front. The page keeps the screen awake (and takes the
wake lock back if you switch apps and return). If a prompt was refused, reload and tap Start again;
if iOS doesn't ask again, quit Safari (swipe it away) and reopen it.

### 4.8 Mount the chest iPhone

- **Portrait, upright, rear camera facing forward**, centered on the chest. The compass reports
  where the back of the phone points.
- **Tilted down a little: 10–20°** (the top of the phone leaning away from the chest), so the floor
  1–4 m ahead and low things close by are in view. The depth obstacle check measures everything
  against the floor, and the wearer's reaching hand needs to be in view at the end. The phone
  measures its own tilt and shows it (**Tilt** `15° down`); every distance takes it into account, so
  it doesn't need to be exact. Level (0°) also works, but then the depth check misses low things
  closer than ~2 m.
- The screen faces the wearer (it's not needed; onlookers watch the laptop).
- Measure the height of the phone's camera above the floor, in meters, and enter it under
  **Calibration → Chest height (m)** on the phone page (default 1.30).

### 4.9 Calibrate distances (once per phone)

Distances come from how big things look, which depends on the phone's camera ("focal length" in
pixels). The default, 720, suits a typical iPhone main camera in portrait. To calibrate:

1. Have someone stand **exactly 3.00 m** from the phone, whole body in view.
2. On the phone page, open **Calibration** and enter their height in **Person height (m)**.
3. Tap **Calibrate: that person is standing exactly 3.00 m away**. The **Focal length (px)** box
   updates.
4. Check: the phone's list now shows them at about `person … 3.0 m`.

The math: focal = (their box height in pixels) × 3.00 ÷ (their height). Focal, person height and
chest height are saved on the phone and survive reloads.

### 4.10 Set up the beacon phone

1. Location Services as in [4.7](#47-set-up-the-chest-iphone) (Precise Location on).
2. In Safari, open `https://<your tunnel address>/beacon.html`.
3. Tap **Start sharing location** and allow location. (Refused by mistake? The button comes back:
   allow location in Safari's site settings and tap it again.)
4. Put the phone **in or on the car** you'll walk to, outdoors, screen on, page open.
5. Wait until the big accuracy number shows **±10 m** or better (it turns green). *Updated N s ago*
   should stay low; a phone that isn't moving can go several seconds without a new fix, which is
   fine (the laptop accepts a beacon fix for 30 s).

### 4.11 Add your own places

Places live in `public/hands.html`, near the top of the script:

```js
const PLACES = [
  { name: "test north", north: 30 },   // 30 m north of wherever the wearer is when they choose it
  { name: "test east", east: 40 },     // 40 m east
];
```

Add real places as `{ name, lat, lon }`:

```js
const PLACES = [
  { name: "entrance", lat: 25.756123, lon: -80.373456 },
  { name: "bus stop", lat: 25.754987, lon: -80.371234 },
];
```

- **Coordinates:** in Google Maps, right-click the exact spot; the first menu item is the
  coordinates (click it to copy).
- **Order = button count.** The first place is 2 presses (1 is always the Waymo), the second 3, and
  so on. The laptop page's **Go to** buttons show the numbers.
- **Names are what the wearer says** ("go to entrance"), so pick short, distinct, easy-to-say names.
- Reload the laptop page after editing. No server restart needed.

### 4.12 Set your magnetic declination

GPS directions are relative to *true* north; the iPhone compass points to *magnetic* north. The
difference (declination) depends on where you are. It's set in `public/hands.html`:

```js
const DECLINATION = -6.8; // Miami: about 6.8° west
```

Look up yours with NOAA's calculator (<https://www.ngdc.noaa.gov/geomag/calculators/magcalc.shtml>):
**east is positive, west is negative.** A wrong value turns every GPS target by the error. The
camera-guided stages (Waymo car, door handle, found things) don't use it.

### 4.13 Before every demo: checklist

- [ ] `npm start` shows all three **ready** lines (object finder, clip, depth).
- [ ] Tunnel running with `--protocol http2`; phone pages opened with **today's** address.
- [ ] Laptop page: both Joy-Con pills green; every buzz under **Testing** felt on the right wrist.
- [ ] Chest phone: every status row green (Laptop, Objects, Hands, Voice, GPS, Compass, Tilt);
      mounted upright, camera forward, **Tilt** 10–20° down; focal and chest height set.
- [ ] Laptop page **Details**: `depth: clear (floor NN%)` while the path ahead is clear.
- [ ] Beacon phone: accuracy ±10 m or better (green), in/on the car, screen on.
- [ ] Laptop page **Details**: `phone: last message` under 200 ms; `heading` changes when the wearer
      turns (turning right makes it go **up**).
- [ ] Spotter ready. Cane in hand.

---

## 5. Test it, step by step

Each step adds one piece. "✅" is what working looks like. Steps 1–2 need only the laptop and
Joy-Cons; 3–5 and 8 work indoors; 6–7 need outdoors.

Messages are written below the way the laptop page's **Details** section shows them (its `guide:`
line). The big display shows the same message in two parts: `STOP: person 1.0 m ahead` is **Stop**
over *person 1.0 m ahead*.

### 1. Laptop and Joy-Cons

- `npm start`, open <http://localhost:8080/>, click **Connect Joy-Con** for each.
- Open **Testing** and press every buzz button.
- ✅ Each pattern matches the table in [What each buzz means](#what-each-buzz-means), on the right
  wrist; the L/R tiles light with it.
- ✅ Under **Reaching buzzes**, **Hand up** and **Hand down** feel clearly different from each other
  and from **Forward** (high, low, normal pitch). If they don't, note it: the frequencies are
  `HIGH` and `LOW` in `hands.html` ([8](#8-tuning-and-customizing)).
- Adjust **Settings → Buzz strength** until every pattern is clearly felt through a sleeve.

### 2. Choosing with the buttons

- Press any button once and wait. ✅ After 1.5 s: one echo pulse; the **Mode** tile says `Waymo`
  (and the **Waymo** button is highlighted).
- Press three times. ✅ Three echo pulses; **Mode** `test east`.
- Press once on each Joy-Con. ✅ It counts as 2: **Mode** `test north`.
- Press more times than there are choices. ✅ A search buzz; the mode doesn't change.
- Connect the Joy-Cons and don't touch them for 10 s. ✅ Nothing is chosen by itself.

### 3. Chest phone and compass (indoors is fine)

- Tunnel on, `eyes.html` on the chest phone, **Start**, then mount it.
- ✅ Phone: **Laptop** and **Objects** rows green. Laptop: the camera view appears, **Phone** pill
  green.
- Stand still and press **90° right** (**Testing → Indoor steering test**).
- ✅ Right wrist pulses; turn right. At about 90°: approaching pulses (1 a second). If it steers the
  wrong way, watch **Details**: turning right should make `heading` go **up**.
- Close `eyes.html`. ✅ Within a second: `NO SIGNAL from the chest phone` and slow L-R-L buzzes.

### 4. Obstacles

- Choose anything, and have a teammate step in front of you, 1 m away.
- ✅ 3 sharp pulses repeating, `STOP: person 1.0 m ahead`, a red STOP box on the camera view, a red
  **Obstacle** tile. Guidance resumes when they step aside.
- Calibrate distances now if you haven't ([4.9](#49-calibrate-distances-once-per-phone)).
- **Depth:** in a clear hallway, watch **Details**. ✅ `depth: clear (floor NN%) · ~80 ms`, and no
  stops.
- Walk slowly toward a big cardboard box, a pillar or a closed door (things YOLO has no name for).
  ✅ `STOP: something 1.4 m ahead` at about the stop distance (**Obstacle** tile: *seen by the depth
  model*; **Details**: `depth: obstacle 1.4 m +3°`). Nothing is drawn on the camera view for these.
- Stand facing a wall, 1 m away. ✅ Within about half a second: `STOP: something close (no floor in
  view)`.
- Stops when nothing's there? See [10](#10-troubleshooting) (usually tilt, chest height or focal).
  **Settings → Obstacles from depth** turns this part off.

### 5. Voice

- Say "Waymo", then "take me to test north", then "find the water bottle".
- ✅ The phone's **Voice** row shows `Heard “…”`; the laptop shows `Heard: “…”` under the big
  message; an echo; the mode changes each time.
- Say "let's get started" and "that's way more fun". ✅ `Heard:` updates, the mode doesn't.

### 6. Go to a place (outdoors)

- Choose **test north** (2 presses) and walk.
- ✅ `Distance` counts down from about 30 m; one long buzz at the arrival radius (6 m); it stays
  `ARRIVED` as you walk on.
- GPS drifts several meters: raise **GPS arrival radius** if it arrives too early or never.

### 7. Go to the Waymo (outdoors, at a car)

- Beacon phone in or on a parked car. Start 30 m or more away; choose **Waymo** (1 press).
- ✅ Ride progress "Your Waymo has arrived: guiding you to it"; steering toward the beacon,
  **Distance** *by GPS*.
- ✅ **Details**: `waymo classifier: best NN%`. Ordinary cars stay low; a Waymo goes over 90%.
- ✅ Waymo in view: 2 quick pulses ("connected"), a green **Waymo** box, **Distance** *to the car, by
  camera*, ride progress "Waymo found by the camera".
- ✅ Within 4 m: **Details** `object finder: door handle: … NN%`, then **Distance** *to the door
  handle*.
- ✅ At the handle: one long buzz, ride progress "At the door", then the reach guidance (as in
  step 8): `REACH: move your hand …`, `REACH: forward …`, `TOUCHING the door handle`. It stays
  arrived while you reach, even when your hand hides the handle.
- ✅ The car right in front doesn't trigger STOP (neither YOLO's "car" nor the depth model's
  "no floor in view").
- No handle found: stand side-on to the door, 1–3 m away, whole door in view.

### 8. Find a thing (indoors)

- Put a water bottle on a table 3–5 m away. Type **water bottle** under *Find something* and press
  Find (or say "find the water bottle").
- ✅ One echo; **Mode** `find "water bottle"`; search buzz while it's out of view.
- ✅ Once in view: **Details** `object finder: "water bottle": ~1200 ms · NN%`; a dashed green box;
  2 quick pulses ("found it"); steering toward it.
- ✅ About 1 m away: one long buzz. It stays arrived as you reach.
- **Reach for it** with one hand, keeping your chest still:
  - ✅ hand not in the camera view yet: `REACH OUT toward the water bottle: … Hand not in view
    yet` and a 250 ms buzz every 1.2 s;
  - ✅ hand in view (pink dots on the phone page; a yellow dot and a dashed line to a green ring on
    the laptop's camera view): `REACH: move your hand left 12°` on the left wrist, `right` on the
    right, `up` as a high buzz on both, `down` as a low buzz on both;
  - ✅ lined up: `REACH: forward (0.30 m to go)`, pulses speeding up as you get closer;
  - ✅ at it: `TOUCHING the water bottle` and 3 quick high buzzes.
  - Without hand tracking (the phone's **Hands** row says `Failed to load`), the display just says
    where to reach: `ARRIVED: the water bottle is within reach, a little left, low (about waist
    height)`.
- ✅ The table under the bottle (bottle near its front edge) doesn't trigger STOP (neither YOLO nor
  the depth model); a person stepping in between does (until you've arrived: while reaching, stops
  are off).
- Try something YOLO doesn't know: "keys", "trash can". ✅ Still found, just updated about every
  1.2 s instead of several times a second: turn slowly.

### 9. Full run

Wearer blindfolded, cane in hand, spotter alongside, starting 50 m or more away. Choose by button
presses only; follow buzzes only. Note every hesitation and wrong turn, and tune
([8](#8-tuning-and-customizing)).

---

## 6. Page-by-page reference

### 6.1 The laptop page

`http://localhost:8080/` (`public/hands.html`).

**Display** (top): camera view, the big message, wrist tiles, Mode / Distance / Obstacle tiles,
ride progress. See [What onlookers see](#what-onlookers-see-the-laptop-page-is-the-display).

**Big message**: what the wearer is being told right now: the guide message (list below), split in
two (`TURN RIGHT 12°` shows as **Turn right** over *12°*), coloured by kind: blue steering, red stop,
green arrived or touching, purple reaching, orange no signal or no compass, grey waiting or
searching. Under it, for 10 s: `Heard: “…”`, the last thing the phone heard.

**Tiles**

| Tile | Meaning |
|---|---|
| **Mode** | `Off`, `Waymo`, a place's name, `find "…"`, or `test …` |
| **Distance** | Meters to the target, and how it's measured: *by GPS*, *to the car, by camera* (the Waymo), *to the door handle*, *by camera* (find mode), *indoor test* |
| **Obstacle** | What's in the way and how far, or `None`: *seen by the camera* (YOLO's name for it) or *seen by the depth model* (`Something`, `Drop-off`); *ignored while reaching* at the door handle or the thing. Red while it stops the wearer |
| **Waymo ride** | Waymo mode only: *Requested → Arrived → Found by the camera → At the door* |

**Header pills**: **Phone** (green: a message in the last second; red: it was connected and went
quiet; grey: never connected), **Joy-Con L** and **Joy-Con R** (green: connected and set up).

**Controls**

| Control | Default | What it does |
|---|---|---|
| Connect Joy-Con (top right) | — | Chrome's device picker; once per Joy-Con |
| Go to: `1 Waymo`, `2 test north`, … | — | Same as pressing a Joy-Con button that many times; the one in use is highlighted |
| Stop | — | Mode off |
| Find something + Find (or Enter) | — | Starts find mode for the typed thing |
| Settings → Buzz strength | 0.7 (0.1–1) | Multiplies every buzz's strength |
| Settings → On-target margin | ±12° (5–30) | How close to straight ahead counts as "facing it" (+5° extra once facing, so it doesn't flicker) |
| Settings → GPS arrival radius | 6 m (2–20) | Arrival distance for places |
| Settings → Obstacle stop distance | 1.5 m (0.5–3) | Anything closer than this, straight ahead, is an obstacle |
| Settings → Obstacles from depth | on | Also stop for anything the depth model sees close in the walking path, not just what YOLO recognizes ([7.5](#75-obstacles)) |
| Settings → Ask the AI where to look | on | Find mode: after a full turn round the room finds nothing, send that turn's photos to Gemini (at most 3 times a search); off: say "not found" instead ([7.8a](#78a-not-in-view-the-room-scan-and-asking-the-ai)) |
| Settings → Any car counts as the Waymo (demo) | off | Only for a demo with no real Waymo there: any car the phone sees counts as the Waymo (the one in the beacon's direction). The ride card says `(demo: any car counts as the Waymo)` while it's on, so nobody is misled ([7.7](#77-mode-2-the-waymo)) |
| Settings → Follow walking routes | on | Steer along an OpenStreetMap walking route to a place or the Waymo, turning at corners; off: a straight line ([7.6a](#76a-walking-routes)) |
| Testing → Walking buzzes, Reaching buzzes | — | Plays each pattern |
| Testing → Indoor steering test: 90° left, 45° right, 90° right, Behind | — | Steers to a direction relative to where the chest faces (no GPS needed); no arrival |

**Settings**, **Testing** and **Details** open with a click; the browser remembers which are open.

**Details** (the last section): what the guidance sees.

| Line | Example | Meaning |
|---|---|---|
| `guide:` | `TURN LEFT 83°` | What it's telling the wearer right now (full list below) |
| `phone:` | `last message 42 ms ago` | Over 1000 ms = no signal |
| `heading:` | `187° magnetic` | Which way the chest faces |
| `you:` / `beacon:` | `25.750000, -80.370000 ±5 m, 0 s old` | Last GPS fixes |
| `camera:` | `person 2.4 m, car 11.8 m` | What YOLO saw in the last 1.5 s |
| `waymo classifier:` | `best 96% (sure at 90%)` | Highest Waymo score in the last 3 s |
| `object finder:` | `door handle: 1180 ms · 22%` or `"water bottle": 1250 ms · not in view` | The object finder's last answer; `(second opinion unavailable: …)` if CLIP isn't ready |
| `depth:` | `clear (floor 78%) · 85 ms`, `obstacle 1.32 m +4° · 88 ms` or `floor not visible (something close in front?) · 90 ms` | The depth model's last answer (up to 4 a second): what it found in the walking path (`obstacle` / `drop`, distance, angle), or why it couldn't judge. `(not used: switched off)` when the checkbox is off |
| `hand:` | `1 in view` | Hand tracking; only runs while reaching (`— (tracked only at the target)` otherwise) |

**Guide messages**

| Message | Meaning |
|---|---|
| `waiting for a choice (…)` | No mode |
| `NO SIGNAL from the chest phone` | No phone message for 1 s: search buzz only |
| `NO COMPASS from the chest phone (allow motion access)` | Messages arrive, but no fresh compass reading: search buzz only (an old heading would steer wrong) |
| `STOP: person 1.0 m ahead` | Obstacle YOLO recognized |
| `STOP: something 1.2 m ahead` / `STOP: drop-off 1.0 m ahead` | Obstacle (or the floor dropping away) seen by the depth model |
| `STOP: something close (no floor in view)` | The depth model couldn't see the floor where it should be, twice in a row: something (a wall, a door) is right in front |
| `SEARCHING: waiting for GPS` / `waiting for the Waymo's location (beacon)` / `the water bottle` | No target yet (find mode: only during the selection echo) |
| `SCANNING: turn right 30° (stop 3 of 10)` / `SCANNING: hold still, looking (stop 3 of 10)` | Find mode, not in view: turning round the room ([7.8a](#78a-not-in-view-the-room-scan-and-asking-the-ai)) |
| `THINKING: not anywhere around you; asking the AI where to look` | The turn found nothing; waiting for Gemini |
| `TURN LEFT 20° toward the desk (the AI's pick)` / `APPROACHING: walk toward the desk (the AI's pick)` | Walking to where the AI said to look |
| `NOT FOUND: not anywhere around you, after asking the AI 3 times` | Find mode gave up (also: AI off, or no answer) |
| `TURN LEFT 83°` / `TURN RIGHT 12°` | Steering |
| `APPROACHING` | Facing it: walk (the big message adds *Facing it: walk forward*) |
| `ARRIVED` | At a place |
| `AT THE CAR: turn slowly along it to find the door handle` | At the Waymo, handle not found yet |
| `ARRIVED at the door handle: reach straight ahead, a bit below chest height` | At the handle: the first second (during the arrival buzz), or with no hand tracking |
| `ARRIVED: the water bottle is within reach, a little left, low (about waist height)` | At the thing: same |
| `REACH OUT toward the water bottle: straight ahead, low (about waist height). Hand not in view yet` | Reaching: no hand in the camera view |
| `REACH: move your hand left 12°` (`right` / `up` / `down`) | Reaching: the fingertips are off the target that way (the bigger miss first) |
| `REACH: forward (0.30 m to go)` | Reaching: lined up; the target is that much farther than the hand |
| `TOUCHING the door handle` / `TOUCHING the water bottle` | Reaching: lined up and about as far away as the target |

### 6.2 The chest phone page

`https://<tunnel>/eyes.html` (`public/eyes.html`).

| Element | What it is |
|---|---|
| Start | Starts everything; asks for every permission. Tap once (it then goes away). |
| Status rows | One per part, with a dot: green working, orange waiting or unsure, red failed, grey not started yet |
| **Laptop** | `Connected · N updates` means the phone reaches the **server**; check the laptop page's **Phone** pill to be sure the laptop page is open too |
| **Objects** | YOLO: `Loading (about 30 MB the first time)…`, `Ready (webgpu)` or `Ready (wasm)`, then `webgpu · N ms a frame` |
| **Hands** | Hand tracking: `Loading (about 20 MB the first time)…`, `Ready (GPU)` or `Ready (CPU)`, then while reaching `N in view · M ms`; or `Failed to load (…): no reach guidance` |
| **Voice** | `Listening`, `Heard “…”`, or an error (`not-allowed` etc.: voice turns itself off; buttons still work) |
| **GPS** | Accuracy, `±N m` (green up to ±20 m) |
| **Compass** | Heading, `N°`; `Not updating` if the reading is over a second old, `Not allowed (motion access)` if refused |
| **Tilt** | How far the camera looks down, `N° down` (green from level to 40° down) |
| Camera view | Appears after Start: blue YOLO boxes with labels, a white center line, pink dots on tracked fingertips; under it, everything YOLO sees: `label score%  ±angle°  distance m` |
| **Calibration** (opens with a click) | **Focal length (px)**: the camera's focal length in pixels of the 960-px detection frame (default 720). **Person height (m)**: the height of the person used to calibrate, and the height assumed for people in distance estimates (default 1.70). **Chest height (m)**: the camera's height above the floor, for distances from where things meet the floor (default 1.30). **Calibrate: that person is standing exactly 3.00 m away**: sets the focal length from the tallest person in view. All saved on the phone. |

### 6.3 The beacon page

`https://<tunnel>/beacon.html` (`public/beacon.html`). **Start sharing location** → a big accuracy
number (green at ±10 m or better, orange up to ±100 m, red beyond, with a hint to turn on Precise
Location), *Updated N s ago*, and the coordinates. The pill at the top says **Connected** when it
reaches the server. It sends its latest fix once a second.

### 6.4 The server terminal

| Line | Meaning |
|---|---|
| `eyes page connected (iPhone); 3 connected` | A page connected (role, device type, total) |
| `object finder model: downloading 40 / 204 MB` | First start only |
| `object finder: ready`, `clip (waymo classifier, second opinions): ready`, `depth: ready` | Models loaded |
| `object finder: failed: stopped (SIGKILL), starting it again` | A model process crashed; it restarts (up to 3 times) |
| `bad cars message: …` | A malformed message was ignored |
| `[status] chest phone 0s ago: gps ±5 m, compass 187°, sees person, car \| beacon 1s ago: ±4 m \| distance 32 m \| waymo 96% \| depth clear \| finding "a car door handle." best 22% (1180 ms)` | Every 3 s while a phone has sent something in the last 10 s. `depth` is `clear`, what's in the walking path (`obstacle 1.32 m`), or why it can't judge. **No coordinates are ever printed.** |

---

## 7. How it works, in depth

All numbers below are the defaults in the code; [8](#8-tuning-and-customizing) says where to change
them.

### 7.1 The guidance loop

`guideTick()` in `hands.html` runs every 50 ms. In order, the first that applies wins:

1. **No mode:** nothing.
2. **No signal or no compass:** no phone message for 1 s, or no compass reading for 1 s → search
   buzz every 1.6 s, nothing else.
3. **Obstacle** (YOLO or depth) seen in the last 1.2 s → stop pulses every 1.2 s. Not while
   reaching (step 5).
4. **Target:** where to go (per mode, below). None → search buzz every 1.6 s.
5. **Arrived** (distance within the arrival radius) → one long buzz, then quiet until the wearer is
   0.5 m (camera targets; 1 m while reaching) or 3 m (GPS) back outside the radius. At the door
   handle or a found thing, **the last reach** takes over: it steers the hand onto it
   ([7.9](#79-the-last-reach-steering-the-hand)).
6. **Facing it** (target within the on-target margin, ±12°, +5° once facing) → approach pulses.
   Pulses per second: door handle / thing: 5 ÷ distance (1–4); Waymo car: 15 ÷ distance (0.7–4);
   GPS: 40 ÷ distance (0.7–3); unknown distance: 1.
7. **Otherwise** → a steer pulse on the side to turn toward, every 400 ms.

A new choice resets everything, buzzes the echo, and holds guidance for N × 300 + 400 ms so the
echo can be counted; the "connected / found it" buzz also waits for the echo to end.

### 7.2 Heading

- iPhone: Safari's `webkitCompassHeading` (degrees clockwise from magnetic north; with the phone
  upright, the direction the camera faces). Android: the W3C DeviceOrientation formula, from
  `deviceorientationabsolute`, for the direction out of the back of the phone.
- The phone sends it 10 times a second, and sends `null` once the reading is over a second old. The
  laptop only steers with a heading under a second old.
- Camera targets are stored as absolute headings: *heading when the frame was taken + angle in the
  frame*. So when the target leaves the camera view, turning still steers toward where it was.

### 7.3 GPS

- `watchPosition` with high accuracy on both phones. A fix is timestamped when it arrives (Safari's
  own timestamps count from 2001, not 1970).
- Distance: haversine formula (Earth radius 6,371 km). Direction: initial great-circle bearing (true
  north), converted to magnetic: **bearing − DECLINATION**.
- A fix counts for 15 s (wearer) or 30 s (beacon): a phone that isn't moving often gets no new fix
  for a while; a moving one gets one every second or so.
- Test places are pinned at the wearer's first fix after choosing: `north` m ÷ 111,320 degrees of
  latitude, `east` m ÷ (111,320 × cos latitude) degrees of longitude.

### 7.4 Camera geometry: angle and distance

- YOLO runs on a **960-px frame** (longest side; 540 × 960 in portrait). Focal length `f` is in these
  pixels. At the default 720, the camera sees ~41° across and ~67° top to bottom in portrait.
- **Angle** of a box: `atan((box center x − frame width ÷ 2) ÷ f)`. Negative = left.
- **Distance**, two ways; the phone reports the **nearer**:
  - *By size:* `f × real height ÷ box height`, for kinds with a known height: car 1.6 m, truck 3.0,
    bus 3.2, person (the Person height setting), chair 0.9, bench 0.8, fire hydrant 0.7. Up close a
    box runs off the frame and this reads long.
  - *By where it meets the floor:* from chest height `h`, with the camera tilted down by `tilt`, a
    point `y` pixels below the middle of the frame is `h ÷ tan(tilt + atan(y ÷ f))` away (with the
    camera level: `h × f ÷ y`). A box cut off at the bottom is at least that close.

    ```
    camera ●───────────── level ─────────────
           │ \    angle below level = tilt + atan(y ÷ f)
         h │    \    the ray to the point where the thing meets the floor,
           │       \   y pixels below the middle of the frame
    floor ─┴──────────●───  distance = h ÷ tan(angle)
    ```
- **Tilt:** from the phone's orientation sensor: `tilt = 90° − beta` (beta is 90° with the phone
  upright; tipping its top away from the chest points the camera down), limited to −30…60°. No
  reading in the last second → 0 (level). It goes with every `eyes` message (`frame.pitch`) and
  preview frame (`cam.pitch`).
- **Height of a target** (`up`): its angle above or below the middle of the frame, minus the tilt:
  degrees above (+) or below (−) level at chest height.
- **Find mode** distance (on the laptop): `f × usual size ÷ the box's longer side`, using the sizes
  in [7.8](#78-mode-3-find-a-thing); unknown things fall back to the floor method (which reads too
  far for things on a table).
- Object-finder frames are 800 px, so their focal length is `f × 800 ÷ 960`.

### 7.5 Obstacles

Two sources. Either one stops the wearer; when both see something at once, YOLO's name ("person")
is shown rather than the depth model's "something". An obstacle counts for 1.2 s after it was last
seen (longer than YOLO's gap between results on a slow phone, so STOP doesn't flicker), and never
while reaching for the door handle or the thing (it's right in front, and so is the wearer's arm).

**Things YOLO recognizes** (on the phone, several times a second):

- Anything of YOLO's 80 kinds, **within ±20° of straight ahead**, **closer than the stop distance**
  (1.5 m).
- Except: **the target itself** (a car within 15° of the Waymo's direction; in find mode, the thing's
  YOLO kind within 15° of the target), and, in Waymo and find modes, **anything at or behind the
  target** (distance ≥ target distance − 0.3 m): the table the bottle is on, or the Waymo itself
  while walking up to its door handle.

**Anything else, from the depth model** (on the Mac, up to 4 times a second; `depth-worker.js`):

Each preview frame (360 px) goes through Depth Anything V2 small (8-bit, resized to 364 × 364,
~80 ms on an M3 Pro). Its output is relative (bigger = closer, no units), so **the floor is the
ruler**: the chest height and the tilt say how far away each bit of floor in the frame is, which
turns the whole frame into meters. In `analyze()`:

1. **Where the floor should be:** each image row below the horizon meets the floor at a known
   distance: `h ÷ tan(tilt + atan(row offset ÷ f))`. Rows where that's **1–4 m** ahead (every other
   pixel, 5–95% across) give pairs of (1 ÷ Z where the floor would be, the model's value), Z being
   depth along the camera's axis. Fewer than 200 such pixels: `no floor in view (tilt the phone down
   a little)`, and nothing is judged.
2. **Fit:** on the floor, the model's value ≈ `s × (1 ÷ Z) + t`. RANSAC (150 tries; `s` must be
   positive; tolerance 5% of the values' range) finds the line most of those pixels agree on, even
   with a box or a person standing on part of the floor; least squares on the agreeing pixels
   refines it. The share that agrees is `floor` (shown in **Details**). Under **25%** (or a
   negative `s`): `floor not visible (something close in front?)`: typically a wall or a door
   filling the view.
3. **Every pixel → 3D:** `Z = s ÷ (value − t)`, then how far ahead, how far to the side and how high
   above the floor it is (with the tilt).
   - **Obstacle:** 12 cm to 2.1 m above the floor, within **±0.4 m** of the walking line, **0.3–4 m**
     ahead.
   - **Drop-off:** more than 12 cm *below* the floor (lower half of the frame only), same zone.
   - A kind counts when at least 0.4% of the frame's pixels are it; its distance is its near edge
     (the 10th percentile, so a few noisy pixels don't decide).
4. **On the laptop** (`onDepth()` in `hands.html`, with **Obstacles from depth** on and a mode
   chosen): the nearest one **within ±20°** and **closer than the stop distance** → `STOP: something
   1.2 m ahead` (or `drop-off`). As with YOLO, anything at or behind the target doesn't count.
   `floor not visible` **twice in a row** → `STOP: something close (no floor in view)`, unless the
   target is under 2.5 m away (walking up to the Waymo or a table fills the view on purpose).

Tested on rendered scenes with exact geometry (a box 1.4 m ahead was found at 1.27 m; a clear floor
gave nothing; a wall 1.2 m ahead gave "floor not visible") and on photos of corridors, streets and
stairs. What neither source sees: [11](#11-known-limitations).

### 7.6 Mode 1: a place

GPS and compass only (no object recognition). Target: the next point along the walking route to the
place ([7.6a](#76a-walking-routes)), or, with no route, the magnetic bearing straight to it. Arrival: GPS distance ≤ the arrival radius (6 m). `SEARCHING: waiting for GPS`
until the wearer has a fix under 15 s old.

### 7.6a Walking routes

A straight line to a place or the Waymo would walk the wearer across streets, into buildings and
over medians. So in both GPS modes, `hands.html` asks OpenStreetMap's public foot router
(`routing.openstreetmap.de/routed-foot`, OSRM; free, no key) for a walking route over sidewalks,
footpaths and crossings, and steers along it (`routeTo()` / `routeAim()`):

- **The route** runs from where the wearer was when it was asked, along the router's path, to the
  target itself (the router ends on the nearest path; a car in a parking lot may be off it). In
  Waymo mode its end follows the beacon's latest fix.
- **Where the wearer is on it:** the nearest point, searching from the segment they were on up to
  80 m past its end (a route that doubles back near itself doesn't skip ahead).
- **Where to steer:** 12 m further along the route, or **the next corner** (a bend over 35°) if that
  comes first and is still more than 6 m away: the wearer walks to the corner, then turns there,
  instead of cutting across it. The usual turn and approach buzzes do the rest.
- **Distance** (display, approach pulses, arrival) is what's left along the route.
- **A new route** is asked for when the target changes (or the Waymo moves more than 20 m), or when
  the wearer is more than 30 m (or their GPS accuracy, if worse) off the route; at most every 15 s,
  since it's a shared public server. No route (offline, nothing walkable): the straight line, as
  before. **Settings → Follow walking routes** turns it off.

In a simulated walk over a real 835 m campus route (1.3 m steps, the wearer lining up within ±12°),
the wearer stayed on average 0.7–1.2 m from the router's path, at most 3–6 m (corners, with ±0–6 m of
GPS noise), and arrived every time; after walking 50 m off to the side it asked for a new route
and arrived.

GPS accuracy (±5 m on a good day) is the limit: the route says *which* sidewalk and *where* to turn,
but GPS can't tell the two sides of a sidewalk apart, or the curb from the path. The cane, and the
obstacle and drop-off checks, still matter.

### 7.7 Mode 2: the Waymo

1. **Ride status** starts at "Ride requested…", and becomes "Your Waymo has arrived: guiding you to
   it" when a beacon fix arrives.
2. **GPS stage:** steer toward the beacon, along the walking route to it
   ([7.6a](#76a-walking-routes)). There's no GPS arrival in this mode: only the camera
   decides you're there.
3. **Car crops:** while the laptop asks (`want-cars`, every second, in Waymo mode only), the phone
   sends the 3 biggest car/truck/bus boxes wider than 40 px, twice a second, cut exactly like the
   training crops: the box widened 5% each side and extended 35% of its height upward (so the roof
   sensors are in it), squashed to 224 × 224.
4. **Classifier:** CLIP image features → standardized → logistic regression (`waymo-head.json`) →
   probability. **0.9 or more = confirmed**, with its direction: the compass when the crop was taken
   + its angle. Several confirmed: the one closest to the beacon's direction. **Demo with no real
   Waymo there:** **Settings → Any car counts as the Waymo (demo)** makes every car crop count
   (still the one closest to the beacon's direction), and the ride card says so. Off by default;
   leave it off with a real Waymo, and tell the judges when it's on.
5. **Car stage:** every YOLO result, the car within 12° of the confirmed Waymo's direction becomes
   the target (`object`). First time: the "connected" buzz and "Waymo found by the camera".
   Arrival at 1.0 m: `AT THE CAR: turn slowly along it to find the door handle`.
6. **Door handle stage:** within **4 m** of the car (or standing at it), the laptop requests frames
   one at a time with the prompt **"a car door handle."**. Of the object finder's boxes, those
   narrower than 40% of the frame with a score of at least 0.12 count; the best becomes the target
   (`handle`), with:
   - distance = the smaller of *f × 0.25 m ÷ box width* (a handle is about 25 cm wide) and the car's
     YOLO distance (if under 3 s old): both read long when off, so the smaller is closer to right;
   - height: its angle above or below level (the camera's tilt taken into account);
   - its box and the heading when the frame was taken, for the last reach.

   A handle sighting beats the car for 4 s. Arrival at **0.8 m**: one long buzz and "At the door".
   It **stays arrived** while the handle is out of view (as the wearer reaches). Then **the last
   reach** steers the hand onto it ([7.9](#79-the-last-reach-steering-the-hand)).

### 7.8 Mode 3: find a thing

1. **What:** the typed or spoken words, cleaned up ("Get me a water bottle, please." → `water
   bottle`), become the prompt `"a water bottle."`.
2. **Object finder:** frames are requested one at a time for as long as the mode is on (~1.2 s
   each). It returns up to 10 boxes above a score of 0.1. It nearly always boxes *something*, even
   when the thing isn't there (asked for a water bottle, it once boxed a mug at 83%).
3. **CLIP second opinion** (on the server): the 3 best boxes (score ≥ 0.2, narrower than 80% and
   shorter than 90% of the frame) are cropped with 15% extra around them and compared with the text
   "a photo of a water bottle." and with ~80 alternatives ("a photo of a cup.", "a photo of a
   plastic bag." …: YOLO's kinds plus things the finder confused in tests), leaving out words that
   mean the same thing (for "mug": cup, coffee). A box is **verified** if the thing wins.
4. **Accepted boxes:** score ≥ 0.25 **and** (verified **or** YOLO saw the same kind of thing within
   10° in the last 1.5 s). While already steering to one, the one nearest to it wins (so two bottles
   don't make it flip between them).
5. **YOLO tracking:** if the thing is one of YOLO's kinds (table below), every YOLO sighting of that
   kind near the target (within 20°) updates it, several times a second.
6. The target counts for 3 s after the last sighting (or for as long as the wearer has arrived).
   First sighting: the "found it" buzz (same as "connected").
7. **Arrival at 1.0 m** (about where a table-top thing starts to drop out of the chest camera's
   view): one long buzz, then **the last reach** ([7.9](#79-the-last-reach-steering-the-hand)).
   Where it is, in words (on the display): side = `straight ahead` (under 8°), `a little
   left/right` (under 25°) or `left/right`; height = `above chest height` (over 8° up), `a bit below
   chest height` (8–25° down) or `low (about waist height)` (over 25° down).

**Known things** (`THINGS` in `hands.html`): the words that mean each, YOLO's kind (for fast
tracking), and the usual size (longest side) for distances:

| Words | YOLO kind | Size (m) |
|---|---|---|
| water bottle, bottle, water | bottle | 0.25 |
| mug, cup, coffee | cup | 0.12 |
| phone, iphone, cell phone, mobile | cell phone | 0.15 |
| backpack, book bag, bag | backpack | 0.45 |
| purse, handbag | handbag | 0.30 |
| laptop, computer | laptop | 0.33 |
| book | book | 0.24 |
| remote | remote | 0.18 |
| keyboard | keyboard | 0.44 |
| scissors | scissors | 0.20 |
| umbrella | umbrella | 0.90 |
| suitcase, luggage | suitcase | 0.60 |
| glass, wine glass | wine glass | 0.20 |
| bowl | bowl | 0.18 |
| banana / apple / orange | banana / apple / orange | 0.20 / 0.08 / 0.08 |
| ball | sports ball | 0.22 |
| plant | potted plant | 0.50 |
| chair, seat | chair | 0.90 |
| couch, sofa | couch | 0.90 |
| bench | bench | 1.2 |
| tv, television | tv | 0.70 |
| fridge, refrigerator | refrigerator | 1.7 |
| microwave | microwave | 0.50 |
| sink | sink | 0.60 |
| toilet | toilet | 0.75 |
| bike, bicycle | bicycle | 1.7 |
| dog / cat | dog / cat | 0.60 / 0.45 |
| person, someone, friend | person | 1.7 |
| keys, key | — (object finder only) | 0.08 |
| trash can, trash, garbage, bin | — | 0.65 |
| door | — | 2.0 |
| wallet | — | 0.11 |
| glasses, sunglasses | — | 0.14 |

Anything else still works (the object finder reads any words); it just has no YOLO tracking and its
distance assumes it's on the floor. The longest matching word wins ("water bottle" over "water").

### 7.8a Not in view: the room scan, and asking the AI

The detectors only find what's in front of the camera. When the thing isn't (`scanTick()`,
`askAi()`, `onAi()` in `hands.html`; `ai.js` on the server):

1. **The room scan (local, free).** The wrists turn the wearer round a full circle in **10 stops,
   36° apart** (the camera sees ~41° across, so they overlap a little), starting where they face:
   turn pulses until within 10° of the stop, then **quiet: hold still** until the object finder has
   answered for a frame taken there (0.8–4 s; YOLO looks the whole time). Each stop keeps its
   preview photo (202 × 360) and compass heading. Found at any stop: the usual "found it" buzz and
   steering ([7.8](#78-mode-3-find-a-thing)). Obstacle stops are off while turning on the spot
   (there's nothing to walk into, and a table in front mustn't stop the looking).
2. **Only if the whole turn found nothing: ask the AI, once.** The 10 photos (258 tokens each for
   Gemini; a test call with 2 photos came to 2,565 tokens in all and took 3.2 s, so expect a few
   thousand a call) go to the server, which asks Gemini (`ai.js`,
   default `gemini-3.5-flash-lite`): *is it visible in any photo (the on-device detector misses
   small or partly hidden things), and if not, which one place in the photos should they walk to
   next to find it, where it's usually kept, or a doorway toward where it's likely to be?* It
   answers with JSON: a photo, how far across it (0–1000), a name ("the desk"), a rough distance
   and one sentence of why. The answer is checked (a photo that exists, a position), and turned
   into a direction: the heading the photo was taken at + that position's angle in it.
3. **Walk there.** The usual turn and approach buzzes (1 a second: no measured distance), with
   obstacle stops as always, for about as long as the AI's distance takes at 0.5 m/s, plus 3 s.
   The detectors keep looking the whole way: seen, and it's the normal steering. An obstacle
   (something close in the walking path, often the counter or desk itself) or the time running out
   ends the walk: **turn round and look again** (step 1).
4. **Gives up** (the search buzz once, then quiet; `NOT FOUND` on the display) when a turn finds
   nothing and the AI has been asked **3 times this search**, or it's switched off (**Settings → Ask
   the AI where to look**), or it has no answer (no key, no good place to look, no reply in 25 s).

What keeps it cheap and safe:

- **The AI never decides "found".** It only picks where to walk; the "found it" buzz and the reach
  still need the object finder with CLIP's second opinion, or YOLO. A wrong guess costs a detour.
- **Never for anything else:** not the Waymo, not places, not obstacles, distances or steering.
- **Limits in the server** (`ai.js`), whatever the page asks: 6 calls a minute, 100 per server
  run, at most 12 photos of up to ~150 KB each, JPEG only. **Only the laptop's own page can ask**
  (`server.js` refuses requests that come through the tunnel, which carry Cloudflare's
  `Cf-Connecting-Ip` header), so nobody with the phone address can spend the key.
- The laptop page's **Details** shows each call (`ai: "the desk" · 1.5 s · 2912 tokens · call 1 of
  3`), and the server terminal prints `[ai] …` with the running totals.

Tested in a simulation that runs `hands.html`'s own code with a simulated wearer, phone, object
finder and AI: a thing behind the wearer was found at the 4th stop (12 s, no AI call); a thing
nowhere in view took a full turn (~23 s), one AI call, a walk toward the AI's pick until a chair
stopped it, a second turn, and was found; with the AI answering but the thing never found, it gave
up after exactly 3 calls; with the AI off or answering "nowhere", it gave up after one turn. `ai.js`
was tested against a stand-in for Gemini's API (answers, answers in code fences, no photo,
out-of-range photos, not JSON, HTTP errors, the rate limit). Against Gemini itself
(`gemini-3.5-flash-lite`), through the server: two drawn test photos (a desk with a red bottle-like
cylinder, a door) and "water bottle" → "visible, photo 0, x 638, the study desk", which is where the
cylinder is. **Not yet tested with real photos on real hardware.**

A laptop whose antivirus scans HTTPS (Norton, for one) re-signs Google's certificate, and Node.js
then refuses it (`couldn't reach Gemini: …` with a certificate error). Start the
server with `node --use-system-ca --env-file-if-exists=.env server.js` (Node.js 22.15 or newer):
Node then trusts the system's certificates, as browsers do.

### 7.8b Plain-language requests

The detectors need a thing's name; people say what they need. "Something to drink", "somewhere to
sit", "something to write with" (`findThing()`, `onAiWhat()` in `hands.html`; `whatToFind()` in
`ai.js`):

1. Find mode starts at once (the echo buzz), but nothing is looked for yet (`THINKING: what to look
   for, for "something to drink"`).
2. The request alone, as text, goes to Gemini: *which one kind of object should the camera look
   for?* It answers with 1–3 plain words and a reason; the answer is checked (letters only, short).
3. Find mode goes on as if that had been asked ("water bottle": the object finder's prompt, YOLO's
   `bottle`, its usual size). The display's scan card shows `AI: "something to drink" means water
   bottle. A water bottle is the most common…`.
4. No answer (no key, switched off, an error, or nothing in 15 s): it looks for the words as they
   were said.

Against Gemini (`gemini-3.5-flash-lite`): "something to drink" → water bottle (133 tokens, 0.95 s),
"somewhere to sit" → chair (134 tokens, 0.76 s). Same limits and switch as 7.8a: only from the
laptop's own page, 6 calls a minute, **Settings → Ask the AI where to look** off = no calls.

### 7.9 The last reach: steering the hand

At the door handle or a found thing, the wrists steer the wearer's hand onto it (`reachTick()` in
`hands.html`).

1. **Hand tracking, on the phone.** Once arrived, the laptop sends `want-hands` every second; for
   3 s after each, the phone runs MediaPipe's hand landmarker (`@mediapipe/tasks-vision` 1.0.1, the
   float16 hand model, on the GPU with a CPU fallback, up to 2 hands) on every other camera frame
   (~7 a second). For each hand, it adds to its `eyes` messages:
   - `tip`: the middle of the index and middle fingertips (landmarks 8 and 12), what touches first;
   - `palm`: the middle of the wrist and the four knuckles;
   - `width`: the distance from the index to the little-finger knuckle (landmarks 5 and 17), in
     960-px frame pixels.

   `hands: []` means tracking, but no hand in view. The model loads when Start is tapped and runs
   once on a blank image straight away: the first run sets up the GPU and freezes the page for a
   few seconds, better at the start than at the door.
2. **Where the target is in the frame:** the middle of its last box (from YOLO or the object
   finder), shifted sideways by however far the chest has turned since (`tan(turn) × f` pixels).
   The reaching hand often hides the target, so it can't be re-detected.
3. **How far off:** the angle from the fingertips to the target, sideways and up/down. **Lined up**
   = within half the target's box both ways (at least ±4°). **The hand's distance** = `f × 0.08 m ÷
   knuckle width` (an adult's index-to-little-finger knuckles are about 8 cm apart); **gap** = the
   target's distance − the hand's.
4. **Buzzes** (the first one 1 s after the arrival buzz, so the two don't blur together):
   - no hand in view: *reach out*, every 1.2 s;
   - not lined up: the bigger miss first (measured against the tolerance): *left* / *right* on that
     wrist, *up* / *down* as a high / low buzz on both, every 300 ms; strength `0.4 + degrees ÷ 30`
     (full from 18° off);
   - lined up: *forward* pulses, `1 ÷ gap` a second (2–6);
   - lined up with a gap under 12 cm: **touch** (3 quick high buzzes), once; it stays "touching"
     until the gap grows past 25 cm or the hand drifts off line.
5. **No hand tracking** (MediaPipe failed to load), and during the arrival buzz: no reach buzzes;
   the display says where to reach, in words ([7.8](#78-mode-3-find-a-thing)).
6. **Meanwhile:** obstacle stops are off, and it takes 1 m (not 0.5 m) past the arrival radius to
   count as having left: the hand covers the target, which makes its box smaller and its distance
   read long.

The touch buzz means "you're about there", not contact: the target's distance is rough up close
(±20%), and so is the hand's (hands differ). The fingers finish the job by feel.

Tested with a simulated phone (every stage, on the right wrists, at the right pitches) and with hand
photos in Chrome on the Mac (MediaPipe found the fingertips and knuckles).

### 7.10 Choosing: buttons, voice, typing

**Buttons**

- Counted: left Joy-Con `up down left right L ZL − Capture` and stick click; right Joy-Con
  `A B X Y R ZR + Home` and stick click. Not SL/SR (the library reads those from both halves of the
  report, where the noise is).
- Each press counts once (on the way down; holding doesn't repeat). Presses on both Joy-Cons add up.
  1.5 s after the last press, the count is chosen.

**Voice.** The phone recognizes English (US) speech continuously and sends every final phrase to the
laptop, which decides:

1. Lower-case it, drop punctuation, and drop leading `please`, `hey`, `hi`, `ok`/`okay`, `paradise`,
   `can you`, `could you`, `would you`, `will you`.
2. A leading command verb is noted and removed: `take me to`, `bring me to`, `get me to`, `go to`,
   `guide me to`, `walk me to`, `navigate to`, `help me find`, `look for`, `find`, `grab`, `fetch`,
   `bring me`, `bring`, `get`, `where's`, `where is`, `where are`, `where did i put`.
3. Filler is removed: leading `me us the a an my our your some`, trailing `please`, `for me`,
   `for us`, `now`, `thanks`, `thank you`.
4. What's left:
   - exactly `waymo` (or `way mo` / `way more`, how dictation sometimes spells it) → **Waymo**;
   - exactly a place's name → **that place**;
   - otherwise, *if there was a command verb*, and it isn't a word like `it`, `there`, `going`,
     `started`, `ready`… → **find it**. Plain language instead of a thing's name (it starts with
     `something`, `anything`, `somewhere`, `anywhere`, `place`, `thing` or `stuff`: "something to
     drink", "a place to sit") → the AI names the thing first ([7.8b](#78b-plain-language-requests)).

| Said | Result |
|---|---|
| "Waymo." / "Take me to the Waymo, please" / "Bring me the Waymo" | Waymo |
| "Test north" / "Go to test north" | That place |
| "Find my keys." / "Where are my keys?" / "Hey Paradise, find my phone." / "Get me a water bottle please" / "Where’s the trash can?" | Find: keys / keys / phone / water bottle / trash can |
| "Find me something to drink" / "Help me find somewhere to sit" | Find: water bottle / chair (named by the AI) |
| "Let's get started" / "That's way more fun" / "I love Waymo" / "I can't get there" / "Get going" | Nothing (not commands) |

**Typing:** the **Find something** box goes through the same cleanup (steps 2 and 3, so "find me
something to drink" works typed too), then find mode.

### 7.11 The server

- **Pages:** serves only `.html`, `.js` and `.css` files inside `public/`; `/` is `hands.html`;
  never cached (`Cache-Control: no-store`); malformed addresses get 400, anything else 404. The
  models and server code are never served.
- **Relay:** every WebSocket message goes to all other connected pages, except messages with a `to`
  field, which go only to pages with that role (`eyes`, `hands`, `beacon`), or to the server itself
  (`to: "server"`). A page's role is the `?role=` in its WebSocket address.
- **Preview frames** come to the server: it passes each one on to the laptop pages as it is (for
  the display), then, while a laptop page is connected, runs the depth model on it and sends the
  result (`depth`) to the laptop pages.
- **Models:** each in its own Node process (forked), because the ONNX runtime crashes when two
  threads of one process use it, and running one in the server's main thread held up the relay for
  over a second (long enough for the laptop's no-signal stop). One object-finder frame at a time (a
  second one gets `busy`, and the laptop asks again 0.5 s later); CLIP requests queue; the depth
  model takes one preview frame at a time and skips any that arrive while it's busy (the next one
  is a quarter of a second away). A crashed model process restarts (up to 3 times); requests it was
  working on fail cleanly. Model processes exit with the server.
- **Robustness:** anything can arrive through the public tunnel; malformed messages are logged and
  ignored, never fatal.
- **Port:** 8080, or `PORT=… npm start`.

### 7.12 Message protocol

All messages are JSON over one WebSocket per page: `ws(s)://<host>/ws?role=eyes|hands|beacon`.
Images are JPEG data URLs.

**From the chest phone (`role=eyes`)**

| `type` | To | When | Fields |
|---|---|---|---|
| `eyes` | everyone | 10 a second | `seq`; `compass` (degrees, or `null` if stale); `gps` `{lat, lon, acc, age}` or `null` (`age` in ms); `frame` `{w, h, focal, camH, pitch}` (what boxes are measured in; `pitch` = tilt, degrees down); `objects` (only when there's a new YOLO result): `[{label, score, angle, distance, box: [x1, y1, x2, y2] as 0–1}]`; `hands` (only while tracking hands): `[{tip: [x, y], palm: [x, y] as 0–1, width (knuckles, 960-px frame pixels)}]`, `[]` = no hand in view |
| `preview` | `server` (which passes it on to `hands`) | 4 a second | `image` (360 px, JPEG quality 0.6); `cam` `{focal (in this image's pixels), camH, pitch}` (for the depth model); `boxes` `[{label, angle, distance, x1, y1, x2, y2 as 0–1}]` |
| `frame` | `server` | When asked | `id`, `prompt`, `check` `{what, same}` (find mode), `image` (800 px, quality 0.7), `w`, `h`, `focal` (in this image's pixels) |
| `cars` | `server` | Twice a second, while asked | `compass`; `cars` `[{image (224 × 224, quality 0.85), angle, distance}]` |
| `heard` | everyone | Each spoken phrase | `text` |

**From the laptop page (`role=hands`)**

| `type` | To | When | Fields |
|---|---|---|---|
| `frame-please` | `eyes` | One at a time, while a frame is needed and the phone is connected | `id`, `prompt` (`"a car door handle."` or `"a <thing>."`), `check` |
| `want-cars` | `eyes` | Every second in Waymo mode | — (the phone sends car crops for the next 3 s) |
| `want-hands` | `eyes` | Every second while reaching | — (the phone tracks hands for the next 3 s) |

**From the beacon (`role=beacon`)**

| `type` | To | When | Fields |
|---|---|---|---|
| `beacon` | everyone | Once a second | `lat`, `lon`, `acc`, `age` |

**From the server (to every `hands` page)**

| `type` | When | Fields |
|---|---|---|
| `found` | After each `frame` | `id`; `boxes` `[{score, x1, y1, x2, y2 in pixels, verified?}]` or `null`; `reason` (why `null`: `busy`, `loading`, `failed: …`); `note` (e.g. `second opinion unavailable: …`); `w`, `h`, `focal`, `ms` |
| `waymo` | After each `cars` | `compass`; `cars` `[{angle, distance, prob}]` |
| `preview` | 4 a second | The phone's `preview` message, passed on as it is |
| `depth` | After each preview frame the depth model took (up to 4 a second) | `ok`; `why` (when not ok: `no floor in view (…)` or `floor not visible (…)`); `floor` (0–1, how much of where the floor should be looks like floor); `found` `[{kind: "obstacle" or "drop", distance (m), angle (degrees, + = right)}]`; `ms` |

The laptop page ignores a `found` answer if the mode changed since it asked (it's about something
else), and gives up on a request after 5 s.

### 7.13 Speed and bandwidth

Measured on a MacBook Pro (M3 Pro); phone speeds vary and show on the phone page.

| What | Time |
|---|---|
| YOLOv10n in Chrome on the Mac | 14 ms a frame (WebGPU), ~170 ms (WebAssembly) |
| Object finder (Grounding DINO tiny, 8-bit, CPU) | 1.1–1.6 s a frame |
| CLIP (8-bit, CPU) | ~20–35 ms an image; the first check for a new thing also encodes ~80 text labels once |
| Depth model (Depth Anything V2 small, 8-bit, 364 px, CPU) | ~80–90 ms a frame, including the floor fit; at 4 frames a second, about a third of one CPU core |
| Hand tracking (MediaPipe, on the phone) | Shown on the phone page while reaching (`hands: 1 in view · N ms`) |
| Server start with models on disk | A few seconds |

From the chest phone, roughly: `eyes` messages 10 a second (under 2 KB each; hand positions add a
few dozen bytes while reaching); preview frames 4 a second (~10–20 KB each); in Waymo mode up to 3
car crops twice a second (~10–15 KB each); an object-finder frame (~50–100 KB) every ~1.3 s while
finding or near the car. Well under 200 KB/s in total.

---

## 8. Tuning and customizing

All in `public/hands.html` unless noted. Pages: edit and reload. Server files: restart `npm start`.

| Setting | Where | Default | What it does |
|---|---|---|---|
| `PLACES` | top of the script | 2 test spots | Saved places ([4.11](#411-add-your-own-places)) |
| `DECLINATION` | top of the script | −6.8 (Miami) | Magnetic declination, east positive ([4.12](#412-set-your-magnetic-declination)) |
| Buzz strength / margin / GPS radius / stop distance | sliders under **Settings** on the page | 0.7 / ±12° / 6 m / 1.5 m | See [6.1](#61-the-laptop-page) |
| Obstacles from depth | switch under **Settings** on the page | on | See [7.5](#75-obstacles) |
| Colours, fonts, spacing | `public/paradise.css` (shared by the three pages) | light and dark | The page look; each page adds its own layout in its `<style>` |
| `PATTERNS` | "Buzz vocabulary" | see [What each buzz means](#what-each-buzz-means) | Each pattern: `buzz(side, strength, ms)`, `both(...)`, `repeat(n, gap, fn)` |
| `LO_HZ`, `HI_HZ` | Joy-Cons section | 160, 320 Hz | Rumble frequencies of normal buzzes (Joy-Con ranges: 41–626 Hz low, 82–1253 Hz high) |
| `HIGH`, `LOW` | Joy-Cons section | 320 + 900 Hz, 80 + 160 Hz | The up / down buzzes while reaching (and the touch buzz: `HIGH`) |
| `OBSTACLE_HOLD` | "What the chest phone tells us" | 1200 ms | How long an obstacle counts after it was last seen |
| `WAYMO_SURE` | "Waymo: which car" | 0.9 | Classifier score that confirms a Waymo |
| `HANDLE_RANGE` | object finder frames | 4 m | Distance to the car where the door-handle search starts |
| `HANDLE_WIDTH` | object finder frames | 0.25 m | Assumed handle width, for its distance |
| `THING_SURE` | object finder frames | 0.25 | Minimum object-finder score in find mode |
| Arrival radii | `guideTick()` | handle 0.8 m, car 1.0 m, thing 1.0 m | Camera-target arrival distances |
| `THINGS` | "Finding things" | [7.8](#78-mode-3-find-a-thing) | Add words, a YOLO kind and a size |
| `KNUCKLES` | "The last reach" | 0.08 m | Index-to-little-finger knuckle width, for the hand's distance (smaller hands: lower it) |
| Touch gap, tolerances, pulse rates | `reachTick()` | touch within 0.12 m (stays until 0.25 m); lined up within half the box, at least ±4°; 300 ms steering pulses | [7.9](#79-the-last-reach-steering-the-hand) |
| Blocked frames, near-target distance | `onDepth()` | 2 frames; 2.5 m | When "no floor in view" stops the wearer |
| Walking corridor, obstacle heights, floor fit | `depth-worker.js`, `analyze()` | ±0.4 m wide, 0.3–4 m ahead, 0.12–2.1 m high; drop below −0.12 m; floor fitted 1–4 m ahead, 25% to count | What the depth model calls an obstacle |
| Depth model input size | `depth-worker.js` | 364 px | Bigger is sharper and slower (the model's default, 518 px: ~200 ms a frame) |
| Hand tracking rate | `public/eyes.html`, the camera loop | every other frame (~7 a second) | `now - hands.last > 80` |
| `POLITE`, `VERB`, `NOT_A_THING` | "Voice" | [7.10](#710-choosing-buttons-voice-typing) | The voice grammar |
| `HEIGHTS` | `public/eyes.html` | car 1.6 m, … | Real heights for distance by size |
| Focal / person height / chest height | phone page | 720 / 1.70 / 1.30 | [4.9](#49-calibrate-distances-once-per-phone) |
| `OTHERS` | `clip-worker.js` | ~80 labels | Alternatives CLIP compares a found thing against |
| `waymo-head.json` | `paradise/` | trained weights | Retrain: [9](#9-the-waymo-classifier) |
| `PORT` | environment | 8080 | `PORT=8081 npm start` |

Adding a place, a thing or a voice word is a one-line change. Adding a new buzz pattern: add it to
`PATTERNS`, then call it from `guideTick()`.

---

## 9. The Waymo classifier

CLIP turns each car crop into 512 numbers; a small logistic regression, trained on photos, turns
those into "how sure is it a Waymo". Only the regression is trained (about a minute on a laptop, no
GPU); its weights are `waymo-head.json`.

- **Data:** openly licensed photos from Wikimedia Commons and Openverse: 305 Waymo photos and 642
  other-car photos (deliberately including look-alikes: plain Jaguar I-Paces, Zoox and Cruise
  robotaxis, taxis). YOLO cut out the cars; every Waymo crop was checked by eye, and 70 that weren't
  current Waymos (retired Firefly pods, Google Lexus test cars, buses…) were removed.
- **Result:** 125 Waymo crops (Jaguar I-Pace, Pacifica, Zeekr with sensors) vs 654 other cars.
  5-fold cross-validated (grouped by photo) at the 0.9 cutoff: **about 90% of Waymo crops recognized
  (88–91% across runs), 4 false alarms among the 654 other cars**, mostly other robotaxis with roof
  sensors. The phone sends several crops a second, so a missed one rarely matters.
- **Why CLIP:** compared with DINOv2 features, CLIP caught more Waymos at the strict cutoff;
  combining both didn't help.

**Make it better with photos from the venue** (the actual Waymos you'll demo with, in that light,
plus the other cars parked there). Full steps in [training/README.md](training/README.md). In short:

```
cd training
# put JPEG/PNG photos in data/img/pos (Waymos) and data/img/neg (other cars)
node crop.mjs                                # new photos only; lists unreadable files (iPhone HEIC: convert to JPEG)
node sheet.mjs crops/pos sheet1.jpg 0 108    # check the Waymo crops by eye
node embed.mjs
node train.mjs                               # prints the cross-validated accuracy; writes ../waymo-head.json
```

Then restart `npm start`. To start from scratch (download the web photos again), run
`node collect.mjs` and `node download.mjs` first.

---

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `npm start`: *Could not read package.json* | Run it from `paradise/`, not the repo root. |
| `Port 8080 is already in use` | `npm start` is already running in another terminal: stop it, or `PORT=8081 npm start`. |
| Models download slowly on first start | They're ~390 MB; wait for all three **ready** lines. After that they load from disk. |
| Tunnel logs `Failed to dial a quic connection` | Use `--protocol http2`. Still stuck: put the Mac on a phone hotspot. |
| Phone: **Laptop** `Not connected` | Is `npm start` running? Is the tunnel running, with the address you typed? It changes on every restart. |
| Phone: `camera error` | Use the https tunnel address, not `http://…`. Allow the camera in Safari's site settings (**aA → Website Settings**). |
| Phone: **Objects** `Failed to load` | The phone needs internet for the first load (~30 MB from jsDelivr and Hugging Face). Reload. |
| `GPS error: User denied Geolocation` | Allow location ([4.7](#47-set-up-the-chest-iphone)); reload and tap Start again. |
| GPS ±35 m or worse | You're indoors, or Precise Location is off. |
| Laptop: *No compass* / phone: **Compass** `Not allowed (motion access)` | Allow motion & orientation when Start asks. Reload and tap Start again; if iOS doesn't ask, quit Safari and reopen it. |
| Steers the wrong way | Phone upright, camera facing forward; turning right must make `heading` go **up**. Keep it away from magnets and steel. Joy-Cons on the right wrists (L left, R right). |
| GPS targets consistently a bit off | Set `DECLINATION` for your location ([4.12](#412-set-your-magnetic-declination)). |
| Joy-Con won't connect or buzz | Quit Steam/BetterJoy; re-pair; use Chrome; press a button on the Joy-Con to wake it. |
| Button presses don't count | Use a face button, trigger or stick click (not SL/SR); wait 1.5 s after the last press. |
| `NO SIGNAL` while the phone is on | Keep the phone screen on and `eyes.html` in front; check its signal. |
| Phone: **Voice** `not-allowed` / `service-not-allowed` | Allow the microphone for the site; turn on Dictation (**Settings → General → Keyboard**). Buttons always work. |
| Voice ignores what I say | It must start with a command ([7.10](#710-choosing-buttons-voice-typing)); check the `Heard:` text for how it was transcribed. |
| Stops for no reason: `STOP: person…`, `STOP: chair…` | Something YOLO recognized is within the stop distance ahead; lower **Obstacle stop distance**. |
| Stops for no reason: `STOP: something…` | The depth model. Check the phone's `tilt` (10–20° down is best), **Chest height** and **Focal** ([4.8](#48-mount-the-chest-iphone), [4.9](#49-calibrate-distances-once-per-phone)): it measures against the floor, so wrong values put the floor in the wrong place. Still wrong: untick **Obstacles from depth**. |
| `STOP: something close (no floor in view)` with nothing there, or `depth: no floor in view (tilt the phone down a little)` | The camera doesn't see the floor ahead: it's tilted up, or a jacket or strap covers the lower part of the lens. Tilt it down 10–20°. |
| Phone: **Hands** `Failed to load` | Needs internet the first time (~20 MB from jsDelivr and Google). Without it, the reach buzzes are off and the display just says where to reach. |
| Reaching: `hand not in view yet` although the hand is out | Reach out in front of the chest, below the camera (the camera sees about ±20° to each side). Keep the chest still while reaching. Gloves and long sleeves over the hand can hide it from the tracker. |
| Reaching: the touch buzz comes too early or too late | The target's distance or the hand's is off: calibrate focal ([4.9](#49-calibrate-distances-once-per-phone)); for a smaller or bigger hand, change `KNUCKLES` ([8](#8-tuning-and-customizing)). |
| Never finds the Waymo | Check `waymo classifier: best NN%` while the car is in view: under 90% on your Waymo = retrain with venue photos ([9](#9-the-waymo-classifier)). |
| Never finds the door handle | Side-on to the door, 1–3 m away, whole door in view. |
| Find mode: `(second opinion unavailable: …)` | CLIP is still loading or failed: check the server terminal. |
| Distances clearly wrong | Calibrate focal and set chest height ([4.9](#49-calibrate-distances-once-per-phone)). |

---

## 11. Known limitations

Say these out loud when presenting:

- **Obstacles:** YOLO's 80 everyday kinds of things (people, bikes, cars, benches, hydrants,
  dogs…), plus the depth model for anything else that sticks up 12 cm–2.1 m from the floor in the
  walking path (walls, poles, doors, boxes). The depth model does **not** reliably see low curbs
  (~15 cm), steps down, holes or drop-offs whose edge doesn't show, glass doors and walls, or
  overhangs above the camera's view. Its distances are rough (±20–30%): it needs the floor in view
  and the right chest height and tilt. The cane covers the rest.
- **Reaching:** the touch buzz means "about there", not contact: the target's distance is rough up
  close (±20%), and the hand's distance assumes 8 cm knuckles. While the hand hides the target, its
  position is where it was last seen, corrected for the chest turning but not for the wearer
  stepping or leaning. The hand has to be in the chest camera's view.
- **GPS drift** is several meters, so a place's arrival radius needs tuning on site.
- **Compass** is magnetic: steel, magnets and cars nearby can skew it by several degrees.
- **Waymo classifier:** ~90% per crop, 4 false alarms in 654 other cars in testing, mostly other
  robotaxis with roof sensors. Trained on web photos; venue photos improve it.
- **Door handle:** sometimes it picks the charging-port flap. Distances up close are rough (±20%).
- **Find mode:** in 21 photo tests the double check kept 10 of 11 real finds and rejected 9 of 10
  false alarms (a plastic container passed as "a water bottle"). Things YOLO doesn't know update only
  every ~1.2 s. Distance to unknown things assumes they're on the floor.
- **Arrival at a found thing is about 1 m** (arm's reach); from there the hand is steered, and
  the fingers finish by feel.
- **Voice** needs clean mic pickup; buttons always work.
- **Not a real Waymo integration:** the beacon phone stands in for the car's location, and the ride
  status on the display is simulated.
- **Tested so far** with simulated phones, real photos, rendered depth scenes and hand photos (in
  Chrome on the Mac); the hardware parts need testing on the real devices (section 5): the
  Joy-Cons (and whether the high and low buzzes are easy to tell apart), the iPhone compass and
  tilt on the real mount, iPhone speech recognition, hand tracking on the iPhone, and the depth
  model while actually walking.

---

## 12. Privacy and security

- The chest camera's frames go from the phone, through Cloudflare's tunnel, to the Mac. Nothing is
  stored, and nothing is sent anywhere else (except below). The models run on the Mac and the phone. Hand tracking
  runs on the phone; only fingertip positions leave it.
- The phone downloads its models and libraries from jsDelivr, Hugging Face and Google's storage
  (the hand model). Those are downloads only: no camera data goes to them.
- **The one exception: asking the AI** ([7.8a](#78a-not-in-view-the-room-scan-and-asking-the-ai)).
  With a Gemini key set and **Settings → Ask the AI where to look** on, a find that sees nothing
  all the way round sends that turn's 10 small photos of the room to Google's Gemini API. Tell
  whoever wears it; switch it off, or leave out the key, to keep everything local. **On Gemini's
  free tier, Google may use what's sent to improve its products** (its pricing page, September
  2026); on the paid tier it doesn't. Fine for a demo; for real users' homes, use a paid key.
- The Gemini key lives only in `paradise/.env` on the Mac (git-ignored), is used only by the
  server, and only requests from the laptop's own page can use it.
- Walking routes: the laptop page sends the wearer's position and the target's to OpenStreetMap's
  router ([7.6a](#76a-walking-routes)).
- **The tunnel address is public:** anyone who has it can open the pages and see the camera view.
  Stop the tunnel when you're done; a new tunnel gets a new address.
- The server terminal never prints coordinates, only GPS accuracy and distances.
- Phone settings (focal, heights) are saved in the phone's browser storage only.

---

## 13. Why it's built this way

- **A laptop in the loop:** Chrome's WebHID can drive Joy-Cons; iPhone Safari can't. The laptop also
  runs the two bigger models, which are far too slow in a browser.
- **A Cloudflare tunnel:** iPhones only allow the camera, GPS, compass and microphone on https
  pages, and the beacon phone may be on cellular far away. A quick tunnel is free, needs no account,
  and works from anywhere.
- **Heading from the iPhone compass, not the Joy-Cons' gyro:** the Joy-Cons are on the wrists, and
  arms swing.
- **YOLO on the phone, the rest on the Mac:** YOLO is small and fast, and its results are tiny to
  send. Grounding DINO and CLIP are 200 and 150 MB; in the Mac's Node.js they take ~1.2 s and ~30 ms,
  in a browser ~14 s (and their WebGPU versions gave wrong scores).
- **Each model in its own process:** the ONNX runtime crashes when two threads of one process use
  it, and a model in the server's main thread stalled the relay for over a second.
- **CLIP's second opinion in find mode:** the object finder nearly always boxes *something*, so its
  score alone can't tell "found" from "not there".
- **A trained Waymo classifier instead of a dome detector:** open-vocabulary "sensor dome" detection
  was unreliable in tests (ordinary cars' mirrors scored higher than real domes); a classifier trained
  on whole-car crops works much better.
- **Big frames only on request:** the phone sends 800-px frames only when the laptop needs one,
  which keeps cellular data low.
- **A depth model for obstacles, on the Mac:** YOLO only knows 80 kinds of things; a wall or a pole
  isn't one of them. The small preview frames already go to the Mac (for the display), and its CPU
  runs the depth model in ~80 ms; the phone's GPU is busy with YOLO.
- **The floor as the ruler:** a single camera's depth model gives no units. The chest height and the
  measured tilt say how far away the floor is in each row of the frame, which calibrates every frame
  on its own. (Web pages can't use an iPhone's lidar.)
- **Hand tracking on the phone:** MediaPipe's hand model is small (8 MB) and fast in a browser, and
  the hand needs tracking faster than frames could make a round trip to the Mac and back.
- **Knuckle width for the hand's distance:** MediaPipe's own depth values are relative to the wrist,
  not to the camera; the knuckles' width in the frame shrinks as the hand moves away.
- **High and low buzzes for up and down:** there are only two wrists, and left and right take one
  each. Up and down buzz both, told apart by pitch (Joy-Con HD rumble can play any frequency).
- **A beacon phone for the Waymo's location:** there's no public Waymo API.

---

## 14. Files

```
paradise/
├── README.md                  this file
├── package.json               npm start → node server.js (with .env); dependencies: ws, @huggingface/transformers
├── .env                       your Gemini key, if any (you create it; git-ignored; 4.2a)
├── server.js                  web server (public/ only), WebSocket relay, passes frames/crops to the models, status line
├── ai.js                      asks Gemini where to look next (only after a full turn finds nothing) and what a plain-language request means, with limits
├── object-finder.js           starts and talks to the object finder process (restarts it if it crashes)
├── object-finder-worker.js    the object finder: Grounding DINO tiny (8-bit), finds things described in words
├── clip.js                    starts and talks to the CLIP process (restarts it if it crashes)
├── clip-worker.js             CLIP ViT-B/32 (8-bit): the Waymo classifier + second opinions
├── depth.js                   starts and talks to the depth process (restarts it if it crashes)
├── depth-worker.js            Depth Anything V2 small (8-bit) + the floor fit: obstacles in the walking path
├── waymo-head.json            trained Waymo classifier weights (512 means, 512 spreads, 512 weights, 1 bias)
├── models/                    downloaded models (git-ignored; ~390 MB, fetched on the first npm start)
├── public/                    the pages (served to browsers)
│   ├── hands.html             laptop page: Joy-Cons, choosing, voice commands, all guidance (incl. the last reach), the display
│   ├── eyes.html              chest phone: camera + YOLO, hand tracking (MediaPipe), compass, tilt, GPS, voice, frames and crops
│   ├── yolo-worker.js         YOLOv10n in a web worker on the phone (WebGPU or WebAssembly)
│   ├── paradise.css           the look shared by the three pages (light and dark follow the device)
│   └── beacon.html            beacon phone: shares its GPS location
└── training/                  the Waymo classifier's training pipeline (see training/README.md)
    ├── README.md
    ├── collect.mjs            1. lists openly licensed photos (Commons, Openverse)
    ├── download.mjs           2. downloads them
    ├── crop.mjs               3. YOLO + crops the cars (new photos only)
    ├── sheet.mjs              contact sheets, to check crops by eye
    ├── embed.mjs              4. CLIP features for every crop
    ├── train.mjs              5. trains, cross-validates, writes ../waymo-head.json
    └── data/                  photos, crops, features (git-ignored)
```

---

## 15. Credits and licenses

| Component | Source | License |
|---|---|---|
| YOLOv10n (phone) | [onnx-community/yolov10n](https://huggingface.co/onnx-community/yolov10n) (from THU-MIG's YOLOv10) | **AGPL-3.0**: check what this means for you before you distribute or host a product built on it |
| Grounding DINO tiny (object finder) | [onnx-community/grounding-dino-tiny-ONNX](https://huggingface.co/onnx-community/grounding-dino-tiny-ONNX) (IDEA Research) | Apache-2.0 |
| CLIP ViT-B/32 | [Xenova/clip-vit-base-patch32](https://huggingface.co/Xenova/clip-vit-base-patch32) (OpenAI CLIP) | OpenAI's CLIP release is MIT; check the model card for your use |
| Depth Anything V2 Small (obstacles) | [onnx-community/depth-anything-v2-small](https://huggingface.co/onnx-community/depth-anything-v2-small) (from Depth Anything V2, HKU and TikTok) | Apache-2.0 (the Small model only: the bigger Depth Anything V2 models are non-commercial) |
| MediaPipe hand landmarker (phone) | `@mediapipe/tasks-vision` 1.0.1 and the `hand_landmarker.task` model (Google) | Apache-2.0 |
| Where to look next (server, optional) | Google Gemini API (`gemini-3.5-flash-lite` by default) | Google's terms for the Gemini API; paid beyond its free tier |
| Walking routes (laptop page) | OSRM foot router at `routing.openstreetmap.de` (FOSSGIS), over OpenStreetMap data | Data © OpenStreetMap contributors, ODbL (credited under **Settings → Follow walking routes**); the server is shared and free: light use only |
| transformers.js | `@huggingface/transformers` 3.8.1 | Apache-2.0 |
| ONNX Runtime | `onnxruntime-node` 1.21.0, `onnxruntime-web` 1.22.0 | MIT |
| sharp | 0.34.5 | Apache-2.0 |
| ws | 8.21.3 | MIT |
| joy-con-webhid | 0.11.0 | Apache-2.0 |
| Training photos | Wikimedia Commons and Openverse (Creative Commons and similar licenses; kept locally in `training/data/`, not redistributed) | Per photo |
