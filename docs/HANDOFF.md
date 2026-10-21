# Athens Racing operations handoff — 21 October 2026

**Status: production cutover blocked on GOOGLE_CLIENT_ID/SECRET.** The owner is
setting the two production OAuth secrets. Production currently serves activation
`db402449`; its normal menu race works without sign-in, but its prebuilt route
catalogue is empty. Correction `35dfb3b1` forwards production's configured route
flags through the train. Keep `production-hold` present until credentials are
available and the signed-in production smoke can finish. Read `/release.json`
and `~/.local/state/athens-release/train.log` for the actual live SHA.

## Live services and assets

- Production: https://athensracing.com (www redirects here), Worker
  `athens-street-racers`, R2 `athens-racing-world`, D1 `athens-racing-accounts`.
- Staging: https://staging.athensracing.com, Worker
  `athens-street-racers-staging`, R2 `athens-racing-world-staging`, D1
  `athens-racing-accounts-staging`. The approved game base is `62dbe66`.
- Both Wrangler environments select
  `manifests/5b7c87c65d6ce353fc3e7ede46d54e91aa79c5303407c58d1d42cca9c921190d.json`.
  Its active set was copied without deletion: **1,750 cell payloads plus four
  manifests, 424,696,493 bytes**. This includes 1,748 tiles and two regional
  payloads. Every source SHA-256 and both buckets' single-part MD5 checksums and
  sizes match. Historical staging objects were retained. Audit:
  `/home/dev/data/agent-feed/release/world-copy-2026-10-21.json`.
- The six route IDs are `psychiko-faros`, `riviera-coast`, `penteli-hill`,
  `penteli-descent`, `megara-club`, and `syntagma-pilot`. Use
  `/?routes=1&route=<id>`; the world remains behind `?map=athens`. Normal menu
  defaults are unchanged. Route JSON is generated into Worker static assets,
  not stored in R2. Its hashes bind to browser source as well as geometry.

## Deploy and finish this release

Use a clean worktree from local `prod`; never touch the shared stale checkout
or index. Check disk first; do not start large work at 85% usage. Test an exact
candidate archive with
`flock /home/dev/.local/state/athens-release/agent-test.lock npm test`, plus
physics regression, syntax and browser-import gates described in `AGENTS.md`.
Commit only intended files, then land with
`git update-ref refs/heads/prod <new> <old>`. Retry a CAS race only after review;
never force-push. The train pushes and deploys committed archives.

The owner must run these from `/home/dev/projects/paraliaki-racing`, entering
values at Wrangler's private prompts; never put values in chat or Git:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID --env production
npx wrangler secret put GOOGLE_CLIENT_SECRET --env production
```

The Google OAuth client must allow
`https://athensracing.com/api/auth/google/callback`. Confirm both secret names
with `npx wrangler secret list --env production`. Then remove
`~/.local/state/athens-release/production-hold`; if promoting the already recorded
SHA, also remove the train's `deployed` marker. Start
`systemctl --user start athens-release.service` and watch `train.log` through
“live on production”. The timer normally runs every ten minutes. The installed
train uses `release-fast.mjs` and runs its own gates, staging and production
builds, deploys and race smokes. Do not hand-deploy Wrangler. Failures are in
`last-failure.log`; `failed` suppresses that SHA. Check the signed-in home page,
one normal menu race, Faros and Riviera before publishing the release notes.

## Add an Athens route

After a new scope approval, author `data/routes/<id>.route.json` against emitted
directed graph and wheel-contact cells, using existing definitions as examples.
Capture/rebind proofs under `data/routes/validation/` with
`tools/capture-route-inputs.mjs`; preserve regional sibling proofs. Validate and
compile with `tools/validate-routes.mjs` and `tools/build-routes.mjs` using their
`--world`, `--graph`, `--routes`, and output/report arguments. Never infer a
race from approximate map coordinates. `prepare-deploy.mjs` rebuilds and checks
the immutable catalogue against the configured manifest and rival plans. Add
the ID to both environments' explicit route flags and build commands, verify
the signed-in opt-in URL on staging, then use the deployment process above.
Copy and checksum any new R2 objects before changing a production pointer.

## Known issues retained

Cold load remains above the 8 s target: Megara **8.1 s**, Penteli hill **9.1 s**
(prior measurements, not remeasured for this release). Still to confirm:
MULTIPLAYER in solo races, Porsche tilt/stray shadow. A traffic-car pile-up was
seen during a Glyfada AI drive. Old per-track loaders remain and still serve
normal menu races; their removal is unfinished. These are not release fixes.
