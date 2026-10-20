# Free roam: click anywhere, areas not POIs, trackpad pans (owner 2026-10-20)

Captured with `../capture.mjs` (stub Google sign-in, clean archive) at 1280×800 and 960×700.

- `before/spawn-*`: the 2026-10-19 picker, with 26 POI pins, "PLACE 2 / 26" and a "SPAWN SPOT" kicker.
- `before/maps-*`: Track select before the wheel change. It looks the same afterwards, because the change is input only.
- `after/spawn-*`: no pins. One marker names the chosen road point, the nav shows the area (one per playable map), and the panel is the name, the car and DRIVE.
- `after/spawn-click-*`: after six two-finger trackpad scroll events (pan), two mouse-wheel notches (zoom) and a click on a street. The click snaps to the road, names it, and leaves the camera where it was.
- `after/spawn-area-*`: after one arrow step, which flies to the next area (Megara) with its start pre-selected.
- `after/maps-*`: Track select uses the same wheel handling (`src/map-wheel.js`).

Browser log at 1280×800:
- The camera point moved by (−111, −44) px for six (18.5, 7.25) trackpad deltas, so it panned 1:1.
- The wheel notches zoomed about the cursor.
- The click named the street TOFALOU, and the page had 0 pins.

The base map tiles are partly unpainted in some shots. That is the SwiftShader software renderer still painting tiles in the background on this shared host, and the prod before-shot shows the same thing.
