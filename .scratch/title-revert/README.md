# Owner-chosen title restoration

Design reference: `aceb5bd`, 2026-10-14 at 23:56 UTC. Restores the logo on the left, a large PLAY card and JOIN GAME, HOST / CREATE GAME, GARAGE and SETTINGS cards. The restored title keeps ATHENS RACING, the account button/route, build badge, version/Credits links and the later flat shared component treatment. It starts no car studio and loads no world or map data.

`before/` and `after/` contain 1280×720, 1440×900, 1920×1080, 2560×1440, 390×844 and 844×390. `contact-sheet.png` compares all six. Before captures use the pre-revert title on `8071301`; the restored title is based on latest `e4b6113`. The newer base contains documentation changes only.

`after-validation.json` records the viewport and clipping checks at all six sizes, including zero worlds, zero /data/ requests, the five original actions and a real account button. Keyboard navigation, G, account access and touch PLAY passed; keyboard/gamepad unit coverage is retained. The check includes ancestor clipping and viewport bounds, allowing visible italic-font overhang. The title also reserves space for the account offline status bar when present.

`tools/title-revert-capture.mjs` reruns the actual browser assertions through the repository browser slot. Explicit Low avoids the unrelated first-time graphics prompt. Full required gate logs/exit markers are in `gates/`. No other screen was redesigned. Wider UI rollout is held for the lead.

All six gates exited 0 on clean candidate `0bc5a253534e42d38c9af2496f75466dbd2db46e`. Final parent `06484cb9d77f8f5c5195fd88734df028d4416304` additionally includes the independent draft world-tile format/schema documentation and validator; title source is byte-identical to the gated snapshot.
