# Compact race notices

The title restoration landed first as f1dd16c. This change is limited to race notices and their shared toast adapter; the wider screen rollout remains held for owner/lead review.

## Behaviour audit

- Engine/damage and the tow prompt share a recovery group. The higher-priority engine card owns the event; the tow fallback stays queued and can return when the condition clears. A higher-priority route banner cannot claim the engine event while hiding its available tow action.
- Checkpoint, objective-direction and wrong-way sources share a direction group. Police status, callouts and recovery-hold messages share a police group. The most urgent source wins.
- Identical sanitized title/body copy merges across producers without restarting its lifetime. Alias dismissal resolves to the original event; a more urgent duplicate can upgrade its real actions. Recent copies have a short cooldown.
- Disabled engines show their cause, without a redundant “no power” statement or coolant temperature. Only heat warnings carry coolant temperature. Limp/impaired conditions retain useful power information.
- Recovery uses the shared key-cap markup and the actual first binding. Free roam shows no trailing zero; a timed race can still say +5 s because time remains the game's score. No points, currency or fines were added.
- Tow/repair controls are real buttons. Pointer and touch invoke the same repair handler. D-pad down focuses an action; A confirms only after focus, so an ordinary handbrake press cannot tow accidentally. Up/down select actions and Back leaves them.
- Off-track notices retain the automatic recovery countdown. Phone connection/disconnection, invites and offline status use the same queue. The old in-race phone latency plate and offline bottom strip are removed from the driving view. The offline strip remains visible in full-screen menus and pause screens. Offline status is a brief notice, including after a race reset; it remains visible in menus as before.
- All sources use a compact flat surface, inline semantic icon, severity bar, condensed italic title and optional subline. No glow, glass blur, large icon plate or drop shadow. The normal recovery action sits beside the two text lines, keeping a full touch target without a third row. Rejected shifts and phone disconnection retain their warning severity.
- Placement reserves the canvas chase strip while it exists, projects the actual cockpit mirror meshes with frame clearance, and retains a conservative upper-windscreen reserve. It also avoids measured HUD and touch controls. The final landscape review found an overlap that the former approximate mirror reserve missed; a real Three.js projection test and browser checks against the projected glass now cover it. A small toast cannot consume a gap that leaves the critical action hidden. This does not change the owner's separate decision to remove the chase mirror.

## Evidence and reproducibility

Run `tools/browser-slot.sh node tools/notices-capture.mjs ROOT OUTPUT before BASE_SHA`, then repeat with `after BASE_SHA`. Before source is served directly from Git for the changed modules; no extra repository archive is made. Both versions use the same controlled notice fixtures, real engine renderer/queue, actual HUD and Megara scene. Changed legacy copy/anchors are represented for engine, tow, off-track, phone and offline. The previous phone disconnection UI had no notice; its before crop intentionally shows the empty driving view.

The fixture skips the all-material loading prewarm in the served main module and compiles the visible scene on its explicit real render. It freezes simulation frames for repeatable poses. It does not alter geometry, materials, lighting or product loading code, and is not a boot-performance benchmark.

The type matrix covers damage/engine heat/limp, full and minimized tow, off-track, police pursuit/cooldown/busted/warning/observing/evaded, checkpoints/objectives/completion/wrong-way, phone connect/disconnect, invites, OPA, offline, TC, gearbox, music, tips, speed cameras, signals, pedestrians, recovery, camera, controller, ABS, unsafe/rejected shifts, splits, rivals, finish, district, bumps, takedowns, nitro, retirement, pickup and session introductions. Other textual variants flow through the same shared renderer. Fixtures are controlled UI coverage, rather than a claim that every driving event was triggered in the simulation.

The type contact sheets isolate the actual component modules on the same neutral background, without loading a world. Placement screenshots use the real rendered Megara scene and HUD. Before/after crops and placement screenshots, validation JSON, the type contact sheet and gate logs are stored here. Placement is checked at 1280×800, 1920×1080, 390×844 and 844×390 in chase and cockpit, including real touch controls on phone sizes. The browser asserts no instrument/mirror overlap and verifies the actual repair handler with mouse, touch and explicit gamepad focus/confirm. Unit tests cover arbitration, merge lifetime, alias dismissal, severity and safe placement.

The type sheet was inspected in full, alongside the full phone portrait/landscape screenshots. Baseline placements are repainted using legacy notice modules on the current renderer/HUD, with the same touch controls enabled. The capture helper flushes resize/paint and freezes only the notice polling clock for a stable photograph. This avoids stale canvas pixels caused by freezing the game frame during a resize.

The first full suite found an isolated driving-aids flow test whose extracted function did not supply the new notifications dependency. Its fixture now supplies that dependency; production behaviour was unchanged by that test repair. The full required suite is rerun on the final clean archive.

## Final gates

All six required gates passed on clean archive 34cf35deb231cfbbd1ee0823ddf6863f9e9e71e9 (parent 8940394cbbf49e766f1467d4f9cd431df155b52a). The notice runtime files in the final commit match that archive exactly; the later capture-helper update only adds the final projected-mirror screenshots. The final composition preserves later documentation and the separately green, inactive tile-accounting change (28039e2). Its affected tests and the notice tests are checked again on the composed archive. The 39 focused notice/driving tests also passed.
