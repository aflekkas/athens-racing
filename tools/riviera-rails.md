# Riviera drop protection

Terrain-derived reconstruction, not a survey of every installed barrier. The avenue keeps its urban kerbs/promenade and its existing concrete run at s=2411–2681. No steel is added just because the sea is close.

## References checked 2026-10-15

- The earlier April 2026 Street View capture at `.scratch/world-playtest/refs/streetview-east-portal.png` was inspected: galvanized steel rails on the approach, stone kerbs inside the east Loumbarda bore. [Panorama](https://www.google.com/maps/@?api=1&map_action=pano&pano=4ogSMsTj1LpnKOYOsKmGrw). A fresh browser request returned no imagery; saved failed requests are in this task's refs directory.
- Dimos F., December 2015, [Loumbarda photos](https://disaki.blogspot.com/2015/12/blog-post_15.html): inspected the existing `dimosf-1.jpg` reference; W-beams above a masonry retaining wall and short posts on the outside curve. This is historical geometry evidence, not confirmation of today's exact extent.
- OpenStreetMap API map exports: [Limanakia](https://api.openstreetmap.org/api/0.6/map?bbox=23.792,37.798,23.801,37.805), [Loumbarda](https://api.openstreetmap.org/api/0.6/map?bbox=23.822,37.805,23.842,37.823). Compact raw geometries/tags and projected stations are saved under `.scratch/riviera-rails/refs/`. These extracts contain no tagged steel guardrail. Stone wall 1460036585 is away from the road; it is not used to invent a roadside barrier. Footways/Beach Path are retained as access exclusions. OSM data © OpenStreetMap contributors, ODbL.

## Rules

Every 2 m, probe rendered terrain 6, 16 and 24 m beyond the shoulder. Select drops over 2.2, 4.5 or 7 m respectively; tight bends also select a 3.5 m drop at 16 m. Fill sampling holes up to 8 m, never across exclusions; discard runs shorter than 12 m. The beam follows the outer pavement's actual horizontal elevation, with posts sunk 3 cm into it, rather than extrapolating the banked asphalt plane. Six-metre turned-down terminals close each run.

Exclude urban pavements, junction mouths with 8 m padding and their neighbouring mesh rows, mapped footpath entrances, parked-car access, the three procedural Limanakia stair approaches, existing concrete protection and the separated Loumbarda carriageways. Rails use Ground's existing lateral collision and sliding response. Route geometry, race progress, lane centres, traffic and corridor widths do not change.

Beams are merged in 240 m spatial cells, with at most 160 m of route in an individual input strip; posts are instanced every 4 m. Shared scenery culling/fading scales 1100 m beam and 420 m post ranges with graphics presets and draw distance. No cast shadows or new per-frame placement work.

## Reproduction

`RAIL_EVIDENCE=1 node --test tools/riviera-rails.test.mjs`

`bash tools/browser-slot.sh node tools/riviera-rails-capture.mjs`

The browser loads the real game; only the old road module is substituted for before captures. Captures use a fixed station and the production chase camera, with renderer PNG export on this software-rendered server.
