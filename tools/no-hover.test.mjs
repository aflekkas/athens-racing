// Owner decision 2026-10-17: "i dont like hover effects please".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = path => readFileSync(path, 'utf8');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const shipped = [...walk('src').filter(f => /\.(css|js)$/.test(f)),
  ...['server', 'worker'].flatMap(walk).filter(f => /\.mjs$/.test(f) && !f.endsWith('.test.mjs')), 'style.css', 'index.html'];
const owner = '2026-10-17 owner decision: no hover effects; keep keyboard/gamepad and click focus. See docs/OWNER-DECISIONS.md.';

test('all shipped styles, including inline styles, have no hover rules or custom interaction cursors', () => {
  const hits = [];
  for (const file of shipped) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    if (/:hover\b/i.test(source) || /cursor\s*:\s*(pointer|grab|grabbing)\b/i.test(source)) hits.push(file);
  }
  assert.deepEqual(hits, [], owner);
});

// Movement is allowed for held-pointer gestures and the gameplay camera only.
// No menu, listbox, prompt or pin gets a passive pointer listener. Keep these
// exceptions narrow: a new subscription must be reviewed against this decision.
const movement = [
  ['src/car-select.js', "container.addEventListener('pointermove',move)", /const move = e => \{ if\(e\.pointerId!==pointer\)return;[^\n]+/],
  ['src/ui/components.js', "track.addEventListener('pointermove', move)", /const move = \(ev\) => \{ if \(ev\.pointerId === e\.pointerId\) onValue\(at\(ev\)\); \};/],
  ['src/map-select.js', "map.addEventListener('pointermove', e => {", /map\.addEventListener\('pointermove', e => \{\s*if \(!pointers\.has\(e\.pointerId\)\) return;/],
  ['src/input.js', "steer.addEventListener('pointermove', move)", /const move = e => \{ if \(e\.pointerId !== pointer\) return;[^\n]+/],
  ['src/input.js', "this.listen('mousemove', e => {", /this\.listen\('mousemove', e => \{\s*if \(!enabled\(\) \|\| e\.sourceCapabilities\?\.firesTouchEvents \|\| editable\(e\)\) return;/],
];
test('passive mouse/pointer movement cannot move UI focus or highlights', () => {
  const hits = [];
  for (const file of shipped.filter(f => /\.(m?js|html)$/.test(f))) {
    let source = read(file);
    // Gesture callbacks cannot call UI focus/selection helpers either.
    if (file === 'src/map-select.js') {
      const gesture = source.slice(source.indexOf("map.addEventListener('pointermove'"), source.indexOf('  const up ='));
      assert.doesNotMatch(gesture, /\b(?:focus|setFocus|hilite|highlight|show)\s*\(|classList\.(?:add|toggle)\(['"](?:focus|hi|selected)/, owner);
    }
    for (const [path, subscription, guard] of movement.filter(([path]) => path === file)) {
      assert.match(source, guard, `${file}: movement must stay behind its interaction guard`);
      assert.equal(source.split(subscription).length - 1, 1, `${file}: exactly one reviewed ${subscription}`);
      source = source.replace(subscription, '');
    }
    if (/(?:addEventListener|\blisten)\s*(?:\?\.)?\(\s*['"`](?:mouse|pointer)(?:move|over|enter|out|leave)['"`]|\bon(?:mouse|pointer)(?:move|over|enter|out|leave)\s*=/i.test(source)) hits.push(file);
  }
  assert.deepEqual(hits, [], owner);
});
