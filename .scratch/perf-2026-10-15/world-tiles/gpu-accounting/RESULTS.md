# Shared GPU allocation accounting — 2026-10-15

Inactive AWT runtime follow-up to `7ede673`, measured against `8940394`. No game import, flag default, map geometry, transfer or visible-world behavior changes.

Two draws sharing one position table and index table previously created separate index BufferAttributes. Quantized terrain additionally recreated its position wrapper for each draw. WebGL uploads by BufferAttribute identity, while the worker formerly counted only typed-array identities: the residency cap understated GPU allocations. The scene now shares matching wrappers and indices; the worker counts the same array/itemSize/normalization/terrain-decode/index-role identities.

| Two-draw fixture | Before actual allocation identities / bytes | After actual identities / bytes | After worker-accounted GPU bytes |
| --- | ---: | ---: | ---: |
| Float32 positions | 3 / 72 | 2 / 60 | 60 |
| Uint16 terrain + Float32 residual | 5 / 88 | 3 / 52 | 52 |

These are deterministic Three.js BufferAttribute allocation identities and typed-array byte lengths, not GPU timing or whole-map memory claims. Both adapters release all shared materials after disposal. The regression test covers both layouts through the real compressed-pack decoder and scene adapter, including distinct terrain decodes that require separate GPU bindings despite sharing source bytes. Final focused suite: 22 passed, zero failures (`focused.log`). `identities.json` records the comparison.

## Rejected upload experiment

GPU staging and shader warm-up remain outside this commit. A separate experimental browser fixture ran 80 teleports beyond 30 km with zero missing contacts, zero decode failures and zero retained geometry/material/texture allocations after disposal, but its instrumented run found an 87.2 ms activation step (86.4 ms inside the first WebGL upload/draw, program count unchanged at 2). Software Chromium reports no KHR_parallel_shader_compile support. This fails the requested 50 ms activation gate; no production streaming/default or milestone acceptance is claimed. The experiment remains in `/tmp/athens-tiles-impl`, with diagnostics in `/tmp/athens-tiles-upload-browser-evidence`.

Existing-map conversion is still experimental. Penteli has one strict contact-seam mismatch; generated Athens has no playable manifest yet. Preserving the shared terrain texture/material look restored in `8940394`, cold/warm controllable-car measurements and the real 20-minute physics/browser stress gate remain outstanding.

Staging dry-run asset inventory: 1,347 physical files, 187,988,371 bytes total; largest file `_c/b7fd1a84944b2cd0.gz` is 19,689,626 bytes, below 25 MiB. This is the complete current deployment inventory, not a projected Athens tile count. See `deploy-inventory.json`.

All six required gates passed (exit 0): full `npm test`, physics regression (1,141 passed / 0 failed), events, syntax, browser imports and staging deployment dry run. Final adapter/worker focused checks passed again after the shader experiment was removed (22 passed). Compressed full logs and `gates.json` are adjacent.
