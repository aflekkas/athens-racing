# Athens Racing — to-do list

This is the lead's single list of open work. It's updated as tasks are assigned, finish or get blocked. `[ ]` open · `[~]` in progress (owner) · `[x]` done (SHA) · `[?]` waiting on the owner (Alexandros).

Last updated: 2026-10-15 19:45 UTC.

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
- [~] www.athensracing.com → athensracing.com 301 redirect (Sol, privacy task).
- [~] Live /privacy and /terms pages, linked from sign-in and About (Sol).

## UI
- [x] Title menu redesign: compact list, live car hero matching the selected car and paint, staging badge (`7414ef1`…`533c53b`).
- [x] Flat head-unit kit: blue-glow removal, base and menu screens (`bc69c8b`, `9b5760d`).
- [~] Final glow sweep over every remaining screen, plus a mode-screen redesign, car thumbnails in the garage, and stronger contrast on settings/setup/results; fresh full screenshot set (Sol, menu thread).
- [x] Release photos in the changelog / What's new (`e520f68`, `7712db9`, `92e545a`). Rule: every visible change adds a picture.
- [x] Renamed to "Athens Racing" everywhere player-facing; Worker names and storage keys stay (`272efb8`).

## Driving and cars
- [x] Front-slip steering assist: gamepad overshoot past peak grip removed (173/180 frames → 0) (`c45aa28`).
- [?] Keyboard turn-in is barely changed and the scripted Megara lap is unchanged. Owner: which car and input did you use on Megara? Then a second, stronger pass.
- [~] Lamborghini Aventador SVJ with exhaust flames and flame/pop sound (Astra).
- [x] HUD motion (POV sway) defaults to Full (`1397702`).
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
- [~] Riviera cliff-drop guardrails: 45 unprotected drop samples confirmed, e.g. 9 m at s=2860 (Astra).
- [x] Auto-tow on leaving the road (`d08bd72`).
- [?] Auto-tow on sand beside the road: tighten to "fully off the drivable surface for 3 s"? Owner to decide.
- [x] Ragdolls and rider ejection (`d13dd21`…`07db7b6`).

## Controls
- [~] Phone as steering wheel: QR pairing, WebRTC with relay fallback, tilt steering, pedal zones, haptics (Sol).

## Quality
- [x] Review findings fixed: trim-step DOM leak, touch rotate, frozen scooter rider, rider protocol bounds, 8 unwired test suites plus a coverage guard (`b2798b9`). CLE margin and mild-language silence were already fixed.
- [ ] Muse perf round 6: final numbers never reported (5 commits landed). Check whether a follow-up is needed.

## Contributors
- [?] Vas-Per PR #2 (classic cars): the review says port onto the trim schema with 3 fixes. Feedback text is ready; owner to approve posting it or have an agent do the port.
- [?] Vas-Per PR #1 (Psychiko): still unresolved.
