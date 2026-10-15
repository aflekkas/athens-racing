# Aventador SVJ evidence

- garage.png: actual garage, six paints and persisted per-car exhaust toggle.
- front-three-quarter.png, rear-three-quarter.png, side.png, cockpit.png:
  actual Three.js model on Megara; assembled as contact-sheet.png.
- geometry-checks.json: actual vertex finiteness and bounds, wheelbase, high
  central exhausts, attachment under pitch/roll, matching mirror transforms,
  High light / Potato suppression, stable GPU resources across 1000 updates.
- chase-{day,night}-{upshift,overrun}.png and matching JSON: real Vehicle
  events from held/released throttle, Low preset, Megara. Night is asserted
  against the live world clock. The rear-view strip shows the same flames.
- road.log / road-errors.json: passing final road capture; no page errors.
- pull-with-pops.wav: 12-second stereo capture of the production modular
  audio graph driven by a flat-road Vehicle pull, lift and second pull.
  audio-metrics.json: master=1, engine=1, peak -5.70 dBFS, eight synchronized
  shift/overrun pulses. Procedural synthesis; no third-party audio samples.

All listed images were opened and inspected. Contact sheet: front and rear
above, side and cockpit below. The render model has 106063 assembled vertices
(including cockpit, damage, lights and wheels). The effect uses four 8-segment
cones, two small additive sprites and one pooled 8-vertex spark buffer: six
draws while flaming, seven when sparks appear. Low/Potato have no flash light;
High has one short flash. A mirror-only copy shares resources and is hidden
outside the mirror pass.

Reproduce model/garage/geometry/audio with tools/svj-browser.mjs; reproduce
final trusted-key road captures with tools/svj-road-browser.mjs. Run both
through tools/browser-slot.sh, one browser job at a time.
tools/svj-network-smoke.mjs runs the required local multiplayer race smoke.

Preliminary full npm, physics, events, syntax, import and staging dry-run
logs passed before the final clean-archive release gates. Physics measured
3.03 s to 100 km/h, 350.1 km/h terminal speed, 29.1 m 100–0. Factory anchors
remain 2.8 s and >350 km/h; the stricter catalogue gate is 12% / 3%.

Source assumptions, limitations and factory reference: tools/svj-notes.md.
The mesh is independently authored, with a simplified ALA downforce mode
and rear-steering contact frames. It is not a scanned production vehicle.

Final clean-archive gates all exit 0: npm test, physics (433/0), events,
syntax, browser imports and staging deployment dry-run. Local multiplayer
race smoke also passed. Tested source commit: `c271a9f7adfc06f7f101350094710317d40377e9`.
The published commit adds these final logs and this note to identical source.

The first archive run exposed a civilian-traffic queue after expanding its
weighted pool. SVJ is now player/AI-rival only (ambient traffic weight 0);
both traffic-race scenarios and the full final suite pass. The original
failed suite is retained as npm-test-archive-attempt1.log for traceability.
