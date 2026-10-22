# Known problems

Read this before you start work on Athens Racing. It lists what is broken or not good enough on production (athensracing.com), most important first. When you fix one, move it to "Fixed" with the commit SHA.

Production was last checked at `a8eaa73` on 2026-10-22. See `docs/HANDOFF.md` for how to deploy.

## Reported by the owner (2026-10-22)

1. **Psychiko is buried under generic buildings.** The Psychiko map looks overrun by procedural "building slop". Vas's hand-made Psychiko work (the centre and his landmarks, PR #3, `f4fbc90d`) appears to have been overwritten or hidden by the streamed Athens world's generated buildings. Find out which layer wins, and make Vas's authored buildings and layout take priority over generated infill.
2. **Finishing races doesn't really work, and going off track is far too harsh.** Races often can't be finished cleanly. Leaving the road is punished too hard, through off-route notices and recovery or progress loss. Make the off-route tolerance generous (shortcuts across a kerb or verge are fine) and make sure every route can be finished reliably.
3. **No direction guidance.** There are no subtle in-world arrows showing which way to go. The unified-world plan (`docs/plans/unified-world.md`) called for low, subtle chevrons at junctions, and they aren't there or aren't visible. Owner rules apply: no visible checkpoints, no glows or outlines, and keep notices out of the driving view.
4. **Unrealistic terrain.** The ground rises and falls in an unrealistic way: big lumps and dips that real Athens streets don't have. Smooth the terrain and road profile so it feels like real streets. The world gates (≤30° asphalt, 15 cm step, ≤45% grade) aren't enough on their own to make it feel right.

## Other known issues

- **Free-roam mirror is a still picture.** In free roam the cockpit mirror shows a static image and ignores Settings → Graphics → Mirror. It works in Quick Race.
- **Esc goes to the wrong screen.** In the Athens route flow, Esc from Race Setup goes to the title screen instead of the track picker.
- **Signed-out leaderboard.** Signed-out players see "Leaderboard unavailable" in Top 3.
- **Slow first load.** Cold load is still above the 8 s target: Megara about 8.1 s, Penteli hill about 9.1 s.
- **Old loaders.** The old per-track loaders haven't been removed yet.
- **Traffic pile-up.** One traffic car got stuck being pushed in a Glyfada AI drive.
- **Stale What's New.** It still mentions engine trims, which were removed.
- **Boxy parked cars.** Parked cars look boxy up close.

## Lessons from releases

- **World rebakes upload to staging only.** Before production uses a new world manifest, copy every file it depends on to the production bucket. Guard `a8eaa73` now refuses a production deploy whose manifest is missing.
- **A failed commit is never retried on its own.** After a failure the release train skips that commit until `~/.local/state/athens-release/failed` is removed.

## Fixed

(none yet)
