# Riviera guardrails — implementation evidence

Selective W-beam protection follows 6/16/24 m terrain probes. Final placement: 15 runs, 2,602 m, 18 merged beam chunks, 613 posts in 24 instance chunks, 18,214 beam triangles (plus 7,356 post triangles). Beam/post reference ranges: 1100/420 m, scaled by the shared graphics-preset policy. No new cast shadows.

The reviewed s=2860 right-side drop is now protected (measured 1.98/5.99/9.12 m from the slightly revised footing). Shoulders and road dimensions are unchanged. Existing concrete protection, urban promenades, tunnel corridors, OSM footpaths, junctions, parking access and procedural beach stair approaches are excluded. Ends turn down over 6 m.

`placement-map.png` is the top-down debug map; `placement.json` contains every probe and final run. `before-2860.png` / `before-8200.png` and `after-*-fullres.png` show the production game at matching stations and chase cameras. The final 3920 shot covers the steep bend approaching Varkiza and its urban transition. Images were visually inspected. `browser-report*.json` records camera coordinates and renderer statistics; full-resolution captures set the renderer and post target to 1280 × 800, with Potato scenery settings. Offline API/WebSocket 404s are expected from the capture-only static server; JavaScript error arrays must be empty.

The initial matched Potato captures (before the final 2 m junction-row safety extension) measured 446 → 441 calls at s2860 and 404 → 405 at s8200, with fewer visible triangles at both sites. Final captures measured 442 calls / 1,793,898 triangles at s2860 and 405 calls / 2,399,825 triangles at s8200, versus 446 / 1,810,656 and 404 / 2,413,239 before. The final post target is larger, so this is not an FPS benchmark on the heavily loaded software renderer.

## Validation

- `tools/riviera-rails.test.mjs`: placement/exclusions, exact uploaded pavement triangles, actual Vehicle/Ground sliding impact, safe tow-corridor distance, full-width lane clearance, and production RivalAI/Vehicle/Ground runs through both protected bends.
- `rival-race.log` / `rails-riviera-slow.json`: full 10.3 km Riviera race with real traffic. Both rivals and player finish; zero racer contacts, racer/traffic contacts and racer wall frames. The traffic simulation also records two civilian collision events. The existing race harness uses conservative road limits; the new targeted test separately exercises the actual new Ground rails.
- Required final clean-archive gates and exit markers are in `rebased-gates/`; `gates/` and root-level gate logs record the earlier validation passes. The final pass includes the concurrent Garage/settings redesign on prod. The final gameplay/source files match the archived candidate. The later full-resolution WebP refresh has a separate `final-picture-check.log` and zero exit marker. A private commit-tree candidate is archived via a temporary bare repository's HEAD; prod is advanced only after all gates pass. No shared checkout/index writes, push or deployment.

References and uncertainty: `tools/riviera-rails.md`, `refs/osm-features.json` and `refs/osm-projected.json`. Earlier street-level captures were inspected; a fresh Street View request failed. This is terrain-informed reconstruction supported by mapped access and available imagery, not a current survey of every rail.
