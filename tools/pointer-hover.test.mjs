// Owner decisions 2026-10-17/18 (docs/OWNER-DECISIONS.md):
//  - "i dont like hover effects" / "this blue hover around everything is cringe": no outline, ring, glow or blue edge on
//    hover or focus, and the mouse must never move keyboard/gamepad focus or the selection.
//  - 2026-10-18 "there is no hover state now at all, we need one": a calm surface hover for real mouse pointers only,
//    the same lighter surface as keyboard focus, never sticky on touch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = path => readFileSync(path, 'utf8');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const shipped = [...walk('src').filter(f => /\.(css|js)$/.test(f)),
  ...['server', 'worker'].flatMap(walk).filter(f => /\.mjs$/.test(f) && !f.endsWith('.test.mjs')), 'style.css', 'index.html'];
const sheets = shipped.filter(f => f.endsWith('.css'));
const owner = '2026-10-18 owner decision: a subtle surface hover on pointer devices only, no outlines, hover never moves focus or selection. See docs/OWNER-DECISIONS.md.';
const HOVER_MEDIA = '(hover: hover) and (pointer: fine)';
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' '));

// Every style rule with the @media conditions that enclose it.
function styleRules(source) {
  source = stripComments(source);
  const rules = []; let i = 0;
  const walkBlock = (media, end) => {
    while (i < end) {
      const open = source.indexOf('{', i), close = source.indexOf('}', i);
      if (open < 0 || (close >= 0 && close < open)) { i = close < 0 ? end : close + 1; return; }
      const head = source.slice(i, open).trim(); i = open + 1;
      if (/^@(media|supports|container|layer)\b/.test(head)) { walkBlock([...media, head.replace(/^@media\s*/, '').replace(/\s+/g, ' ')], end); continue; }
      if (head.startsWith('@')) { let depth = 1; while (depth && i < end) { const c = source[i++]; if (c === '{') depth++; else if (c === '}') depth--; } continue; }
      const stop = source.indexOf('}', i), body = source.slice(i, stop); i = stop + 1;
      const declarations = [...body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)].map(m => [m[1].toLowerCase(), m[2].trim()]);
      rules.push({ selector: head.replace(/\s+/g, ' '), declarations, media });
    }
  };
  walkBlock([], source.length);
  return rules;
}

test('hover rules exist only inside the fine-pointer hover media query, and only in stylesheets', () => {
  const hits = [];
  for (const file of shipped) {
    const source = read(file);
    if (!file.endsWith('.css')) {
      // Inline CSS emitted by JS / server pages: no hover at all (the kit's stylesheet owns it).
      if (/:hover\b/.test(stripComments(source))) hits.push(`${file}: :hover outside a stylesheet`);
      continue;
    }
    for (const rule of styleRules(source)) {
      if (!/:hover\b/.test(rule.selector)) continue;
      if (!rule.media.some(m => m === HOVER_MEDIA)) hits.push(`${file}: ${rule.selector.slice(0, 90)} is not inside @media ${HOVER_MEDIA}`);
    }
  }
  assert.deepEqual(hits, [], owner);
});

test('the kit gives every interactive family a hover surface and clickable items a pointer cursor', () => {
  const rules = styleRules(read('src/ui/ui.css')).filter(r => r.media.includes(HOVER_MEDIA));
  const hover = rules.filter(r => /:hover\b/.test(r.selector)).map(r => r.selector).join('\n');
  for (const family of ['.option', '.field', '.list-row', '.card', '.btn', '.seg__opt', '.tab', '.nav__item', '.stepper__btn', '.listbox__opt', '.bind__chip', '.hu-driver', '.select', '.search'])
    assert.ok(hover.includes(family), `${owner}\nno hover surface for ${family}`);
  assert.match(read('src/map-select.css'), new RegExp(`@media ${HOVER_MEDIA.replace(/[()]/g, '\\$&')}[^}]*track-pin[^{]*:hover`), 'map pins hover like keyboard focus');
  assert.ok(rules.some(r => r.declarations.some(([p, v]) => p === 'cursor' && v === 'pointer') && /\.mi\b/.test(r.selector)), `${owner}\nclickable .mi items get cursor: pointer on pointer devices`);
});

test('selected, checked and disabled controls keep their own look under hover', () => {
  const rules = styleRules(read('src/ui/ui.css')).filter(r => r.media.includes(HOVER_MEDIA) && /:hover\b/.test(r.selector));
  const hits = [];
  for (const family of ['.seg__opt', '.tab', '.nav__item']) {
    for (const rule of rules.filter(r => r.selector.includes(family) && r.declarations.some(([p]) => /^background|^color$/.test(p)))) {
      if (!/:not\([^)]*\.on\b/.test(rule.selector)) hits.push(rule.selector);
    }
  }
  assert.deepEqual(hits, [], `${owner}\nthe lit selected option must not be restyled by hover`);
  for (const rule of rules.filter(r => /\.(?:option|field|list-row|card)\b/.test(r.selector) && r.declarations.some(([p]) => p === 'background')))
    assert.match(rule.selector, /:not\(\.off\)/, `${owner}\n${rule.selector}: disabled rows must not react`);
});

// Hover and focus are surfaces only. This covers CSS emitted by JS / server modules too.
test('hover, focus and selection use surfaces, never outlines, rings, borders, glows or scale', () => {
  const hits = [];
  const edge = /^(?:border|border-(?:color|width|style|top|right|bottom|left)(?:-color)?)$/;
  for (const file of shipped) {
    const source = stripComments(read(file));
    if (/--focus-ring\s*:|\.style\.(?:outline|boxShadow)\s*=/.test(source)) hits.push(`${file}: scripted focus edge`);
    for (const rule of styleRules(source)) {
      const interactive = /(?:\.focus\b|:focus(?:-visible|-within)?\b|:hover\b|\.(?:selected|sel|on|hi)\b)/.test(rule.selector);
      for (const [property, value] of rule.declarations) {
        if (property === 'outline' && !/^(none|0)(?:\s*!important)?\s*$/.test(value)) hits.push(`${file}: ${rule.selector.slice(-100)} outline`);
        if (!interactive) continue;
        if ((property === 'box-shadow' && value !== 'none') || edge.test(property)) hits.push(`${file}: ${rule.selector.slice(-100)} ${property}`);
        if (/:hover\b/.test(rule.selector)) {
          if (/^(?:transform|scale|translate|rotate|outline[\w-]*|filter|backdrop-filter|animation[\w-]*)$/.test(property) && !(property === 'filter' && /^(?:none|contrast\(\.8\) brightness\(1\.05\))$/.test(value))) hits.push(`${file}: ${rule.selector.slice(-100)} hover ${property}`);
          if (/(?:--hu-ice|--c-accent|--c-cyan|--tt-blue|#6fd0ff|#4a9dff|\bblue\b)/i.test(value)) hits.push(`${file}: ${rule.selector.slice(-100)} hover colour flood ${property}`);
        }
      }
    }
  }
  assert.deepEqual(hits, [], '2026-10-18: subtle surfaces only; no outline, ring, glow, coloured edge or scale on hover, focus or selection.');
});

test('custom grab cursors stay forbidden; the pointer cursor lives only in the hover media query', () => {
  const hits = [];
  for (const file of shipped) {
    const source = stripComments(read(file));
    if (!file.endsWith('.css')) { if (/cursor\s*:\s*(pointer|grab|grabbing)\b/i.test(source)) hits.push(`${file}: cursor outside a stylesheet`); continue; }
    for (const rule of styleRules(source)) for (const [property, value] of rule.declarations) {
      if (property !== 'cursor') continue;
      if (/grab/.test(value)) hits.push(`${file}: ${rule.selector.slice(0, 80)} cursor: ${value}`);
      if (value === 'pointer' && !rule.media.includes(HOVER_MEDIA)) hits.push(`${file}: ${rule.selector.slice(0, 80)} cursor: pointer outside the hover media query`);
    }
  }
  assert.deepEqual(hits, [], owner);
});

// Movement is allowed for held-pointer gestures and the gameplay camera only.
// No menu, listbox, prompt or pin gets a passive pointer listener: hover is CSS, so a mouseover / mouseenter handler
// can only be moving focus or selection. Keep these exceptions narrow: a new subscription must be reviewed against this decision.
const movement = [
  ['src/car-select.js', "container.addEventListener('pointermove',move)", /const move = e => \{ if\(e\.pointerId!==pointer\)return;[^\n]+/],
  ['src/ui/components.js', "track.addEventListener('pointermove', move)", /const move = \(ev\) => \{ if \(ev\.pointerId === e\.pointerId\) onValue\(at\(ev\)\); \};/],
  ['src/map-select.js', "map.addEventListener('pointermove', e => {", /map\.addEventListener\('pointermove', e => \{\s*if \(!pointers\.has\(e\.pointerId\)\) return;/],
  ['src/input.js', "steer.addEventListener('pointermove', move)", /const move = e => \{ if \(e\.pointerId !== pointer\) return;[^\n]+/],
  ['src/input.js', "this.listen('mousemove', e => {", /this\.listen\('mousemove', e => \{\s*if \(!enabled\(\) \|\| e\.sourceCapabilities\?\.firesTouchEvents \|\| editable\(e\)\) return;/],
];
test('mouseover / mouseenter / pointermove handlers cannot move UI focus, highlights or selection', () => {
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
    if (/\.matches\(\s*['"`][^'"`]*:hover|classList\.(?:add|toggle)\(\s*['"`]hover/.test(source)) hits.push(`${file}: scripted hover state`);
  }
  assert.deepEqual(hits, [], owner);
});

test('pointer activation hides surface focus; keyboard and named gamepad navigation enable it', () => {
  const kit = read('src/ui/components.js'), menu = read('src/menu.js'), css = read('src/ui/ui.css');
  assert.match(kit, /pointerdown[\s\S]*?dataset\.uiFocus = 'pointer'/);
  assert.match(kit, /keydown[^\n]*navigationFocus\(\)/);
  assert.match(menu, /action\(name\)\s*\{[\s\S]*?C\.navigationFocus\(\)/);
  assert.match(css, /:root\[data-ui-focus="navigation"\][^{}]*\.focus\s*\{[^}]*background:/);
  assert.match(css, /:where\(html, body, #ui, #c, \.scr\):focus\s*\{\s*outline: none; box-shadow: none;/);
});

// Internal menu position survives clicks, but the keyboard focus treatment is navigation-only. Hover is separate: it is
// gated by the pointer media query instead and never touches the .focus class.
test('CSS class focus treatments are gated by navigation modality; hover never uses the focus class', () => {
  const hits = [];
  for (const file of sheets) {
    for (const rule of styleRules(read(file))) {
      for (const part of rule.selector.split(/,(?![^()]*\))/)) {
        if (/\.focus\b/.test(part) && !part.includes('[data-ui-focus="navigation"]') && !/:hover\b/.test(part)) hits.push(`${file}: ${part.trim()}`);
        if (/:hover\b/.test(part) && part.includes('[data-ui-focus')) hits.push(`${file}: hover tied to keyboard modality: ${part.trim()}`);
      }
    }
  }
  assert.deepEqual(hits, [], owner);
});
