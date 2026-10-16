# Psychiko integration evidence

Code/release-picture candidate tested: `6203c8ac9767cd726f029718f17b0a5cf2aac148`.
Base: `87558ec5d2f2dd916b32b6e9fc6e78a290b18571`.
The final evidence commit adds only this directory; the shared working tree/index was never used.

## Contributor provenance

Vassilis Perrotis <vassilisperrotis@gmail.com> retains his original author name, email and dates on all four rebased commits:

| Original | Port |
|---|---|
| 2c9b1f3 | 4a855c8e654e895cb7b3f29919f6d4ab3f8000da |
| 231510e | e52f0957652c23723c5f537806942098e0666ba2 |
| f0745b8 | 93da904462e0b0a0efccb0001b471de1033ddbf8 |
| 54505cc | c58db0e2136cf1856b827688e2c2c2ed48e30ce2 |

Separate Codex commits contain compatibility, owner-style changes and verification fixes.
The owner's annotated `psychiko-garden-original` tag resolves to the full original PR head, `54505ccfe33499cf6e1ed00b0519bd6cc05d0c10`.
`provenance.json` records byte-for-byte JSON equality of the route, roadworks, road network and 3,507 building footprints against that original.

## Behavior

Psychiko appears in the track catalogue and multiplayer catalogue, with two-lap racing and free roam. The 92 OSM exit closures are solid during races and removed in free roam. Police, traffic and road-aware auto-tow use the shared runtime. The original optional one-lap time trial stays defined; the offered race retains two laps and uses the owner maximum of two rivals.

The shared building builder creates plain footprint blocks in its contrasting palette. Vegetation and garden assemblies/textures are removed. Terrain uses the current quantized/LOD/area-colour pipeline with 2.5 m street refinement. Square lamps, shared bins and blocky roadworks fit the locked category budgets (`prop-budgets.json`). The current single graphics look and reverted title design remain in place; its existing catalogue-driven tagline includes Psychiko.

Large road packs are losslessly split into ordered gzip pieces below the CDN asset ceiling, for both legacy and optional meshopt downloads. The optional codec remains disabled for Psychiko until paired startup validation. Tests check exact reconstruction and clean fallback on a missing piece.

## Browser and multiplayer

`browser-report.json` and `browser-simplified.log` record the real local browser run through `tools/browser-slot.sh`: four selector tracks; Psychiko race with two rivals, two laps, visible roadworks; free roam with closures hidden, 11 active traffic cars and the police runtime; no page exceptions.

All ten native game-canvas PNG captures were opened and inspected (captured on 35d6c67 before the unrelated phone-controller removal; map, terrain, road, vehicle, graphics and cockpit sources are identical after the rebase): afternoon/night × start/mid × chase/cockpit, plus both overviews. They show clear road surfaces, simple mapped building blocks, square props and unobstructed cockpit views. Captures use fixed real game cameras; simulation is held while changing the pose to avoid false checkpoint messages. `SHA256SUMS` covers the screenshots and reports. The release note uses `assets/changelog/2026.10.16.1/psychiko.webp`, captured from the afternoon mid-course chase view, and credits Vas-Per and the saved original tag.

`smoke-simplified.log`/`.exit` record `tools/deploy-smoke.mjs --race --map=psychiko` against the real local game server: two clients completed all 157 checkpoints, no DNF, no reconnects.

## Six gates

The `gates/` logs and exit markers are from a fresh git archive of the tested candidate. node_modules is symlinked. Unrelated historical screenshot directories were omitted to respect the VPS disk limit; required POV-mask fixtures were retained. No remote deployment was performed: the Wrangler command is a staging dry-run only.

Final gate results and numerical race/terrain summaries are recorded alongside this file once complete.

## Note for Vas-Per

Vas, your Psychiko street layout, roadworks and lap setup are preserved, with your authorship on all four commits. We adapted the scenery to the owner's new shared style: plain footprint blocks, simple props and terrain colour variation. Your full garden version is saved under `psychiko-garden-original`, and the release note credits you and points to that tag.

Day captures: [start chase](afternoon-start-chase.png), [start cockpit](afternoon-start-cockpit.png), [mid chase](afternoon-mid-chase.png), [mid cockpit](afternoon-mid-cockpit.png), [overview](afternoon-overview.png).

Night captures: [start chase](night-start-chase.png), [start cockpit](night-start-cockpit.png), [mid chase](night-mid-chase.png), [mid cockpit](night-mid-cockpit.png), [overview](night-overview.png).

All six gates passed (each exit marker is 0): npm test, physics regression, events, syntax, browser imports, and staging Wrangler dry-run. The physics regression reports 1,142 passes including 328 valid Psychiko recovery placements. Both two-lap rivals finished cleanly in 742.83 s and 739.18 s. `terrain-summary.json` records the actual rendered-road scan with the shared limits unchanged.
