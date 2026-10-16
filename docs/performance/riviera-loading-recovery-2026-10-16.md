# Riviera slow-network loading and recovery

This follow-up fixes a failure left by `e72722c`, rather than treating its fast
network result as resolution. The player's screenshot of `DOWNLOAD UNAVAILABLE ·
GENERATING TERRAIN + ROADS`, 25%, and 78 seconds proves that release's automatic
generation fallback ran. Authentication is outside this change.

The screenshot alone does not identify the player's exact `downloadError` or
browser capabilities. The timeout was reproduced independently below; unsupported
decompression, network and storage failures also receive explicit handling. The
old 25% was a main.js milestone before `buildMapWorld` awaited the buffer load,
not a measured download percentage. No claim of resolution on the player's
unidentified device follows from the VPS measurements.

## Measured causes

The deployed loader imposed an absolute 45-second deadline on 35,902,203 bytes
of compressed Riviera data. Below about 6.4 Mbps, that budget cannot finish even
without request overhead. The old service worker awaited `cache.put(response.clone())`
before returning the response, hiding chunk progress until the whole body arrived.
A storage write failure also fell through to another network fetch.

Native-browser reproduction used the exact emitted Riviera gzip streams and
the old loader/service worker, throttled to about 5 Mbps aggregate. At 45.003
seconds the loader reported `World download timed out`, zero visible downloaded
bytes, and attempted worker generation while the original requests still transferred.
Those server transfers finished at approximately 52 and 64 seconds. The probe
deliberately stopped that generation attempt rather than spending another minute
regenerating data whose unchanged worker cost was already measured at 65.56 seconds.
The pre-cancellation raw browser result was lost with its browser/tool session;
these retained measurements are distinguished from the new attached raw evidence.

A real live-CDN Range probe against the terrain gzip returned HTTP 200 and the
full 16,130,864-byte response for `bytes=100000-100099`, not a 206 partial response.
Recovery therefore cannot depend on CDN Range support. This is a loader deadline
and response-streaming defect, not evidence of a stale release or proxy HTTP 403.

## Change

- Stream service-worker responses at headers; keep cache writes optional and
  asynchronous. Blocked reads are bounded; storage/quota errors never repeat a
  successful fetch. Explicit reload bypasses a corrupt cached response.
- Replace the absolute deadline with a 30-second idle watchdog, reset by actual
  headers/bytes. Keep receiving useful data at any transfer speed. Network/offline,
  HTTP, invalid-data and generation errors have distinct structured codes.
- Emit exact compressed bytes, known total, source and real decode/generation
  phases. Pause recoverably on network failure with one-shot retry or explicit
  device-generation choices. A network failure never automatically generates.
- Package the exact gzip byte stream into independently cached parts up to 1 MiB,
  with byte counts and SHA-256 digests. Three interleaved request lanes retain
  verified completed parts and partial bodies. Resume with Range where supported;
  safely skip a repeated prefix on HTTP 200. Thus replay is bounded to unfinished
  small parts. CRC/length validation also protects the non-native gzip decoder.
- Bound optional generated-cache open/read, reject and evict malformed cached
  packs, and retain valid warm cache behavior. Worker fallback emits actual map,
  terrain, roads and buffer stages; generators and the existing watchdog remain.

Terrain, road, scenery, collision and physics builders are unchanged. This does
not remove geometry, alter material/shader choices, lower detail, or change the
roundabout/airborne fixes. Packaging splits bytes, without recompression or a new
geometry encoding. The loader accepts older single-file and multipart manifests.

The UI contract is documented in [world-loading-contract.md](world-loading-contract.md).
Opus owns UI commits `6ada01e` and `6dc6452`; only the third-argument forwarding
hook in `main.js` belongs to this implementation.

## Browser evidence

All browser work used the native T3 preview, one active world at a time, in an
incognito profile. Server fixtures deliberately ignore Range like the measured
CDN. The full existing gzip streams decode to 151,809,686 geometry bytes.

- Continuous slow-transfer probe: 60.586 seconds to validated buffers at about
  5 Mbps, with 27,436,621 bytes still actively retained at 45.126 seconds and zero
  worker starts. Before-cancellation raw output is unavailable; the subsequent
  full-game check repeats this transfer constraint and records durable evidence.
- Interrupted-transfer probe: injected socket reset in roads part 4 at 16.334
  seconds paused with 9,937,176 bytes retained and zero worker starts. Retry of
  the original promise completed in another 44.462 seconds. Final unique bytes
  35,902,203; received bytes including replay 36,402,195; exact geometry restored.
  Nine completed files were fetched once. Only three partial files were requested
  again, each with `Range: bytes=166664-`; HTTP 200 replayed 499,992 bytes total.
  The cache's independent response clone finished two already-running requests
  while paused; there was no new fallback or whole-map restart.

The combined full-game test overlays Opus `6dc6452` in a scratch build, with no
UI source edits in this branch. Its real loading screenshot was inspected, then
cropped only to remove the local fixture's offline-account banner for the release
picture. The screenshot shows real bytes (MiB rendered as MB) and the four steps.
The captured full-game and retry histories, metrics and server request logs are
in [the raw evidence](riviera-loading-recovery-2026-10-16.json).

Combined full-game cold result: validated buffers in 61.556 seconds; event/map
setup complete 83.867 seconds after selecting free roam. No generation workers,
no captured JavaScript errors, all 35 gzip parts requested exactly once. The UI
showed 10.9 / 34.2 MB during the inspected download capture. One unrelated fixture
request for `/release.json` was 404 because this scratch bundler fixture does not
run release-data stamping; all terrain/road assets succeeded. Real deployed
release identity was previously verified through `/release.json`, not `/version.json`.

Ordinary rendering was allowed until two actual `frame` callbacks issued world
draw calls, then only recurring game-frame callbacks were suppressed to bound
the software GPU cost. Nothing suppressed rendering before those two frames.
The first callback returned at 92.156 seconds from event selection (5.954 seconds
inside that callback, 235 draw calls). The next returned at 125.666 seconds
(0.678 seconds in JavaScript, 357 draw calls). An inspected cockpit screenshot
shows the real coast road, terrain, car, sea and HUD. The long gap includes
SwiftShader execution/driver scheduling and shared VPS load; neither those
numbers nor a menu FPS readout establish desktop performance. GPU reported
ANGLE/Vulkan SwiftShader Device Subzero; automatic performance class was low,
1280×800 viewport with pixel ratio 0.8, unchanged hard-wired graphics look.

Warm result on the same combined origin: 35 gzip entries present in content
cache; server gzip request count stayed at 35 before and after the reload.
Buffers validated in 8.362 seconds with zero worker starts. The warm test loaded
the map into the menu (no race rendering) and retained the full 151,809,686 bytes.
This measures this constrained VPS/cache path; the earlier 1.095-second generated
cache result is a different source and is not substituted for this measurement.

## Validation

Focused checks: 25 passing transport, loader, generated-cache and service-worker
tests cover >45-second useful progress, idle timeout/retry, dropped body with
206 and ignored-200 ranges, completed-body EOF recovery, per-part corruption,
non-native/exposed-but-unsupported gzip, explicit generation, corrupt generated
cache, blocked storage, streaming before cache completion and quota failure.
Three existing pack-compatibility checks and all 13 notes/detail budget guards
also pass. The unchanged detail guard's source hashes pass without adjusting
budgets or tolerances.

The clean committed archive `/tmp/athens-loading-eea9cff.KxXS39` tested exact
implementation `eea9cffddcf2060da93c64b06946a4c875a2a0dd`. Retained results:

| Check | Result | Log in `.scratch/loading-p0/` |
| --- | --- | --- |
| `npm test`: unit | 1,067 pass, 2 existing skips, exit 0 | `archive-npm-test.log` |
| `npm test`: damage | 56 pass, exit 0 | `archive-npm-test.log` |
| `npm test`: physics | 232 pass, exit 0 | `archive-npm-test.log` |
| `npm test`: world / overall | **Incomplete after task cancellation.** Last reported subtest 23 passed; no failure, world summary or overall exit status recorded. | `archive-npm-test.log` |
| Separate physics regression | 1,146 pass, 0 fail, exit 0 | `physics-regress.log`, `physics-regress.exit` |
| Events | 11 pass, 0 fail | `events.log` |
| Ghost lap | 10 pass, 0 fail | `ghost.log` |
| Syntax | 325 modules checked | `archive-syntax.log` |
| Browser imports | 260 modules checked | `archive-imports.log` |
| Focused recovery/cache tests | 25 pass | `focused-tests.log` |
| Existing pack compatibility | 3 pass | `pack-compat-tests.log` |
| Release notes / detail budget | 13 pass | `notes-detail-tests.log` |

Logs are retained under the implementation worktree
`/home/dev/.t3/worktrees/paraliaki-racing/t3-11ef0eb0/`. The world log includes
the passing complete Riviera generated/baked attribute, index and wheel-surface
equality check. It does not establish completion of all remaining world tests.
No branch-independent failure was recorded in this archive run. No gates were
weakened, and the unfinished overall gate is not green. No heavy checks were
restarted after cancellation; no owned test/server processes remained at handoff.

Both live domains were rechecked through native-browser `/release.json` and
still reported `e72722c`, build `7b2e125491b6`, version `2026.10.15.3`.
This follow-up implementation was not deployed.

Independent integration review of `eea9cff` plus the Opus UI identified two
follow-up gaps: cancelling response bodies rejected at header validation, and
clearing the UI's determinate download state during inflate. The reviewer owns
those fixes in its isolated integration tree. They are not silently claimed as
fixed or validated by this implementation's retained results.

Integration requires both this transport commit and the Opus UI commits above:
the previous UI cannot display the new recovery actions. The combined scratch
build tested their nonoverlapping main.js changes together. This branch contains
the new release picture and note; it does not copy Opus UI source into its commit.

No deploy, push, credentials, auth changes or production-ref movement were made
by this implementation task. Local browser evidence cannot establish the user's
unknown device performance or certify an as-yet unintegrated production release.
