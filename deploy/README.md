# Cloudflare deployment

Staging: https://paraliaki-racing-staging.aflekkas.workers.dev

Production is configured as `paraliaki-racing` and will use https://paraliaki-racing.aflekkas.workers.dev after its first authorised deploy. Production has not been deployed by this task.

Account: **Aflekkas@gmail.com's Account**, `d6f3d2dc5817687a91d74ccd257bad9e`. Never deploy into the other accounts returned by `wrangler whoami`.

## Architecture

Workers Static Assets serves the browser game directly from the CDN. Only `/ws`, `/api/*` and `/health` invoke the Worker. `tools/prepare-deploy.mjs` creates a clean `.deploy/assets` allowlist of index.html, style.css, src/, assets/ and data/, excludes hidden files, symlinks, test modules and `.orig` backups, and rejects files above 25 MiB. Tools, server code, node_modules, scratch output, repository metadata and chain.pid are absent. No client bundling is required; three.js retains its existing CDN importmap.

One SQLite-backed `GameArena` Durable Object per environment owns discovery, lobbies, the clock, bounded state validation, relay and the persistent leaderboard. All lobbies initially share one arena, which shares duration across concurrent races and keeps same-origin `/ws` and public discovery simple. The object uses `acceptWebSocket` and hibernation callbacks. Socket attachments preserve latest telemetry through hibernation; SQLite-backed storage preserves lobby transitions and disconnected sessions. The leaderboard uses indexed SQLite rows, caps each map/version/event/car/traffic board at 200 drivers and shares validation rules with the Node backend. POST rate limits survive hibernation.

`server/core.mjs` implements one protocol for both Cloudflare and the existing Node server. Node retains `createGameServer`, static serving, health, JSON-file leaderboard, heartbeat, reconnect grace and existing tests. A missing optional map bundle logs and is skipped; Riviera remains required. Lobby selection, ready votes and event validation use each map's route version. Changing maps resets readiness.

Physics stays in the browser. Clients sample at 10 Hz and can send two samples in a `states` packet at 5 packets/s, suppressing unchanged stationary telemetry. The core retains compatibility with single `state` packets. The server coalesces snapshots to at most 10 Hz per lobby and broadcasts only changed state. Waiting/results lobbies expire after 30 minutes without lobby activity; disconnected seats expire after 90 seconds. The DO has no repeating idle timer: alarms cover countdown/race deadlines and expiry, and a short relay timeout exists only after a racing state change. Client clock sync is once per 30 seconds; discovery is pushed or explicitly refreshed. Optional raw `keepalive`/`alive` is answered by Cloudflare without waking JavaScript.

## Local checks and staging deploy

```sh
npm ci
npm test
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs
node tools/events-test.mjs
node tools/replay.test.mjs
node tools/check-syntax.mjs
npx wrangler deploy --env staging --dry-run
npx wrangler deploy --env staging
node tools/deploy-smoke.mjs https://paraliaki-racing-staging.aflekkas.workers.dev
node tools/deploy-smoke.mjs https://paraliaki-racing-staging.aflekkas.workers.dev --race
```

On the shared VPS, release only a committed snapshot that has passed CI. Other agents can be editing the checkout during deployment; copying that working tree can publish an incomplete client module. Push the intended HEAD to staging and deploy an archive rather than a worktree:

```sh
mkdir -p .scratch
release_repo_root="$(pwd)"
release_artifact_dir="$(mktemp -d "$release_repo_root/.scratch/release.XXXXXX")"
git archive HEAD | tar -xf - -C "$release_artifact_dir"
ln -s "$release_repo_root/node_modules" "$release_artifact_dir/node_modules"
(cd "$release_artifact_dir" && node_modules/.bin/wrangler deploy --env staging)
```

This assumes `npm ci` has installed the committed lockfile. If deploying another revision with different dependencies, run `npm ci` in its archive instead of sharing node_modules. GitHub Actions already deploys a committed checkout.

`--race --map=megara` and `--race --map=penteli` also exercise their map-specific routes. Full race smoke sends bounded simulated progress at 120 m/s, checks two clients share raceId/startAt, sees relayed state and verifies both finishes. It uses a private temporary lobby and explicitly leaves afterward. The simulated records use clearly named deployment-smoke drivers.

The existing VPS service on port 8000 is independent. Deploying Workers does not restart or stop it.

## GitHub Actions and the required API token

The CI workflow runs on PRs and pushes to main/staging. It installs from the lockfile, runs all four required test gates, checks syntax and dry-runs the Worker bundle. Pushes deploy staging from `staging` and production from `main`, then fetch HTML/module/asset and complete a `/ws` create-lobby round trip. Deploys require a passing test job. Without an API token the workflow reports a notice and skips deployment; a green test run alone does **not** mean GitHub deployed a Worker. The first staging deployment used the VPS OAuth login.

Create the CI token yourself; never copy the Wrangler OAuth token into GitHub:

1. Sign in to https://dash.cloudflare.com/ as aflekkas@gmail.com.
2. Open **My Profile → API Tokens → Create Token** (https://dash.cloudflare.com/profile/api-tokens).
3. Choose **Edit Cloudflare Workers → Use template**.
4. Under **Account Resources**, select **Include → Specific account → Aflekkas@gmail.com's Account** (`d6f3d2dc5817687a91d74ccd257bad9e`). Keep the template's Workers edit permissions. No custom-domain route is needed for workers.dev.
5. Choose a suitable expiry, **Continue to summary → Create Token**, and copy the token once.
6. From a terminal authenticated to GitHub, run the commands below. Paste the token into the first command's hidden interactive prompt; do not put it in a command argument, chat or repository file.

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo aflekkas/paraliaki-racing
gh secret set CLOUDFLARE_ACCOUNT_ID --repo aflekkas/paraliaki-racing --body d6f3d2dc5817687a91d74ccd257bad9e
```

The account-ID secret is already set. After adding the token, rerun the most recent staging CI run in GitHub Actions, or use `gh run rerun <run-id> --repo aflekkas/paraliaki-racing`. Only a successful deploy step followed by the live smoke step confirms automated deployment. Production awaits the orchestrator's approval and a push to main.

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
