# Open problems and good places to contribute

This is the list of things that are broken, rough or missing in Athens Racing right now. **Every item here is open for anyone to pick up:** people, AI agents, first-time contributors. If you want to help and don't know where to start, start here.

Production is https://athensracing.com, last checked at `a8eaa73` on 2026-10-22.

## How to contribute a fix

1. **Pick one item.** Check the GitHub issues and open PRs first, so you don't duplicate work. If nobody has it, open an issue titled with the item name (e.g. "Off-track is too harsh") and say you're on it.
2. **Read the rules once.**
   - [`CONTRIBUTING.md`](../CONTRIBUTING.md) explains the branches, PRs and checks.
   - [`docs/OWNER-DECISIONS.md`](OWNER-DECISIONS.md) lists the locked decisions. Don't undo these.
   - Short version: PRs go into `staging`, one fix per PR, CI must be green, and screenshots are required for anything visible.
3. **Set up and reproduce first.**
   ```sh
   git clone https://github.com/aflekkas/athens-racing.git && cd athens-racing
   git switch staging && npm ci && npm start     # http://localhost:8000
   git switch -c your-name/short-fix-name
   ```
   Reproduce the problem locally, and take a **before** screenshot or short clip.
4. **Fix it in small steps.** Use the "Where to look" pointers below as a starting point, not the full answer.
5. **Prove it.**
   - Run `npm test`, plus the physics, syntax and import checks listed in CONTRIBUTING.md.
   - Add or update a test that would have caught the problem.
   - Take an **after** screenshot from the same spot.
6. **Open the PR into `staging`, using the template.** It has two parts:
   - **A short top half for a human reviewer:** a plain-words summary, a **video, GIF or screenshot of the fix working** (before and after), steps to try it, and the risk.
   - **A detailed collapsed half:** how you did it, **which tools and AI models you used for which part**, every file and why, the exact test commands and results, and the known limits.

   You must have **tested it yourself**: played the fix in the real game, not only run unit tests, and written down what you did and what happened. PRs without visual proof or real testing are sent back. Link the issue.
7. **Update this file in the same PR.** Move the item to "Fixed" with a one-line note. Add anything new you found under "Open".

**Ground rules for every fix:**
- The game is desktop only (computer, keyboard/mouse/gamepad).
- Racing is time only: no XP, money or unlocks.
- No glows, outlines or visible checkpoints, and notices stay out of the driving view.
- Only free Cloudflare services.
- **Never commit third-party media.** Street View, Google Maps captures, web photos and unlicensed audio go in the git-ignored `.reference/` folder only.
- Our own game screenshots are fine.

Difficulty: 🟢 good first fix · 🟡 medium · 🔴 deep / needs care.

---

## Open: reported by the owner (most important first)

### 4. Unrealistic terrain 🔴
**What's wrong:** the ground and roads rise and fall in big unrealistic lumps and dips that real Athens streets don't have.
**Where to look:**
- `src/athens-ground.js`
- `docs/world-roads.md` and `docs/world-tiles-format.md`
- the world bake tools in `tools/`
- the gates in `tools/road-terrain-level.test.mjs`

**Done when:** city streets feel flat-to-gently-sloped like real Athens, and hills only appear where real ones are, such as Lycabettus and Penteli. The existing gates (≤30° asphalt, 15 cm step, ≤45% grade) aren't enough to make it feel right; add a smoothness check.
**Note:** any world rebake must be uploaded to BOTH R2 buckets; see "Lessons" below.

### 5. Parked cars look chopped, and the roads have artefacts 🟡
**What's wrong:**
- Parked cars are cut off or chopped, and some render as flat slabs or look boxy up close.
- The road surface has artefacts, such as patches of road texture spilling onto pavements and odd seams.
- The surroundings sometimes just look rough.

**Where to look:** `src/athens-props.js`, `src/athens-detail.js`, `src/athens-ground.js`, `src/athens-materials.js`, `docs/world-dressing.md` and `docs/world-beauty.md`.
**Done when:** parked cars read as whole cars at every distance; there are no road patches on pavements and no visible seams. Include before/after screenshots from Glyfada, Syntagma and Psychiko.
**Implemented (2026-10-22, `45704212`):** reset leaked contact-shadow scale; sparse shared parking density, complete asphalt/support/clearance checks and stop/crossing exclusions; correct classic asphalt flags and drape fully contained road decals. 29 focused regressions pass. Matching staging evidence: `/home/dev/data/agent-feed/fix-wave/parking/`.
**Remaining:** inherited road/terrain mesh seams, visible around Syntagma, need the separate terrain fix in item 4. Untagged driveways are inferred from road mouths and empty runs. No world rebake or R2 upload in this parking/decal change.

## Open: other known issues

- 🟢 **Esc goes to the wrong screen.** In the Athens route flow, Esc from Race Setup goes to the title screen instead of the track picker.
- 🟢 **Stale What's New.** It still mentions engine trims, which were removed. Update `CHANGELOG.md` / What's New.
- 🟢 **Signed-out leaderboard.** Signed-out players see "Leaderboard unavailable" in Top 3; show something friendlier.
- 🟡 **Free-roam mirror is a still picture.** In free roam the cockpit mirror shows a static image and ignores Settings → Graphics → Mirror. Quick Race mirrors work.
- 🔴 **Slow first load.** Cold load is still above the 8 s target: Megara about 8.1 s, Penteli hill about 9.1 s.
- 🔴 **Old per-track loaders not removed.** They still serve the normal menu races; finishing the move to one Athens world means deleting them.

## Lessons from releases (read before touching the world or deploys)

- **World rebakes upload to the staging bucket only.** Before production points at a new world manifest, copy every file it depends on to the production bucket. Guard `a8eaa73` now blocks a production deploy whose manifest is missing.
- **A failed commit is never retried on its own.** After a failure the release train skips that commit until `~/.local/state/athens-release/failed` is removed.

## Fixed

- **3. Direction arrows (2026-10-22):** Quick Race now shares faint road chevrons with the streamed routes; larger, width-bounded marks sit beside the car, cover within-edge bends, and fade over a speed-based approach. One 128-instance pool, no glows or gates, and no world rebake. Browser evidence: `/home/dev/data/agent-feed/fix-wave/direction-arrows/`.

- **1. Psychiko buried under generic buildings (2026-10-22):** restored all 3,647 authored pieces with the original building kit, surveyed facades, roofs and tile-owned collision; excluded generated lots from authored villa gardens and footprints; stationary spawns finish loading walls, trees and frontage details. Matching centre views: `/home/dev/data/agent-feed/fix-wave/psychiko/`; native day/night budgets recaptured and 32 focused regressions pass. No world rebake.

- **2. Race finishes / harsh off-track handling.** Short kerb/verge/roundabout cuts preserve progress without notices; prolonged departures guide back without resetting. Accepted station crossings time every split and finish; headless regressions drive all six Quick Race routes and their full lap counts.

- **Driving map overlay (2026-10-22):** kept both M ranges compact, replaced resident-cell/500 m street clipping with the published-world street overview, restored sea/coast and area labels, and added a calm race route with a labeled finish instead of the tiny green flag. Nearby streets prepare first across frames, independently of the coast, and cache by view; area, turn and destination captions use separate rows. No world rebake.

- **Traffic pile-up.** Common graph traffic now rejoins safe lanes, times out missing paths and trapped wrecks, and retires distant cars, only when unseen by main/mirror rendering, filters stacked-road leaders, and prevents proposed footprint overlaps. Rivals brake at contact and tiny nudges preserve recovery. Visible cars with no safe escape continue waiting; regional staging proof is required for the newest follow-up.

(Move items here with the PR or commit that fixed them.)
