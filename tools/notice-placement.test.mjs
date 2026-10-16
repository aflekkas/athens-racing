// OWNER LOCK (docs/OWNER-DECISIONS.md, 2026-10-16): in-race notices never sit in the driver's view. They stack small in
// the top-left corner (under the timer) or, on narrow screens, as one slim notice at the very top edge; persistent
// states (police pursuit level) are a HUD badge. Never over the road ahead, a mirror, the speed sign or the minimap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { notificationPlacement, drivingArea, rectanglesOverlap, TOAST_MS, MAX_MS, NotificationQueue } from '../src/ui/notification-queue.js';

const OWNER = 'Owner-locked decision, see docs/OWNER-DECISIONS.md ("in-race notices stay out of the driving view"). Ask the owner before changing.';
/** the race HUD as measured in the real scene (.scratch/one-component-set race captures), per viewport and camera */
function hud(width, height, view) {
  const phone = width < 700, o = {};
  o.posBox = phone ? { left: 10, right: 196, top: 10, bottom: 84 } : { left: 28, right: 262, top: 24, bottom: 112 };
  o.lapTiming = phone ? null : { left: 28, right: 198, top: 116, bottom: 178 };
  o.route = phone ? { left: 20, right: width - 16, top: 128, bottom: 133 } : { left: width * .42, right: width * .78, top: 32, bottom: 48 };
  o.settings = phone ? { left: width - 112, right: width - 12, top: 76, bottom: 116 } : { left: width - 220, right: width - 12, top: 14, bottom: 54 };
  o.minimap = phone ? { left: 16, right: 140, top: height - 147, bottom: height - 23 } : { left: 28, right: 208, top: height - 202, bottom: height - 22 };
  o.dial = phone ? { left: width - 190, right: width - 12, top: height - 190, bottom: height - 12 } : { left: width - 358, right: width - 18, top: height - 346, bottom: height - 6 };
  o.speedSign = phone ? { left: width - 250, right: width - 196, top: height - 120, bottom: height - 66 } : { left: width - 428, right: width - 366, top: height - 120, bottom: height - 58 };
  if (view === 'cockpit' && !phone) { // projected glass: the rear-view mirror (right) and the driver's door mirror (left)
    o.rearMirror = { left: width * .74, right: width, top: height * .28, bottom: height * .43 };
    o.doorMirror = { left: width * .15, right: width * .29, top: height * .54, bottom: height * .66 };
  }
  return Object.fromEntries(Object.entries(o).filter(([, r]) => r));
}
const SIZES = [[1280, 800], [1920, 1080], [390, 844]];

test('notices avoid the central driving area, mirrors, speed sign and minimap at 1280, 1920 and 390, cockpit and chase', () => {
  for (const [width, height] of SIZES) for (const view of ['chase', 'cockpit']) {
    const obstacles = hud(width, height, view), heights = [28, 44, 44], area = drivingArea(width, height);
    const p = notificationPlacement({ width, height, obstacles: Object.values(obstacles), heights });
    assert.ok(p.shown.length >= (width < 700 ? 1 : 2), `${width}x${height} ${view}: room for the notices (${p.mode})`);
    let y = p.top;
    for (const i of p.shown) {
      const r = { left: p.left, right: p.left + p.width, top: y, bottom: y + heights[i] };
      assert.ok(r.left >= 0 && r.right <= width && r.top >= 0 && r.bottom <= height, `${width} ${view}: on screen`);
      assert.ok(!rectanglesOverlap(r, area), `${OWNER}\n${width}x${height} ${view}: notice ${JSON.stringify(r)} covers the driving area`);
      for (const [name, b] of Object.entries(obstacles)) assert.ok(!rectanglesOverlap(r, b), `${OWNER}\n${width}x${height} ${view}: notice covers the ${name}`);
      y = r.bottom + 6;
    }
    assert.equal(p.mode, width < 700 ? 'strip' : 'corner', `${width}: ${width < 700 ? 'a top-edge strip' : 'the top-left corner stack'}`);
  }
});

test('the corner stack sits under the timer, never beside the road', () => {
  const p = notificationPlacement({ width: 1280, height: 800, obstacles: Object.values(hud(1280, 800, 'chase')), heights: [44] });
  assert.equal(p.left, 28); assert.ok(p.top >= 178, 'under the timer and lap timing'); assert.ok(p.left + p.width <= 1280 * .2, OWNER);
});

test('notices are short-lived and the police pursuit level is a HUD badge, not a card', () => {
  assert.ok(TOAST_MS <= 3000 && MAX_MS <= 5000, OWNER);
  const q = new NotificationQueue(); q.post({ text: 'TOWED', ms: 60000 }, 0); assert.equal(q.items.values().next().value.remaining, MAX_MS);
  const police = readFileSync(new URL('../src/police-hud.js', import.meta.url), 'utf8');
  assert.match(police, /slot:'badge'/, OWNER); assert.doesNotMatch(police, /notifications\.banner\('police-status'/, OWNER);
  const manager = readFileSync(new URL('../src/ui/notifications.js', import.meta.url), 'utf8');
  assert.match(manager, /item\.slot==='badge'\?`chip chip--hud/, `${OWNER}\nthe badge is the kit chip`);
  const css = readFileSync(new URL('../src/ui/notifications.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.race-notice|italic/, `${OWNER}\nnotice looks live in the kit (src/ui/ui.css)`);
});

test('with room for one item, a short-lived notice is shown before a persistent badge', () => {
  const obstacles = Object.values(hud(390, 844, 'cockpit')); obstacles.push({ left: 170, right: 280, top: 76, bottom: 108 });
  const p = notificationPlacement({ width: 390, height: 844, obstacles, heights: [28, 40], badges: [0] });
  assert.equal(p.mode, 'strip'); assert.deepEqual(p.shown, [1], 'TOWED shows; the pursuit badge waits');
});
