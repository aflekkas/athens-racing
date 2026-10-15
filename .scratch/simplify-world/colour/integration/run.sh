#!/bin/bash
set +e
node --test tools/world-art-direction.test.mjs > /tmp/simplify-world-verified-ready/.scratch/simplify-world/colour/integration/owner.log 2>&1
echo $? > /tmp/simplify-world-verified-ready/.scratch/simplify-world/colour/integration/owner.exit
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs > /tmp/simplify-world-verified-ready/.scratch/simplify-world/colour/integration/physics.log 2>&1
echo $? > /tmp/simplify-world-verified-ready/.scratch/simplify-world/colour/integration/physics.exit
node tools/check-syntax.mjs > /tmp/simplify-world-verified-ready/.scratch/simplify-world/colour/integration/syntax.log 2>&1
echo $? > /tmp/simplify-world-verified-ready/.scratch/simplify-world/colour/integration/syntax.exit
node tools/check-browser-imports.mjs > /tmp/simplify-world-verified-ready/.scratch/simplify-world/colour/integration/imports.log 2>&1
echo $? > /tmp/simplify-world-verified-ready/.scratch/simplify-world/colour/integration/imports.exit
