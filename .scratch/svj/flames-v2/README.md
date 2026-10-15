# SVJ directional flames, revision 2

Four contact sheets: `day-upshift-sheet.png`, `day-overrun-sheet.png`,
`night-upshift-sheet.png`, `night-overrun-sheet.png`. Each has 12 consecutive
frames, left-to-right, top-to-bottom. Individual full chase images are named
`{day,night}-{upshift,overrun}-{00..11}.png` and include the rear-view strip.
Sheets crop the car region at native pixel size; they do not alter the flame.

Upshift frames are 1/120 s apart (0–91.7 ms), overrun frames 1/60 s apart
(0–183.3 ms). Matching JSON records physical rpm, throttle, pulse serial/kind,
remaining life and world conditions for every frame. Real held/released-key
Vehicle events drive the effects; no synthetic pulse is injected. The audit
freezes only the free-roam weather clock, which otherwise advances with wall
time during slow software rendering. Low quality: no point flash or bloom
is needed for the visible jets. Each view is rendered and read in one browser
call to avoid WebGL clearing the canvas between automation calls.

Three crossed quads per pipe use a shared seeded noise texture, animated
irregular edges and tapered tail. The root is blue-white, transitioning to
yellow/orange; the small blue tip sprite no longer obscures the jet. Shape
and length vary with pulse serial and time. The large ISR cut lasts 80 ms;
engagement produces a small lick, overrun produces uneven 60 ms licks and
limiter events produce medium 75 ms jets. Occasional bang sparks remain
pooled. Tail Y meshes are saturated red; generic rear glow discs are disabled
for the SVJ. Mirror copies share the same resources and transformations.

`geometry-checks.json` checks the actual six ribbon meshes, attachment through
body pitch/roll, matching mirror coordinates, Potato suppression and stable
GPU resource counts over 1000 updates. The V12 audio synthesis is unchanged;
it continues to consume the exact shared visual pulses.

## Floating block audit

`front-original-path.png` reproduces the original garage-to-track camera.
`front-without-car.png` hides the complete SVJ root: the same dark/white block
remains at the top left. `original-path-block-audit.json` records ray hits on
`megara-circuit` at about 10 m, outside the car hierarchy. This is the existing
start gantry (src/maps/megara.js, gantry beam/checkered support), clipped by
the camera framing. It is not an SVJ part or a debug object. The fresh direct
spawn view `front-block-audit.png` is framed beyond the gantry.

## Validation

All six release gates passed from a clean archive of
`03851c01a392ac42151f3072b9bbe3f88bfed6f8`: npm test, physics (433 passed,
0 failed), events, syntax, browser imports, and staging deployment dry-run.
Logs and exit markers are in `gates/`. All game source and the capture helper are identical to that archive.
The published commit adds final evidence/logs and preserves the subsequent
shared release-train timeout adjustment (deployment shell only).

Reproduce through `bash tools/browser-slot.sh node tools/svj-flames-v2-browser.mjs`
and then `bash tools/browser-slot.sh node tools/svj-block-audit.mjs`, sequentially.

All four final contact sheets (48 frames) were opened and visually inspected,
as were the original-view and car-hidden gantry audit images. The browser
completed with no JavaScript or shader errors. The unbuilt local server
returns 404 for `/api/auth/config` and `/release.json`; those responses are
retained in `resource-errors.json` separately from runtime errors.
