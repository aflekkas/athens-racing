# Landuse lookup during offline cleaning

A query-plan check on the same reduced-source SQLite database found the generic
join scanning 25,362 landuse rows before testing the R-tree bounds. Explicit
spatial-first CROSS JOIN uses the four R-tree bounds first, then primary-key
feature lookups. This changes neither source geometry nor visible output.

Five repeated lookups at the same landuse representative point returned the
same six records in both cases. Measured wall time on the shared VPS: 4.193 s
before, 0.0084 s after. Timings are not a game-frame or isolated-CPU claim;
the deterministic evidence is the query plan and identical result rows.

Raw plans and timing: `.scratch/athens-world/landuse-query-check.json`.
The end-to-end fixture also verifies a building receives its intersecting
industrial landuse height default. No renderer, runtime or main-map change.

## Lossless AWT packing, real styled Glyfada cell

Baseline candidate: `b80ff73522c1e149a9ae881413f4d6d6493bc231`.
The after candidate is recorded in `packing-comparison.json` once frozen.
The baseline encoder reproduced the original captured gzip bytes exactly.
The update interns identical table arrays and enables the existing shared ASR1
byte planes on every view. It introduces no codec and changes no decoded value.

| Metric | Before | After |
| --- | ---: | ---: |
| Gzip bytes | 1,754,577 | 1,380,077 |
| Retained CPU array backing bytes | 4,312,136 | 3,968,156 |
| Draw calls | 13 | 13 |
| Drawn triangles | 70,576 | 70,576 |

Wire bytes fall 21.34%; array backing storage falls 7.98%. Per-encode process CPU
averaged 0.5751 s before / 0.5088 s after over three calls; shared-VPS timings are
observations, not a frame-rate or whole-region throughput claim. The actual
worker fetch/hash/decode/contact-index/bounds/accounting path also accepts both
encodings; `packing-worker-check.json` records its complete resident/GPU bytes.

Same-camera screenshots were captured through the browser slot and inspected:
[before overview](../../athens-world/probe-glyfada-overview.png),
[after overview](../../athens-world/packing-after-probe-glyfada-overview.png),
[before street](../../athens-world/probe-glyfada-street.png),
[after street](../../athens-world/packing-after-probe-glyfada-street.png),
[before junction](../../athens-world/probe-glyfada-junction.png),
[after junction](../../athens-world/packing-after-probe-glyfada-junction.png).
All three PNG pairs are byte-identical (`packing-image-comparison.json`), and
all table/mesh bytes match after decoding (`packing-comparison.json`).
The cell remains a nonplayable geometry probe, not a hosting-budget pass.
