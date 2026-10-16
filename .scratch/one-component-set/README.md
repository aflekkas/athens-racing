# One component set: evidence (2026-10-16)

Owner asks: one shared component set for every screen, derived from the pause menu (the reference style); the garage
grid fills the screen; sign-in is a Dialog over the title; a cleaner account screen; no tyre-grip HUD; in-race notices
out of the driving view.

- `before/` the screens before this change (a647154; the Multiplayer join/host shots were retaken on b09b85c, whose
  multiplayer screens are unchanged), `after/` the same screens on the landed commit. Every screen at 1280×800,
  1920×1080 and 390×844, plus the race view (chase and cockpit) with a police pursuit, a tow and a traction notice up.
- `contact-sheet.png` every screen at 1280×800 on one sheet. `pause-pairs.png` the pause menu beside every other screen.
- `before/checks.json`, `after/checks.json`: per screen and size, native selects (0), horizontal overflow, and for the
  garage the number of fully visible car rows (1280×800: 3, 1920×1080: 3; the owner asked for at least 2 and 3).
  `garage-scrolled-*` shows the grid mid-scroll: cards snap to the top edge, so no title is ever half cut.
- `*/race-checks.json`: the notice lane rectangle per size and camera. After: a top-left stack under the timer at
  1280/1920 (x 28–248 / 28–328), a slim strip at the very top edge on phones; never in the central driving area, a mirror,
  the speed sign or the minimap (also asserted by `tools/notice-placement.test.mjs`).

Reproduce (each through `tools/browser-slot.sh`, from a checkout):
`node .scratch/one-component-set/capture.mjs ROOT OUT`, `node .scratch/one-component-set/race-capture.mjs ROOT OUT`,
`node .scratch/one-component-set/contact.mjs .scratch/one-component-set`.
