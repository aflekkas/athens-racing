# ATHENS RACING — Cloudflare deployment

Staging: https://staging.athensracing.com

Production: https://athensracing.com (also https://www.athensracing.com). The Cloudflare worker names remain `athens-street-racers` and `athens-street-racers-staging` to preserve deployed state. Do not rename these Workers, Durable Object classes, bindings or D1 names when changing the public brand.

Worker fallback URLs (not canonical or share URLs): https://athens-street-racers.aflekkas.workers.dev and https://athens-street-racers-staging.aflekkas.workers.dev.

Keep all `paraliaki.*` localStorage keys unchanged so existing player saves survive. The `asr-*` service-worker cache names also remain unchanged; this rename does not create abandoned caches.

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

## Deployment smoke credential (SMOKE_TOKEN)

Deployed Workers require Google sign-in, so the live smoke test needs its own credential. `SMOKE_TOKEN` is a shared secret that signs short-lived smoke sessions. It is not a player account and it does not weaken the sign-in gate:

- The Worker and the Node server accept a smoke session only while `SMOKE_TOKEN` is set to at least 32 characters. Unset, empty or short values disable the path completely.
- A smoke session lasts at most 10 minutes, gets a fixed `SMOKE-<n>` name, and reaches live play and public discovery only. It cannot reach account, friends or presence routes, cannot save leaderboard records, and lobbies it hosts are not listed publicly.
- `tools/deploy-smoke.mjs` and `tools/resumable-smoke-client.mjs` read `SMOKE_TOKEN` from the environment, else from `~/.config/athens-racing/smoke-token`. When sign-in is required and no token is set, the smoke exits at once with `set SMOKE_TOKEN; see deploy/README.md` instead of retrying until it times out.

Generate one value and use the same value in every environment:

```sh
openssl rand -hex 32
```

Install it in each Worker environment. Wrangler prompts for the value, so paste it there rather than putting it in a command argument:

```sh
CLOUDFLARE_ACCOUNT_ID=d6f3d2dc5817687a91d74ccd257bad9e npx wrangler secret put SMOKE_TOKEN --env staging
CLOUDFLARE_ACCOUNT_ID=d6f3d2dc5817687a91d74ccd257bad9e npx wrangler secret put SMOKE_TOKEN --env production
```

Store the same value for the release train to export before the live smoke runs:

```sh
mkdir -p ~/.config/athens-racing && chmod 700 ~/.config/athens-racing
(umask 077; cat > ~/.config/athens-racing/smoke-token)   # paste the value, then press Ctrl-D
chmod 600 ~/.config/athens-racing/smoke-token
```

Run the smoke with the token exported:

```sh
export SMOKE_TOKEN="$(cat ~/.config/athens-racing/smoke-token)"
node tools/deploy-smoke.mjs https://staging.athensracing.com --race
```

Replacing the value means generating a new one, running both `secret put` commands, and updating the local file. Until the new secret is live, the old value still authenticates. The release train must export `SMOKE_TOKEN` from that file before it calls `tools/deploy-smoke.mjs`.

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


## Release notes and versions

Players see the version in **Settings → About** and on the title screen, read the release notes under **What's new**, and get a one-time "What's new in <version>" card on the first launch after an update (never during a race, and not on a brand-new player's very first launch). It all comes from `CHANGELOG.md`.

A version is `YYYY.MM.DD.N`: the release date plus a counter for that day (`2026.10.15.2` is the second release on 15 Oct 2026). The build also carries the short git SHA and the content build id (the `build` in `/sw.js`). `tools/prepare-deploy.mjs` stamps all three into `<meta name="asr-version|asr-sha|asr-build">` in `index.html` and into `/release.json`; it also writes `/credits.json` for the Credits screen. Both datasets are bundled into the HTML shell for immediate offline access, after the content build id is computed. Local dev has none of this and reports `dev`.

**Every player-visible change must add its bullet and screenshot to `## Unreleased` before merging.** The automatic release train cuts version sections and deploys each green `prod` commit to staging and production. Do not manually cut versions or deploy as part of adding release notes.

Use a release-level photo on an unindented line, or indent it under the bullet it illustrates. Alt text is required and becomes the caption unless a quoted caption is supplied:

```md
## Unreleased

- Pick your engine trim in the garage.
  ![Golf engine choices in the garage](assets/changelog/2026.10.15.3/golf-trims.webp "Choose the engine that suits your drive.")

![Racing along the coast](assets/changelog/2026.10.15.3/race-hud.webp "The Riviera at race speed.")
```

Keep photos in `assets/changelog/<version>/` as still, lossy WebP: about 1280 px wide, quality around 75, **under 150,000 bytes each**. Use the latest known version as the screenshot batch directory while writing Unreleased; paths remain stable when the train assigns the next section version, and releases may reuse a photo from an earlier batch. Do not guess the train's next counter or rename shared images when a heading is cut. Use descriptive filenames, alt text and short player-facing captions. Never use bug captures, debug overlays or test-harness UI. Inspect every source photo before adding it.

`npm test` checks alt text, local paths, file existence, lossy WebP encoding, image dimensions (960–1280 px wide, no taller than 1280) and the 150 KB cap. `prepare-deploy` emits a loud **warning, without blocking** when Unreleased contains bullets but no photos. Images are referenced by URL in the small notes metadata; their bytes are never embedded in the boot HTML or JavaScript, or prefetched by the service worker. Opening What's new loads the page's photos lazily as you scroll, inline at the full column width; the one-time card requests them only after VIEW PHOTOS, where a tap opens a photo full screen (Back returns).

Dry run: `node tools/prepare-deploy.mjs`, then serve `.deploy/assets`. Check `/release.json`, the stamped version and the photos after the train releases.

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

The pre-deploy suite command remains **`npm test`**. It runs `tools/run-tests.mjs`, which starts every test file in its own process from one work pool (see "Fast release path" below), reports every failure, and reruns a failed file once, alone. Keep the
train calling the npm command so repository scripts remain the source of truth;
do not duplicate loader flags or file lists in the train. Schedule
`npm run test:full` separately for nightly Penteli bake equality, Penteli/Megara rendered-terrain
scans and real-map compression heuristic checks. Keep the physics regression and browser-import
gates above as separate required gates. Both suite commands must run against
the exact committed archive being released. Test scheduling and fixture details
are in `CONTRIBUTING.md` and `.scratch/test-speed/REPORT.md`.


`deploy/release-train.sh` runs every 10 minutes from the systemd user timer `athens-release.timer` (installed as `~/.local/bin/athens-release-train`). When local `prod` has a new commit, it:
1. Runs every CI gate on a clean `git archive`.
2. Pushes the commit to `origin/prod` and sync-merges `origin/staging`.
3. Deploys staging and runs the live race smoke test, then does the same for production.

A failing commit is recorded and skipped until a newer commit arrives. State and logs are in `~/.local/state/athens-release/` (`train.log`, `last-failure.log`, `deployed`, `failed`).

- `touch ~/.local/state/athens-release/production-hold`: deploy staging only. Remove the file and delete `deployed` to promote the current commit.
- When the repository has a `CLOUDFLARE_API_TOKEN` Actions secret, the train only pushes and GitHub Actions deploys.
- `systemctl --user start athens-release.service`: run now. `journalctl --user -u athens-release`: service output.

## Fast release path (`tools/release-fast.mjs`)

`npm install` was never the slow part (`npm ci` runs only when `package-lock.json` changes, about 19 s). Time went on the gates running one after another, a 9-40 minute test run in which one failing group killed the others, and baking every map three times (dry run, staging, production, about 5 CPU-minutes each). The train, and the staging-lane script in `accfaef6` (patch below), now call `node tools/release-fast.mjs`, so the policy lives in one place. Commits that predate the tool fall back to the old sequential gates.

**`gates`** runs everything at once on the unpacked commit, then reports every failure:

| check | what it runs |
|---|---|
| `tests` | `npm test` (`tools/run-tests.mjs`): one process per test file, as wide as the machine (`ASR_TEST_JOBS`, default min(CPUs, 8)), heaviest first (`tools/test-weights.json`), group limits for the memory-heavy world files |
| `regress-rest`, `regress-stab-K-4` | `tools/physics-test/regress.mjs` split with `REGRESS_PART` (`rest`, `stab:0/4` ... `stab:3/4`); the parts cover exactly the runs of the unsharded script (1261 checks), which still works for CI and local runs |
| `events`, `ghost-lap`, `syntax`, `browser-imports` | the other CI gates, unchanged |
| `build-<env>` | in a private copy of the commit (`<archive>.fast/<env>`): `tools/prepare-deploy.mjs` for that environment, then `wrangler deploy --dry-run` on the finished bundle |

`deploy` uploads the bundle `gates` built, using a copy of `wrangler.jsonc` with its `build` steps removed (`wrangler.prebuilt.jsonc`), so nothing is built twice. Without a prebuilt bundle it builds first.

**Measured (2026-10-18, 8 CPUs, host load 15-30 from other agents, so wall times are inflated 2-4x against an idle box):**

| step | before | after |
|---|---|---|
| `npm test` | 9 min idle, 15-40 min loaded; one failing group killed the rest | 3.9-4.6 min, in parallel with everything else below; all failures reported, flaky files retried alone |
| standalone physics regression | 232 s wall (184 CPU-s), after `npm test` | 147 s wall as 5 parts beside the tests (about 60 CPU-s on the longest part) |
| events, ghost lap, syntax, browser imports | about 20 s, in sequence | in parallel, off the critical path |
| `prepare-deploy` (map bake) | 535 s wall / 320 CPU-s, run 3 times (dry run, staging, production) | cold bake 172 s wall (maps in parallel), only after map code or data changed; otherwise 9-15 s, once per environment |
| `wrangler deploy` | build + upload | upload only, 10-13 s |
| live smoke | 20 s sleep + 94 s | 5 s sleep + 94 s (the race is real-time: 86 s at the server's 120 m/s speed cap) |
| commit to staging | 24 min good runs, 42 min today (`b91e761`), 15-40 min lost per flaky failure | about 4.5 min of gates + 12 s deploy + 100 s smoke when the bake is cached; 9 min on a cold bake |
| staging to production (same tree) | 8.1 min (bake and tests partly rerun) | about 2.3 min: gates 20 s (proven on the tree), build 15 s, deploy 11 s, smoke 100 s |

The timer still fires every 10 minutes, so add up to 10 minutes of waiting to a commit.

**Same tree, no rerun.** A passing check is recorded in `~/.cache/athens-release/gates/<node major>-<git tree hash>/<check>-<hash of its command>.json`. A re-deploy, a retry after a deploy or smoke failure, the sync-merge commit pushed to `staging` and a release merge commit whose tree equals the tested `staging` tree all skip the checks that already passed on that tree. Only passes are recorded; a failure always reruns. Delete the directory (or run with `--no-cache`) to force a full run. Builds are never cached as results (they are the deploy artifact), but they are cheap, see the bake cache.

**Bake cache** (`tools/bake-cache.mjs`, used by `tools/bake-world.mjs`): the world bake is nearly all of `prepare-deploy`. Each map's output (the `data/baked/*` downloads, its data file with the `bakedWorld` field, its codec policy) is stored under `~/.cache/athens-release/bake/<key>/`. The key hashes:
- every local source file `tools/bake-world.mjs` imports, found with an esbuild metafile (so terrain, road, pack or catalogue changes miss, and a UI-only change cannot), except `src/asset-codec-policy.js`, which is the bake's own output;
- the map's data and terrain files, the only files the bake reads at run time. The bake fails if it ever reads another file, so a hidden input cannot make the cache stale;
- the three.js and Node/zlib versions and a `CACHE_VERSION` constant.

A hit installs byte-identical files (the whole `.deploy/assets` tree hashes the same cold and warm). Misses bake in parallel child processes (`ASR_BAKE_JOBS`, default min(3, CPUs)). Entries are published by atomic rename, so trains and agents can share the cache. It is capped (`ASR_CACHE_MAX_BYTES`, default 3 GB; least recently used first; the newest four and anything under ten minutes old are kept) and `release-fast.mjs prune` also deletes gate records older than 30 days and stray `/tmp/athens-release-*.fast` dirs older than six hours. `ASR_BAKE_CACHE=off` bypasses it; `ASR_CACHE_DIR` moves it.

**Flaky tests.** A test file that fails is rerun once, alone, after the pool drains (the machine is then quiet). If it passes, the run passes, and the first attempt's output is printed under `[flaky]`, listed in the `[summary]`, appended as JSON lines to `$ASR_TEST_FLAKY_LOG` and written by the train to `train.log` as `<sha> flaky test <file>: failed under load (...), passed alone on retry (...)`. GitHub Actions also gets a `::warning`. A file that fails twice fails the run, so a deterministic failure is never masked. If more than 12 files fail it is a breakage, not flakiness, and nothing is retried. `--no-retry` (or `ASR_TEST_RETRY=0`) turns retry off. Grep `flaky test` in `train.log` to see which tests need de-flaking.

**Browser tests** (for example `tools/garage-cards.test.mjs`) go through `tools/browser-slot.sh`. The train's tests use their own pool (`BROWSER_SLOT_POOL=release`, two slots), so they no longer queue behind other agents' browsers (one such test waited 590 s). Other agents' pool is unchanged.

**Train integration.** `~/.local/bin/athens-release-train` calls `gates --envs staging[,production]` (production is skipped while `production-hold` exists), `deploy --env <env>`, then its own smoke test (with the `SMOKE_TOKEN` export); `prune` runs after the gates. The release-by-PR train from `accfaef6` needs the same few edits: `deploy/release-fast-newflow.patch` applies to `deploy/athens-release-train.sh` as it is in that commit (`git apply deploy/release-fast-newflow.patch`). The patch also adds the `SMOKE_TOKEN` export to that script's `smoke()`, which that commit predates.

Stage logs: `<archive>.fast/logs/*.log` during a run (removed with the archive); failures are copied to `~/.local/state/athens-release/last-failure.log` as before. `train.log` gains `gates passed in N s; ... slowest: ...` and `wrangler deploy <env> finished in N s` lines.
