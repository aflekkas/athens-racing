# Owner colour refinement — 2026-10-15

Before: 82ac93ca5864032605d04cd1153bd8d8d3f10a49 (landed simplified world). After measured source: 98a34074640daa56e6fcb2cb9803e108b6b430e1, based on 5c72f29. Final commit adds evidence and the inspected changelog WebP.

The owner requested simple landscape colour/texture variation and buildings that contrast with the ground. Restored the 8071301 terrain's landuse/slope/height colour logic and subdued ground/sand/rock texture splatting. Omitted the old painted shrub clumps and irregular garden/plot shader blocks. No vegetation or beach furniture returns. Building footprints, heights, batching and budgets are unchanged; white/cool grey and muted blue/terracotta/ochre replace beige. Effects Off preserves the terrain material and quantized decoder.

## Paired evidence

Same fixed poses and camera/lighting as the first simplification capture: Riviera start/mid, Penteli mid, Megara overview, afternoon and night. The after harness explicitly passes lowGraphics:true with high geometry quality to exercise Effects Off. The before images are the corresponding 82ac93c captures. No continuous animation loop; render counts are populated-world/frustum counters, not gameplay distance-LOD or GPU-time claims. Known pre-existing distant terrain wedges remain the terrain owner's separate follow-up.

| Map/pose/light | Calls before → after | Rendered triangles before → after |
| --- | ---: | ---: |
| riviera/start/afternoon | 126 → 126 | 688868 → 689044 |
| riviera/start/night | 116 → 116 | 619602 → 619778 |
| riviera/mid/afternoon | 83 → 83 | 654703 → 655103 |
| riviera/mid/night | 68 → 68 | 520913 → 521313 |
| penteli/mid/afternoon | 286 → 286 | 1765610 → 1768282 |
| penteli/mid/night | 286 → 286 | 1765610 → 1768282 |
| megara/overview/afternoon | 120 → 120 | 989105 → 995153 |
| megara/overview/night | 120 → 120 | 989105 → 995153 |

| Map | Total populated triangles before → after | Geometry bytes before → after |
| --- | ---: | ---: |
| riviera | 6082647 → 6082647 | 398651222 → 398651222 |
| penteli | 4632426 → 4632426 | 126701974 → 126701974 |
| megara | 2208183 → 2208183 | 51792413 → 51792413 |

Draw calls are unchanged at every paired pose. Rendered triangle counts increase by up to 0.62% with the restored terrain colours/material path; total populated geometry triangles and buffer bytes remain unchanged. These are controlled scene counters, not a GPU timing claim.

## Texture cost

Four restored 512×512 ground-surface WebPs add 399,926 source bytes and an estimated 4,194,304 decoded base-level RGBA bytes. Retained requests: 16 → 20 (original baseline: 32); source bytes: 1,772,090 → 2,172,016 (original: 3,193,122). Foliage bark/leaves/fronds and detailed-building plaster textures remain deleted. Retained TX: asphalt/paver/concrete diff,nor,arm; ground/grass/sand/rock diff,nor; leather nor,arm; water. Grass is a ground-surface scan, not vegetation geometry.

## Verification

Owner guard permits terrain texture variation while retaining vegetation, beach-furniture, box-building and triangle-budget locks. It also checks the palette and Effects Off material retention. See colour/gates logs and exit markers for all six clean-archive gates. Paired screenshots, contact sheet and release WebP were inspected.

Integration provenance: the independent suspension commit a92d24d landed while these gates ran. Final source rebases onto it without altering its vehicle files; only changelog additions overlap. Full six world-candidate gates were run on 98a3407; the combined archive additionally reruns owner locks, physics, syntax and browser imports (see `colour/integration/`). Screenshots remain measurements of 98a3407, not the unrelated vehicle update.

The subsequent 7ede673 inactive world-tile runtime is also preserved without overlapping this change. Final syntax/import validation includes those modules; the paired rendering does not activate that independent runtime.

Final integration: owner locks 7/7, combined physics 1,141/1,141, syntax and browser imports all exit 0. The final syntax/import checks run on clean archive cb9402384f3876050d10b197712cb41f08c57ace, based on 7ede673. Final commit changes only evidence after those checks.
