# Main menu redesign evidence

Code commits: `7414ef1` (redesign, account hook, environment identity, domain references), `0835168` (phone account visibility and content default focus), `30fd9df` (deployment smoke domains), `1c98a0a` (crop transparent hero padding). Shared `prod` was updated using a private index and commit-tree; the shared index and working files were not changed. No push or deployment was performed.

Before / after screenshots, personally inspected, are `before/menu-{1280,1920,390}.png` and `after/menu-{1280,1920,390}.png`. Viewports are 1280×800, 1920×1080 and 390×844. Low graphics / SwiftShader; no world or map active. The final phone account chip is visible. Automated checks assert no horizontal overflow at each width.

The new screen replaces five empty glass panels with a compact four-item menu. PLAY has a clear lime selection state. Multiplayer contains Join and Host. The feature image comes from our game's Carrera model, with Greek Riviera road furniture and a real catalogue-backed selected car / road strip. Garage and keyboard hints retain the existing input bindings.

## Boot measurements

These are source-mode loads from a local HTTP server mirroring the pinned Three.js CDN dependency, with the same browser/cache method as tools/lazy-boot-browser.mjs. Time-to-menu is the first title DOM state; transfer bytes include the document and loaded resources. The final image is decoded before counting bytes. Measurements isolate this menu change against `2109e25`; they do not benchmark the separate fleet or accounts changes committed concurrently.

| Metric | Before | Final after |
|---|---:|---:|
| Initial / final capture cold time | 886.2 ms | 13,900.2 ms |
| Initial / final capture warm time | 376.8 ms | 964.7 ms |
| Cold transfer | 4,231,518 B | 4,266,194 B |
| Warm transfer | 9,409 B | 9,259 B |
| Map-data requests / bytes | 0 / 0 | 0 / 0 |
| Worlds / geometries / game-renderer textures | 0 / 0 / 0 | 0 / 0 / 0 |

Cold transfer increases 34,676 B (0.82%). The hero itself is 28,456 B and 744×288 pixels: 857,088 B of decoded RGBA pixels, a pixel-budget estimate rather than a browser-process memory measurement. No car renderer, map world, geometry, WebGL texture or continuous animation is introduced at boot.

**Cold latency non-regression is NOT established.** The shared host had load average 51.95 on 8 CPUs. Three alternating before/after pairs produced cold medians 8,836.8 → 24,062.6 ms and warm medians 16,117.3 → 15,801.4 ms. Individual unchanged-before warm runs ranged from 10.49 to 22.45 seconds. These samples show scheduling noise and an observed cold slowdown; do not call this a passing latency gate. A quiet-host or controlled CI rerun is needed before claiming parity. All raw samples are retained in `paired-performance.json`; those pairs preceded the final transparent-padding crop (which removed 1,974 image bytes). The final capture is `after/report.json`.

## Navigation and build identity

`tools/menu-redesign.test.mjs` covers explicit environment identity, Wrangler commands, UP/W, DOWN/S, ENTER/SPACE, G and D-pad/A from a focused menu button. `tools/menu-capture.mjs` exercises default PLAY, the mode screen, list navigation, multiplayer Join/Host entry, Account/back, garage, DEV/STAGING/production identity, account visibility and overflow at all three widths. Final browser report: 14 checks passed, zero page errors.

Wrangler build commands explicitly set ASR_BUILD_ENV for staging and production. prepare-deploy injects `asr-environment` before bundling/content hashing. Only explicit production hides the badge; unknown packaged builds are staging; a source checkout is DEV. No hostname guessing. Version comes from existing `asr-version` release metadata.

Account integration is documented in HANDOFF.md. The accounts agent subsequently installed its real account screen through the route hook; the default-focus follow-up preserves that integration. The final code retains the concurrently added accounts files and Wrangler bindings.

## Honest visual assessment

Hierarchy, density, navigation and car identity are substantially improved. The remaining generic part is the abstract studio/coast backdrop. The car is a static, featured Carrera rather than the selected car or a live map cinematic. Its model has the game's existing geometry/detail limitations. The selected car is labelled separately and accurately. A real Riviera cinematic would add place and movement, but is not silently loaded at boot.

Design sources studied: the Forza Horizon 5 title/menu screenshots linked in HANDOFF.md, the NFS Unbound UI designer's garage portfolio, and the Gran Turismo 7 official manual. No reference-game artwork is shipped.

Gate results and frozen revisions are recorded in validation.json and the gates directories. The full required suite runs detached with exit-marker files. Follow-up menu checks run from a separate clean archive.

Validation outcome: all six required gates passed on the first clean archive (`7414ef1`). The final clean archive (`1c98a0a`) passed the 41-test focused suite (40 passed; the git-history audit correctly skipped without .git), the 426-case physics regression, events, syntax, browser imports and staging dry-run. Generated staging HTML contains `asr-environment=staging`, version `2026.10.15.3`, SHA `1c98a0a`; the packaged hero is 28,456 B.

To repeat comparisons, archive `2109e25` and the desired after revision into separate directories, make their dependencies available, and run `tools/browser-slot.sh node tools/menu-benchmark.mjs AFTER_ROOT OUT BEFORE_ROOT`. For screenshots / navigation use `tools/browser-slot.sh node tools/menu-capture.mjs AFTER_ROOT OUT`. The `guest=1` query isolates the menu from the separately owned account onboarding gate. This tool expects the repository's usual Playwright location or PLAYWRIGHT_MODULE.
