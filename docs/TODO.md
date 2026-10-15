# Athens Racing — to-do list

This is the lead's single list of open work. It's updated as tasks are assigned, finish or get blocked. `[ ]` open · `[~]` in progress (owner) · `[x]` done (SHA) · `[?]` waiting on the owner (Alexandros).

Last updated: 2026-10-15 21:40 UTC.

## Release and infrastructure
- [x] Automatic release train on the VPS: tests, pushes and deploys staging then production every 10 min (`023bb4e`).
- [x] Production live at athensracing.com with `bf99234` (menu redesign, accounts code, every vehicle, dash and badges, beach fix).
- [~] Next train round: hero fix, flat UI, release photos, HUD-motion Full default, render fixes.
- [ ] GitHub Actions deploy (optional): needs a `CLOUDFLARE_API_TOKEN` repo secret. The train switches to push-only automatically once it exists.

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
