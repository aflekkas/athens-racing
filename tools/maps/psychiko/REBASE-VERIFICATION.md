# Psychiko staging integration verification

All work was performed in the `psychiko-track` worktree `t3-ff227117`. No push or deployment was performed. The local browser server used port 8002 because ports 8000 and 8001 were occupied.

## Conflict resolutions

- `src/enabled-maps.js`: retain restored Megara and add Psychiko; playable order is Riviera, Megara, Penteli, Psychiko.
- `src/map-select.js`: retain Megara's gold selector colour and add Psychiko's pale gold.
- `tools/build-attica-map.py`: retain staging's western extent (23.00 E) and source snapshot, and generate all four route overlays.
- `assets/maps/attica.svg`, `src/attica-map-data.js`: regenerate from the resolved Python generator; a second rebuild is identical. Combined size: 368,283 bytes.
- `tools/maps/attica/README.md`: retain western coverage and source attribution; describe four tracks and Psychiko terrain/route inputs.
- `package.json`: retain all staging tests, including tyre stacks, traffic racing and the rival regression script; add Psychiko world tests.
- `tools/bundle-browser.mjs`: retain staging's all-map worker metadata update; retain Psychiko's macOS realpath correction.
- `tools/deploy-smoke-catalogue.test.mjs`, `tools/deploy-smoke-route.test.mjs`, `tools/deploy-smoke.mjs`: cover all four tracks, retaining map-specific preview fetching.
- `tools/multiplayer-client.test.mjs`: expect both restored Megara and Psychiko.

The remaining shared scene, map, physics and road files merged automatically. Megara scenery, gantry, tyre stack implementation, world-worker and rival AI files are byte-identical to staging. A direct comparison of `Ground.at` against staging matched 7,414 Megara contacts, including kerbs and runoff. Circuit passing restrictions also apply sensibly to Psychiko: a two-lap browser race finished without a crash or missed gate. Tyre stacks are created only in Megara's scenery module.

## Review fixes

- Restore the retaining-masonry comment and format the villa range block and Psychiko scenery module.
- Restrict the extra road-network mouth check to street circuits. Comparing the executed villa blocks with actual Riviera data gives the same 56 placement calls as staging.
- Keep the Riviera direction sign scoped to Riviera; unnamed closed-route start banners fall back to `CIRCUIT`.
- Accept `psychiko-tt` only when explicitly requested by the URL. Megara/Penteli trials stay disabled, including their URL lookups; menus retain Quick Race and Free Roam. The scratch event-scope audit checks string and object lookups for all three maps.
- Update older selector and browser-worker fixtures that assumed only three tracks. The first full test run exposed these two fixture omissions; both are fixed and the full rerun passes.

## Commands and results

All final commands passed:

```sh
npm ci
npm test
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs
node tools/events-test.mjs
node tools/check-syntax.mjs
node tools/check-browser-imports.mjs
node tools/maps-test.mjs
node --import ./tools/physics-test/register.mjs tools/maps-test.mjs
node tools/maps-resource-test.mjs
node tools/maps/psychiko/validate.mjs
npx wrangler deploy --env staging --dry-run
```

`npm test`: 682 passing tests, one pre-existing skip, plus the passing three-route rival regression. Physics regression: 172 passed, zero failures. Syntax: 209 modules. Browser import graph: 171 modules. Dry run includes all four tracks and exits without publishing.

Additional checks passed:

```sh
node --test tools/bundle-browser.test.mjs tools/map-select-camera.test.mjs
node .scratch/psychiko-r2/staging-parity.mjs
node .scratch/psychiko-r2/event-scope.mjs
.scratch/attica-map/venv/bin/python tools/build-attica-map.py
git diff --exit-code HEAD -- assets/maps/attica.svg src/attica-map-data.js
```

## Browser evidence

Chrome was driven through `tools/cdp.mjs` with `autodrive`, `simhook`, `quality=low`, `nosw` and chase camera. Simulation stepping advances the real game/physics; no position teleporting was used.

- Psychiko race: finished two laps in 417.4823 s, 115/115 gates, zero crashes and zero console errors.
- Megara race: finished three laps in 269.2161 s, 86/86 gates, zero crashes and zero console errors.
- Selector: all four pins visible and in frame, including Megara in the west, zero console errors. The initial script invoked quit before asynchronous boot completed; the final script waits for the menu to be ready before opening the selector.

All seven screenshots were personally opened and inspected:

```text
.scratch/psychiko-r2/psychiko-driving-pavlou.png
.scratch/psychiko-r2/psychiko-driving-diamantidou.png
.scratch/psychiko-r2/psychiko-driving-kallari.png
.scratch/psychiko-r2/psychiko-race-finish.png
.scratch/psychiko-r2/megara-driving.png
.scratch/psychiko-r2/megara-race-finish.png
.scratch/psychiko-r2/selector-desktop.png
```

The third Psychiko driving screenshot's filename is inherited from the previous script; this run captured station 4009 m on Kyprou. Exact stations, race results and checkpoint totals are in `psychiko-drive.log` and `megara-drive.log`. Automated results correctly have `valid=false`.

Evidence and scripts live in ignored `.scratch/psychiko-r2/`. Remaining validation limits: no deployed multiplayer smoke, mobile browser race, or physical controller drive was requested or performed in this round. Only the dry-run deployment was authorized.
