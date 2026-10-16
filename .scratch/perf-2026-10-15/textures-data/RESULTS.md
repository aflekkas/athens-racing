# Textures and map data

HTTP codecs remain opt-in: `?assetcodec=1&bakedownload=1`. Original image and worker-generation paths remain default. Texture codecs require the explicit HTTP-pack path so generated-world startup never pays for an otherwise unneeded Basis download. Even with assetcodec=1 the existing generated-world cache remains preferred; bakedownload=1 forces HTTP packs for the file-path experiment.

Texture library: 2,225,059 → 2,352,436 file-body bytes; 52.00 → 34.00 MiB estimated resident texture data on Riviera/Penteli. Megara retains original images and its 52.00 MiB texture library to avoid transcoder overhead. This excludes procedural textures, render targets, browser compositor and driver overhead. Measured formats are BC7 for ETC1S surfaces and ASTC 4×4 for the UASTC badge (both 8 bits/pixel), against RGBA8 originals (32 bits/pixel); other GPUs can choose different block formats. An ETC2-only fallback is validated separately.

6 of 21 retained textures use KTX2 on maps with enough HTTP-pack savings: ETC1S colour/ARM and UASTC badge. Normal candidates use UASTC RDO 1.5 + Zstd; their download expansions exceed the per-texture 128 KiB cap, so runtime keeps the original WebPs. Badge uses RDO 0.25. All textures retain their full mip chains under the owner-locked single graphics look.

## Lossless file-codec benchmark

Same current production geometry inputs on both sides; Node CPU time uses process.cpuUsage, wall time is measured separately. Warm median of three samples after warmup; explicit GC outside timings. Includes gzip inflation and byte reconstruction, no GPU rendering. Heap/ArrayBuffer peaks are sampled at decode boundaries, not exhaustive process peaks.

| Map | Legacy gzip B | ASR2 gzip B | CPU ms before → after | Wall ms before → after | JS heap MiB before → after | ArrayBuffer MiB before → after |
|---|---:|---:|---:|---:|---:|---:|
| riviera | 35,820,490 | 33,194,241 | 1012.4 → 918.6 | 785.1 → 682.0 | 21.05 → 21.40 | 713.37 → 776.32 |
| penteli | 22,843,383 | 17,073,883 | 736.5 → 687.7 | 523.7 → 453.7 | 25.19 → 25.24 | 671.88 → 501.48 |
| megara | 1,385,290 | 1,173,346 | 44.1 → 48.1 | 28.5 → 27.7 | 11.76 → 11.81 | 133.38 → 33.62 |

## Startup budget and repeated timing check

Per-buffer meshopt requires at least 1% and 4 KiB savings over the best gzip/raw-byte-plane encoding. Otherwise the bytes remain raw. Per-map geometry reserves 32 KiB for decoder startup; compressed textures need at least 1 MiB pack savings to cover Basis plus texture transfer growth. Generated policy: `{"riviera":{"geometry":true,"textures":true,"savedBytes":2626249,"meshoptViews":120},"megara":{"geometry":true,"textures":false,"savedBytes":211944,"meshoptViews":12},"penteli":{"geometry":true,"textures":true,"savedBytes":5769500,"meshoptViews":77}}`. MeshoptDecoder is imported only for ATTRIBUTES views; raw-only browser fixtures record zero decoder requests. Hashed loader/decoder chunks and the hashed Basis directory have immutable HTTP caching; the service worker retains demand caching.

Five interleaved Penteli pairs alternate before/after order. Median first render: **13,594 → 12,696 ms** (-6.6%); median absolute deviations 1,037 / 320 ms. Median paired delta -2,073 ms. The repeated median is the primary timing check; individual single pairs still swing substantially in either direction. The earlier run is retained in initial-c183171/. Every repeated pair also downloads fewer total startup bytes. Texture waiting is essentially zero; phase timings distinguish fetch/inflate, buffer decode and compilation. [All samples and order](penteli-five-pairs/browser.json) · [summary](penteli-five-pairs/summary.json). The repetition code pair is baseline `71e05c36f909ac8c455f103883f583428a9c4962` versus `73d7747173a14b22a3cd75b3e418eb46793f9e65`; subsequent explicit HTTP-path gating leaves that measured path unchanged.

| Pair | Before ms | After ms | Total startup B before → after | Buffer decode wall ms | Texture wait ms | Compile ms |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 17,924 | 12,852 | 28,224,721 → 23,192,201 | 338.1 | 0.1 | 243.4 |
| 2 | 12,800 | 14,879 | 28,224,721 → 23,192,201 | 386.7 | 0.1 | 348.4 |
| 3 | 12,557 | 12,696 | 28,224,721 → 23,192,201 | 290.7 | 0.1 | 285.8 |
| 4 | 15,666 | 12,376 | 28,224,721 → 23,192,201 | 301.0 | 0.0 | 230.8 |
| 5 | 13,594 | 11,521 | 28,224,721 → 23,192,201 | 302.5 | 0.1 | 238.0 |

ASR2 is generic over typed arrays and preserves every bit, normalized flags, draw ranges, chunk decode transforms and LOD metadata. The benchmark does not claim less GPU geometry memory: vertex layout is the terrain agent’s responsibility. Compare per-map CPU measurements separately from download savings; the codec stays opt-in.

## Browser map loads

Fixed 1000×650 viewport, owner-locked lighting off and effects off; no animation-frame game loop while capturing. Cold contexts; paired captures force HTTP packs on both sides by omitting the worker URL from served manifests. The after side adds assetcodec=1&bakedownload=1. Both use the same simplified geometry and owner-locked look. Main heap sampled every 250 ms during load; worker heaps and WASM linear memory are excluded. Main resource timing excludes dedicated-worker fetches. The controlled HTTP-pack comparison uses no world-generation worker fetches. For an optional default-generation run, worker input bodies are estimated separately from the exact served files; the paired HTTP run has no such estimate. Static transfer totals include browser-reported header overhead, excluding navigation, TLS and connections. GPU sums include total scene geometry capacity and the explicitly uploaded texture library, excluding other procedural textures and render targets. Visibility-dependent geometry residency can be lower. Map load is start action through first race render submission; GPU presentation delays on SwiftShader are not a hardware-performance result. Text/JSON served Brotli quality 6; already-compressed binary/image bodies use identity encoding, matching the checked live WebP response. Cloudflare transfer for new files has not been measured because this task does not deploy.

| Map | Side | /data body B (main + worker estimate) | Texture body B | Codec startup body B | JS body B | Static body / transfer B | First race ms | Sampled peak main heap MiB | Geometry + library MiB |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| riviera | before | 37,360,899 (0 worker est.) | 2,193,229 | 0 | 657,434 | 41,002,072 / 41,024,572 | 22,063 | 489.32 | 217.64 |
| riviera | after | 34,734,650 (0 worker est.) | 2,352,436 | 541,973 | 693,471 | 39,112,760 / 39,136,460 | 20,892 | 467.88 | 199.64 |
| penteli | before | 24,622,331 (0 worker est.) | 2,193,229 | 0 | 661,976 | 28,224,721 / 28,248,121 | 10,315 | 320.07 | 133.18 |
| penteli | after | 18,852,831 (0 worker est.) | 2,352,436 | 541,973 | 698,047 | 23,192,192 / 23,216,792 | 13,099 | 277.87 | 115.18 |
| megara | before | 1,803,568 (0 worker est.) | 2,193,229 | 0 | 666,149 | 5,408,405 / 5,431,205 | 13,158 | 109.51 | 64.00 |
| megara | after | 1,591,624 (0 worker est.) | 2,193,229 | 0 | 678,878 | 5,208,910 / 5,232,010 | 7,646 | 101.60 | 64.00 |

Provenance: baseline `71e05c36f909ac8c455f103883f583428a9c4962`; implementation code `98f616d953c8dd2b36db4568ec43f6b08a5e0c62`; mode: paired HTTP packs.

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
| before | 365.8 | 459.6 | 52.00 |
| after | 496.6 | 249.9 | 34.00 |
| etc2 | 489.6 | 243.7 | 31.17 |
| unsupported | 358.2 | 403.4 | 52.00 |
| missing | 483.3 | 435.7 | 52.00 |

Focused row load wall includes image decode for original/fallback rows and transcode for compressed rows; the complete game also records each image and compressed decode path.

## Visual and fallback evidence

[Before texture sheet](before-texture-sheet.png) · [After texture sheet](after-texture-sheet.png). Unsupported-GPU and failed-download sheets must have identical PNG hashes to before. Game poses cover car paint/badges, road/terrain and overview; canvas signs and HTML/SVG UI icons retain their original rendering paths. Paired 3D captures preserve car paint, road and terrain appearance; badges remain sharp. Shared SVG icon sheets and the Penteli procedural sign atlas have identical PNG hashes. Full menus can differ in anonymous driver labels or clock text between anonymous cold contexts; these are outside the texture path. Procedural plates can also differ between anonymous contexts.

UI icon sheets: [before](before-ui-icons.png) · [after](after-ui-icons.png).

## Caching and rebuild

KTX2 filenames hash encoded content. Encoder cache keys hash source bytes, tool version and options. `tools/build-textures.mjs` is invoked by prepare-deploy and uses committed cached outputs without native tools; changed inputs require toktx 4.4.2 and sharp. Meshopt gzip packs are content-addressed and checked against 25 MiB. Both participate in the existing service worker’s demand cache; /data precaching remains prohibited. Hashed paths have HTTP immutable headers. Local Basis JS/WASM uses a content-hashed immutable directory and ships under Apache 2.0; meshoptimizer encoder under MIT.

Build cache evidence: [build-cache.json](build-cache.json) records byte-identical regeneration after eviction; a subsequent encoder-free cache-hit build passed. Production codec worker source is frozen before minification so Function.toString workers remain self-contained while normal bundle minification stays enabled. [production-workers.json](production-workers.json) records actual emitted-worker validation.

Runtime diagnostics: `window.__assetMetrics` gives texture format byte estimates, transcode/fetch/queue wall ms, upload submission CPU ms, per-map container bytes, inflate/decode pipeline wall ms, heap samples and first-race render submission. CPU-only codec timing lives in geometry.json.

## Paired capture files

- riviera: menu [before](before-riviera-menu.png) / [after](after-riviera-menu.png) · front [before](before-riviera-front.png) / [after](after-riviera-front.png) · road [before](before-riviera-road.png) / [after](after-riviera-road.png) · badge [before](before-riviera-badge.png) / [after](after-riviera-badge.png) · overview [before](before-riviera-overview.png) / [after](after-riviera-overview.png) · atlas [before](before-riviera-atlas.png) / [after](after-riviera-atlas.png)
- penteli: menu [before](before-penteli-menu.png) / [after](after-penteli-menu.png) · front [before](before-penteli-front.png) / [after](after-penteli-front.png) · road [before](before-penteli-road.png) / [after](after-penteli-road.png) · badge [before](before-penteli-badge.png) / [after](after-penteli-badge.png) · overview [before](before-penteli-overview.png) / [after](after-penteli-overview.png) · atlas [before](before-penteli-atlas.png) / [after](after-penteli-atlas.png) · signs [before](before-penteli-signs.png) / [after](after-penteli-signs.png)
- megara: menu [before](before-megara-menu.png) / [after](after-megara-menu.png) · front [before](before-megara-front.png) / [after](after-megara-front.png) · road [before](before-megara-road.png) / [after](after-megara-road.png) · badge [before](before-megara-badge.png) / [after](after-megara-badge.png) · overview [before](before-megara-overview.png) / [after](after-megara-overview.png) · atlas [before](before-megara-atlas.png) / [after](after-megara-atlas.png)

## Final integration and landing validation

Final tested source object: `2122bf600a10c59e6e4f116e994a4a04d40d5fd5`, parent `cd0e72a4e800a2dc7c4754ab8c9765ed98bd46fb`. The parent includes the later client-bundle/lazy-world changes; the fixed paired measurement remains `71e05c3` versus `98f616d` as authorized. No texture-source or map encoding changes landed between the measured pair and this parent. Runtime, build, tests and codec assets are byte-identical to the tested object; the landing adds only evidence records.

All six clean-archive gates passed (exit 0): npm test, physics (1,141/1,141), events, syntax, browser imports (242 modules), Wrangler staging **dry-run**. [Gate logs](gates-final/) include the interrupted dry-run's successful rerun. No deployment or push was performed. Largest prepared asset: `assets/_c/4837f6f0c9b2e7b1.gz`, 19,690,948 bytes, below 25 MiB.

Final-parent focused codec/bundle tests, real emitted-worker smoke, five-case texture/fallback browser suite, and all three map integration loads passed. [Final integration](final-integration/browser.json) has no page errors and asserts zero fresh-menu /data requests, ASR2 installation, lower total startup bodies than the fixed baseline for all three maps, and zero KTX/Basis requests on Megara. Final integration ran concurrently with CPU-heavy gates, so its first-frame samples (Riviera 39,981 ms, Penteli 13,342 ms, Megara 9,376 ms) are retained as integration diagnostics, not substituted into the fixed paired measurements.

Final screenshot review covered paint, road/terrain, overview, signs and badge atlas. [PNG hashes](final-visual-hashes.json) confirm identical UI-icon and Penteli sign sheets. The compressed badge stays sharp; source normal maps remain WebP. New-file Cloudflare wire transfer remains unmeasured; the per-texture table explicitly reports local negotiated bodies and gzip/Brotli alternatives.
