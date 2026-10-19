# Athens Racing — to-do list

This is the lead's single list of open work. It's updated as tasks are assigned, finish or get blocked. `[ ]` open · `[~]` in progress (owner) · `[x]` done (SHA) · `[?]` waiting on the owner (Alexandros).

Last updated: 2026-10-18 20:40 UTC.

## In flight (lead thread "Fix Floor Visibility in All Cars", check-up every 30 min)
Production is on hold (`~/.local/state/athens-release/production-hold`). Staging live at `ebc92001` (train, 2026-10-19 02:03 UTC); `9ae9d1ad` in gates. Agents use Haiku/Sonnet only (Codex quota ran out; no Opus).

Done and checked by the lead:
- [x] Leaderboards inside Quick Race (`5149f16d`, `9a7c06ca`, `c9619d55`)
- [x] Cabin floors sealed; interiors through light glass; batched (`b99589d5`, `e3ad08f9`)
- [x] Remove music (`893686df`, `a455d6c1`, `64f8d528`)
- [x] Hover/outline removal (`d0a1e153`…`e1483668`). Owner later asked for a subtle hover back (in progress, below)
- [x] Settings sidebar (`582e3e3b`)
- [x] Dialog blur (`030afed1`, `21f6e0e2`, `467c6ea7`)
- [x] Google sign-in required (`248a6837`…`e4b4864d`). Production has no GOOGLE_CLIENT_ID/SECRET yet; waiting on the owner (consent screen)
- [x] Title cleanup (`91bb033d`), simple header and no clock (`bd8ff407`)
- [x] Lucide icons (`5ed5152d`, `ea499482`)
- [x] Garage cards/filters/viewer (`fdedb0f5`); Ducato dashboard (`ab85a17e`)
- [x] Mobile playable; bodyless-car fix (`c222bc29`, `8f16ab59`); solo HUD MULTIPLAYER button removed (`854ba390`)
- [x] Multiplayer lobby browser and solo RACE (`74611cfc`); full-page track map (`20fa3196`, `7d6e589f`)
- [x] Credits and What's New as full-page articles (`8a5117e2`, `a220b106`)
- [x] Release-PR versioning written (`accfaef6`, not on prod yet). Lead does the cutover after this batch

Also done since 2026-10-18 04:00 (checked by the lead):
- [x] Subtle pointer hover (`56ab1c46`); layout templates finished with a guard (`dbb85c2a`)
- [x] Cockpit pillars, wrong-way pitch, ground patch (`7938f245`); windscreen view won back (`41e4e0f5`); thin header band on closed cars (`2477f047`, report pending)
- [x] Smoke sign-in key (`6a3c70d3`); SMOKE_TOKEN installed on staging and production; train exports it
- [x] Add-to-home-screen card + 404 fix (`85d2a087`, `06dc8fb9`); track map perf (`7014e69a`, `6ef60940`)
- [x] No checkpoints (`c5ed9d83`); new Psychiko route (`a5fb7d19`); clean free roam (`fb42cca7`)
- [x] Flaky world-detail timing test made robust (`449dba78`); train timer gets OnCalendar */10; staging live at `449dba78`
- [x] Lead playbook (`752f212f`); AGENTS.md PID rule (`b91e761c`); 2.8 GB of old .scratch deleted

- [x] Tow/reset onto the nearest road (`6c2d6c13`, `2d0ff81d`); one frame limiter, NO LIMIT honoured (`30ebd588`)
- [x] Fast releases: parallel gates, bake cache, same-tree memory, flaky retry (`02c6e212`); train every 2 min
- [x] Staging multiplayer black screen / reconnect loop / retire cursor (`9720683c`); owner to retest with two players

- [x] Multiplayer extras: tyre smoke online, sign-out shows sign-in gate, stuck LOADING self-heals, CHANGE CAR / TRIM (`c56a1522`)
- [x] Megara tow stays on the car's own leg; every map's finish tested (`b9a4bcd3`)
- [x] Auto gearbox no longer drops to 1st at speed on a slide/handbrake (`47d28899`, `90e7305a`)
- [x] Seat lettering, A-Class star, lower door mirrors (`9a753c93`)

- [x] Porsche 911 front/tail rework (`4b5ed440`)
- [x] Engine sounds: flat-six for the 911, V12 for the Aventador/SL 65, own turbo-four takes for hot, mainstream and small cars (no recording shared by more than 13 cars)
- [x] Exhaust-pop first-pop freeze: one permanent flash light + flame pipeline warm-up (`10aad92c`)
- [x] Athens: connected coast stage 2 + OSM road cross-sections, rebaked, 47.9 MB in R2 staging (`b631ef8c`, `b3591cc0`); screenshots being re-made; next area waits on the lead's review

- [x] Handling: no more ploughing into corners (`9e3555f0`); rivals keep off the edge so the gate is green again (`ebc92001`)
- [x] Engine sounds: flat-six 911, V12 Aventador/SL 65, separate turbo-four takes (`634824e4`); SL rear lettering fixed (`9a753c93`); 911 lamps flush (`a30c4e01`)
- [x] Look back on V, racing-wheel support, mouse no longer pans the camera by itself (`9ae9d1ad`, final report pending)

Running (Sonnet; Enterprise unless noted):
- [~] Low-end laptop performance + audio dropouts/ticking (Personal)
- [~] Driving: final report after the 9ae9d1ad gate (Personal)
- [~] Cars: 911 silhouette pass (roofline, haunches, nose) + GLA mirror joint (Personal)
- [~] Athens: re-made road screenshots (paused by rate limit)
- [~] Release cutover (lead): after the batch is checked on staging

Waiting on the owner:
- [?] Google consent screen published, then the lead installs the production Google secrets

## Release and infrastructure
- [x] Automatic release train on the VPS: tests, pushes and deploys staging then production every 10 min (`023bb4e`).
- [x] Production live at athensracing.com with `bf99234` (menu redesign, accounts code, every vehicle, dash and badges, beach fix).
- [~] Next train round: hero fix, flat UI, release photos, HUD-motion Full default, render fixes.
- [ ] GitHub Actions deploy (optional): needs a `CLOUDFLARE_API_TOKEN` repo secret. The train switches to push-only automatically once it exists.
- [x] Fast release path: gates run in parallel, per-map bake cache, same-tree gate memory, one-shot flaky-file retry, prebuilt bundle deploys (`tools/release-fast.mjs`, `deploy/README.md` "Fast release path"). Cut `deploy/release-fast-newflow.patch` into `deploy/athens-release-train.sh` when `accfaef6` lands.
- [ ] Release-speed follow-ups: nightly check that a cached bake equals a fresh bake; split the Riviera half of `tools/world-tests.test.mjs` further; Actions CI could reuse `tools/release-fast.mjs gates`.

## Accounts (Google sign-in only)
- [x] Accounts, friends, presence and invites; Google only; the gate turns on only when configured (`d134110`…`b585492`).
- [x] Google OAuth client created; staging secrets installed (GOOGLE_CLIENT_ID/SECRET, SESSION_SECRET).
- [?] Owner: sign in with Google on staging.athensracing.com and confirm the name/plate step works.
- [?] Owner: publish the Google consent screen ("In production"), using the privacy and terms URLs below.
- [ ] Install production secrets (separate SESSION_SECRET) once the two items above are done, then verify the live sign-in.
- [x] www.athensracing.com → athensracing.com 301 redirect (`6072314`).
- [x] Live https://athensracing.com/privacy and /terms (`6072314`, `694a9cf`).
- [?] Owner: add the privacy/terms URLs to the Google consent screen and publish the app.

## UI
- [x] Title menu redesign: compact list, live car hero matching the selected car and paint, staging badge (`7414ef1`…`533c53b`).
- [x] Flat head-unit kit: blue-glow removal, base and menu screens (`bc69c8b`, `9b5760d`).
- [x] Redesign round 1: Garage with car thumbnails, Race setup, Video settings (`ae24114`).
- [?] Owner: approve round 1 (lead's notes: smaller garage header, drop the road sign from settings, use the sign only on title and setup), then roll out to every screen (Sol).
- [x] Release photos in the changelog / What's new (`e520f68`, `7712db9`, `92e545a`). Rule: every visible change adds a picture.
- [x] Renamed to "Athens Racing" everywhere player-facing; Worker names and storage keys stay (`272efb8`).

## Driving and cars
- [x] Front-slip steering assist: gamepad overshoot past peak grip removed (173/180 frames → 0) (`c45aa28`).
- [?] Keyboard turn-in is barely changed and the scripted Megara lap is unchanged. Owner: which car and input did you use on Megara? Then a second, stronger pass.
- [x] Lamborghini Aventador SVJ: V12/ISR, own body and cockpit, pops and bangs sound, exhaust-pops toggle (`56b2c91`).
- [x] SVJ flames v2: directional jets, sparks, crisp red tail lights (`b60b589`).
- [?] Owner: should the upshift bangs be bigger and longer, plus fireballs on high-rpm lift-off?
- [x] HUD motion (POV sway) defaults to Full (`1397702`).
- [~] Bus/heavy-fleet suspension "insanely messed up": reproduce, physical fix, stability tests (Sol).
- [~] Optimal cockpit eye point for every vehicle (sits too low in many), plus a seat height/position setting (Astra).
- [x] Every vehicle model drivable, 30 entries / 69 configs (`4ad85ea`, `ac46091`, `e4a6dc7`).
- [x] More trims, 18 cars / 55 trims; ride-height fix (`6ca36ee`).
- [x] Powertrain realism, gearbox behaviour, sound signals (`5e782b3`, `0bb4d99`, `61ae851`).
- [x] Curved telltales, unclipped gauges, vector brand badges (`549fab4`, `5f5d2bd`).
- [x] Driver shift-hand animation (`df37f18`).
- [x] Host car-class rulesets (`be60bf4`).
- [?] Speed FOV (+3° max, on): owner to say if it should be stronger.
- [?] Real brand logos: trademark call is the owner's. Each brand has an on/off flag.

## World and rendering
- [x] Simplified world: no vegetation or beach props, block props, simple pedestrians (`82ac93c`). Terrain colour/texture variation plus contrasting box buildings (`8940394`).
- [ ] Pre-existing sky-coloured terrain wedges (Penteli mid, Riviera hillside): terrain agent, after its speed fixes.
- [~] Terrain LOD speed fixes: selector ≤150 µs, build time back to original, baked-terrain test from 14 min down to under 2 (Astra).
- [~] Low-poly vehicles (−94% triangles, no occupants, dark glass) plus 80% windscreen cockpit camera and seat sliders: landing next (Astra).
- [~] Graphics lock (Lighting Off + Effects Off only) plus no chase-cam mirror (Opus).
- [~] Title screen reverted to the 14 Oct night design; notices cleanup; tyre-grip panel removal (Sol).
- [x] Bus/fleet suspension stabilised (`a92d24d`); body dynamics and wheel lift queued next (Sol).
- [x] Beach above water, grounded props, shadow/AO flicker stabilised (`0b07849`…`34c7016`). The road stripe is a real streetlight shadow.
- [ ] Mac-only near-black sand tint not reproduced on the VPS. Owner to re-check on the live site after the next deploy.
- [ ] Mac GPU profiling of the render changes (VPS SwiftShader timings are noise).
- [x] Penteli road width 7.2–7.8 m plus 2.5 km of real guardrails (`d3acd1f`, `bc0fd52`, `9790808`).
- [x] Riviera guardrails, 2.6 km over 15 runs (`214d088`).
- [x] Auto-tow on leaving the road (`d08bd72`).
- [?] Auto-tow on sand beside the road: tighten to "fully off the drivable surface for 3 s"? Owner to decide.
- [x] Ragdolls and rider ejection (`d13dd21`…`07db7b6`).

## Performance (Codex agents, one per area; started 20:00 UTC)
- [~] Bundle, minify and code-split the client, and bundle three.js (Sol).
- [x] Terrain compact vertices: GPU geometry −47 to −50% (`935cc47`).
- [~] Terrain LOD actually reducing far triangles (round 1 showed none) plus freeing CPU-side copies (JS heap unchanged) (Astra).
- [~] KTX2 textures plus meshopt-compressed map data (Sol).
- [~] Shadows: near/far cascades plus cached static shadows; merge and instance scenery for fewer draw calls (Sol).
- [~] Move simulation (traffic, peds, AI) to a Web Worker plus dynamic resolution scaling (Sol).
- [?] Owner: one Mac Chrome performance trace (Riviera + Penteli, High) to confirm GPU vs CPU bottlenecks.

## Open world
- [x] Plan: docs/athens-open-world-plan.md (`ed1732d`).
- [x] Owner: no photo rule for any street; bare simple (roads plus building blocks); all of Athens at minimal cost (`d9aed06`).
- [~] Tile format spec plus streaming runtime; the existing 3 maps streamed tile by tile (Sol).
- [~] Offline all-Athens generator from OSM + DEM: south suburbs, then the basin, then Attica, plus an "Athens" free-roam mode (Astra).

## Controls
- [x] Phone as steering wheel: QR pairing, P2P with relay fallback, tilt, pedals, safe release (`fe12576`).
- [?] Owner: test on a real iPhone/Android.

## Quality
- [x] Review findings fixed: trim-step DOM leak, touch rotate, frozen scooter rider, rider protocol bounds, 8 unwired test suites plus a coverage guard (`b2798b9`). CLE margin and mild-language silence were already fixed.
- [ ] Muse perf round 6: final numbers never reported (5 commits landed). Check whether a follow-up is needed.

## Contributors
- [?] Vas-Per PR #2 (classic cars): the review says port onto the trim schema with 3 fixes. Feedback text is ready; owner to approve posting it or have an agent do the port.
- [?] Vas-Per PR #1 (Psychiko): still unresolved.
