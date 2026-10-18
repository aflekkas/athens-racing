// Owner decision 2026-10-17: "i dont like hover effects please".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = path => readFileSync(path, 'utf8');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const shipped = [...walk('src').filter(f => /\.(css|js)$/.test(f)),
  ...['server', 'worker'].flatMap(walk).filter(f => /\.mjs$/.test(f) && !f.endsWith('.test.mjs')), 'style.css', 'index.html'];
const owner = '2026-10-17 owner decision: no hover effects; keyboard/gamepad surface focus only, with no extra pointer decoration. See docs/OWNER-DECISIONS.md.';

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

// Includes CSS emitted by JS/server modules. Reject the decoration itself so a
// later selector refactor cannot quietly bring back the browser-root frame.
test('focus and selection use surfaces, never outlines, rings or border changes', () => {
  const hits = [];
  for (const file of shipped) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    if (/--focus-ring\s*:|\.style\.(?:outline|boxShadow)\s*=/.test(source)) hits.push(`${file}: scripted focus edge`);
    for (const [, selector, declarations] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const [, property, value] of declarations.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)) {
        if (property === 'outline' && !/^(none|0)(?:\s*!important)?\s*$/.test(value.trim())) hits.push(`${file}: ${selector.trim().slice(-100)} outline`);
        if (!/(?:\.focus\b|:focus(?:-visible|-within)?\b|\.(?:selected|sel|on|hi)\b)/.test(selector)) continue;
        if ((property === 'box-shadow' && value.trim() !== 'none') || /^(?:border|border-(?:color|width|style|top|right|bottom|left))$/.test(property)) hits.push(`${file}: ${selector.trim().slice(-100)} ${property}`);
      }
    }
  }
  assert.deepEqual(hits, [], '2026-10-18: subtle keyboard/gamepad surfaces only; no focus or selection edges.');
});

test('pointer activation hides surface focus; keyboard and named gamepad navigation enable it', () => {
  const kit = read('src/ui/components.js'), menu = read('src/menu.js'), css = read('src/ui/ui.css');
  assert.match(kit, /pointerdown[\s\S]*?dataset\.uiFocus = 'pointer'/);
  assert.match(kit, /keydown[^\n]*navigationFocus\(\)/);
  assert.match(menu, /action\(name\)\s*\{[\s\S]*?C\.navigationFocus\(\)/);
  assert.match(css, /:root\[data-ui-focus="navigation"\][^{}]*\.focus\s*\{[^}]*background:/);
  assert.match(css, /:where\(html, body, #ui, #c, \.scr\):focus\s*\{\s*outline: none; box-shadow: none;/);
});

// Internal menu position survives clicks, but its visual treatment is navigation-only.
test('CSS class focus treatments are gated by navigation modality', () => {
  const hits = [];
  for (const file of shipped.filter(f => f.endsWith('.css'))) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const part of selector.split(',')) {
        if (/\.focus\b/.test(part) && !part.includes('[data-ui-focus="navigation"]')) hits.push(`${file}: ${part.trim()}`);
      }
    }
  }
  assert.deepEqual(hits, [], owner);
});
