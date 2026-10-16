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


## Rejected compact-layout experiment

On the same canonical Glyfada pair, Float32 output used 2,735,921 gzip bytes;
terrain-u16 with normals, urban blend and Y residual used 2,865,235 bytes.
First-cell actual worker residency increased 5,446,046 → 5,609,565 bytes and GPU
storage increased 1,061,772 → 1,142,314 bytes. Contacts and topology are unchanged;
2,765 graph points and 2,048 shared-edge samples still pass. This is not an
optimization and remains opt-in. Timing on this shared software-rendered VPS
is not evidence of a GPU improvement. Raw worker metrics and same-camera
images are in `quantized-worker-check.json`, `quantized-image-comparison.json`,
`float32-probe-glyfada-{overview,street,junction}.png` and
`quantized-probe-glyfada-{overview,street,junction}.png` under the Athens evidence
directory. All three quantized views were inspected.

The DEM sampler separately caches CRS/bounds/inverse-affine setup. A 10,000-point
sample produced byte-identical Float64 heights (SHA-256
50742136bf86639c51a15762c0d28ae8df7652608d3052c4a33194e4f09339e6).
Observed CPU time was 1.540878377 → 0.217262984 seconds, limited to that sampler.
This does not imply a seven-fold full-generation speedup. Reproduction and raw
metrics are `benchmark-elevation.py` and `elevation-cache-benchmark.json`.
