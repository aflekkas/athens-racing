node --test tools/vehicle-budgets.test.mjs tools/pov-camera.test.mjs tools/cockpit-controls.test.mjs tools/cockpit-telltales.test.mjs tools/svj.test.mjs tools/car-catalog.test.mjs tools/brand-badges.test.mjs tools/release-notes.test.mjs tools/release-data.test.mjs tools/world-art-direction.test.mjs tools/settings.test.mjs tools/mirror-cadence.test.mjs tools/test-runner-coverage.test.mjs > /tmp/lowpoly-final-rebase-gates/focused.log 2>&1
echo $? > /tmp/lowpoly-final-rebase-gates/focused.exit
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs > /tmp/lowpoly-final-rebase-gates/physics.log 2>&1
echo $? > /tmp/lowpoly-final-rebase-gates/physics.exit
node tools/events-test.mjs > /tmp/lowpoly-final-rebase-gates/events.log 2>&1
echo $? > /tmp/lowpoly-final-rebase-gates/events.exit
node tools/check-syntax.mjs > /tmp/lowpoly-final-rebase-gates/syntax.log 2>&1
echo $? > /tmp/lowpoly-final-rebase-gates/syntax.exit
node tools/check-browser-imports.mjs > /tmp/lowpoly-final-rebase-gates/imports.log 2>&1
echo $? > /tmp/lowpoly-final-rebase-gates/imports.exit
