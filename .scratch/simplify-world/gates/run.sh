#!/bin/bash
set +e
npm test > .scratch/simplify-world/gates/npm.log 2>&1
echo $? > .scratch/simplify-world/gates/npm.exit
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs > .scratch/simplify-world/gates/physics.log 2>&1
echo $? > .scratch/simplify-world/gates/physics.exit
node tools/events-test.mjs > .scratch/simplify-world/gates/events.log 2>&1
echo $? > .scratch/simplify-world/gates/events.exit
node tools/check-syntax.mjs > .scratch/simplify-world/gates/syntax.log 2>&1
echo $? > .scratch/simplify-world/gates/syntax.exit
node tools/check-browser-imports.mjs > .scratch/simplify-world/gates/imports.log 2>&1
echo $? > .scratch/simplify-world/gates/imports.exit
npx wrangler deploy --env staging --dry-run > .scratch/simplify-world/gates/wrangler.log 2>&1
echo $? > .scratch/simplify-world/gates/wrangler.exit
