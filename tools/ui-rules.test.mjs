// UI rules (CONTRIBUTING): no native dropdowns anywhere. Every dropdown is the kit's Select: the select() row builder in
// menus, or <ui-select> (src/ui/components.js) in DOM other modules own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.(m?js|html)$/.test(n) ? [p] : []; });
const NATIVE = [/<select[\s>/]/i, /createElement\(\s*['"`]select['"`]/i, /<\/select>/i];

test('no native <select> in the game UI (src/ and index.html)', () => {
  const hits = [];
  for (const f of [...files('src'), 'index.html']) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (NATIVE.some((re) => re.test(line))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(hits, [], 'use C.select() in menus or <ui-select> elsewhere');
});

// Key hints and tooltip chips are purely informational: keys / gamepad buttons drive the
// actions, never the hint labels. A hint element must not carry click handling, a pointer cursor
// or keyboard/gamepad focus (tabindex, data-act, role=button, .mi), and it must be hidden from
// assistive tech (aria-hidden) or exposed as a description, never as a control.
test('key hints and tooltip chips are not clickable, have no pointer cursor and are not focusable', () => {
  const read = (f) => readFileSync(f, 'utf8');
  const hintLine = /(hints|tabs__hint|driving-controls|car-stage__hint|id="keys"|attica-caption)/;
  const clickable = [/tabindex/i, /data-act/i, /role="button"/i, /\bonclick\b/i, /addEventListener\(\s*['"]click['"]/i,
    /closest\(\s*['"]\.hints?['"]\s*\)/, /querySelector[^\n]*\.hints?['"\]]\s*\)?\s*\.\s*click/i];
  const hits = [];
  for (const f of ['src/ui/components.js', 'src/ui/driving-hints.js', 'src/map-select.js', 'src/car-select.js', 'src/menu.js', 'index.html']) {
    read(f).split('\n').forEach((line, i) => {
      if (!hintLine.test(line)) return;
      // Real controls that merely live near a hint (SELECT TRACK, mapPrev/mapNext, RESET) keep data-act/title.
      if (/data-act="(mapPrev|mapNext|mapReset|paint)"/.test(line) || /data-confirm-track/.test(line)) return;
      // The OSM/Copernicus attribution links inside .attica-caption stay clickable by design.
      if (/<a\b/.test(line)) return;
      for (const re of clickable) if (re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  assert.deepEqual(hits, [], 'hint/tooltip labels must not be clickable or focusable');

  // Every pure-hint container labels itself decorative so it never enters the a11y tree as a control.
  const decorative = [
    ['src/ui/components.js', '<div class="hints ${cls}" aria-hidden="true">'],
    ['src/ui/components.js', 'tabs__hint on-key" aria-hidden="true"'],
    ['src/ui/driving-hints.js', '<div class="driving-controls" aria-hidden="true">'],
    ['index.html', '<div id="keys" aria-hidden="true">'],
  ];
  const missing = decorative.filter(([f, s]) => !read(f).includes(s)).map(([f, s]) => `${f}: missing ${s}`);
  assert.deepEqual(missing, [], 'hint containers must carry aria-hidden="true"');
  assert.ok(read('src/car-select.js').includes("setAttribute('aria-hidden','true')"), 'car-stage hint must be aria-hidden');

  // No pointer-cursor affordance on hint selectors, and pointer-events:none where the hint owns its box.
  const cssFiles = ['src/ui/ui.css', 'src/menu.css', 'style.css', 'src/map-select.css'];
  const css = cssFiles.map(read).join('\n');
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const pointerHits = [];
  for (const m of stripped.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1], body = m[2];
    if (!/(\.hints?|\.tabs__hint|\.driving-controls|#keys|\.car-stage__hint)/.test(sel)) continue;
    if (/cursor\s*:\s*pointer/.test(body)) pointerHits.push(sel.trim().slice(0, 120));
  }
  assert.deepEqual(pointerHits, [], 'hint/tooltip selectors must not use cursor: pointer');
  for (const sel of ['.hints', '.hint', '.tabs__hint', '.driving-controls', '#keys', '.car-stage__hint']) {
    const covered = [...stripped.matchAll(/([^{}]+)\{([^}]*)\}/g)].some((m) => m[1].includes(sel) && /pointer-events\s*:\s*none/.test(m[2]));
    assert.ok(covered, `${sel} must have a pointer-events: none rule`);
  }
});
