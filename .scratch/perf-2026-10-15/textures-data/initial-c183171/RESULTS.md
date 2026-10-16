# Textures and map data

Codecs remain opt-in: `?assetcodec=1`. Original image and worker-generation paths remain default. Even with assetcodec=1 the existing generated-world cache remains preferred; bakedownload=1 forces HTTP packs for the file-path experiment.

Texture library: 2,225,059 → 2,352,436 file-body bytes; 52.00 → 34.00 MiB estimated resident texture data. This excludes procedural textures, render targets, browser compositor and driver overhead. Measured formats are BC7 for ETC1S surfaces and ASTC 4×4 for the UASTC badge (both 8 bits/pixel), against RGBA8 originals (32 bits/pixel); other GPUs can choose different block formats. An ETC2-only fallback is validated separately.

6 of 21 retained textures use KTX2: ETC1S colour/ARM and UASTC badge. Normal candidates use UASTC RDO 1.5 + Zstd; their download expansions exceed the per-texture 128 KiB cap, so runtime keeps the original WebPs. Badge uses RDO 0.25. All textures retain their full mip chains under the owner-locked single graphics look.

## Lossless file-codec benchmark

Same current production geometry inputs on both sides; Node CPU time uses process.cpuUsage, wall time is measured separately. Warm median of three samples after warmup; explicit GC outside timings. Includes gzip inflation and byte reconstruction, no GPU rendering. Heap/ArrayBuffer peaks are sampled at decode boundaries, not exhaustive process peaks.

| Map | Legacy gzip B | ASR2 gzip B | CPU ms before → after | Wall ms before → after | JS heap MiB before → after | ArrayBuffer MiB before → after |
|---|---:|---:|---:|---:|---:|---:|
| riviera | 35,820,490 | 33,030,820 | 1065.0 → 1120.8 | 871.4 → 884.1 | 21.04 → 21.37 | 689.75 → 708.28 |
| penteli | 22,843,383 | 17,005,153 | 1046.5 → 588.7 | 1156.5 → 520.0 | 25.18 → 25.23 | 578.49 → 498.40 |
| megara | 1,385,290 | 1,147,465 | 37.8 → 21.8 | 32.3 → 16.7 | 11.77 → 11.81 | 120.77 → 32.72 |

ASR2 is generic over typed arrays and preserves every bit, normalized flags, draw ranges, chunk decode transforms and LOD metadata. The benchmark does not claim less GPU geometry memory: vertex layout is the terrain agent’s responsibility. Compare per-map CPU measurements separately from download savings; the codec stays opt-in.

## Browser map loads

Fixed 1000×650 viewport, owner-locked lighting off and effects off; no animation-frame game loop while capturing. Cold contexts; paired captures force HTTP packs on both sides by omitting the worker URL from served manifests. The after side adds assetcodec=1&bakedownload=1. Both use the same simplified geometry and owner-locked look. Main heap sampled every 250 ms during load; worker heaps and WASM linear memory are excluded. Main resource timing excludes dedicated-worker fetches. The controlled HTTP-pack comparison uses no world-generation worker fetches. For an optional default-generation run, worker input bodies are estimated separately from the exact served files; the paired HTTP run has no such estimate. Static transfer totals include browser-reported header overhead, excluding navigation, TLS and connections. GPU sums include total scene geometry capacity and the explicitly uploaded texture library, excluding other procedural textures and render targets. Visibility-dependent geometry residency can be lower. Map load is start action through first race render submission; GPU presentation delays on SwiftShader are not a hardware-performance result. Text/JSON served Brotli quality 6; already-compressed binary/image bodies use identity encoding, matching the checked live WebP response. Cloudflare transfer for new files has not been measured because this task does not deploy.

| Map | Side | /data body B (main + worker estimate) | Texture body B | Codec startup body B | JS body B | Static body / transfer B | First race ms | Sampled peak main heap MiB | Geometry + library MiB |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| riviera | before | 37,360,885 (0 worker est.) | 2,193,229 | 0 | 657,434 | 41,003,981 / 41,026,781 | 24,211 | 504.49 | 217.64 |
| penteli | before | 24,622,324 (0 worker est.) | 2,193,229 | 0 | 661,976 | 28,226,637 / 28,250,337 | 8,985 | 311.65 | 133.18 |
| megara | before | 1,803,564 (0 worker est.) | 2,193,229 | 0 | 666,149 | 5,421,919 / 5,445,319 | 9,396 | 115.89 | 64.00 |
| riviera | after | 34,571,215 (0 worker est.) | 2,352,436 | 541,973 | 693,000 | 38,948,854 / 38,972,554 | 17,989 | 489.74 | 199.64 |
| penteli | after | 18,784,094 (0 worker est.) | 2,352,436 | 541,973 | 697,577 | 23,122,985 / 23,147,585 | 11,136 | 280.43 | 115.18 |
| megara | after | 1,565,739 (0 worker est.) | 2,352,436 | 541,973 | 701,727 | 5,907,054 / 5,931,054 | 7,811 | 134.78 | 46.00 |

Provenance: baseline `71e05c36f909ac8c455f103883f583428a9c4962`; implementation code `c18317106007178e51882cd8d0085037a28b5d18`; mode: paired HTTP packs.

All fresh menus must have zero /data requests (asserted by the browser harness). Per-map metrics and original resource timing entries: [browser.json](browser.json). The normal generated-world preference stays unchanged. These measurements isolate the HTTP fallback/file-codec path; they do not claim a default cold-boot speedup.

## Per-texture bytes and GPU estimate

Original is WebP except atlas.svg. “KTX2 B” includes cached comparison candidates that are **not selected or shipped**. Wire B is the negotiated local browser payload when available, otherwise identity file bytes (SVG original uses the computed Brotli payload). New Cloudflare encoding is unmeasured; gzip and Brotli payload alternatives are in [textures.json](textures.json). GPU after keeps original storage for unselected rows.

| Texture | Runtime | Original B | KTX2 B | Wire B before → after | GPU MiB before → after |
|---|---|---:|---:|---:|---:|
| asphalt_02_diff.webp | etc1s | 382,402 | 257,012 | 382,402 → 257,012 | 5.33 → 1.33 |
| asphalt_02_nor.webp | image | 452,932 | 1,202,828 | 452,932 → 452,932 | 5.33 → 5.33 |
| asphalt_02_arm.webp | etc1s | 229,582 | 260,246 | 229,582 → 260,246 | 5.33 → 1.33 |
| floor_pavement_diff.webp | etc1s | 112,682 | 215,703 | 112,682 → 215,703 | 5.33 → 1.33 |
| floor_pavement_nor.webp | image | 136,910 | 733,632 | 136,910 → 136,910 | 5.33 → 5.33 |
| floor_pavement_arm.webp | etc1s | 42,276 | 136,282 | 42,276 → 136,282 | 5.33 → 1.33 |
| concrete_floor_worn_001_diff.webp | image | 9,180 | 30,944 | 9,180 → 9,180 | 1.33 → 1.33 |
| concrete_floor_worn_001_nor.webp | image | 4,252 | 63,993 | 4,252 → 4,252 | 1.33 → 1.33 |
| concrete_floor_worn_001_arm.webp | image | 14,518 | 45,054 | 14,518 → 14,518 | 1.33 → 1.33 |
| dry_ground_01_diff.webp | image | 63,912 | 92,123 | 63,912 → 63,912 | 1.33 → 1.33 |
| dry_ground_01_nor.webp | image | 52,750 | 239,507 | 52,750 → 52,750 | 1.33 → 1.33 |
| withered_grass_diff.webp | etc1s | 82,138 | 97,167 | 82,138 → 97,167 | 1.33 → 0.33 |
| withered_grass_nor.webp | image | 124,990 | 323,711 | 124,990 → 124,990 | 1.33 → 1.33 |
| coast_sand_01_diff.webp | image | 60,168 | 94,906 | 60,168 → 60,168 | 1.33 → 1.33 |
| coast_sand_01_nor.webp | image | 98,120 | 305,893 | 98,120 → 98,120 | 1.33 → 1.33 |
| rock_face_03_diff.webp | image | 48,450 | 94,194 | 48,450 → 48,450 | 1.33 → 1.33 |
| rock_face_03_nor.webp | image | 94,678 | 319,796 | 94,678 → 94,678 | 1.33 → 1.33 |
| fabric_leather_02_nor.webp | image | 20,234 | 143,214 | 20,234 → 20,234 | 1.33 → 1.33 |
| fabric_leather_02_arm.webp | image | 77,512 | 101,428 | 77,512 → 77,512 | 1.33 → 1.33 |
| waternormals.webp | image | 64,330 | 252,460 | 64,330 → 64,330 | 1.33 → 1.33 |
| atlas.svg | uastc | 53,043 | 63,090 | 21,213 → 63,090 | 1.33 → 0.33 |

## Texture decode and upload measurements

Focused cold-context validation loads rows serially. Decode wall includes fetch, queue and transcode/image decode; upload is CPU submission via initTexture, not GPU completion. The whole-game per-map textureUploadMs and individual decodeWallMs remain in browser.json.

| Mode | Recorded decode wall total ms | Texture upload submission ms | GPU library MiB |
|---|---:|---:|---:|
| before | 390.7 | 434.4 | 52.00 |
| after | 564.1 | 225.6 | 34.00 |
| etc2 | 486.6 | 258.3 | 31.17 |
| unsupported | 441.3 | 366.6 | 52.00 |
| missing | 550.4 | 449.1 | 52.00 |

Focused row load wall includes image decode for original/fallback rows and transcode for compressed rows; the complete game also records each image and compressed decode path.

## Visual and fallback evidence

[Before texture sheet](before-texture-sheet.png) · [After texture sheet](after-texture-sheet.png). Unsupported-GPU and failed-download sheets must have identical PNG hashes to before. Game poses cover car paint/badges, road/terrain and overview; canvas signs and HTML/SVG UI icons retain their original rendering paths. All screenshots must be inspected before accepting equivalence.

## Caching and rebuild

KTX2 filenames hash encoded content. Encoder cache keys hash source bytes, tool version and options. `tools/build-textures.mjs` is invoked by prepare-deploy and uses committed cached outputs without native tools; changed inputs require toktx 4.4.2 and sharp. Meshopt gzip packs are content-addressed and checked against 25 MiB. Both participate in the existing service worker’s demand cache; /data precaching remains prohibited. Hashed paths have HTTP immutable headers. Local Basis JS/WASM uses a content-hashed immutable directory and ships under Apache 2.0; meshoptimizer encoder under MIT.

Build cache evidence: [build-cache.json](build-cache.json) records byte-identical regeneration after eviction; a subsequent encoder-free cache-hit build passed. Production codec worker source is frozen before minification so Function.toString workers remain self-contained while normal bundle minification stays enabled. [production-workers.json](production-workers.json) records actual emitted-worker validation.

Runtime diagnostics: `window.__assetMetrics` gives texture format byte estimates, transcode/fetch/queue wall ms, upload submission CPU ms, per-map container bytes, inflate/decode pipeline wall ms, heap samples and first-race render submission. CPU-only codec timing lives in geometry.json.

## Paired capture files

- riviera: menu [before](before-riviera-menu.png) / [after](after-riviera-menu.png) · front [before](before-riviera-front.png) / [after](after-riviera-front.png) · road [before](before-riviera-road.png) / [after](after-riviera-road.png) · badge [before](before-riviera-badge.png) / [after](after-riviera-badge.png) · overview [before](before-riviera-overview.png) / [after](after-riviera-overview.png) · atlas [before](before-riviera-atlas.png) / [after](after-riviera-atlas.png)
- penteli: menu [before](before-penteli-menu.png) / [after](after-penteli-menu.png) · front [before](before-penteli-front.png) / [after](after-penteli-front.png) · road [before](before-penteli-road.png) / [after](after-penteli-road.png) · badge [before](before-penteli-badge.png) / [after](after-penteli-badge.png) · overview [before](before-penteli-overview.png) / [after](after-penteli-overview.png) · atlas [before](before-penteli-atlas.png) / [after](after-penteli-atlas.png) · signs [before](before-penteli-signs.png) / [after](after-penteli-signs.png)
- megara: menu [before](before-megara-menu.png) / [after](after-megara-menu.png) · front [before](before-megara-front.png) / [after](after-megara-front.png) · road [before](before-megara-road.png) / [after](after-megara-road.png) · badge [before](before-megara-badge.png) / [after](after-megara-badge.png) · overview [before](before-megara-overview.png) / [after](after-megara-overview.png) · atlas [before](before-megara-atlas.png) / [after](after-megara-atlas.png)
