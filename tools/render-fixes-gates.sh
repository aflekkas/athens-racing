#!/usr/bin/env bash
set +e
mkdir -p .scratch/render-fixes/gates
npm test > .scratch/render-fixes/gates/npm-test.log 2>&1
printf '%s\n' "$?" > .scratch/render-fixes/gates/npm-test.exit
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs > .scratch/render-fixes/gates/physics.log 2>&1
printf '%s\n' "$?" > .scratch/render-fixes/gates/physics.exit
node tools/events-test.mjs > .scratch/render-fixes/gates/events.log 2>&1
printf '%s\n' "$?" > .scratch/render-fixes/gates/events.exit
node tools/check-syntax.mjs > .scratch/render-fixes/gates/syntax.log 2>&1
printf '%s\n' "$?" > .scratch/render-fixes/gates/syntax.exit
node tools/check-browser-imports.mjs > .scratch/render-fixes/gates/imports.log 2>&1
printf '%s\n' "$?" > .scratch/render-fixes/gates/imports.exit
npx wrangler deploy --env staging --dry-run > .scratch/render-fixes/gates/wrangler.log 2>&1
printf '%s\n' "$?" > .scratch/render-fixes/gates/wrangler.exit
