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

## Game design rules (please don't fight these)

- Racing is about time only: no XP, levels, points, money, unlocks or text dialogue.
- The HUD stays simple.
- Terrain next to every drivable road blends to road level so a car can always drive back on (checked by tools/road-terrain-level.test.mjs).
- UI: no native dropdowns (`<select>`), use the shared Select component; every selection/hover/focus state animates; all screens are built from the shared components in `src/ui/components.js` and update in place (no full re-render or flashing); menus are full screens, not pop-up dialogs.
- Nitro only exists on the SEAT.
- New tracks are built from real street-level imagery of the real road, with side-by-side comparison screenshots in the PR.
- Free Cloudflare plan only: no paid services, no new paid APIs.
- Assets must be ours or properly licensed (CC0 / CC-BY with credits added to the matching `CREDITS.txt`). No ripped models, textures, music or sounds.

## Project layout

- `src/` browser game (three.js, no build step), `index.html`, `style.css`
- `server/` shared multiplayer/leaderboard core; `worker/` Cloudflare Worker + Durable Object
- `data/` map data (OpenStreetMap, ODbL), `assets/` textures, audio, icons
- `tools/` tests, physics regression suite, map/asset builders, deploy smoke tests
- `deploy/README.md` Cloudflare deployment notes (maintainer only)

Questions: open an issue or ask in the PR.
