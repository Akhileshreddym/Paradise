# Training the Waymo classifier

The server's Waymo classifier (`../clip.js`) is CLIP image features plus a small
logistic regression. Only the regression is trained; its weights are `../waymo-head.json`. It
trains in about a minute on a laptop, no GPU.

Current model: 125 Waymo crops (Jaguar I-Pace, Pacifica, Zeekr with sensors) and 654 other cars,
all from openly licensed photos on Wikimedia Commons and Openverse. Cross-validated at the 0.9
cutoff: about 90% of Waymo crops recognized, 4 false alarms among the 654 other cars (Zoox and Cruise
robotaxis, plain white I-Paces).

**The best improvement: photos from the venue.** Photos of the actual Waymos you'll demo with, in
that light, plus the other cars parked there. They can be phone photos; put them in the folders
below and re-run steps 3–5.

## Steps
Run from `nudge/training/`. Everything goes into `data/` (git-ignored).

```
node collect.mjs    # 1. list photo URLs (Commons + Openverse)             → data/lists.json
node download.mjs   # 2. download them                                       → data/img/pos, data/img/neg
node crop.mjs       # 3. YOLO + cut out cars, same crop as the phone         → data/crops/pos, data/crops/neg
node embed.mjs      # 4. CLIP features for every crop                        → data/emb_clip.json
node train.mjs      # 5. train, cross-validate, save                         → ../waymo-head.json
```

**Between steps 3 and 4, check the Waymo crops by eye.** A photo tagged "Waymo" can show a
different car as the biggest one, or the retired "Firefly" pod car. Make contact sheets:
```
node sheet.mjs crops/pos sheet1.jpg 0 108
node sheet.mjs crops/pos sheet2.jpg 108 108
```
Open `data/sheet1.jpg`; the number on each tile is its line in `data/sheet1.jpg.txt`. Move anything
that isn't a current Waymo into `data/crops/dropped/`.

**After step 5**, `data/wrong.json` lists what cross-validation got wrong. Look at those crops: a
"false alarm" that's actually a Waymo means a mislabeled photo; move it into `crops/pos`.

Your own photos: put them in `data/img/pos` (Waymos) and `data/img/neg` (anything else, especially
white SUVs and other robotaxis), then run steps 3–5. Restart `npm start` to use the new weights.
