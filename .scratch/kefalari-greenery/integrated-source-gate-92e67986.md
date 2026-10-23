# Integrated source checkpoint gate: failed

Frozen commit `92e6798668c11a45a077ccb767b97023dffbfae5`, tree `2759dcb8ff513637117ecd16f66aa107375a3332`.

All four required commands ran sequentially on a fresh clean archive, with two npm workers. This is a source checkpoint; it does not validate the final published world or authorize release.

| Gate | Result |
|---|---|
| `npm test` | FAIL: 317 files, 2997 tests; 2978 pass, 12 fail, 7 skip; 9 files fail again alone, 0 flaky |
| `node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs` | PASS: 1323, 0 fail |
| `node tools/check-browser-imports.mjs` | PASS: 364 modules |
| `node tools/check-syntax.mjs` | PASS: 475 modules |

The mandatory garage browser guard passes 7/7. Its browser and server close in `finally` before the test file passes. Car received the explicit CLOSED handoff.

## Failed files

- `tools/pov-owner-lock.test.mjs`: POV evidence binding is stale: generated old cars hash `2978c18c` versus current `8ef657c5`.
- `tools/vehicle-budgets.test.mjs`: Retired-driver source regex matches substring in multiplayer.driverProgress.
- `tools/tow-road-placement.test.mjs`: Four extracted tow harness tests reference undefined worldSession.
- `tools/bundle-browser.test.mjs`: Production graph assertion expects src/maps/riviera.js lazy entry.
- `tools/low-end-budget.test.mjs`: Real low-end traffic density regression, confirmed by parent and loader from frozen main.js and WorldTraffic; separate fix owned by parent.
- `tools/owner-locked-desktop-only.test.mjs`: Entry dynamic imports now include route-entry-prefetch.js before main.js.
- `tools/police-online.test.mjs`: Source assertion expects pursuit telemetry in main.js.
- `tools/race-lifecycle.test.mjs`: Extracted raceGap harness references undefined multiplayer.
- `tools/remote-sync-sim.test.mjs`: Extracted contact harness declares holdingRecovery twice.

All failures were reported to the parent during the run. The frozen archive was not patched. The complete run uses the exact environment, command exit codes, durations and dependency receipt in [the JSON receipt](integrated-source-gate-92e67986.json). Shared Linux dependency versions/integrities match all 44 applicable lock entries; 51 unsupported optional platform entries are correctly absent. Python/Chromium paths were explicit.

Logs remain in `/tmp/athens-greenery.98Rc/integrated-{npm,physics,imports,syntax}.log`; the npm log includes complete first failures and isolated retry failures. After parent and loader completed inspection, only our owned 830 MiB frozen archive was removed. All four exact logs, reduced receipts, dependencies and source caches remain. This receipt commit is based on own `7233d9d4`; no runtime source, shared dependency or other task files were modified. CPU FULLEND and no-owned-process status were sent to parent and terrain. Disk before and after: 70G used / 75G available / 49%.

Implementation and gate orchestration: Codex gpt-6.1-sol. No new subagents, pushes, deployment or production claims.

Parent followup classification: one real low-end density regression, seven stale fixtures, and one POV evidence-binding failure. Parent accepted a separate full 77-render/231-pixel-check identical POV proof (generated old hash `2978c18c` → current `8ef657c5`). That followup does not change this frozen checkpoint verdict; no additional browser or full gate ran here.

Disk after archive cleanup:

```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1       145G   69G   76G  48% /
```
