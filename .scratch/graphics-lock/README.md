# Graphics lock evidence (owner-locked: one look, no chase-cam mirror)

Captured with `capture.mjs` (headless Chromium, SwiftShader software GL, 960×540, `?simhook&fixeddt&notraffic&car=mini`, frozen game loop).
The pose is route s = 300 m in lane 0 on each map, with a chase camera 7 m back and 2.8 m up, or a cockpit camera at the driver's head. Each map is shot at day (`day`) and night (`night`), in clear weather and race state.
Frames are stored as WebP (q82) to keep the repo small. Each `*-report.json` holds per-frame draw calls, triangles, `renderer.render` pass counts and render targets.

Variants:
- **default**: prod before this change (8071301), browser default. On this VPS the heuristic picks the Low preset, Lighting/Effects = preset.
- **offoff**: prod before this change with the High preset and **Lighting OFF + Effects OFF**. This is the look the owner chose and the reference.
- **after**: this change on the same base (8071301), performance class High (same draw distance as offoff). The 3D scene matches **offoff**: a difference image shows only HUD overlays (toasts, tags, minimap) changing. The chase cam no longer has the rear-view strip or the mirror pass.
- **final** / **landed**: this change rebased onto the simplified world (5c72f29) and the colour follow-up (8940394).
- `*-settings-graphics`: Settings › Graphics before (`default-`) and after (`after-`, `landed-`).

Draw calls · `renderer.render` passes per frame ("(mirror)" = that frame also ran the in-car mirror pass, which runs on every third frame). ms timings are noise on software GL, so none are given.

| Map / view | default calls · passes | offoff calls · passes | after calls · passes | final calls · passes | landed calls · passes |
|---|---|---|---|---|---|
| megara day-chase | 266 · 3 | 342 · 4 (mirror) | 267 · 2 | – | – |
| megara day-cockpit | 185 · 2 | 261 · 3 (mirror) | 187 · 2 | – | – |
| megara night-chase | 346 · 4 (mirror) | 270 · 3 | 269 · 2 | – | – |
| megara night-cockpit | 187 · 2 | 189 · 2 | 189 · 2 | – | – |
| penteli day-chase | 490 · 3 | 834 · 4 (mirror) | 560 · 2 | 320 · 2 | – |
| penteli day-cockpit | 412 · 2 | 485 · 2 | 758 · 3 (mirror) | 239 · 2 | – |
| penteli night-chase | 776 · 4 (mirror) | 563 · 3 | 562 · 2 | 322 · 2 | – |
| penteli night-cockpit | 698 · 3 (mirror) | 487 · 2 | 762 · 3 (mirror) | 241 · 2 | – |
| riviera day-chase | 681 · 4 (mirror) | 520 · 3 | 521 · 2 | 421 · 2 | 421 · 2 |
| riviera day-cockpit | 334 · 2 | 451 · 2 | 719 · 3 (mirror) | 348 · 2 | 348 · 2 |
| riviera night-chase | 685 · 4 (mirror) | 788 · 4 (mirror) | 523 · 2 | 423 · 2 | 423 · 2 |
| riviera night-cockpit | 611 · 3 (mirror) | 719 · 3 (mirror) | 455 · 2 | 350 · 2 | 541 · 3 (mirror) |

Chase camera before: scene + final + rear-view strip (3 passes), plus the mirror scene pass on its cadence (4 passes, about +200–340 draw calls).
Chase camera after: always 2 passes (scene + final), with no mirror and no strip. Cockpit is unchanged: scene + final, plus the fixed mirror view (384 px, 150 m) every third frame.
Shadow maps were off in every run (`shadowMap:false`). Post (offoff and after): no MSAA, AO, bloom, motion blur, FXAA/sharpen, heat, glare or rain lens.
