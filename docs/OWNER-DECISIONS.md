# Owner-locked decisions

These choices were made deliberately by the owner (Alexandros Lekkas). Don't change, revert or "improve" any of them without asking the owner first. Guard tests enforce several of them, and their failure messages point here. Add new entries at the bottom, dated, in the owner's words where possible.

| Date | Decision | Notes |
|---|---|---|
| 2026-10-13 | No progression, points, XP or fines. Time is the only score. Car select, strong AI rivals. | Game design direction. |
| 2026-10-15 | At most 2 AI rivals (default 2), solo and online. | "Rivals lag your computer (allow for 2 max)" (`ec0df39`). |
| 2026-10-15 | The game is named **Athens Racing**, at athensracing.com. | Worker names and localStorage keys deliberately keep the old name (`272efb8`). |
| 2026-10-15 | Accounts use **Google sign-in only**: no Discord, email codes or email sending. Sign-in is mandatory once Google is configured. | (`b585492`) |
| 2026-10-15 | HUD motion (POV sway) defaults to **Full**. | (`1397702`) |
| 2026-10-15 | **One graphics look:** today's Lighting OFF + Effects OFF. No Potato–Ultra presets and no lighting/effects selectors. | "I don't want it to go back." Being implemented with guard tests. |
| 2026-10-15 | **No rear-view mirror in third-person/chase camera.** | Cockpit mirrors follow the mirrors setting. |
| 2026-10-15 | **Simplified world:** no trees or vegetation, clean terrain (real mountains kept), buildings as clean blocks. | "We want to simplify this as much as possible." Being implemented with guard tests. |
| 2026-10-15 | Every release's changelog (What's new) includes screenshots of the visible changes. | |
| 2026-10-15 | **No street-photo proof rule** for any road or map. Maps are generated **bare simple** from OSM roads plus elevation: road shapes, terrain and building blocks. The goal is to build out all of Athens at minimal cost. | "I relax 100%, we don't need the photo rule for any streets." Supersedes the 2026-10-13 street-view rule. |
