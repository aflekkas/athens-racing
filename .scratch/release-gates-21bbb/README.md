# Exact candidate code gates

The clean `21bbb592d4f3f957073354575706e1b82b7bfce0` candidate passes all four required gates and full terrain mode. This is a code-verification milestone. Combined world, multiplayer, cold-load and release acceptance remain open.

## Results

| Check | Result |
|---|---|
| npm test | 338/338 files; 3,779 passed, 28 skipped, 0 failed, 0 isolated retries |
| Full unsharded physics | 1,323 passed, 0 failed |
| Browser imports | 369 modules passed |
| Syntax | 481 modules passed |
| Full terrain mode | 4/4 passed, 0 skipped; 6,880,558 samples |
| Managed-default garage browser guard | 7/7 passed, 0 skipped |

Terrain scans cover Riviera, Megara, Penteli and Psychiko through the unchanged `getPlayableMaps()` list. They retain the 5 mm above-road, 150 mm shoulder-step and tan(30 degrees) slope limits. They do not prove streamed-world admission, the new Kifissia/Ekali routes, field adoption, physical fidelity or online safety.

## How I tested it

A single full Git archive contained 8,781 tracked files / 855,457,301 bytes. Every extracted blob, size and mode was verified. Commands ran sequentially from that archive; no test/map selectors, external retries or assertion changes were used.

```text
npm test
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs
node tools/check-browser-imports.mjs
node tools/check-syntax.mjs
ASR_TEST_FULL=1 node --test tools/road-terrain-level.test.mjs
```

Each command used `env -i PATH=/usr/bin:/bin`. The first four also used the explicit verified full-Chrome `CHROME_BIN` and `PLAYWRIGHT_BROWSERS_PATH` recorded in receipt.json; only npm received `ASR_TEST_JOBS=2`. Terrain received only PATH and ASR_TEST_FULL. The separate garage check used PATH and PLAYWRIGHT_BROWSERS_PATH with **no CHROME_BIN or channel override**, exercising Playwright 1.64.0's managed headless-shell default. All 287 files of that installation were hashed before launch; its executable path was observed. No browser.version() call was made, so package version metadata is not presented as a runtime query.

The initial `99a7e953` run stopped after its hardcoded missing Chromium 1234 prerequisite failed. Its partial result and logs remain failed. The corrected guard uses Playwright's managed default, preserving an explicit CHROME_BIN. Both the explicit-full-Chrome and managed-default checks pass.

All observed owned processes, browser slots and queues closed. Root independently rehashed all 8,781 tracked archive files after the four gates, and all 1,126 selected garage files after its browser check. The terrain run rechecked its 16 source pins. Logs were hashed only after EOF and process closure.

## Proof and limits

This record contains no new gameplay capture. Existing own-game UI images in [the scoped UI proof](../driving-help-v24/README.md) retain their historical labels; they are not evidence of current-root cold-load, terrain or multiplayer acceptance. The later material baseline failed on an aborted cell 8,38 request before saving any image; its cause remains unknown.

The compact [receipt](receipt.json) binds original logs, manifests, resources and cleanup receipts by exact SHA256 and path. No raw world bodies or duplicate archives are committed. All five tests passed before the full archive was removed; 883,490,816 allocated bytes were freed. Disk moved from 54% to 53% during that cleanup. The remaining small logs, manifests and receipts stay in their owner's task directory for combined review. Sampled RSS is not an absolute peak or capacity proof.

## Risk and rollback

This evidence-only change adds no runtime behavior. Revert it to remove the proof record. Subsequent code or world changes require their own exact-candidate verification. Nothing was deployed or enabled online.

<details>
<summary>How it was done</summary>

Codex gpt-6.1-sol implemented the one-option garage portability repair, ran the visible Cogenly clean-archive/native checks and independently verified hashes and closure. Node, Playwright 1.64.0 and the existing repository browser-slot workflow supplied the actual tests. No generated or third-party media was added.

Files: this README explains scope and reproduction; receipt.json records exact counts and source/artifact hashes; docs/PROBLEMS.md moves the narrowly verified garage portability repair to Fixed and records the code-gate milestone without closing combined release items.

</details>
