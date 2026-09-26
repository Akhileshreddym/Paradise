# Nudge

Joy-Cons buzz to guide a blind or deafblind person to their Waymo and its door handle. No sound,
no screen, nothing stuck on the car. Meant to work alongside a cane, not instead of one.

```
chest phone ── eyes.html: camera + YOLO + GPS + compass ──┐
                                                           ├── https tunnel ──► Mac: server.js ──► hands.html (Chrome) ──Bluetooth──► Joy-Cons
beacon phone ── beacon.html: GPS ("the Waymo") ────────────┘                    (also finds door handles)
```

## How it works

| Stage | Distance | What steers | Runs on |
|---|---|---|---|
| 1. Head toward the car | far | GPS: the beacon phone plays the Waymo sharing its location | both phones + Mac |
| 2. Walk to the car | car in camera view | YOLO finds cars; the one in the beacon's direction is the target | chest phone |
| 3. Walk to the door handle | within 4 m | Grounding DINO finds the door handle in camera frames (~1.2 s each) | Mac (`server.js`) |
| 4. Arrived | within ~0.8 m | 3 pulses; the laptop page says whether the handle is above or below chest height | |

Turning is tracked by the heading Joy-Con's gyro, so between camera updates it still knows where
the target is as you turn.

**What the buzzes mean** (patterns still to be designed):
- One side buzzing: turn that way. Stronger means further off.
- Tick on both, then gentle pulses on both: you're facing it, walk. Faster means closer.
- Alternating left/right: searching, turn slowly.
- 3 pulses: arrived.
- 2 taps, then silence: link to the chest phone lost, guiding stopped.

## What you need

**Hardware**
- **Mac** with Bluetooth. It runs the server and drives the Joy-Cons, so it goes with the wearer (backpack).
- **Two original Switch Joy-Cons** (L and R, not Switch 2), plus straps.
- **Chest phone** (iPhone or Android) with a chest mount or harness: upright, rear camera facing forward.
- **Beacon phone**: any phone with GPS. It stands in for the Waymo.
- **Internet for the Mac and both phones.** An iPhone hotspot for the Mac works well outdoors.

**Software on the Mac**
- [Node.js](https://nodejs.org) LTS
- **Chrome or Edge.** Safari can't talk to Joy-Cons.
- cloudflared: `brew install cloudflared`

**Space to test:** an open parking lot with a parked car you're allowed to walk up to, and a
teammate as spotter.

## One-time setup

1. **Install:**
   ```
   cd nudge
   npm install
   ```
2. **Pair the Joy-Cons.** System Settings → Bluetooth. Hold the small round sync button on each
   Joy-Con's rail until the green lights sweep, then pick it. Quit Steam and BetterJoy first,
   because they grab the Joy-Cons.
3. **iPhones (both):** Settings → Privacy & Security → Location Services → **on**. Under
   **Safari Websites**: *While Using the App*, with **Precise Location on**.

## Every time: start it up

**Terminal 1: the server**
```
cd nudge
npm start
```
Wait for `door handle finder: ready`. The very first start downloads the handle model (~200 MB)
into `nudge/models/`; the terminal shows progress.

**Terminal 2: the https tunnel.** Phones only allow the camera and GPS on https pages.
```
cloudflared tunnel --protocol http2 --url http://localhost:8080
```
Copy the `https://….trycloudflare.com` address it prints. It changes every time.

**Open the pages**

| Where | Open | Then |
|---|---|---|
| Mac, Chrome | <http://localhost:8080/> | **Connect a Joy-Con**, once per Joy-Con |
| Chest phone | `https://….trycloudflare.com/eyes.html` | **Start**, allow camera, location and motion. The first load is ~30 MB, so use Wi-Fi. |
| Beacon phone | `https://….trycloudflare.com/beacon.html` | **Start sharing location**, allow location |

Keep both phone screens on with the pages open. Put `eyes.html` and `hands.html` in separate
windows if they're on the same computer, because Chrome pauses background tabs.

When you're done, press Ctrl + C in both terminals. Anyone with the tunnel address can open the pages.

## Test it, step by step

Do these in order; each one only adds one new piece. "✅" is what working looks like.

### 1. Laptop only
- `npm start`, open <http://localhost:8080/>.
- ✅ Terminal says `door handle finder: ready`. The page loads.

### 2. Joy-Cons
- Click **Connect a Joy-Con** for each one, then **Buzz both**. Under *One at a time*, press
  **front-left** and **front-right**.
- ✅ Status shows both connected; the right Joy-Con buzzes for each button.
- Strap the **left** Joy-Con flat on your chest. Press **Zero (hold still 2 s)** and hold still.
  Turn right slowly.
- ✅ The heading number goes **up**. If it goes down, tick **Flip turn direction**.
- Press **Calibrate 360°: start**, turn exactly one full circle, press it again.
- ✅ Turning 90° shows about 90.

### 3. Guidance with no phones
- Target source: **Test buttons**. Press **90° right**, then **Auto-guide: OFF** to turn it ON.
- ✅ The right Joy-Con buzzes. Turn right: at about 90° both tick, then gentle pulses. The guide line
  says `WALK FORWARD`.
- Try **Behind**, **45° left**, and **Remember this direction** (face something, press, turn
  away). Then **Clear**.

### 4. Chest phone (camera and link)
- Start the tunnel and open `eyes.html` on the chest phone, then press **Start**.
- ✅ Green badge `LAPTOP: CONNECTED`, `objects: model ready (webgpu)` (or `wasm` on older
  phones), and blue boxes around people and chairs.
- ✅ The terminal prints a `[status]` line every 3 s: `chest phone 0s ago … sees person`.
- On the laptop: Destination **Person**, and Target source switches to **Camera (phone)** on its own.
  Have a teammate stand somewhere in the room.
- ✅ The guide line says `turn LEFT/RIGHT … (object)` and then `WALK FORWARD`. Walk to them:
  3 pulses at about 1.2 m.
- **Calibrate distance (once per phone):** have the teammate stand exactly **3.00 m** away, whole
  body in view, enter their height, and tap **Calibrate**. ✅ `eyes.html` now shows them at about 3.0 m.
- Close `eyes.html`. ✅ Within half a second: `LINK LOST: not guiding` and two taps.

### 5. Beacon (outdoors, open sky)
- Open `beacon.html` on the beacon phone, press **Start sharing location**, and walk it 30–50 m away.
- ✅ The beacon page shows accuracy under ±15 m, updating within a few seconds.
- ✅ The laptop's Target source switches to **GPS beacon**; the green GPS box shows `beacon at N° · D m`.
- ✅ The terminal `[status]` line shows `distance … m`, shrinking as you walk toward it.
- With Auto-guide on, you're steered toward the beacon: `… m (gps)` in the guide line.

### 6. Car and door handle
- Destination **Waymo**. Put the beacon phone in or on a parked car, and walk toward it from
  30 m or more away.
- ✅ Once the camera sees it: `… m (object)`.
- ✅ Within 4 m: the laptop shows `door handle finder: ~1200 ms · handle NN%`, and the guide line
  switches to `(handle)`.
- ✅ At the handle: 3 pulses and `AT THE DOOR HANDLE … reach straight out`.
- If it never finds a handle: stand side-on to the door, 1–3 m away, with the whole door in view.

### 7. Full run
- Wearer blindfolded, cane in hand, spotter next to them. Start 50 m or more from the car, with
  Auto-guide on, and follow the buzzes only.
- Note where it hesitated or pointed wrong.

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm start`: *Could not read package.json* | Run it from `nudge/`, not the repo root. |
| Tunnel keeps logging `Failed to dial a quic connection` | Use `--protocol http2`, as above. Still stuck: put the Mac on a phone hotspot. |
| Phone says `LAPTOP: NOT CONNECTED` | Is `npm start` running? Is the tunnel running, with the address you typed? The address changes on every restart. |
| `camera error` on the phone | The page must be the https tunnel address, not `http://…`. Allow the camera in site settings. |
| `GPS error: User denied Geolocation` | Allow location (see the one-time setup), then reload and press Start again. |
| GPS accuracy ±35 m or worse, or it barely changes | You're indoors, or Precise Location is off. Go outside. |
| Laptop: `waiting for compass` | Chest phone: allow motion access when Start asks. iPhone: reload and press Start again. |
| Joy-Con won't connect or buzz | Quit Steam and BetterJoy; re-pair in Bluetooth settings; use Chrome or Edge. |
| Heading drifts or goes the wrong way | Redo **Zero** and **Calibrate 360°**; tick **Flip turn direction** if turning right lowers it. |
| `LINK LOST` while the phone is on | Keep the phone's screen on and `eyes.html` in front. Check the phone's signal. |
| `door handle finder: loading` | First start: wait for the download in terminal 1. |
| Handle finder picks the wrong spot | Known: it sometimes picks the charging-port flap. Get side-on to the door. |

## Known limits
- It can't tell a Waymo from other cars by looking; the beacon's direction picks the car.
- Distances up close are rough (about ±20%), so the cane decides the last step.
- It doesn't know about obstacles, curbs, traffic or glass. Always test with a spotter.

## Files
| File | What it is |
|---|---|
| `server.js` | Serves the pages, relays messages between them, prints the status line |
| `handle-finder.js`, `handle-finder-worker.js` | Door handle detection (Grounding DINO), on its own thread |
| `public/hands.html` | Laptop page: Joy-Cons, heading, all the guidance logic |
| `public/eyes.html` | Chest phone: camera, YOLO, GPS, compass |
| `public/yolo-worker.js` | YOLOv10n object detection, off the phone's main thread |
| `public/beacon.html` | Beacon phone: shares GPS location |
| `models/` | Downloaded handle model (git-ignored) |
