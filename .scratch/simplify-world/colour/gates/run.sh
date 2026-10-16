#!/bin/bash
set +e
npm test > .scratch/simplify-world/colour/gates/npm.log 2>&1
echo $? > .scratch/simplify-world/colour/gates/npm.exit
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs > .scratch/simplify-world/colour/gates/physics.log 2>&1
echo $? > .scratch/simplify-world/colour/gates/physics.exit
node tools/events-test.mjs > .scratch/simplify-world/colour/gates/events.log 2>&1
echo $? > .scratch/simplify-world/colour/gates/events.exit
node tools/check-syntax.mjs > .scratch/simplify-world/colour/gates/syntax.log 2>&1
echo $? > .scratch/simplify-world/colour/gates/syntax.exit
node tools/check-browser-imports.mjs > .scratch/simplify-world/colour/gates/imports.log 2>&1
echo $? > .scratch/simplify-world/colour/gates/imports.exit
npx wrangler deploy --env staging --dry-run > .scratch/simplify-world/colour/gates/wrangler.log 2>&1
echo $? > .scratch/simplify-world/colour/gates/wrangler.exit
