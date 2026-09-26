# Nudge

Joy-Cons buzz to guide you to a target. A phone on your chest finds the target with its
camera; a laptop turns that into buzzes. Meant to work alongside a cane, not instead of one.

```
phone (eyes.html) ── WebSocket ──► server.js ──► laptop (hands.html) ── Bluetooth ──► Joy-Cons
```

## What you need
- Laptop with Bluetooth, **Chrome or Edge**, and [Node.js](https://nodejs.org) (LTS)
- Two original Switch Joy-Cons (not Switch 2)
- A phone with a rear camera
- Printed ArUco markers: [chev.me/arucogen](https://chev.me/arucogen/), dictionary **Original ArUco**,
  IDs **1** (door), **2** (chair), **3** (car). Matte paper, keep the white border. Measure the black
  square edge to edge.

## Run it
```
cd nudge
npm install
npm start
```
Laptop: open <http://localhost:8080/> in Chrome or Edge.

The phone camera only works on **https** pages, so give the laptop a temporary https address
(free, no account):
```
winget install --id Cloudflare.cloudflared     # once
cloudflared tunnel --url http://localhost:8080
```
If the installer is blocked (it needs admin), use the portable version instead: download
`cloudflared-windows-amd64.exe` from [cloudflared's releases](https://github.com/cloudflare/cloudflared/releases/latest),
save it as `nudge/tools/cloudflared.exe` (git-ignored), and run
`./tools/cloudflared.exe tunnel --url http://localhost:8080` from `nudge/`.

Open the printed `https://….trycloudflare.com` address **+ `/eyes.html`** on the phone.
The address changes every time the tunnel restarts.
Anyone with that address can reach the pages, so stop the tunnel (Ctrl + C) when you're done.

## Pair the Joy-Cons (once)
Windows **Settings → Bluetooth & devices → Add device → Bluetooth**. Hold the small round sync
button on the Joy-Con's rail until the green lights sweep, then pick it. Do both. On
`hands.html`, click **Connect a Joy-Con** once per Joy-Con. Windows may call both
"Wireless Gamepad"; that's fine.

Close BetterJoy and Steam first. They grab the Joy-Cons.

## First-time setup on hands.html
1. Strap the **heading** Joy-Con (default: left) flat on your **chest or belt**, not your wrist.
2. **Zero**: hold still for 2 seconds.
3. Turn right slowly. The heading should go up; if it goes down, tick **Flip turn direction**.
4. **Calibrate 360°**: press, turn one full circle, press again.

## First-time setup on eyes.html
1. Enter the marker's real size in meters (e.g. `0.18`).
2. Hold a marker exactly **1.00 m** away and tap **Calibrate**.

## Using it
Turn on **Auto-guide**. When the phone sees the chosen destination marker, the Joy-Con on the
side you should turn to buzzes, stronger the further off you are, until you face it. Then both
tick once and go quiet. If the phone stops sending for more than half a second, guiding stops.

**Safety:** it only knows about the marker. It can't see walls, glass, steps or most obstacles.
Test on a clear floor with someone walking next to you.
