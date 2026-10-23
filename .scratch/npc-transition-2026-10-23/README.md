## Summary (for the reviewer)

NPCs now keep the legal road owner/layer and selected directional lane through junctions and structure portals. Passing uses measured adjacent lane centres. This report verifies source `079e89545891962a8ceb15919004dfefea97e86b`; it does not close the broader city-wide NPC issue or claim staging/production parity.

The three UI tracker items were already implemented; their independent verification/provenance is committed in `fdecae7d` and integrated by the parent as `2ce8359781c3a34b233b885687f9f18095dff36a`. No release-text correction remains necessary. Neither PROBLEMS.md nor CHANGELOG.md was edited here.

## Proof it works (required)

| Scenario | Before | After |
|---|---|---|
| Loumbarda tunnel, reverse/northbound approach | [Blocked at entry](baseline-loumbarda-npc.jpg) | [Inside layer -1](candidate-loumbarda-inside.jpg), [out on layer 0](candidate-loumbarda-npc.jpg) |
| Central Athens, measured 6.38158 m two-lane one-way road | [Blocked behind the parked player](baseline-actual-npc-passing.jpg) | [Passing in the adjacent legal lane](candidate-actual-npc-passing.jpg) |

All images are captures of our actual game. Playwright 1.64.0 / Chromium 156.0.8078.4, headless SwiftShader, 1280×800, low graphics, world detail enabled. Follow camera for the tunnel NPC; fixed overhead camera for passing. These are isolated source 079 captures, without the parent's later UI/terrain/car work. The blocky fleet appearance is under separate diagnosis; these images do not establish visual fidelity.

## How I tested it (required)

- **Tunnel:** same actual fleet Panda (3.538×1.578 m), same initial physical pose in both runs `(9105.4337205,19.8757880,18423.3417505)`. Baseline substitutes only the exact `a117ed94` traffic module; other local source is 079. Baseline remains blocked for 12 simulated seconds. Candidate runs actual `WorldTraffic.update()` at 240 Hz and crosses 0→-1 at second 2, then -1→0 at second 6, completing the outgoing edge switch by second 8. Every sampled NPC remains active; zero page errors. [Exact URL, setup and samples](transition-browser.json).
- **Passing:** same real parked Corolla pose `(-55.4488375,99.9380857,-81.1293355)`, same fleet Panda and actual asphalt/actors. Baseline traffic module `0c0f3cdb` starts at its old centre-divider position and remains blocked at offset 50.47527 after 20 seconds. Candidate starts in the corrected right lane, shifts -3.190791 m to the measured adjacent lane, passes by second 10 and reaches offset 159.29339 after 20 seconds. All 40 one-second samples stay active; zero page errors. [Exact URL, setup and samples](passing-browser.json).
- **Continuous safety / retreat:** actual emitted Loumbarda roads, barriers and obstacles, using runtime's `edgeId` safety contract. Both legal left→left portal curves pass 1,001 `advanceLane()` poses each and reverse retreat (464 and 500 50 ms `yieldBack()` steps). No safety tolerance or road geometry changed. [Results and world-set revision](loumbarda-fullcandidate-safety.json). This reverse-retreat check is an offline invocation of actual runtime methods, not a browser reverse-driving capture.
- **Baseline long drive only:** 180 seconds actual player physics driving from Syntagma into Exarcheia, then 60 seconds parked. Source a117ed94. 1,359.7748 m; max 2 non-signal-stopped cars; 0 clusters; max stop 8 s; 51 stopped-car-seconds; 0 cluster-seconds, car contacts, missing contacts, holds or page errors; final 8 active / 7 moving. Whole red queues are excluded by the existing verification protocol. [Drive image](before-syntagma-drive.jpg), [parked image](before-syntagma-parked.jpg), [complete samples](syntagma-baseline.json). This baseline does not exercise the fixed transition.
- **Clean exact-source gates:** all four required gates pass on a fresh `git archive 079e8954`: npm 301/301 files, 2,751 pass / 14 skipped / 0 failed / 0 flaky (2,765 total), 589.9 s; physics 1,323 pass / 0 failed; browser imports 373 modules; syntax 460 modules. Full traffic-flow suite 33 pass inside npm; online police/foci suite 11 pass.
- **Not tested / still open:** matching long Glyfada/Quick browser runs; elevated bridge browser driving; combined two-client online police visual proof; staging after integration. Broad routing failures are not closed by one successful tunnel or one baseline without clusters. New physical rider ejection/rendering and the observed fleet appearance are separate pending work.

## How to try it (2 minutes)

1. Serve the exact source and generated world assets. Tunnel run URL was `http://127.0.0.1:42819/?map=athens&spawn=9108,18350&simhook=1&car=corolla&cam=chase`; passing URL was `http://127.0.0.1:42135/?map=athens&spawn=-80,-90&simhook=1&car=corolla&cam=chase`. These temporary servers are closed; replace the port with yours.
2. The controlled tunnel scenario places one actual NPC at incoming edge `osm:way:25371522:0-1:f:17:35`, offset 8.7735485, in its left directional lane. It continues to `osm:way:25371523:0-0:f:17:35` (-1) and `osm:way:50825898:0-0:f:17:35` (0). The player stays at the native safe spawn `(9097.2366488,26.8258246,18359.7071391)`. Normal traffic decisions and movement remain enabled; only unrelated fleet spawning is suppressed for this isolated case.
3. Passing uses `osm:way:10976954:0-1:f:-1:-1`, offset 50, with the actual parked player at offset 57 in the right lane. The measured edges are left 3.1979625 m / right 3.1836201 m. Let the real traffic update run for 20 seconds; observe the pass in the left lane.

## Risk

- More directional turn candidates and the additional 0.2 m admission sweep cost work on a cold path-cache miss. Cached paths retain 21 knots. No density workaround, geometry change, safety relaxation or new visual assets were used for these fixes.
- Online API/dispatch is source-tested here; the loader owner owns transport, replica application, main wiring and combined online browser proof.
- Roll back the affected source stages listed below. No route/terrain data or schema migration was changed here.

## Checklist / proposed tracker text for the parent

Verified local fix: “NPC junction curves preserve the actual legal road owner and layer, retain a checked directional outgoing lane through lookahead and exit, and validate between stored curve knots. Passing uses measured adjacent lane centres.”

Keep the broad pathfinding item open. Twelve baseline approaches stopped at curve entry. At Mitropoleos and Stadiou, sampled candidate poses failed footprint contacts/building checks; those failures are **not proven source gaps**. Bounded alternate lane/shape tests are required before attributing any remaining defect to terrain. No tracker closure should imply current staging or production matches this local source/assets proxy.

<details>
<summary><b>How it was done (full detail)</b></summary>

### Root cause and approach

The old cubic inherited incoming `edgeId` while guessing a new layer at halfway. Runtime safety resolves the edge identity, so legal connected-layer contact could be interpreted as belonging to the old layer. The fix follows only the already legally joined road owners/layers and preserves complete knot metadata during forward travel and retreat.

Correct lane centres then exposed a separate planner failure: resetting every exit to the rightmost lane discards supported left→left routes. The final planner prefers the current directional lane index, tries only measured/tagged same-direction alternatives, retains all supported alternatives until lookahead and NPC exit occupancy select a route, and carries the selected physical shift through the edge switch. Unknown lane tags do not invent extra lanes. Directional counts and measured asymmetric widths determine the divider. Swept footprint, actors, legal graph successors and checked exit remain mandatory.

A provisional shorter-tangent curve passed only the old 21-knot check but failed denser checks. That experiment was discarded and never committed. The final fix retains the original curve shape and checks the actual interpolated runtime segments at bounded 0.2 m spacing. Actual 1,001-pose validation proves both selected Loumbarda left-lane curves; it does not prove all possible turns.

### Source stages

- `150c3c44`: legal per-sample transition identity and knot interpolation; source + real road-safety regression.
- `0c0f3cdb`: live legally connected contact-layer ownership; emitted simulator edgeId parity.
- `afcc37d9`: measured directional lane centres and passing; asymmetric/unequal-direction/narrow/blocked/oncoming/police regressions.
- `76dd7454`, `c26c5ad0`: retain checked outgoing lanes through movement/lookahead; bounded interpolation safety checks and viable-alternative regression.
- `d6511d3f`: optional pool sizes; defaults remain 24+5, online caller can request 66+8.
- `89a1dd00`, `209011d6`, `079e8954`: accepted per-driver foci, judge-only local heat, elected-authority NPC update/dispatch, own-target arrest semantics, snapshot siren/chase lights, fair patrol coverage and reset/reconnect tests. The loader owns all adapter/main/protocol edits.

### Files and tools

Codex gpt-6.1-sol implemented/reviewed this work using Cogenly terminal tools, Node, Playwright and Chromium. No additional agents spawned. `tools/browser-slot.sh` serialized Chrome; shared CPU/browser handoffs were explicit.

Source: `src/world-traffic.js`; regressions: `tools/world-traffic-flow.test.mjs`, `tools/world-traffic-online-police.test.mjs`; runtime-validation parity: `tools/world-traffic-sim.mjs`; registration: `tools/test-groups.json`. This directory contains only linked own-game proof and compact measurements.

### Exact checks

```text
# Fresh git archive of 079e89545891962a8ceb15919004dfefea97e86b
CHROME_BIN=/tmp/athens-ui-fixes.Nxho/browsers/chromium-1248/chrome-linux64/chrome ASR_TEST_JOBS=2 BROWSER_SLOTS=1 npm test
  301/301 files; 2765 tests; 2751 pass; 14 skipped; 0 fail; 0 flaky; 589.9s
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs
  1323 pass; 0 fail
node tools/check-browser-imports.mjs
  373 modules; pass
node tools/check-syntax.mjs
  460 JavaScript modules; pass
```

Negative controls: a117 fails the real road-safety transition regression; 150c fails the early/late physical-boundary regression; afcc fails both new lane-continuation and between-knot safety cases (0/2); 76dd fails the retained viable-alternative case (0/1). Focused current flows passed 23/23 before the full 33/33 suite; online foci passed 11/11. An earlier full-flow invocation was killed by its 10 s terminal deadline after 29 passes; the later complete npm archive run supersedes it. The first tunnel browser attempt stopped before capture because the chosen native spawn was in the next cell; retry in the target cell succeeded. It is not counted as a successful proof run.

### Capture provenance and limits

Browser commands were `CHROME_BIN=... BROWSER_SLOTS=1 bash tools/browser-slot.sh node /tmp/athens-ui-fixes.Nxho/transition-browser.mjs` and the corresponding `passing-browser.mjs`. The temporary server served this worktree's actual source and publishReleaseData-generated release HTML. Only the baseline phase intercepts the traffic module with exact saved `git show` bytes. Missing generated route/world assets were served through an authenticated read-only staging proxy/cache, world-set revision `80055f9208753e2d6fa8658b31c90216d22c650f7f33588ebd5178d1a6b804a1`. This is not a staging/production parity check. Source SHA and local URLs are retained per run in JSON. Simulation is controlled to isolate the NPC, but its actual road graph, contacts, actors, traffic update and rendering are used.

### Cleanup / disk

Both proof browsers and embedded servers are fully closed; the browser was explicitly handed to car. All gate terminals exited. One task temp directory remains while follow-up rider/appearance work and queued drives continue: `/tmp/athens-ui-fixes.Nxho` (clean archive, logs, one world cache, owned Chromium). `node_modules` (275 MB) remains intentionally available read-only to car/infrastructure until their checks finish. No other agent's files/processes were removed or signalled. Intermediate negative-control archive was replaced by the exact clean candidate. Task-start disk: 145 GB total / 58 GB used / 88 GB available (40%); pre-final-candidate check: 145 GB / 75 GB / 71 GB (52%). Final task cleanup/disk figures will follow when these dependencies are released.

</details>
