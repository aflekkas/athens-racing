#!/usr/bin/env bash
# VPS release train: tests the newest local `prod` commit on a clean archive and, if every CI gate passes,
# pushes it to origin/prod, sync-merges origin/staging, then deploys staging and production. Each deploy must
# pass the live smoke test before the next step runs.
# If the GitHub repo has a CLOUDFLARE_API_TOKEN secret, deploys are left to GitHub Actions and the train only pushes.
# Touch $STATE/production-hold to deploy staging only: origin/prod and production stay untouched until the hold is removed.
# Run by the systemd user timer athens-release.timer (see deploy/README.md). Never touches the shared checkout.
set -uo pipefail
REPO=/home/dev/projects/paraliaki-racing
STATE=$HOME/.local/state/athens-release
mkdir -p "$STATE"
exec 9>"$STATE/lock"; flock -n 9 || exit 0
LOG="$STATE/train.log"
log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }
cd "$REPO" || exit 1
git fetch -q origin || { log "fetch failed"; exit 1; }
C=$(git rev-parse prod); S=${C:0:7}
[ "$C" = "$(cat "$STATE/deployed" 2>/dev/null)" ] && exit 0
[ "$C" = "$(cat "$STATE/failed" 2>/dev/null)" ] && exit 0
git merge-base --is-ancestor origin/prod "$C" || { log "$S does not fast-forward origin/prod; skipped"; echo "$C" > "$STATE/failed"; exit 1; }
D=$(mktemp -d /tmp/athens-release-$S.XXXX); trap 'rm -rf "$D"' EXIT
git archive "$C" | tar -x -C "$D"
if cmp -s <(git show "$C:package-lock.json") package-lock.json; then ln -s "$REPO/node_modules" "$D/node_modules"; else (cd "$D" && npm ci --no-audit --no-fund > "$STATE/npm-ci.log" 2>&1) || { log "$S npm ci failed"; echo "$C" > "$STATE/failed"; exit 1; }; fi
cd "$D"
fail() { log "$S FAILED: $1 (see $STATE/last-failure.log)"; cp "$2" "$STATE/last-failure.log" 2>/dev/null; echo "$C" > "$STATE/failed"; exit 1; }
gate() { timeout 3600 "$@" > gate.log 2>&1 || fail "$*" gate.log; }
log "$S testing"
gate npm test
gate node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs
gate node tools/events-test.mjs
gate node tools/ghost-lap.test.mjs
gate node tools/check-syntax.mjs
gate node tools/check-browser-imports.mjs
gate npx wrangler deploy --env staging --dry-run
cd "$REPO"
HOLD=; [ -e "$STATE/production-hold" ] && HOLD=1
[ -z "$HOLD" ] && { git push -q origin "$C:refs/heads/prod" 2> "$D/push.log" || fail "push prod" "$D/push.log"; }
if ! git merge-base --is-ancestor "$C" origin/staging; then
  M=$(git commit-tree "$C^{tree}" -p origin/staging -p "$C" -m "Sync staging with prod $S")
  git push -q origin "$M:refs/heads/staging" 2> "$D/push.log" || fail "push staging" "$D/push.log"
fi
if gh secret list -R aflekkas/athens-racing 2>/dev/null | grep -q '^CLOUDFLARE_API_TOKEN'; then
  log "$S pushed; GitHub Actions deploys"; echo "$C" > "$STATE/deployed"; exit 0
fi
cd "$D"
smoke() { timeout 600 node tools/deploy-smoke.mjs "$1" --race --map=riviera > smoke.log 2>&1 || { sleep 30; timeout 600 node tools/deploy-smoke.mjs "$1" --race --map=riviera > smoke.log 2>&1; }; }
ENVS="staging production"; [ -n "$HOLD" ] && ENVS=staging
for env in $ENVS; do
  url=https://athensracing.com; [ $env = staging ] && url=https://staging.athensracing.com
  ASR_GIT_SHA=$S timeout 2700 node_modules/.bin/wrangler deploy --env $env > deploy.log 2>&1 || fail "deploy $env" deploy.log
  sleep 20; smoke $url || fail "smoke $env" smoke.log
  log "$S live on $env"
done
[ -n "$HOLD" ] && { log "$S production held"; echo "$C" > "$STATE/deployed"; exit 0; }
echo "$C" > "$STATE/deployed"
