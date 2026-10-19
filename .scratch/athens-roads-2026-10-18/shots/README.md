# Athens roads: screenshots from the published staging bake (2026-10-19)

Recreated after the first evidence folder was lost (it was in gitignored `.scratch/` and went with the worktree cleanup).

## What was shot

- **Code:** `prod` at `b3591cc0` ("Athens roads: one OSM-derived cross-section model ..."), extracted with `git archive` into a temp dir. No code changed, no re-bake.
- **World data:** pulled from the **staging R2 bucket** `athens-racing-world-staging`, manifest
  `manifests/9d0941d1b85688efecb1464cae8314664f5f51d6dc6a87c290eb2c38d92d095c.json`.
  127 cells, 47,922,592 bytes. Every cell's SHA-256 and byte length matched the manifest, and so did the manifest's own hash.
- **Run:** real app at `/?map=athens`, served locally from the extracted tree (R2 cells and manifest served from disk under the same paths the Worker uses), headless Chromium (software rendering), 1280x720, run through `tools/browser-slot.sh`. The player car and the streamed world are the real runtime. The camera is moved by the dev hook `__athens.setCameraHook`, with the car paused. Page errors: none in the retake run (the first run's error list was lost with the rate limit).
- **HUD:** the speedometer in the bottom right is the normal HUD. The game paused at speed 0, gear 1.
- Coordinates are in world metres. The bridge is at x 3599, z 15236 (deck y 24.75).

## Files

| File | What it shows |
| --- | --- |
| `street-sidewalks-zebra.webp` | A residential street at about (2889, 14463): textured asphalt, cream paved sidewalks on both sides with kerb edge line, a side street branching off, a painted zebra crossing |
| `street.webp` | Player's view at a T-junction near (2000, 13800): asphalt with cracks, paved sidewalks with a bright kerb line, rounded kerb corners at the junction |
| `avenue-markings-zebras.webp` | A wide avenue junction near (2418, 15248) by the sea: lane dashes, solid edge lines, centre-line, zebras across several arms, green refuge islands, sidewalks |
| `junction.webp` | The same street junction as `street.webp` from 13 m up: kerb fillets at the corners, sidewalks continuing round the corners |
| `coast.webp` | The Glyfada to Riviera coast from the air: sea, bays, roundabout, avenue with median, beach areas, block buildings |
| `overview.webp` | The whole neighbourhood from 520 m up: the full street grid in textured asphalt with sidewalk edges, avenues, parks. The flat dark areas at the top and right appear to be outside the baked cells |
| `bridge-deck.webp` | Player car on the bridge deck from behind: continuous asphalt, lane dashes, solid edge lines, solid guardrail barrier on both sides |
| `bridge-deck-side-guardrail.webp` | The same deck from the side at 8 m: the car between the two barriers, a second carriageway beyond |
| `above-bridge.webp` | The bridge and its approaches from 90 m up: both carriageways, tan median, lane dashes, a junction at the top of frame. The deck looks continuous, no holes |
| `above-bridge-median-close.webp` | Close view of the median strip and sidewalk on the deck. The median is a continuous strip, no holes |
| `above-bridge-deck.webp` | A second angle over the bridge deck at 60 m, looking along both carriageways and the median |
| `under-deck-along.webp` | Under the deck, looking along the underpass: the slab underside as a ceiling, with sky showing past its edge. No dark void |
| `under-deck-across.webp` | Under the deck, looking across the span: the slab above the underpass road, with sidewalks and the lane-marked road continuing beyond |
| `under-deck-edge.webp` | Under the deck from the side: the slab underside, a seam of sky at the deck edge and the terrain beside the underpass |

## Honest notes

- The shots were taken from the published bake, not from a local bake: every cell was hash-checked against the staging manifest.
- Buildings are plain grey boxes and trees are cut-out cubes. That is the current low-poly style for the dev flag, not a regression.
- The underside of the deck is a flat grey slab and the terrain beside the underpass is flat beige: there are no voids or holes, but there is no texture there either.
- The bridge guardrail is a tall solid grey block. It reads as a concrete barrier from the side shot.
- Discarded from the first attempt (capture bugs, not world bugs): the first `junction`, `above-bridge`, `above-bridge-median-close` and `under-deck*` shots. The above-bridge pair were solid grey because the fog start was left at the overview value (1500 m) while the fog end was reduced, and the under-deck pair had the camera looking steeply up at the slab. These were retaken with the fog reset for each shot and a lower, level camera.
