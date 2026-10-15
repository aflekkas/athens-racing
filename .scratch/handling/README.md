# Handling evidence

See `tools/handling-notes.md` for research, methods, real references and before/after tables. `summary.json` retains all scalar measurements and every CPU lap corner minimum. `before.json.gz` / `after.json.gz` retain complete traces; `sections-*.json` cover six tight Megara sections × six cars × two devices.

`before-huracan-chase-0..3.png` and `after-huracan-chase-0..3.png` are actual browser WebGL canvas frames in chase camera, at 0.2/0.4/0.6/0.8 s after the keyboard turn request. They omit DOM HUD overlays. Native rendering remains active while physics is paused between scripted steps. The canvas is read immediately after a production render; the headless compositor screenshot path stalled on this VPS. The run uses the normal trusted keyboard events, Input, Vehicle and Ground. Browser boot reports two HTTP 404 console messages; there are no page exceptions. Inspect `browser-*.json` for the 48-frame physical trace.

`laps-ground-*.json` are complete Huracán laps with **production Ground and barriers enabled**, actual RivalAI line/pedals, binary rate-limited keyboard steering through Input, and continuous gamepad-style steering with 0.35 assist. This is an automation driver, not a claim about human lap pace or fully binary pedals. Every sampled s/u/speed remains available. CPU dry-continuation wall counts are deliberately not used as collision evidence.

`gates/` records npm test, physics regression, events, syntax, browser imports and staging **dry run**, with exit markers. Nothing was pushed or deployed by this task. The tested code commit and source hashes are in `manifest.json`; release evidence is added after the tests.

`focused-final.log` and `audit-test-final.log` include the new hairpin, per-wheel slip, AI inverse and fixed-controller drift assertions. `drift-*-before.log` and `drift-*-final.log` preserve the older broad parameter-search bench, including its **pre-existing failing five-second feint-hold criterion**. Handbrake and power-over holds exceed seven seconds before and after; feint still initiates a slide. No threshold was relaxed. `rivals-before.log` is the original-physics comparison; final rival races are part of the green npm gate.

Reproduce in a fresh archive, never in the shared working tree:

```sh
node --import ./tools/physics-test/register.mjs tools/physics-test/handling-audit.mjs after.json
node --import ./tools/physics-test/register.mjs tools/physics-test/handling-sections.mjs sections-after.json
node --import ./tools/physics-test/register.mjs --test tools/physics-test/handling-audit.test.mjs
# Baseline for CPU replay: put the original module next to its relative imports.
git show 533c53bf28e594c35d041558edd45757b0c68c29:src/physics.js > src/physics-handling-before.js
PHYS=../../src/physics-handling-before.js node --import ./tools/physics-test/register.mjs tools/physics-test/handling-audit.mjs before.json
# Browser replay expects .scratch/handling/before.json and after.json (gunzip the traces).
tools/browser-slot.sh node tools/physics-test/handling-browser.mjs before
tools/browser-slot.sh node tools/physics-test/handling-browser.mjs after
```

Reference limitations: published skidpad tests differ in tyre, year and pad size; comparable primary Superb 4x4 and matched six-car slalom figures were not found. The note explicitly avoids using unmatched slalom speeds to infer yaw latency or justify physics thresholds.
