## Summary

Source candidate only: coastal limestone strata now repeat at3.2m (160cycles per512m cell), fissures converge to average coverage when unresolved, and existing fine noise adds restrained chips/pits (at most±6%). Palette, scrub pockets, classification and geometry are unchanged. **Not visually accepted yet:** actual-game matched captures, full GPU compilation and measured budgets await a coordinated browser grant.

## Proof it works

No new photos have been captured. The older Riviera static images are diagnostic references only. Their tan polygon and tower/stream-context defects are not attributed to this material change.

## How I tested it

- Own source focused tests:33passed/0failed across material, detail and coastal-dressing tests.
- Combined focused fixture using read-only current-master dependencies and only this owned material candidate:34passed/0failed. This retains the newer ground/noise/Off implementation without editing or committing those files.
- Negative controls restore the actual old2.1rad/m phase or the old unfiltered fissure expression using test-only module-loader transforms: each selected regression fails its intended assertion (seam discontinuity1; unresolved phase variation1).
- Material tests execute the scalar GLSL emitted by the real material, sweep1024 border phases and independently supersample4096 phases for unresolved coverage. All three complete Three Basic shader sources are expanded, and Off removes all limestone code/uniforms. This is source validation, **not a claim of GPU compilation**.
- Syntax checks pass for the material and new browser harness. No browser, GPU job, full suite, archive, download or new asset was launched.

## How to try it

After parent integration and a browser grant, use the new actual-game harness twice with fresh before/after source commits, identical pinned world/cases, and explicit Low/High runs. Inspect a verified coastal limestone face near stations500/9000, at a cell boundary and near/far distances; compare detail On/Off and resource counts. Old photos must not serve as an after frame.

## Risk and rollback

- Subtle grain and fissure appearance still need visual review; hard projection-axis transitions remain outside scope.
- Rollback this limestone material/test/harness commit. No saved data, wire format, physical surface, palette, source recipe, tree placement, contact or mesh changes.

<details>
<summary>How it was done</summary>

Codex gpt-6.1-sol authored the change and checks using Node/Three and the Cogenly terminal. No other model or third-party asset contribution is claimed.

Files: `src/athens-materials.js` changes only the limestone snippet and its three shared program-key versions; `tools/athens-materials.test.mjs` adds seam, aliasing and full-source/budget/Off regressions; `tools/terrain-material.browser.mjs` prepares the future exact-source, pinned-world actual-game check. This README records source-only status.

Baseline audited master:26e05b244b411d791ba89083b21d91c2c961eeca. Original material SHA256:8c3dda11d4e1a3e774cc52ea3eacde288fc5b2f20432530b34770ae485ee0245. The original formula has a44.42degree phase mismatch per512m; its narrow fissures also select different coverage under subpixel movement.

Commands executed:
```sh
node --import ./tools/damage-test-register.mjs --test tools/athens-materials.test.mjs tools/athens-detail.test.mjs tools/coastal-dressing.test.mjs
#33/33 pass; own branch dependencies
node --import /tmp/athens-terrain-material.sBHJ/integrated.mjs --import ./tools/damage-test-register.mjs --test tools/athens-materials.test.mjs /home/dev/.cogenly/worktrees/athens-racing/t3-41c48689/tools/athens-detail.test.mjs /home/dev/.cogenly/worktrees/athens-racing/t3-41c48689/tools/coastal-dressing.test.mjs
#34/34 pass; exact parent dependency paths except owned material candidate
ASR_TERRAIN_NEGATIVE=period node --import /tmp/athens-terrain-material.sBHJ/negative.mjs --import ./tools/damage-test-register.mjs --test --test-name-pattern='continuous across 512m' tools/athens-materials.test.mjs
#expected exit1,1failed assertion: visible fissure discontinuity1
ASR_TERRAIN_NEGATIVE=alias node --import /tmp/athens-terrain-material.sBHJ/negative.mjs --import ./tools/damage-test-register.mjs --test --test-name-pattern='unresolved limestone' tools/athens-materials.test.mjs
#expected exit1,1failed assertion: unresolved camera-phase variation1
node --check src/athens-materials.js
node --check tools/terrain-material.browser.mjs
```

Source resource accounting: same four limestone lookups; generic ground remains six. No texture/uniform/material/geometry/draw/pass additions. Existing256RGBA mip-noise allocation remains349525B. Limestone GLSL adds617ASCII source bytes with identical includes; shader keys change once to v2, independent of time/camera/wear. These are structural counts, not measured GPU performance.

The proof harness requires explicit TERRAIN_ROOT, TERRAIN_COMMIT, TERRAIN_TEMP, TERRAIN_OUT, TERRAIN_PHASE, TERRAIN_MANIFEST_SHA256, TERRAIN_WORLD_REVISION, TERRAIN_CASES, TERRAIN_PROXY_HELPER and PLAYWRIGHT_EXECUTABLE_PATH. It verifies every JS runtime file/index against pinned Git objects before startup, checks the world manifest hash/revision, uses unchanged production source and public native camera/step/render hooks, performs packet-triangle material picks, captures render+JPEG together and checks full GPU shader diagnostics. After requires a completed fresh baseline and identical case/world/admitted-cell/camera/resource/draw identities. CPU picks exclude separate instanced vegetation, so selected visible terrain must also be inspected in the new images. Three synchronized frame samples are descriptive only. A hard deadline is capped at300seconds per invocation. No source substitutions are installed by the browser harness.

One owned task temp: `/tmp/athens-terrain-material.sBHJ`, containing focused logs and test-only loaders, retained for the queued proof. Own node_modules is a read-only symlink to the existing shared dependency target. No download/install/cache/archive created. Disk before:145G total/70G used/75G free49%. Final cleanup/df follow browser work.

Proposed parent documentation entry, only after visual acceptance: “Coastal limestone uses continuous tile-scale strata and filtered fissures with restrained aggregate detail, reusing the existing noise texture.” Reserved PROBLEMS/CHANGELOG files were not edited.

</details>
