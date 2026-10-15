# Athens Street Racers — Cloudflare deployment

Staging: https://staging.athensracing.com

Production: https://athensracing.com (also https://www.athensracing.com). The Cloudflare worker names remain `athens-street-racers` and `athens-street-racers-staging`.

Account: **Aflekkas@gmail.com's Account**, `d6f3d2dc5817687a91d74ccd257bad9e`. Never deploy into the other accounts returned by `wrangler whoami`.

The previous worker at https://paraliaki-racing-staging.aflekkas.workers.dev is retained. This rename does not delete it or migrate its temporary lobby state.

The GitHub repository is [aflekkas/athens-racing](https://github.com/aflekkas/athens-racing). The shared VPS checkout remains `/home/dev/projects/paraliaki-racing`, and its existing systemd service name remains `paraliaki-racing`.

Use the Workers Free plan. The configuration uses only Free-compatible features, including SQLite-backed Durable Objects (`new_sqlite_classes`). This rename does not change account subscriptions or enable paid services. Free quotas are shared with the retained old worker.

## Architecture

Workers Static Assets serves the browser game directly from the CDN. Only `/ws`, `/api/*` and `/health` invoke the Worker. `tools/prepare-deploy.mjs` creates a clean `.deploy/assets` allowlist of index.html, style.css, src/, assets/ and data/, excludes hidden files, symlinks, test modules and `.orig` backups, and rejects files above 25 MiB. Tools, server code, node_modules, scratch output, repository metadata and chain.pid are absent. The browser import graph is validated before packaging (without writing a bundle). No client bundling is required; three.js retains its existing CDN importmap.

One SQLite-backed `GameArena` Durable Object per environment owns discovery, lobbies, the clock, bounded state validation, relay and the persistent leaderboard. All lobbies initially share one arena, which shares duration across concurrent races and keeps same-origin `/ws` and public discovery simple. The object uses `acceptWebSocket` and hibernation callbacks. Socket attachments preserve latest telemetry through hibernation; SQLite-backed storage preserves lobby transitions and disconnected sessions. The leaderboard uses indexed SQLite rows, caps each map/version/event/car/traffic board at 200 drivers and shares validation rules with the Node backend. POST rate limits survive hibernation.

`server/core.mjs` implements one protocol for both Cloudflare and the existing Node server. Node retains `createGameServer`, static serving, health, JSON-file leaderboard, heartbeat, reconnect grace and existing tests. A missing optional map bundle logs and is skipped; Riviera remains required. Lobby selection, ready votes and event validation use each map's route version. Changing maps resets readiness.

Protocol 7 adds host car rulesets (`carRules`), per-player pace (`pi`/`class`) and Balance of Performance (`balance`) to lobby publishes, with pace data shipped in `.deploy/catalogue.json` (`carSpecs`). The worker and the browser client must deploy together: a protocol-6 client is asked to reload and never mixes into a protocol-7 lobby, and a worker without `carSpecs` rejects every spec-dependent ruleset while open lobbies keep racing.

Physics stays in the browser. Clients sample at 10 Hz and can send two samples in a `states` packet at 5 packets/s, suppressing unchanged stationary telemetry. The core retains compatibility with single `state` packets. The server coalesces snapshots to at most 10 Hz per lobby and broadcasts only changed state. Waiting/results lobbies expire after 30 minutes without lobby activity; disconnected seats expire after 90 seconds. The DO has no repeating idle timer: alarms cover countdown/race deadlines and expiry, and a short relay timeout exists only after a racing state change. Client clock sync is once per 30 seconds; discovery is pushed or explicitly refreshed. Optional raw `keepalive`/`alive` is answered by Cloudflare without waking JavaScript.

## Local checks and staging deploy

```sh
npm ci
npm test
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs
node tools/events-test.mjs
node tools/ghost-lap.test.mjs
node tools/check-syntax.mjs
node tools/check-browser-imports.mjs
npx wrangler deploy --env staging --dry-run
npx wrangler deploy --env staging
node tools/deploy-smoke.mjs https://staging.athensracing.com
node tools/deploy-smoke.mjs https://staging.athensracing.com --race
```

On the shared VPS, release only a committed snapshot that has passed CI. Other agents can be editing the checkout during deployment; copying that working tree can publish an incomplete client module. Push the intended HEAD to staging and deploy an archive rather than a worktree:

```sh
mkdir -p .scratch
release_repo_root="$(pwd)"
release_artifact_dir="$(mktemp -d "$release_repo_root/.scratch/release.XXXXXX")"
release_git_sha="$(git rev-parse --short HEAD)"
git archive HEAD | tar -xf - -C "$release_artifact_dir"
ln -s "$release_repo_root/node_modules" "$release_artifact_dir/node_modules"
(cd "$release_artifact_dir" && ASR_GIT_SHA="$release_git_sha" node_modules/.bin/wrangler deploy --env staging)
```

`ASR_GIT_SHA` is only needed for an archive copy, which has no `.git`; without it the About screen shows no commit (CI uses `GITHUB_SHA`; a plain checkout asks git).

This assumes `npm ci` has installed the committed lockfile. If deploying another revision with different dependencies, run `npm ci` in its archive instead of sharing node_modules. GitHub Actions already deploys a committed checkout.

`--race --map=megara` and `--race --map=penteli` also exercise their map-specific routes. Full race smoke sends bounded simulated progress at 120 m/s, checks two clients share raceId/startAt, sees relayed state and verifies both finishes. It uses a private temporary lobby and explicitly leaves afterward. The simulated records use clearly named deployment-smoke drivers.

The existing VPS service on port 8000 is independent. Deploying Workers does not restart or stop it.

## GitHub Actions and the required API token

The CI workflow runs on PRs and pushes to prod/staging. It installs from the lockfile, runs all four required test gates, checks syntax and the full browser import graph, then dry-runs the Worker bundle. Pushes deploy staging from `staging` and production from `prod`, then fetch HTML/module/asset and complete a `/ws` create-lobby round trip. Deploys require a passing test job. Without an API token the workflow reports a notice and skips deployment; a green test run alone does **not** mean GitHub deployed a Worker. The first staging deployment used the VPS OAuth login.

Create the CI token yourself; never copy the Wrangler OAuth token into GitHub:

1. Sign in to https://dash.cloudflare.com/ as aflekkas@gmail.com.
2. Open **My Profile → API Tokens → Create Token** (https://dash.cloudflare.com/profile/api-tokens).
3. Choose **Edit Cloudflare Workers → Use template**.
4. Under **Account Resources**, select **Include → Specific account → Aflekkas@gmail.com's Account** (`d6f3d2dc5817687a91d74ccd257bad9e`). Keep the template's Workers edit permissions. Custom domains are configured in `wrangler.jsonc`.
5. Choose a suitable expiry, **Continue to summary → Create Token**, and copy the token once.
6. From a terminal authenticated to GitHub, run the commands below. Paste the token into the first command's hidden interactive prompt; do not put it in a command argument, chat or repository file.

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo aflekkas/athens-racing
gh secret set CLOUDFLARE_ACCOUNT_ID --repo aflekkas/athens-racing --body d6f3d2dc5817687a91d74ccd257bad9e
```

The account-ID secret is already set. After adding the token, rerun the most recent staging CI run in GitHub Actions, or use `gh run rerun <run-id> --repo aflekkas/athens-racing`. Only a successful deploy step followed by the live smoke step confirms automated deployment. Production awaits the orchestrator's approval and a promotion of a tested `staging` commit to `prod`.

## Free-tier headroom

Pricing checked 2026-10-13 against [Workers static-asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/). Static requests/storage are unlimited and free. Dynamic Worker requests and DO request equivalents each have a 100,000/day allowance; DO duration allows 13,000 GB-s/day. Incoming WebSocket messages count at 20:1; outgoing messages are uncharged. Opening sockets, HTTP calls and alarms also consume DO requests. Limits are account-wide, shared by staging/production and other projects; exceeding Free limits fails requests rather than silently providing unlimited service.

With two 10 Hz samples per packet, each moving player sends 5 packets/s, or 0.25 DO request equivalents/s. Ignoring control overhead, this is about **111.1 active player-hours/day**. Single-sample legacy clients halve that headroom. Stationary suppression increases it.

| Simultaneously moving players | Incoming packets/s | DO request equivalents/s | Raw racing headroom/day | Conservative racing headroom/day |
| --- | ---: | ---: | ---: | ---: |
| 8 (one full lobby) | 40 | 2 | 13 h 53 min | 12 h 20 min |
| 50 (several lobbies) | 250 | 12.5 | 2 h 13 min | 1 h 50 min |

The conservative column reserves 10,000 request equivalents for connections, menus, API calls and alarms, plus a full day's 30-second clock pings: 1,152 equivalents for 8 connected players or 7,200 for 50. A packet can contain one sample when flushing; more frequent partial batches reduce these figures. Idle clients send no racing samples; clock pings still incur brief execution and request usage. Hibernation removes standing idle duration, not the cost of application messages.

One continuously active arena costs at most `0.125 GB × 86,400 s = 10,800 GB-s/day`, below 13,000. Two continuously active environments would exceed it. A moving 8-player lobby for 12 h 20 min consumes roughly 5,550 GB-s; 50 players for 1 h 50 min consume roughly 825 GB-s because concurrent lobbies share the arena. Actual event CPU, unrelated account usage and alarms remain additional constraints.

SQLite's daily allowances are 5 million rows read and 100,000 rows written, with 5 GB storage on Free. Telemetry uses attachments instead of per-sample SQLite writes. At 8 players finishing five-minute races for 12 hours (~1,152 finishes/day), indexed leaderboard writes remain in the low thousands, plus a few thousand lobby/session updates and POST throttling rows. Monitor Cloudflare metrics before growing usage; retained leaderboard versions can accumulate over time. JSON attachments are bounded below Cloudflare's 2 KiB socket-attachment limit.

The P2P alternative and TURN fallback trade-off are in [docs/multiplayer-cost.md](../docs/multiplayer-cost.md). It is a future option, not part of this deployment.

## Local drivers

Players go straight to the title screen. Settings → Driver sets a local driver
name (3–16 A–Z, 0–9 or hyphens, with a light profanity/staff-name filter).
Names do not need to be unique. The name appears on the plate and in multiplayer.
A fresh browser generates a name such as `GR-1234` and stores it in localStorage.
Paint and driver presets also stay in this browser. There are no accounts,
sign-in screens, cookies, recovery codes, social APIs or account-owned uploads.

Multiplayer assigns an independent identity to each connection. A short-lived
reconnect token in sessionStorage preserves a disconnected racer for 90 seconds;
it is not a login. Best-time leaderboards remain available without accounts.

The existing SQLite Durable Object performs a one-time, transactional cleanup
of retired identity/social/customization-owner tables and records a KV marker.
It preserves the arena, live reconnect state and leaderboards, adds no service
or paid binding, and does not scan tables or schedule background work.

Local Worker checks: start `wrangler dev --local --port 19631`, then run
`ASR_TEST_BASE=http://127.0.0.1:19631 node --test worker/local-driver.test.mjs`.

## Music sources

Fresh players start with **Music Off**. Settings → Sound → MUSIC SOURCE provides
local files/folders, optional Built-in radio and a visible **menu-only** YouTube
stream/playlist player. Files never leave the device.
Chromium can save chosen file/folder handles in IndexedDB; Restore may request
read permission again. Other browsers require selecting files again next visit.
Use J for local music mute and N for next track. L switches the gearbox mode, M opens the big map.
See [current research and official links](../docs/music-sources.md).

YouTube embeds need no Data API key. Users explicitly load an embeddable URL and
press native Play. Preserve visible controls, ads and branding; do not enable
hidden/audio-only or background-tab playback. The player pauses when scrolled
away and is destroyed when Sound settings closes. It cannot share WebAudio;
its API volume follows master × music. ERT stream endpoints are documented in
the research but are not shipped as presets without station/rights permission.
No music source requires a Cloudflare paid feature or a streaming proxy.

## Release notes and versions

Players see the version in **Settings → About** and on the title screen, read the release notes under **What's new**, and get a one-time "What's new in <version>" card on the first launch after an update (never during a race, and not on a brand-new player's very first launch). It all comes from `CHANGELOG.md`.

A version is `YYYY.MM.DD.N`: the release date plus a counter for that day (`2026.10.15.2` is the second release on 15 Oct 2026). The build also carries the short git SHA and the content build id (the `build` in `/sw.js`). `tools/prepare-deploy.mjs` stamps all three into `<meta name="asr-version|asr-sha|asr-build">` in `index.html` and into `/release.json`; it also writes `/credits.json` for the Credits screen. Both datasets are bundled into the HTML shell for immediate offline access, after the content build id is computed. Local dev has none of this and reports `dev`.

**Before promoting to prod** (the release step, done by the maintainer or lead):

1. Open `CHANGELOG.md`. Under `## Unreleased`, write or tidy the bullets for players: short, plain, no file names or internal jargon, one sentence each, what they can now see, hear or do.
2. Rename `## Unreleased` to the new version and date, e.g. `## 2026.10.16.1 — 2026-10-16`. Use `.2`, `.3`... for another release on the same day. Add a fresh empty `## Unreleased` above it. Versions must be newest first; the build fails on a bad heading, an older version above a newer one, or a release with no bullets.
3. Commit it. The newest dated section is the version `prepare-deploy` stamps, so the commit you deploy must contain it.
4. Deploy as above. `node tools/prepare-deploy.mjs` prints `release.version`, `sha` and `build`, and warns if `Unreleased` still has bullets (they would ship unlabelled) or a git author is missing from `CREDITS.md`.
5. After the deploy, check `/release.json` shows the version and that the title screen corner reads `V<version>`.

Staging builds carry the same stamp, so a staging playtest shows the version the next prod release will have once the section is dated. Dry run: `node tools/prepare-deploy.mjs`, then serve `.deploy/assets`.

**Credits** are generated at deploy time: `CREDITS.md` (team and AI line), every `CREDITS*`, `LICENSE*`, `NOTICE*` file under the repo (and `MODELS.md` beside the Greek voices), the "Data and credits" list in `README.md`, the fonts in `index.html` and `package.json`. Add a new asset's credits file next to it and it appears automatically; `tools/release-data.test.mjs` fails if a credits file exists that the screen does not include, or if a git author is not in `CREDITS.md`.

## Branches

| Branch | Deploys to | Who updates it |
|---|---|---|
| `staging` (default) | https://staging.athensracing.com | PRs from contributor branches, after CI and code-owner review |
| `prod` | https://athensracing.com | The maintainer only, by promoting a commit already tested on staging |

`main` was renamed to `prod` on 2026-10-15; GitHub redirects old `main` references. Both branches are protected (PR + `test` check + code-owner approval, no force-pushes). Promote with a fast-forward of `prod` to the tested `staging` commit, then deploy production from a clean `git archive` of that exact commit and run `tools/deploy-smoke.mjs --race` against each map.


### Menu build identity

Wrangler's `staging` and `production` environments explicitly set `ASR_BUILD_ENV` in their build commands. `tools/prepare-deploy.mjs` injects `asr-environment` metadata before bundling and content hashing. Only `production` hides the badge; all other packaged builds show STAGING with the release version. A source checkout without metadata shows DEV. Never reuse staging assets for a production deploy.

## Automatic releases (VPS release train)

`deploy/release-train.sh` runs every 10 minutes from the systemd user timer `athens-release.timer` (installed as `~/.local/bin/athens-release-train`). When local `prod` has a new commit, it:
1. Runs every CI gate on a clean `git archive`.
2. Pushes the commit to `origin/prod` and sync-merges `origin/staging`.
3. Deploys staging and runs the live race smoke test, then does the same for production.

A failing commit is recorded and skipped until a newer commit arrives. State and logs are in `~/.local/state/athens-release/` (`train.log`, `last-failure.log`, `deployed`, `failed`).

- `touch ~/.local/state/athens-release/production-hold`: deploy staging only. Remove the file and delete `deployed` to promote the current commit.
- When the repository has a `CLOUDFLARE_API_TOKEN` Actions secret, the train only pushes and GitHub Actions deploys.
- `systemctl --user start athens-release.service`: run now. `journalctl --user -u athens-release`: service output.
