# Contributing to ATHENS RACING

Thanks for helping. This page is the whole process: read it once before your first pull request.

## The rules

1. **Everything goes through a pull request into `staging`.** There are two long-lived branches:
   - `staging`: the integration branch and the default branch. It deploys to https://staging.athensracing.com. Every contribution lands here first, through a PR.
   - `prod`: what players get, at https://athensracing.com. Only the maintainer updates it, by promoting a tested `staging` commit.

   Both branches are protected: no direct pushes, no force-pushes, and every change needs a PR with a green `test` check and the code owner's approval. Branch from the latest `staging`, push your own branch, open a PR into `staging`. Never push to `staging` or `prod` directly; anything pushed there outside a PR is reverted.
2. **CI must be green.** The `test` check (`.github/workflows/ci.yml`) runs on every PR and must pass before merging.
3. **The maintainer reviews and merges.** @aflekkas is the code owner and approves every PR. Nothing reaches players without that review.
4. **Deploys are done by the maintainer**, never from a PR. Merged work goes to staging for a playtest first, and is promoted from `staging` to `prod` (production) only when the maintainer says so. See `deploy/README.md`.
5. **Show your work.** Every PR that changes anything a player can see, hear or feel needs screenshots or a short video in the PR description (the template asks for them). Before *and* after for visual changes. A PR without them will be sent back.

## Workflow

```sh
git clone https://github.com/aflekkas/athens-racing.git
cd athens-racing
git switch staging
npm ci
npm start                     # http://localhost:8000
git switch -c your-name/short-feature-name
# ...make changes, commit in small steps...
git push -u origin your-name/short-feature-name
gh pr create --base staging --fill   # or open the PR on github.com
```

Keep your branch up to date with `git pull --rebase origin staging`. Never force-push `staging`, `prod` or someone else's branch.

## Before you open the PR, run the same checks CI runs

```sh
npm test
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs
node tools/events-test.mjs
node tools/ghost-lap.test.mjs
node tools/check-syntax.mjs
node tools/check-browser-imports.mjs
npx wrangler deploy --env staging --dry-run
```

All must exit 0. If you change physics, add or update a case in `tools/physics-test/regress.mjs`. If you change multiplayer, also run `node tools/deploy-smoke.mjs http://localhost:8000 --race` against a local server.

## Release pictures

Every player-visible change must add a plain-language bullet and its screenshot under `## Unreleased` in `CHANGELOG.md` before merging. Use real in-game captures without bugs, debug overlays or test-harness controls. See `deploy/README.md` for Markdown examples and image limits. The automatic release train cuts version sections and deploys green `prod` commits; contributors leave notes in Unreleased.

## What makes a good PR

- **One feature or fix per PR.** Small PRs get merged fast; giant ones don't.
- **Title says what the player gets**, e.g. "Add tyre walls to the Megara hairpin", not "update stuff".
- **Screenshots / video** of the change in game, plus the graphics preset you used (Potato–Ultra) and the map.
- **Performance**: if you add models, effects or scenery, say what it costs (draw calls and triangles from the in-game stats, or frame time) on Low and High. The game must stay smooth on laptops.
- **Multiplayer**: anything that affects the shared world must look the same for every player. If it can't be synced, it must be hidden online.

## Owner-locked decisions

Some decisions are locked by the owner and listed in [`docs/OWNER-DECISIONS.md`](docs/OWNER-DECISIONS.md). Don't change, revert or "improve" any of them, even by accident in an unrelated PR, without the owner's written OK. Guard tests enforce several of them (for example `tools/owner-locked-graphics.test.mjs` locks the one graphics look and the mirror-free chase camera), and they fail with "Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing." Never edit or delete a guard test to get CI green. Ask the owner instead.

## Game design rules (please don't fight these)

- Racing is about time only: no XP, levels, points, money, unlocks or text dialogue.
- The HUD stays simple.
- Terrain next to every drivable road blends to road level so a car can always drive back on (checked by tools/road-terrain-level.test.mjs).
- UI: no native dropdowns (`<select>`), use the shared Select component; every selection/hover/focus state animates; all screens are built from the one shared component set in `src/ui/components.js` + `src/ui/ui.css`, derived from the pause-menu reference style, and update in place (no full re-render or flashing); screen stylesheets only lay components out (checked by tools/ui-components.test.mjs); menus are full screens, not pop-up dialogs, except the sign-in Dialog over the title screen (owner decision, docs/OWNER-DECISIONS.md).
- Nitro only exists on the SEAT.
- New roads and maps are generated bare-simple from OpenStreetMap and elevation data (road shapes, terrain, building blocks). No street-level photo proof is required (owner decision, docs/OWNER-DECISIONS.md).
- Free Cloudflare plan only: no paid services, no new paid APIs.
- Assets must be ours or properly licensed (CC0 / CC-BY with credits added to the matching `CREDITS.txt`). No ripped models, textures, music or sounds.

## Project layout

- `src/` browser game (three.js, no build step), `index.html`, `style.css`
- `server/` shared multiplayer/leaderboard core; `worker/` Cloudflare Worker + Durable Object
- `data/` map data (OpenStreetMap, ODbL), `assets/` textures, audio, icons
- `tools/` tests, physics regression suite, map/asset builders, deploy smoke tests
- `deploy/README.md` Cloudflare deployment notes (maintainer only)

Questions: open an issue or ask in the PR.

## Test commands

Run `npm test` before submitting or deploying. It calls `node tools/run-tests.mjs`,
which runs four independent groups concurrently: unit (two file workers), physics
(two workers with the physics register), damage (one worker with the damage
register), and world (one shared-fixture process). Output is prefixed by group,
with elapsed times and a nonzero exit on failure; remaining groups are stopped
on the first failure. Keep new suites in `tools/test-groups.json`, or import them
from a listed suite. The coverage test rejects any omitted `.test.mjs` file.

Run `npm run test:full` nightly and when changing terrain generation, road cuts,
or geometry packing. It additionally runs Penteli's full-map generated/baked
geometry equality check and Penteli/Megara's exhaustive rendered-terrain scans,
plus the real-world gzip shuffling selection in `generateMapBake`. Those three
full-map checks are explicitly reported as skipped by the pre-deploy gate.
Riviera still receives the full attribute/index equality, two-metre road scan,
25-point shoulder probes, shoreline and sightline regressions, and live rail
contact/rival simulations in `npm test`. Mountain/circuit road, contact, slope,
seam and LOD unit tests remain in the normal gate. No assertion tolerance or
physics timestep changes. World fixtures are generated once per map and shared
within the world test process; no persistent fixture can mask source changes.

The separate release gates remain:

```sh
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs
node tools/check-browser-imports.mjs
```

See `.scratch/test-speed/REPORT.md` for measured timings and exhaustive-check
rationale. Run timing comparisons on a clean `git archive` with dependencies
matching its lockfile; shared checkout edits are not a release input.
