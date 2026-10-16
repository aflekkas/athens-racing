# Phone wheel verification

Implementation: `fe12576f3f17ae06ba589f8a2a951113b932a229`. Clean test snapshot: `399d836f69fdbd7f8dcab6bdc2853a0a2f26f9c2`, based on `b7bd65445931c58a9eea5131704fd9b584a776fa`. The full gates ran on `99c54836211cbd3816f61eb0bd1e5b8b38650087`; the browser CLI then gained an explicit successful exit after cleanup. The subsequent UI redesign was merged without overlapping phone changes, then the final UI checks, import graph, syntax and browser test were run on the merged tree. The final browser test ran on the implementation snapshot. The snapshot was exported with `git archive HEAD` from a private bare HEAD; shared index and working tree were never used. Concurrent unrelated prod work was preserved with an isolated index and compare-and-swap ref update. No push or deployment was performed.

All six required gates exited 0: npm test, physics regression (433 passed), events, syntax, browser imports, and staging Wrangler dry-run. Logs and exit markers are in `gates/`. Focused packet, expiry, mixing, permission, motion, feedback, and bundle tests are in `focused.log`.

`browser-report.json` records two isolated browser contexts (desktop and mobile emulation), denied iOS permission then a gesture-authorized retry, synthetic orientation and analog touch input, real car motion in solo and an online race, and the second network client's received car state. It verifies P2P, forced relay fallback, the last-input hold and safe release, unpair, and that the HUD link indicator stays clear of Settings. Motion tests cover both landscape rotations, natural-landscape tablet orientation, full lock and flat-phone safety.

Same-machine LAN loopback application RTT, measured without rendering work during each sampling window:

- P2P: 20 samples, median 2.1 ms, p95 9.2 ms.
- WebSocket: 12 samples, median 4.3 ms, p95 17.6 ms.

Raw samples are in the browser report. These measurements use synthetic sensors and local browsers; the planned real iPhone/Android check remains a hardware check.

The actual local Wrangler Worker / Durable Object / built-asset checks passed in `worker-report.json`: /wheel serves its bundled controller without redirect, cross-origin creation is rejected, a duplicate phone is rejected without disturbing the game, signalling and binary packets relay, and unpair/disconnect notify and release the peer. A peer can receive its close notification before the underlying TCP close handshake finishes; the controller clears input immediately on the explicit unpair notification.

Screenshots, viewed before publication:

- `pairing-1280.png`: 1280 × 800 pairing screen.
- `controller-844x390.png`: a 390 × 844 phone rotated to landscape.
- `controller-390x844.png`: portrait fallback with rotation guidance.
- `controller-tablet-1180x820.png`: tablet layout.
- `car-phone-steering.png`: Megara online diagnostic frame and HUD (Potato, manually stepped simulation with render RAF frozen).

The changelog WebP is `assets/changelog/2026.10.15.4/phone-wheel.webp`; the short how-to is in the root README.

Reproduce the browser checks with `tools/browser-slot.sh node tools/phone-wheel-browser.mjs ROOT OUT` (Playwright module path may be supplied with PLAYWRIGHT_MODULE). Run Worker checks against local Wrangler with `node tools/phone-wheel-worker-smoke.mjs http://127.0.0.1:8787 OUT/worker-report.json`.

API references: [Cloudflare hibernating WebSockets](https://developers.cloudflare.com/durable-objects/api/state/), [W3C device orientation](https://www.w3.org/TR/orientation-event/), [screen orientation](https://www.w3.org/TR/screen-orientation/).
