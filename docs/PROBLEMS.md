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
6. **Open the PR into `staging`.** Use the template, include before/after pictures and the map and graphics preset, and link the issue.
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

### 1. Psychiko is buried under generic buildings 🔴
**What's wrong:** Psychiko looks overrun by procedural "building slop". Vas's hand-made Psychiko work (the centre, his landmarks and layout, merged in PR #3 / `f4fbc90d`) seems to have been overwritten or hidden by the streamed Athens world's generated infill buildings.
**Where to look:**
- `tools/maps/psychiko/` (sources, see `SOURCES.md`)
- `src/athens-world.js`, `src/athens-quarters.js`, `src/buildings.js`, `src/athens-landmark-hide.js`
- the world-area docs `docs/world-areas.md` and `docs/world-tiles-format.md`

**Done when:** in Psychiko, Vas's authored buildings and layout show, and generated infill only fills the gaps around them. Include before/after screenshots from the same spots in the centre.

### 2. Finishing races doesn't work reliably, and going off track is far too harsh 🟡
**What's wrong:** races often can't be finished cleanly. Leaving the road is punished too hard: off-route notices, lost progress, forced recovery.
**Where to look:**
- `src/route-navigation.js` and `src/course.js`, which own off-route, wrong-way and rejoin
- `src/driving-objectives.js`
- `docs/route-guidance.md`

**Done when:**
- Cutting across a kerb, verge or short shortcut doesn't trigger anything.
- Only clearly leaving the route for a long way does.
- Every Quick Race route can be finished start to finish, and a test drives each one to the finish.

### 3. No direction arrows 🟡
**What's wrong:** nothing in the world shows which way to go. The plan (`docs/plans/unified-world.md`) calls for low, subtle chevrons at junctions and turns, but they're missing or invisible in play.
**Where to look:** `src/route-guidance.js` (the module exists, see `docs/route-guidance.md`), how `src/main.js` wires it up, and `src/hud.js` for the minimap route.
**Done when:** low, understated arrows on or beside the road point the way at junctions and tight turns, readable at speed but not shouty. No glows or outlines; this is an owner-locked decision.

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

## Open: other known issues

- 🟢 **Esc goes to the wrong screen.** In the Athens route flow, Esc from Race Setup goes to the title screen instead of the track picker.
- 🟢 **Stale What's New.** It still mentions engine trims, which were removed. Update `CHANGELOG.md` / What's New.
- 🟢 **Signed-out leaderboard.** Signed-out players see "Leaderboard unavailable" in Top 3; show something friendlier.
- 🟡 **Free-roam mirror is a still picture.** In free roam the cockpit mirror shows a static image and ignores Settings → Graphics → Mirror. Quick Race mirrors work.
- 🟡 **Traffic pile-up.** One traffic car got stuck being pushed by the AI in a Glyfada drive.
- 🔴 **Slow first load.** Cold load is still above the 8 s target: Megara about 8.1 s, Penteli hill about 9.1 s.
- 🔴 **Old per-track loaders not removed.** They still serve the normal menu races; finishing the move to one Athens world means deleting them.

## Lessons from releases (read before touching the world or deploys)

- **World rebakes upload to the staging bucket only.** Before production points at a new world manifest, copy every file it depends on to the production bucket. Guard `a8eaa73` now blocks a production deploy whose manifest is missing.
- **A failed commit is never retried on its own.** After a failure the release train skips that commit until `~/.local/state/athens-release/failed` is removed.

## Fixed

(Move items here with the PR or commit that fixed them.)
