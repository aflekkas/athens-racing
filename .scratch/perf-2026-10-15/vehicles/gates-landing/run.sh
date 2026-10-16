node --test tools/pov-owner-lock.test.mjs tools/pov-camera.test.mjs tools/vehicle-budgets.test.mjs tools/cockpit-controls.test.mjs tools/cockpit-telltales.test.mjs tools/notifications.test.mjs tools/notice-style.test.mjs tools/settings.test.mjs tools/driving-aids.test.mjs tools/driving-feedback.test.mjs tools/release-notes.test.mjs tools/release-data.test.mjs tools/test-runner-coverage.test.mjs tools/world-art-direction.test.mjs > /tmp/lowpoly-landing-gates/integration.log 2>&1
echo $? > /tmp/lowpoly-landing-gates/integration.exit
node tools/check-syntax.mjs > /tmp/lowpoly-landing-gates/syntax.log 2>&1
echo $? > /tmp/lowpoly-landing-gates/syntax.exit
node tools/check-browser-imports.mjs > /tmp/lowpoly-landing-gates/imports.log 2>&1
echo $? > /tmp/lowpoly-landing-gates/imports.exit
