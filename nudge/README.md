# Nudge

Touch-only guidance for blind and DeafBlind people. Two Joy-Cons, one on each wrist, buzz to steer
the wearer: turn left, turn right, walk, stop, you're there. Nothing is ever said out loud or shown
to the wearer. A phone on the chest is the eyes; a laptop in a backpack does the thinking.

It does three things:

1. **Walks you to a saved place** (GPS and compass).
2. **Walks you to your Waymo, right up to its door handle** (GPS toward the car, then a camera
   model that recognizes Waymos, then a door-handle finder).
3. **Finds a thing you ask for** ("water bottle", "my keys", "trash can") and walks you to it.

The whole time, in every mode, it **stops you for obstacles** the camera can see.

> **Safety.** This is a prototype. It works *alongside* a white cane, never instead of one. It can't
> see curbs, steps, holes, glass or most walls. Always test with a sighted spotter walking next to
> the wearer.

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
| **Go to the Waymo** | Press once, or say "Waymo" | GPS toward the car's location, then the camera: a classifier that recognizes Waymos, then a door-handle finder | One long buzz at arm's length from the door handle |
| **Find a thing** | Say "find the water bottle", or type it on the laptop page | The camera: an object finder that looks for exactly the words given (plus YOLO for everyday things) | One long buzz at about 1 m: arm's reach |

A mode stays on until another is chosen (or **Stop** is pressed on the laptop page).

### Choosing

- **Buttons (the main way).** Press any Joy-Con button N times: any face button, trigger, `+`/`−`,
  Home/Capture or stick click (not the small SL/SR buttons on the rail). Both Joy-Cons count toward
  the same number. 1.5 s after the last press it counts: **1 = Waymo, 2 = first place, 3 = second
  place**, and so on. The Joy-Cons buzz N times back to confirm (the *echo*). A number with no
  choice behind it gets the search buzz and changes nothing.
- **Voice.** The chest phone listens all the time. Only commands count: what's said has to *start*
  with one (after an optional "please", "hey Nudge" or "can you"), so people talking nearby don't
  change anything. Full grammar in [7.9](#79-choosing-buttons-voice-typing).
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
| Waymo connected / found it | Both | 2 × 80 ms pulses, 180 ms apart | Full |
| Selection echo | Both | N × 120 ms pulses, 300 ms apart (N = the choice) | 80% |

Every strength is multiplied by the **Strength** slider on the laptop page (default 0.7). Guidance
waits until an echo is over, so it can be counted. The **Try each buzz** buttons on the laptop page
play each pattern.

### What onlookers see (the laptop page is the display)

The wearer never looks at a screen. The laptop page is for everyone else:

- the chest camera's live view (4 frames a second), with boxes: **red "STOP"** on an obstacle,
  **green** on the target (labelled WAYMO, or the thing's name), grey on everything else; in find
  mode a **dashed green** box is the object finder's latest find;
- two wrist icons, **L** and **R**, that light up exactly when that wrist buzzes (even with no
  Joy-Con connected, which is handy for demos);
- one status line: `Mode: Waymo | Distance: 8.0 m (object) | Obstacle: none | Heard: "waymo"`;
- in Waymo mode, a simulated ride status: *Ride requested… → Your Waymo has arrived: guiding you to
  it → Waymo found by the camera → At the door*.

---

## 2. How it's built

### The devices

```
 ┌──────────────── chest iPhone (Safari) ─────────────────┐     ┌──── beacon phone ────┐
 │ eyes.html                                              │     │ beacon.html          │
 │  camera → YOLOv10n (runs in the phone, 80 object kinds)│     │  GPS, once a second  │
 │  compass, GPS, microphone (speech → text)              │     │  ("the Waymo")       │
 └──────────────────────────┬─────────────────────────────┘     └──────────┬───────────┘
                            │  https + WebSocket, through a Cloudflare tunnel │
                            ▼                                                 ▼
 ┌──────────────────────────── Mac, in a backpack ───────────────────────────────────────┐
 │ npm start → server.js: serves the pages, relays messages between them                  │
 │   ├─ object-finder-worker.js  (own process): Grounding DINO, finds things in words     │
 │   └─ clip-worker.js           (own process): CLIP, "is this a Waymo?" + second opinions│
 │ Chrome → http://localhost:8080/ → hands.html: all guidance decisions + the display     │
 └──────────────────────────────────────┬────────────────────────────────────────────────┘
                                        │ Bluetooth (Chrome's WebHID)
                          Joy-Con (L) on the left wrist · Joy-Con (R) on the right wrist
```

### What runs where, and why

| Part | Runs on | Its job | Why there |
|---|---|---|---|
| YOLOv10n (80 everyday object kinds) | Chest iPhone, in a web worker (WebGPU if available, else WebAssembly) | People, cars, bottles, chairs… several times a second: obstacles, cars to check, everyday things to find | Small (9 MB) and fast; only tiny results need sending |
| Compass, GPS, speech-to-text | Chest iPhone | Which way the wearer faces, where they are, what they said | The sensors are on the phone |
| Beacon | Second phone | Shares "the Waymo's" location | Stands in for Waymo's app: there's no public API |
| `server.js` | Mac (Node.js) | Serves the three pages; relays messages between them; hands frames to the models | One fixed place for everyone to connect to |
| Object finder (Grounding DINO tiny, 8-bit) | Mac, its own process | Finds things described in words in a camera frame: door handles, "a water bottle" | 200 MB; ~1.2 s a frame on a Mac's CPU, ~14 s in a browser |
| CLIP ViT-B/32 (8-bit) | Mac, its own process | "Is this car a Waymo?" (with trained weights); second opinions on the object finder's boxes | 150 MB; ~20–35 ms per image |
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
6. At 0.8 m from the handle: one long buzz. The display says "ARRIVED at the door handle: reach
   straight out, below chest height" and the ride status says "At the door".

---

## 3. What you need

### Hardware

| Item | How many | Notes |
|---|---|---|
| Mac laptop with Bluetooth | 1 | Runs the server, the two models and Chrome. Tested on a MacBook Pro (M3 Pro). Needs ~400 MB of disk for the models. It travels with the wearer (a backpack), because the Joy-Cons connect to it over Bluetooth (~10 m range). Windows and Linux should also work (see [Software](#software)), but only macOS was tested. |
| Nintendo Switch Joy-Con **(L)** and **(R)** | 1 each | **Original Switch Joy-Cons** (USB product IDs `0x2006` and `0x2007`). Switch 2 Joy-Cons are **not** supported. Charge them fully. |
| Joy-Con wrist straps | 2 | Any strap that holds a Joy-Con flat against the inside of the wrist. |
| Chest iPhone | 1 | Rear camera, GPS, compass, microphone. iOS 16.4 or newer (the page uses Screen Wake Lock and OffscreenCanvas). Where Safari has WebGPU, YOLO runs on the GPU (faster); otherwise it falls back to WebAssembly. Android Chrome should also work (the compass code handles Android) but wasn't tested. |
| Chest mount / harness | 1 | Holds the phone **upright (portrait), rear camera facing forward**, centered on the chest. |
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
| Loaded by the pages at runtime | `joy-con-webhid` 0.11.0 (laptop page); `onnxruntime-web` 1.22.0 and the YOLOv10n model (phone) | CDNs: jsDelivr, Hugging Face | Cached by the browser after the first load (~30 MB on the phone). |
| Downloaded by the server on first start | Grounding DINO tiny, 8-bit (204 MB); CLIP ViT-B/32, 8-bit (vision 89 MB + text 65 MB) | Mac, into `nudge/models/` | ~360 MB once, then loaded from disk. |

No accounts, no API keys, nothing paid.

---

## 4. Build it, step by step

### 4.1 Get the code

```
git clone https://github.com/Akhileshreddym/Haptik.git
cd Haptik/nudge
```

Everything lives in the `nudge/` folder. Run every command below from there.

### 4.2 Install

```
npm install
```

This installs the WebSocket library and the model runtime (`@huggingface/transformers`, with its
native ONNX runtime and the `sharp` image library). It takes a minute and a few hundred MB.

### 4.3 First start: the models download

```
npm start
```

Expected output on the very first start (the object finder shows download progress; CLIP downloads
silently):

```
Laptop (hands): http://localhost:8080/
Phone (eyes):   https://<tunnel address>/eyes.html
object finder model: downloading 20 / 204 MB
object finder model: downloading 40 / 204 MB
…
clip (waymo classifier, second opinions): ready
object finder: ready
```

Wait for both **ready** lines. On a slow connection the first download can take a while (at
0.3 MB/s, ~20 minutes); after that every start loads from `nudge/models/` in a few seconds. The
models are git-ignored, so each machine downloads its own copy.

Leave this terminal running. Every 3 s, while a phone is connected, it prints a status line (see
[6.4](#64-the-server-terminal)).

- **Port already in use?** It says so: `Port 8080 is already in use: is npm start already running in
  another terminal?` Stop the other one, or run on another port: `PORT=8081 npm start` (then use
  that port in the URLs below).
- **Edited a page** (`public/…`)? Just reload it in the browser; pages are never cached.
  **Edited a server file** (`*.js` in `nudge/`) or retrained? Stop with Ctrl + C and `npm start`
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
2. Click **Connect a Joy-Con**. Chrome shows a device picker: choose **Joy-Con (L)**, click
   **Connect**.
3. Click **Connect a Joy-Con** again for **Joy-Con (R)**.
4. The line under the button reads `Joy-Con L: connected · Joy-Con R: connected`.
5. Press a few **Try each buzz** buttons: the right wrist should buzz, and the L/R icons should light.

Chrome remembers the permission. Next time, the Joy-Cons reconnect by themselves when the page
loads or when they wake up; you only click **Connect** for a new Joy-Con. If one drops out
(battery, out of range), the status line shows `—` for it until it's back.

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
2. For voice: Safari's speech recognition uses Apple's dictation. If the phone page later shows
   `voice: service-not-allowed`, turn on **Settings → General → Keyboard → Enable Dictation**.

Then, each time:

1. In **Safari**, open `https://<your tunnel address>/eyes.html`.
2. Tap **Start (camera + GPS + compass + mic)** and **allow every prompt**: microphone (speech),
   motion & orientation (the compass), location, camera. The first load downloads ~30 MB (use
   Wi-Fi).
3. Check the page:
   - the badge turns green: `LAPTOP: CONNECTED · N updates sent`;
   - `objects: model ready (webgpu)` (or `wasm` on phones without WebGPU), then `objects: webgpu,
     N ms a frame`;
   - `voice: listening`;
   - `GPS: ±N m · compass: N°`.
4. On the laptop page, the camera view appears and the details box shows `phone: last message
   N ms ago`.

Keep the phone's screen on and this page in front. The page keeps the screen awake (and takes the
wake lock back if you switch apps and return). If a prompt was refused, reload and tap Start again;
if iOS doesn't ask again, quit Safari (swipe it away) and reopen it.

### 4.8 Mount the chest iPhone

- **Portrait, upright, rear camera facing straight ahead**, centered on the chest. The compass
  reports where the back of the phone points, and the distance-from-the-floor math assumes the
  camera looks level (not tilted up or down).
- The screen faces the wearer (it's not needed; onlookers watch the laptop).
- Measure the height of the phone's camera above the floor, in meters, and enter it as **Chest
  height (m)** on the phone page (default 1.30).

### 4.9 Calibrate distances (once per phone)

Distances come from how big things look, which depends on the phone's camera ("focal length" in
pixels). The default, 720, suits a typical iPhone main camera in portrait. To calibrate:

1. Have someone stand **exactly 3.00 m** from the phone, whole body in view.
2. Enter their height in **Person height (m)** on the phone page.
3. Tap **Calibrate: that person standing exactly 3.00 m away**. The **Focal (px)** box updates.
4. Check: the phone's list now shows them at about `person … 3.0 m`.

The math: focal = (their box height in pixels) × 3.00 ÷ (their height). Focal, person height and
chest height are saved on the phone and survive reloads.

### 4.10 Set up the beacon phone

1. Location Services as in [4.7](#47-set-up-the-chest-iphone) (Precise Location on).
2. In Safari, open `https://<your tunnel address>/beacon.html`.
3. Tap **Start sharing location** and allow location. (Refused by mistake? The button comes back:
   allow location in Safari's site settings and tap it again.)
4. Put the phone **in or on the car** you'll walk to, outdoors, screen on, page open.
5. Wait until it shows `accuracy ±10 m` or better. `last update N s ago` should stay low; a phone
   that isn't moving can go several seconds without a new fix, which is fine (the laptop accepts a
   beacon fix for 30 s).

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
  so on. The laptop page's **Choose** buttons show the numbers.
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

- [ ] `npm start` shows both **ready** lines.
- [ ] Tunnel running with `--protocol http2`; phone pages opened with **today's** address.
- [ ] Laptop page: both Joy-Cons connected; **Try each buzz** felt on the right wrists.
- [ ] Chest phone: green badge, `objects: model ready`, `voice: listening`, a GPS accuracy, a compass
      reading; mounted upright, camera forward; focal and chest height set.
- [ ] Beacon phone: accuracy ±10 m or better, in/on the car, screen on.
- [ ] Laptop page details box: `phone: last message` under 200 ms; `heading` changes when the wearer
      turns (turning right makes it go **up**).
- [ ] Spotter ready. Cane in hand.

---

## 5. Test it, step by step

Each step adds one piece. "✅" is what working looks like. Steps 1–2 need only the laptop and
Joy-Cons; 3–5 and 8 work indoors; 6–7 need outdoors.

### 1. Laptop and Joy-Cons

- `npm start`, open <http://localhost:8080/>, click **Connect a Joy-Con** for each.
- Press every **Try each buzz** button.
- ✅ Each pattern matches the table in [What each buzz means](#what-each-buzz-means), on the right
  wrist; the L/R icons light with it.
- Adjust **Strength** until every pattern is clearly felt through a sleeve.

### 2. Choosing with the buttons

- Press any button once and wait. ✅ After 1.5 s: one echo pulse; the status line says `Mode: Waymo`.
- Press three times. ✅ Three echo pulses; `Mode: test east`.
- Press once on each Joy-Con. ✅ It counts as 2: `Mode: test north`.
- Press more times than there are choices. ✅ A search buzz; the mode doesn't change.
- Connect the Joy-Cons and don't touch them for 10 s. ✅ Nothing is chosen by itself.

### 3. Chest phone and compass (indoors is fine)

- Tunnel on, `eyes.html` on the chest phone, **Start**, then mount it.
- ✅ Phone: green badge, `objects: model ready`. Laptop: the camera view appears.
- Stand still and press **90° right** (Indoor test).
- ✅ Right wrist pulses; turn right. At about 90°: approaching pulses (1 a second). If it steers the
  wrong way, watch the details box: turning right should make `heading` go **up**.
- Close `eyes.html`. ✅ Within a second: `NO SIGNAL from the chest phone` and slow L-R-L buzzes.

### 4. Obstacles

- Choose anything, and have a teammate step in front of you, 1 m away.
- ✅ 3 sharp pulses repeating, `STOP: person 1.0 m ahead`, a red STOP box on the camera view.
  Guidance resumes when they step aside.
- Calibrate distances now if you haven't ([4.9](#49-calibrate-distances-once-per-phone)).

### 5. Voice

- Say "Waymo", then "take me to test north", then "find the water bottle".
- ✅ The phone shows `voice: heard "…"`; the laptop status line shows `Heard: "…"`; an echo; the
  mode changes each time.
- Say "let's get started" and "that's way more fun". ✅ `Heard:` updates, the mode doesn't.

### 6. Go to a place (outdoors)

- Choose **test north** (2 presses) and walk.
- ✅ `Distance` counts down from about 30 m; one long buzz at the arrival radius (6 m); it stays
  `ARRIVED` as you walk on.
- GPS drifts several meters: raise **GPS arrival radius** if it arrives too early or never.

### 7. Go to the Waymo (outdoors, at a car)

- Beacon phone in or on a parked car. Start 30 m or more away; choose **Waymo** (1 press).
- ✅ Ride status "Your Waymo has arrived: guiding you to it"; steering toward the beacon, `… m (gps)`.
- ✅ Details box: `waymo classifier: best NN%`. Ordinary cars stay low; a Waymo goes over 90%.
- ✅ Waymo in view: 2 quick pulses ("connected"), a green WAYMO box, `… m (object)`, ride status
  "Waymo found by the camera".
- ✅ Within 4 m: `object finder: door handle: … NN%`, then `… m (handle)`.
- ✅ At the handle: one long buzz, `ARRIVED at the door handle: reach straight out…`, ride status "At
  the door". It stays arrived while you reach, even when the handle leaves the camera view.
- No handle found: stand side-on to the door, 1–3 m away, whole door in view.

### 8. Find a thing (indoors)

- Put a water bottle on a table 3–5 m away. Type **water bottle** under *Find something* and press
  Find (or say "find the water bottle").
- ✅ One echo; `Mode: find "water bottle"`; search buzz while it's out of view.
- ✅ Once in view: `object finder: "water bottle": ~1200 ms · NN%`; a dashed green box; 2 quick pulses
  ("found it"); steering toward it.
- ✅ About 1 m away: one long buzz, `ARRIVED: the water bottle is within reach, straight ahead, low…`.
  It stays arrived as you reach.
- ✅ The table under the bottle doesn't trigger STOP; a person stepping in between does.
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

**Display** (top): camera view, wrist icons, status line, ride status. See
[What onlookers see](#what-onlookers-see-the-laptop-page-is-the-display).

**Status line fields**

| Field | Meaning |
|---|---|
| `Mode` | `off`, `Waymo`, a place's name, `find "…"`, or `test …` |
| `Distance` | Meters to the target and where it comes from: `gps`, `object` (the Waymo car), `handle` (its door handle), `thing` (find mode), `test` |
| `Obstacle` | What's in the way and how far, or `none` |
| `Heard` | The last thing the phone heard (shown for 10 s) |

**Setup controls**

| Control | Default | What it does |
|---|---|---|
| Connect a Joy-Con | — | Chrome's device picker; once per Joy-Con |
| Choose: `1 · Waymo`, `2 · …` | — | Same as pressing a Joy-Con button that many times |
| Stop | — | Mode off |
| Find something + Find (or Enter) | — | Starts find mode for the typed thing |
| Strength | 0.7 (0.1–1) | Multiplies every buzz's strength |
| On-target margin | ±12° (5–30) | How close to straight ahead counts as "facing it" (+5° extra once facing, so it doesn't flicker) |
| GPS arrival radius | 6 m (2–20) | Arrival distance for places |
| Obstacle stop distance | 1.5 m (0.5–3) | Anything recognized closer than this, straight ahead, is an obstacle |
| Try each buzz | — | Plays each pattern |
| Indoor test: 90° left, 45° right, 90° right, Behind | — | Steers to a direction relative to where the chest faces (no GPS needed); no arrival |

**Details box** (bottom): what the guidance sees.

| Line | Example | Meaning |
|---|---|---|
| `guide:` | `TURN LEFT 83°` | What it's telling the wearer right now (full list below) |
| `phone:` | `last message 42 ms ago` | Over 1000 ms = no signal |
| `heading:` | `187° magnetic` | Which way the chest faces |
| `you:` / `beacon:` | `25.750000, -80.370000 ±5 m, 0 s old` | Last GPS fixes |
| `camera:` | `person 2.4 m, car 11.8 m` | What YOLO saw in the last 1.5 s |
| `waymo classifier:` | `best 96% (sure at 90%)` | Highest Waymo score in the last 3 s |
| `object finder:` | `door handle: 1180 ms · 22%` or `"water bottle": 1250 ms · not in view` | The object finder's last answer; `(second opinion unavailable: …)` if CLIP isn't ready |

**Guide messages**

| Message | Meaning |
|---|---|
| `waiting for a choice (…)` | No mode |
| `NO SIGNAL from the chest phone` | No phone message for 1 s: search buzz only |
| `NO COMPASS from the chest phone (allow motion access)` | Messages arrive, but no fresh compass reading: search buzz only (an old heading would steer wrong) |
| `STOP: person 1.0 m ahead` | Obstacle |
| `SEARCHING: waiting for GPS` / `waiting for the Waymo's location (beacon)` / `the water bottle: turn slowly` | No target yet |
| `TURN LEFT 83°` / `TURN RIGHT 12°` | Steering |
| `APPROACHING` | Facing it: walk |
| `ARRIVED` | At a place |
| `AT THE CAR: turn slowly along it to find the door handle` | At the Waymo, handle not found yet |
| `ARRIVED at the door handle: reach straight out, below chest height` | At the handle |
| `ARRIVED: the water bottle is within reach, a little left, low (about waist height)` | At the thing |

### 6.2 The chest phone page

`https://<tunnel>/eyes.html` (`public/eyes.html`).

| Element | What it is |
|---|---|
| Start (camera + GPS + compass + mic) | Starts everything; asks for every permission. Tap once. |
| Focal (px) | Camera focal length in pixels of the 960-px detection frame. Default 720. Saved on the phone. |
| Person height (m) | Height of the person used to calibrate, and the height assumed for people in distance estimates. Default 1.70. |
| Calibrate: that person standing exactly 3.00 m away | Sets Focal from the tallest person in view |
| Chest height (m) | Camera height above the floor. Default 1.30. Used for distances from where things meet the floor. |
| `objects:` | YOLO: loading, `model ready (webgpu/wasm)`, then milliseconds per frame |
| `voice:` | `listening`, `heard "…"`, or an error (`not-allowed` etc.: voice turns itself off; buttons still work) |
| Green/red badge | `LAPTOP: CONNECTED · N updates sent` means the phone reaches the **server**; check the laptop page's `phone:` line to be sure the laptop page is open too |
| `GPS: ±N m · compass: N°` | Current accuracy and heading (`compass: not updating` if the reading is over a second old) |
| List | Everything YOLO sees: `label score%  ±angle°  distance m` |
| Camera view | With blue YOLO boxes and a white center line |

### 6.3 The beacon page

`https://<tunnel>/beacon.html` (`public/beacon.html`). **Start sharing location** → shows
`lat, lon`, `accuracy ±N m`, `last update N s ago`, and a hint if accuracy is worse than 100 m
(Precise Location is off). `link: connected` means it reaches the server. It sends its latest fix
once a second.

### 6.4 The server terminal

| Line | Meaning |
|---|---|
| `eyes page connected (iPhone); 3 connected` | A page connected (role, device type, total) |
| `object finder model: downloading 40 / 204 MB` | First start only |
| `object finder: ready`, `clip (waymo classifier, second opinions): ready` | Models loaded |
| `object finder: failed: stopped (SIGKILL), starting it again` | A model process crashed; it restarts (up to 3 times) |
| `bad cars message: …` | A malformed message was ignored |
| `[status] chest phone 0s ago: gps ±5 m, compass 187°, sees person, car \| beacon 1s ago: ±4 m \| distance 32 m \| waymo 96% \| finding "a car door handle." best 22% (1180 ms)` | Every 3 s while a phone has sent something in the last 10 s. **No coordinates are ever printed.** |

---

## 7. How it works, in depth

All numbers below are the defaults in the code; [8](#8-tuning-and-customizing) says where to change
them.

### 7.1 The guidance loop

`guideTick()` in `hands.html` runs every 50 ms. In order, the first that applies wins:

1. **No mode:** nothing.
2. **No signal or no compass:** no phone message for 1 s, or no compass reading for 1 s → search
   buzz every 1.6 s, nothing else.
3. **Obstacle** seen in the last 1.2 s → stop pulses every 1.2 s.
4. **Target:** where to go (per mode, below). None → search buzz every 1.6 s.
5. **Arrived** (distance within the arrival radius) → one long buzz, then quiet until the wearer is
   0.5 m (camera targets) or 3 m (GPS) back outside the radius.
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
  - *By where it meets the floor:* with the camera level at chest height `h`, a point `y` pixels below
    the middle of the frame is `h × f ÷ y` away. A box cut off at the bottom is at least that close.

    ```
    camera ●───────────── level ─────────────
           │ \
         h │    \    the ray to the point where the thing meets the floor,
           │       \   y pixels below the middle of the frame
    floor ─┴──────────●───  distance = h × f ÷ y
    ```
- **Find mode** distance (on the laptop): `f × usual size ÷ the box's longer side`, using the sizes
  in [7.8](#78-mode-3-find-a-thing); unknown things fall back to the floor method (which reads too
  far for things on a table).
- Object-finder frames are 800 px, so their focal length is `f × 800 ÷ 960`.

### 7.5 Obstacles

- Anything YOLO recognizes, **within ±20° of straight ahead**, **closer than the stop distance**
  (1.5 m).
- Except: **the target itself** (a car within 15° of the Waymo's direction; in find mode, the thing's
  YOLO kind within 15° of the target), and, in Waymo and find modes, **anything at or behind the
  target** (distance ≥ target distance − 0.3 m): the table the bottle is on, or the Waymo itself
  while walking up to its door handle.
- It counts for 1.2 s after it was last seen (longer than YOLO's gap between results on a slow
  phone, so STOP doesn't flicker).
- Only YOLO's 80 kinds of things count ([11](#11-known-limitations)).

### 7.6 Mode 1: a place

GPS and compass only (no object recognition). Target: the magnetic bearing from the wearer's latest
fix to the place. Arrival: GPS distance ≤ the arrival radius (6 m). `SEARCHING: waiting for GPS`
until the wearer has a fix under 15 s old.

### 7.7 Mode 2: the Waymo

1. **Ride status** starts at "Ride requested…", and becomes "Your Waymo has arrived: guiding you to
   it" when a beacon fix arrives.
2. **GPS stage:** steer toward the beacon. There's no GPS arrival in this mode: only the camera
   decides you're there.
3. **Car crops:** while the laptop asks (`want-cars`, every second, in Waymo mode only), the phone
   sends the 3 biggest car/truck/bus boxes wider than 40 px, twice a second, cut exactly like the
   training crops: the box widened 5% each side and extended 35% of its height upward (so the roof
   sensors are in it), squashed to 224 × 224.
4. **Classifier:** CLIP image features → standardized → logistic regression (`waymo-head.json`) →
   probability. **0.9 or more = confirmed**, with its direction: the compass when the crop was taken
   + its angle. Several confirmed: the one closest to the beacon's direction.
5. **Car stage:** every YOLO result, the car within 12° of the confirmed Waymo's direction becomes
   the target (`object`). First time: the "connected" buzz and "Waymo found by the camera".
   Arrival at 1.0 m: `AT THE CAR: turn slowly along it to find the door handle`.
6. **Door handle stage:** within **4 m** of the car (or standing at it), the laptop requests frames
   one at a time with the prompt **"a car door handle."**. Of the object finder's boxes, those
   narrower than 40% of the frame with a score of at least 0.12 count; the best becomes the target
   (`handle`), with:
   - distance = the smaller of *f × 0.25 m ÷ box width* (a handle is about 25 cm wide) and the car's
     YOLO distance (if under 3 s old): both read long when off, so the smaller is closer to right;
   - height: its angle above or below the chest camera.

   A handle sighting beats the car for 4 s. Arrival at **0.8 m**: one long buzz, `ARRIVED at the
   door handle: reach straight out` plus `below/above chest height` when it's more than 8° off, and
   "At the door". It **stays arrived** while the handle is out of view (as the wearer reaches).

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
7. **Arrival at 1.0 m** (about where a table-top thing drops out of the chest camera's view):
   `ARRIVED: the water bottle is within reach, <where>`: side = `straight ahead` (under 8°), `a little
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

### 7.9 Choosing: buttons, voice, typing

**Buttons**

- Counted: left Joy-Con `up down left right L ZL − Capture` and stick click; right Joy-Con
  `A B X Y R ZR + Home` and stick click. Not SL/SR (the library reads those from both halves of the
  report, where the noise is).
- Each press counts once (on the way down; holding doesn't repeat). Presses on both Joy-Cons add up.
  1.5 s after the last press, the count is chosen.

**Voice.** The phone recognizes English (US) speech continuously and sends every final phrase to the
laptop, which decides:

1. Lower-case it, drop punctuation, and drop leading `please`, `hey`, `hi`, `ok`/`okay`, `nudge`,
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
     `started`, `ready`… → **find it**.

| Said | Result |
|---|---|
| "Waymo." / "Take me to the Waymo, please" / "Bring me the Waymo" | Waymo |
| "Test north" / "Go to test north" | That place |
| "Find my keys." / "Where are my keys?" / "Hey Nudge, find my phone." / "Get me a water bottle please" / "Where’s the trash can?" | Find: keys / keys / phone / water bottle / trash can |
| "Let's get started" / "That's way more fun" / "I love Waymo" / "I can't get there" / "Get going" | Nothing (not commands) |

**Typing:** the **Find something** box goes through the same cleanup, then find mode.

### 7.10 The server

- **Pages:** serves only `.html`, `.js` and `.css` files inside `public/`; `/` is `hands.html`;
  never cached (`Cache-Control: no-store`); malformed addresses get 400, anything else 404. The
  models and server code are never served.
- **Relay:** every WebSocket message goes to all other connected pages, except messages with a `to`
  field, which go only to pages with that role (`eyes`, `hands`, `beacon`), or to the server itself
  (`to: "server"`). A page's role is the `?role=` in its WebSocket address.
- **Models:** each in its own Node process (forked), because the ONNX runtime crashes when two
  threads of one process use it, and running one in the server's main thread held up the relay for
  over a second (long enough for the laptop's no-signal stop). One object-finder frame at a time (a
  second one gets `busy`, and the laptop asks again 0.5 s later); CLIP requests queue. A crashed
  model process restarts (up to 3 times); requests it was working on fail cleanly. Model processes
  exit with the server.
- **Robustness:** anything can arrive through the public tunnel; malformed messages are logged and
  ignored, never fatal.
- **Port:** 8080, or `PORT=… npm start`.

### 7.11 Message protocol

All messages are JSON over one WebSocket per page: `ws(s)://<host>/ws?role=eyes|hands|beacon`.
Images are JPEG data URLs.

**From the chest phone (`role=eyes`)**

| `type` | To | When | Fields |
|---|---|---|---|
| `eyes` | everyone | 10 a second | `seq`; `compass` (degrees, or `null` if stale); `gps` `{lat, lon, acc, age}` or `null` (`age` in ms); `frame` `{w, h, focal, camH}` (what boxes are measured in); `objects` (only when there's a new YOLO result): `[{label, score, angle, distance, box: [x1, y1, x2, y2] as 0–1}]` |
| `preview` | `hands` | 4 a second | `image` (360 px, JPEG quality 0.6); `boxes` `[{label, angle, distance, x1, y1, x2, y2 as 0–1}]` |
| `frame` | `server` | When asked | `id`, `prompt`, `check` `{what, same}` (find mode), `image` (800 px, quality 0.7), `w`, `h`, `focal` (in this image's pixels) |
| `cars` | `server` | Twice a second, while asked | `compass`; `cars` `[{image (224 × 224, quality 0.85), angle, distance}]` |
| `heard` | everyone | Each spoken phrase | `text` |

**From the laptop page (`role=hands`)**

| `type` | To | When | Fields |
|---|---|---|---|
| `frame-please` | `eyes` | One at a time, while a frame is needed and the phone is connected | `id`, `prompt` (`"a car door handle."` or `"a <thing>."`), `check` |
| `want-cars` | `eyes` | Every second in Waymo mode | — (the phone sends car crops for the next 3 s) |

**From the beacon (`role=beacon`)**

| `type` | To | When | Fields |
|---|---|---|---|
| `beacon` | everyone | Once a second | `lat`, `lon`, `acc`, `age` |

**From the server (to every `hands` page)**

| `type` | When | Fields |
|---|---|---|
| `found` | After each `frame` | `id`; `boxes` `[{score, x1, y1, x2, y2 in pixels, verified?}]` or `null`; `reason` (why `null`: `busy`, `loading`, `failed: …`); `note` (e.g. `second opinion unavailable: …`); `w`, `h`, `focal`, `ms` |
| `waymo` | After each `cars` | `compass`; `cars` `[{angle, distance, prob}]` |

The laptop page ignores a `found` answer if the mode changed since it asked (it's about something
else), and gives up on a request after 5 s.

### 7.12 Speed and bandwidth

Measured on a MacBook Pro (M3 Pro); phone speeds vary and show on the phone page.

| What | Time |
|---|---|
| YOLOv10n in Chrome on the Mac | 14 ms a frame (WebGPU), ~170 ms (WebAssembly) |
| Object finder (Grounding DINO tiny, 8-bit, CPU) | 1.1–1.6 s a frame |
| CLIP (8-bit, CPU) | ~20–35 ms an image; the first check for a new thing also encodes ~80 text labels once |
| Server start with models on disk | A few seconds |

From the chest phone, roughly: `eyes` messages 10 a second (under 2 KB each); preview frames 4 a
second (~10–20 KB each); in Waymo mode up to 3 car crops twice a second (~10–15 KB each); an
object-finder frame (~50–100 KB) every ~1.3 s while finding or near the car. Well under 200 KB/s in
total.

---

## 8. Tuning and customizing

All in `public/hands.html` unless noted. Pages: edit and reload. Server files: restart `npm start`.

| Setting | Where | Default | What it does |
|---|---|---|---|
| `PLACES` | top of the script | 2 test spots | Saved places ([4.11](#411-add-your-own-places)) |
| `DECLINATION` | top of the script | −6.8 (Miami) | Magnetic declination, east positive ([4.12](#412-set-your-magnetic-declination)) |
| Strength / margin / GPS radius / stop distance | sliders on the page | 0.7 / ±12° / 6 m / 1.5 m | See [6.1](#61-the-laptop-page) |
| `PATTERNS` | "Buzz vocabulary" | see [What each buzz means](#what-each-buzz-means) | Each pattern: `buzz(side, strength, ms)`, `both(...)`, `repeat(n, gap, fn)` |
| `LO_HZ`, `HI_HZ` | Joy-Cons section | 160, 320 Hz | Rumble frequencies (Joy-Con ranges: 41–626 Hz low, 82–1253 Hz high) |
| `OBSTACLE_HOLD` | "What the chest phone tells us" | 1200 ms | How long an obstacle counts after it was last seen |
| `WAYMO_SURE` | "Waymo: which car" | 0.9 | Classifier score that confirms a Waymo |
| `HANDLE_RANGE` | object finder frames | 4 m | Distance to the car where the door-handle search starts |
| `HANDLE_WIDTH` | object finder frames | 0.25 m | Assumed handle width, for its distance |
| `THING_SURE` | object finder frames | 0.25 | Minimum object-finder score in find mode |
| Arrival radii | `guideTick()` | handle 0.8 m, car 1.0 m, thing 1.0 m | Camera-target arrival distances |
| `THINGS` | "Finding things" | [7.8](#78-mode-3-find-a-thing) | Add words, a YOLO kind and a size |
| `POLITE`, `VERB`, `NOT_A_THING` | "Voice" | [7.9](#79-choosing-buttons-voice-typing) | The voice grammar |
| `HEIGHTS` | `public/eyes.html` | car 1.6 m, … | Real heights for distance by size |
| Focal / person height / chest height | phone page | 720 / 1.70 / 1.30 | [4.9](#49-calibrate-distances-once-per-phone) |
| `OTHERS` | `clip-worker.js` | ~80 labels | Alternatives CLIP compares a found thing against |
| `waymo-head.json` | `nudge/` | trained weights | Retrain: [9](#9-the-waymo-classifier) |
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
| `npm start`: *Could not read package.json* | Run it from `nudge/`, not the repo root. |
| `Port 8080 is already in use` | `npm start` is already running in another terminal: stop it, or `PORT=8081 npm start`. |
| Models download slowly on first start | They're ~360 MB; wait for both **ready** lines. After that they load from disk. |
| Tunnel logs `Failed to dial a quic connection` | Use `--protocol http2`. Still stuck: put the Mac on a phone hotspot. |
| Phone: `LAPTOP: NOT CONNECTED` | Is `npm start` running? Is the tunnel running, with the address you typed? It changes on every restart. |
| Phone: `camera error` | Use the https tunnel address, not `http://…`. Allow the camera in Safari's site settings (**aA → Website Settings**). |
| Phone: `objects: model failed to load` | The phone needs internet for the first load (~30 MB from jsDelivr and Hugging Face). Reload. |
| `GPS error: User denied Geolocation` | Allow location ([4.7](#47-set-up-the-chest-iphone)); reload and tap Start again. |
| GPS ±35 m or worse | You're indoors, or Precise Location is off. |
| Laptop: `NO COMPASS…` / heading `—` | Allow motion & orientation when Start asks. Reload and tap Start again; if iOS doesn't ask, quit Safari and reopen it. |
| Steers the wrong way | Phone upright, camera facing forward; turning right must make `heading` go **up**. Keep it away from magnets and steel. Joy-Cons on the right wrists (L left, R right). |
| GPS targets consistently a bit off | Set `DECLINATION` for your location ([4.12](#412-set-your-magnetic-declination)). |
| Joy-Con won't connect or buzz | Quit Steam/BetterJoy; re-pair; use Chrome; press a button on the Joy-Con to wake it. |
| Button presses don't count | Use a face button, trigger or stick click (not SL/SR); wait 1.5 s after the last press. |
| `NO SIGNAL` while the phone is on | Keep the phone screen on and `eyes.html` in front; check its signal. |
| Voice: `voice: not-allowed` / `service-not-allowed` | Allow the microphone for the site; turn on Dictation (**Settings → General → Keyboard**). Buttons always work. |
| Voice ignores what I say | It must start with a command ([7.9](#79-choosing-buttons-voice-typing)); check the `Heard:` text for how it was transcribed. |
| Stops for no reason | Something recognized is within the stop distance ahead; lower **Obstacle stop distance**. |
| Never finds the Waymo | Check `waymo classifier: best NN%` while the car is in view: under 90% on your Waymo = retrain with venue photos ([9](#9-the-waymo-classifier)). |
| Never finds the door handle | Side-on to the door, 1–3 m away, whole door in view. |
| Find mode: `(second opinion unavailable: …)` | CLIP is still loading or failed: check the server terminal. |
| Distances clearly wrong | Calibrate focal and set chest height ([4.9](#49-calibrate-distances-once-per-phone)). |

---

## 11. Known limitations

Say these out loud when presenting:

- **Obstacles:** only YOLO's 80 everyday kinds of things (people, bikes, cars, benches, hydrants,
  dogs…). It does **not** see curbs, steps, walls, glass, holes or overhangs. The cane covers those.
- **GPS drift** is several meters, so a place's arrival radius needs tuning on site.
- **Compass** is magnetic: steel, magnets and cars nearby can skew it by several degrees.
- **Waymo classifier:** ~90% per crop, 4 false alarms in 654 other cars in testing, mostly other
  robotaxis with roof sensors. Trained on web photos; venue photos improve it.
- **Door handle:** sometimes it picks the charging-port flap. Distances up close are rough (±20%).
- **Find mode:** in 21 photo tests the double check kept 10 of 11 real finds and rejected 9 of 10
  false alarms (a plastic container passed as "a water bottle"). Things YOLO doesn't know update only
  every ~1.2 s. Distance to unknown things assumes they're on the floor.
- **Arrival at a found thing is about 1 m** (arm's reach): the last reach is by touch.
- **Voice** needs clean mic pickup; buttons always work.
- **Not a real Waymo integration:** the beacon phone stands in for the car's location, and the ride
  status on the display is simulated.
- **Tested so far** with simulated phones and real photos; the hardware parts (Joy-Cons, the iPhone
  compass held upright, iPhone speech recognition) need testing on the real devices (section 5).

---

## 12. Privacy and security

- The chest camera's frames go from the phone, through Cloudflare's tunnel, to the Mac. Nothing is
  stored, and nothing is sent anywhere else. The models run on the Mac and the phone.
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
- **A beacon phone for the Waymo's location:** there's no public Waymo API.

---

## 14. Files

```
nudge/
├── README.md                  this file
├── package.json               npm start → node server.js; dependencies: ws, @huggingface/transformers
├── server.js                  web server (public/ only), WebSocket relay, passes frames/crops to the models, status line
├── object-finder.js           starts and talks to the object finder process (restarts it if it crashes)
├── object-finder-worker.js    the object finder: Grounding DINO tiny (8-bit), finds things described in words
├── clip.js                    starts and talks to the CLIP process (restarts it if it crashes)
├── clip-worker.js             CLIP ViT-B/32 (8-bit): the Waymo classifier + second opinions
├── waymo-head.json            trained Waymo classifier weights (512 means, 512 spreads, 512 weights, 1 bias)
├── models/                    downloaded models (git-ignored; ~360 MB, fetched on the first npm start)
├── public/                    the pages (served to browsers)
│   ├── hands.html             laptop page: Joy-Cons, choosing, voice commands, all guidance, the display
│   ├── eyes.html              chest phone: camera + YOLO, compass, GPS, voice, frames and crops
│   ├── yolo-worker.js         YOLOv10n in a web worker on the phone (WebGPU or WebAssembly)
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
| transformers.js | `@huggingface/transformers` 3.8.1 | Apache-2.0 |
| ONNX Runtime | `onnxruntime-node` 1.21.0, `onnxruntime-web` 1.22.0 | MIT |
| sharp | 0.34.5 | Apache-2.0 |
| ws | 8.21.3 | MIT |
| joy-con-webhid | 0.11.0 | Apache-2.0 |
| Training photos | Wikimedia Commons and Openverse (Creative Commons and similar licenses; kept locally in `training/data/`, not redistributed) | Per photo |
