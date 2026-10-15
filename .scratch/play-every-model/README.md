# Every vehicle model — evidence

Implementation commits:
- `4ad85ea237c8f6551a2314b3f35ccf242cca8fd2`: all fleet garage entries, literal physics profiles, native model adapter/cockpit, scaled chase cameras, race-only AI selection and coverage/physics cases.
- `ac46091e39e1885eac15c21b833335b0c957d559`: fit thumbnails and showroom cameras to utility dimensions at all turntable angles and narrow aspect ratios.
- `e4a6dc77ae5187d62a74764c7981ba55db8e9423`: complete native cockpit HUD navigation contract and widen/raise the bus chase camera.

30 garage generation entries / 69 selectable configurations. Newly exposed: Aygo II; Qashqai J11 1.2 DIG-T and 1.5 dCi; BYD Dolphin Comfort and Atto 3 Design; Ducato L2H2 Multijet 130/150; Isuzu NPR 75-190; Citaro O530 OSY; SH150i delivery; Beverly 300 HPE; Tracer 900; BMW R1250RT police; existing Octavia police profile. Existing player Corollas, Golfs, Octavia and Superb cover the matching passenger/taxi fleet bodies. The exhaustive registry test asserts every authored fleet identity has a garage drivetrain, and every CARS configuration is reachable.

Full specs: `lineup.json`; source/approximation ledger: `tools/play-every-model-notes.md`. Bus: 12,000 kg operating mass, 220 kW, 1250 Nm, RWD, four-speed Voith automatic, 12 × 2.55 × 3.10 m, wheelbase 5.845 m, estimated CoM 1.12 m, 85 km/h governor. Commercial masses and all CoM values are estimates. Bikes use assisted balance/four virtual contact patches; scooter CVTs use virtual automatic ratios; EV launch uses the existing clutch controller and remains slower than the factory anchor. These limitations are documented, not hidden in claimed manufacturer specs.

## Captures

`tools/browser-slot.sh node tools/play-every-model-browser.mjs <this directory>`; one owned browser job at a time. Actual 1280 × 800 garage UI screenshots:
- `garage-commercial.png`
- `garage-public-transport.png`
- `garage-motorcycle.png`
- `garage-service.png`
- `garage-bus.png`

Actual game WebGL renderer images on Riviera (HTML HUD omitted; corresponding live DOM and state recorded separately):
- `bus-riviera-chase.png`
- `bus-riviera-cockpit.png`

The capture asserts player ID, physics spec ID and model spec ID are all `bus`, then steps the real camera modes. Browser page errors are recorded in `browser-results.json`. Game URL explicitly selects `map=riviera`. Bus chase distance is 12.2 m before speed extension, height 4.34 m. Garage framing uses a bounding sphere, including bikes' rider height.

## Gates

Final source archive: `e4a6dc77ae5187d62a74764c7981ba55db8e9423`, extracted with `git archive HEAD` in `/tmp/every-release.x5lrn84e` when it was HEAD. Only node_modules is linked to the installed dependencies. Required commands and release logs:
- `npm test` → `npm-test-release.log` / `.exit`
- `node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs` → `physics-regress-release.log` / `.exit`
- `node tools/check-browser-imports.mjs` → `browser-imports-release.log` / `.exit`

All newly playable native trims run production-physics acceleration, speed and braking scenarios. Bus, both vans and truck also run gentle turns checking finite state, small roll/sideslip and positive loading on every wheel. Bus results: 0–59.5 km/h 12.57 s; terminal 84.6 km/h; 68–0 km/h 24.9 m (0.73 g). Ducato 130: 0–100 15.60 s; 80–0 25.6 m. The loop checks minimum corner load stays above 4% of total weight throughout each gentle turn (bus observed approximately 15.4%, van 19.7%).

Final acceptance: **880 npm tests passed, 2 skipped, 0 failed; 426 physics checks passed; 198 browser modules validated; browser check passed with 0 page errors.** All four release exit files contain `0`.
