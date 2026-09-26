# Nudge

Touch-only guidance for blind and DeafBlind people. Two wrist-worn Joy-Cons buzz the wearer; no
sound in or out of the device. It guides someone to a place, to a Waymo, or to a thing they ask
for ("water bottle"). Meant to work alongside a cane, not instead of one.

```
chest iPhone ── eyes.html: camera + YOLO, GPS, compass, mic ──┐
                                                               ├── https tunnel ──► Mac: server.js ──► index page (Chrome) ──Bluetooth──► Joy-Cons (wrists)
beacon phone ── beacon.html: GPS (stands in for the Waymo) ────┘                    (object finder,                 (+ display for onlookers)
                                                                                     CLIP: Waymo classifier, checks)
```

## The modes

**Choose** by pressing any Joy-Con button N times (1.5 s after the last press it counts), by
saying it, or (find mode) by typing it on the laptop page. The Joy-Cons buzz N times back to confirm.

| Presses | Say | Type (laptop page) | Mode |
|---|---|---|---|
| 1 | "Waymo" | | Mode 2: go to the Waymo |
| 2, 3, … | the place's name | | Mode 1: go to a saved place (see `PLACES` in `public/hands.html`) |
| | "find / get / grab / where's the water bottle" | **Find something:** water bottle | Mode 3: find a thing |

**Mode 1: a place.** GPS and compass only: bearing and distance from the wearer to the place.
Arrival: GPS distance under the arrival radius (default 6 m; tune it on site).

**Mode 2: the Waymo.**
1. GPS toward the beacon phone (it plays the Waymo sharing its location).
2. The phone sends crops of the cars it sees; the server's **Waymo classifier** (trained on photos
   of Waymos and other cars, see `training/`) recognizes the Waymo by its sensors. First confident
   recognition: **"Waymo connected"** buzz, and the camera takes over from GPS. Several Waymos in view:
   the one in the beacon's direction. Ordinary cars never take over.
3. Within 4 m, the server finds the **door handle** in camera frames (~1.2 s each) and steers to it.
4. Arrival at arm's length from the handle. The display says whether the handle is above or below chest height.

**Mode 3: find a thing** ("water bottle", "red mug", "my keys", "trash can": anything describable).
1. The server's **object finder** (Grounding DINO) looks for exactly those words in camera frames
   (~1.2 s each). It boxes *something* nearly every time, so a box only counts when **CLIP agrees**
   it looks more like the thing than like ~80 other everyday things, or when the phone's YOLO sees
   the same kind of thing in the same direction.
2. If the thing is one of YOLO's 80 everyday classes (bottle, cup, phone, backpack, laptop…), YOLO's
   ~10 sightings a second keep the steering smooth in between.
3. First sighting: the **"found it"** buzz (same as Waymo connected). Not in view: search buzz, turn slowly.
4. Arrival at about 1 m, where a table-top thing drops out of the chest camera's view. The display
   says where to reach: left/right, and how low.

Distance to a thing comes from its usual size (a bottle is about 25 cm; the list is `THINGS` in
`public/hands.html`), or for unknown things from where it meets the floor. Things on or behind the
target (the table the bottle is on) don't count as obstacles.

**Obstacles, always on in every mode:** anything the camera recognizes in the walking path (±20°)
closer than the stop distance (default 1.5 m) gives the **stop** buzz, overriding everything else.

The wearer's heading comes from the chest iPhone's compass. The Joy-Cons only buzz.

## Buzz vocabulary

| Event | Pattern |
|---|---|
| Steer left | Left Joy-Con, 150 ms pulse every 400 ms |
| Steer right | Right Joy-Con, mirrored |
| Approaching | Both, pulses get faster as you get closer |
| Arrived | Both, one long 800 ms buzz |
| Obstacle/stop | Both, 3 sharp 100 ms pulses (repeats while it's there) |
| Search/no signal | Alternating L-R-L, slow |
| Waymo connected / found it | Both, 2 quick pulses |
| Selection echo | N short pulses |

The laptop page's **Try each buzz** buttons play each one.

## The display (for onlookers, never the wearer)
The laptop page shows:
- the live camera feed, with boxes: **red STOP** for an obstacle, **green** for the target (the
  Waymo, or the thing being found; dashed green is the object finder's latest box);
- two wrist icons that light up with every real buzz;
- one status line, e.g. `Mode: Waymo | Distance: 8.0 m (object) | Obstacle: none | Heard: "waymo"`;
- in Waymo mode, the simulated ride status: requested, arrived, found, at the door.

## What you need

**Hardware**
- **Mac** with Bluetooth. It runs the server and drives the Joy-Cons, so it goes with the wearer (backpack).
- **Two original Switch Joy-Cons** (L and R, not Switch 2), with wrist straps.
- **Chest iPhone** with a chest mount: upright, rear camera facing forward.
- **Beacon phone**: any phone with GPS. It stands in for the Waymo.
- **Internet for the Mac and both phones.** An iPhone hotspot for the Mac works well outdoors.

**Software on the Mac:** [Node.js](https://nodejs.org) LTS, **Chrome** (Safari can't talk to
Joy-Cons), and `brew install cloudflared`. All free, no accounts.

**Space to test:** an open parking lot with a parked car you're allowed to walk up to, and a
teammate as spotter.

## One-time setup
1. **Install:**
   ```
   cd nudge
   npm install
   ```
2. **Pair the Joy-Cons.** System Settings → Bluetooth. Hold the small round sync button on each
   Joy-Con's rail until the green lights sweep, then pick it. Quit Steam and BetterJoy first.
3. **Both iPhones:** Settings → Privacy & Security → Location Services → **on**. Under **Safari
   Websites**: *While Using the App*, with **Precise Location on**.
4. **Places:** edit `PLACES` near the top of the script in `public/hands.html`. Real spots are
   `{ name, lat, lon }`: right-click the spot in Google Maps to copy them. There are two test spots
   (30 m north and 40 m east of wherever the wearer is when they choose it).

## Every time: start it up

**Terminal 1: the server**
```
cd nudge
npm start
```
Wait for `clip (waymo classifier, second opinions): ready` and `object finder: ready`. The first
start downloads the object finder (~200 MB) and CLIP (~150 MB) into `nudge/models/`.

**Terminal 2: the https tunnel.** iPhones only allow the camera, GPS, compass and mic on https pages.
```
cloudflared tunnel --protocol http2 --url http://localhost:8080
```
Copy the `https://….trycloudflare.com` address it prints. It changes every time.

| Where | Open | Then |
|---|---|---|
| Mac, Chrome | <http://localhost:8080/> | **Connect a Joy-Con**, once per Joy-Con. Show this page to onlookers. |
| Chest iPhone | `https://….trycloudflare.com/eyes.html` | **Start**, allow camera, location, motion and microphone. The first load is ~30 MB. |
| Beacon phone | `https://….trycloudflare.com/beacon.html` | **Start sharing location**, allow location |

Keep both phone screens on with the pages open. When done, press Ctrl + C in both terminals:
anyone with the tunnel address can open the pages.

## Test it, step by step

Each step adds one piece. "✅" is what working looks like.

### 1. Laptop and Joy-Cons
- `npm start`, open <http://localhost:8080/>, and click **Connect a Joy-Con** for each.
- Press every **Try each buzz** button.
- ✅ Each pattern matches the table, on the right wrist, and the wrist icons light with it.
- Adjust **Strength** until every pattern is clearly felt through a sleeve.

### 2. Choosing
- Press a Joy-Con button once, wait 1.5 s. ✅ One echo pulse; the status line says `Mode: Waymo`.
- Press three times. ✅ Three echo pulses; `Mode: test east`.
- Press more times than there are choices. ✅ A search buzz (no such choice).

### 3. Chest iPhone and compass (indoors is fine)
- Tunnel on, `eyes.html` on the chest iPhone, **Start**, then mount it on your chest.
- ✅ Phone: green `LAPTOP: CONNECTED`, `objects: model ready`. Laptop: the camera feed shows up.
- Stand still, press **90° right** (indoor test).
- ✅ Right wrist pulses; turn right. At about 90°: approaching pulses. If it steers the wrong way,
  check the heading line in the details box: turning right should make it go **up**.
- Close `eyes.html`. ✅ Within a second: `NO SIGNAL` and slow L-R-L buzzes.

### 4. Obstacles
- Guide somewhere (any mode), and have a teammate step in front of you, 1 m away.
- ✅ 3 sharp pulses repeating, `STOP: person 1.0 m ahead`, and a red STOP box on the feed.
  Guidance resumes when they step aside.
- **Distance calibration (once per phone):** teammate stands exactly **3.00 m** away, whole body in
  view. Enter their height on `eyes.html` and tap **Calibrate**. Set **Chest height** to where
  the phone sits.

### 5. Voice
- Say "Waymo" (or "take me to test north").
- ✅ Phone shows `voice: heard "…"`; laptop status shows `Heard: "…"`; echo buzz; mode changes.
- If the phone says `voice: not-allowed`: Settings → Safari → Microphone → Allow, and turn on
  Siri & Dictation (Safari's speech recognition needs it).

### 6. Mode 1 outdoors
- Choose **test north** (2 presses). Walk.
- ✅ Distance shrinks from about 30 m; one long buzz at the arrival radius.
- GPS drifts several meters: raise **GPS arrival radius** if it arrives too early or never.

### 7. Mode 2 at a car
- Beacon phone in or on a parked car, **Start sharing location**. Start 30 m or more away and choose **Waymo** (1 press).
- ✅ Ride status "Your Waymo has arrived". Steers toward the beacon (`… m (gps)`).
- ✅ Details box: `waymo classifier: best NN%`. Ordinary cars stay low; a Waymo goes over 90%.
- ✅ Waymo in view: 2 quick pulses ("connected"), a green WAYMO box, `… m (object)`.
- ✅ Within 4 m: `object finder: door handle: … NN%` in the details, then `… m (handle)`.
- ✅ At the handle: one long buzz, `ARRIVED at the door handle: reach straight out`.
- No handle found: get side-on to the door, 1–3 m away, with the whole door in view.

### 8. Find a thing (indoors)
- Put a water bottle on a table 3–5 m away. On the laptop page, type **water bottle** under
  *Find something* and press Find (or say "find the water bottle").
- ✅ One echo pulse; status `Mode: find "water bottle"`; search buzz while it's out of view.
- ✅ Details: `object finder: "water bottle": ~1200 ms · NN%` once it's in view; a dashed green box
  on the feed; 2 quick pulses ("found it"); steering toward it.
- ✅ About 1 m away: one long buzz, `ARRIVED: the water bottle is within reach, straight ahead, low…`.
- ✅ The table under it doesn't trigger STOP. A person stepping in between does.
- Try something YOLO doesn't know: "keys", "trash can". It still works, just updates slower (~1.2 s).

### 9. Full run
Wearer blindfolded, cane in hand, spotter alongside, starting 50 m or more away. Choose by button
press only, follow buzzes only. Note every hesitation or wrong turn.

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm start`: *Could not read package.json* | Run it from `nudge/`. |
| Tunnel logs `Failed to dial a quic connection` | Use `--protocol http2`, as above. Still stuck: put the Mac on a phone hotspot. |
| Phone says `LAPTOP: NOT CONNECTED` | Is `npm start` running? Is the tunnel running, with the address you typed? It changes on every restart. |
| `camera error` | Use the https tunnel address. Allow the camera in site settings. |
| `GPS error: User denied Geolocation` | Allow location (one-time setup), reload, press Start again. |
| GPS ±35 m or worse | You're indoors, or Precise Location is off. |
| Heading — (no compass yet) | Allow motion access when Start asks. iPhone: reload and press Start again. |
| Steers the wrong way | The phone must be upright, camera facing forward. Keep it away from magnets and laptop speakers. |
| Joy-Con won't connect or buzz | Quit Steam and BetterJoy; re-pair; use Chrome. |
| `NO SIGNAL` while the phone is on | Keep the phone screen on and `eyes.html` in front; check its signal. |
| Stops for no reason | Something recognized is within the stop distance ahead; lower **Obstacle stop distance**. |

## Known limitations (say these out loud)
- **Obstacles:** the camera only recognizes the 80 everyday things YOLO knows (people, bikes,
  cars, benches, poles like parking meters and hydrants, dogs…). It does **not** see curbs,
  steps, walls, glass or holes. The cane covers those.
- **GPS drift** is several meters, so Mode 1's arrival radius needs tuning on site.
- **Waymo classifier:** recognizes about 90% of Waymo crops (it sees several a second, so misses
  rarely matter), with 4 false alarms among 654 other cars in testing: mostly other robotaxis with roof
  sensors. Trained on web photos; photos from the venue will make it better (`training/README.md`).
- **Door handle:** it sometimes picks the charging-port flap. Distances up close are rough (±20%).
- **Find mode:** in 21 photo tests the double check (object finder + CLIP) accepted 10 of 11 real
  finds and rejected 9 of 10 false alarms; the one that got through was a plastic container taken
  for "a water bottle". Things YOLO doesn't know update only every ~1.2 s, so turn slowly. Distance
  to unknown things assumes they're on the floor.
- **Voice** needs clean mic pickup; button presses always work.
- **Compass** is magnetic: steel, magnets and cars nearby can skew it by several degrees.

## Files
| File | What it is |
|---|---|
| `server.js` | Serves the pages, relays messages, prints a status line every 3 s |
| `object-finder.js`, `object-finder-worker.js` | Finds things described in words (door handles, a water bottle): Grounding DINO, in its own process |
| `clip.js`, `clip-worker.js`, `waymo-head.json` | CLIP, in its own process: the Waymo classifier (with its trained weights) and second opinions for the object finder |
| `training/` | Collects photos and trains the Waymo classifier; see its README |
| `public/hands.html` | Laptop page: Joy-Cons, choosing, all guidance logic, the display. `PLACES` is here |
| `public/eyes.html` | Chest phone: camera + YOLO, GPS, compass, voice |
| `public/yolo-worker.js` | YOLOv10n object detection, off the phone's main thread |
| `public/beacon.html` | Beacon phone: shares GPS location (the simulated Waymo) |
| `models/` | Downloaded handle model (git-ignored) |
