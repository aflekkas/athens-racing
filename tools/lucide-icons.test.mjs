import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSprite } from './build-icon-sprite.mjs';
import * as C from '../src/ui/components.js';

const read = path => readFileSync(path, 'utf8');
const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${path}/${e.name}`) : [`${path}/${e.name}`]);
const manifest = JSON.parse(read('assets/icons/lucide.json'));
const names = new Set(Object.keys(manifest.icons));
const sprite = read('assets/icons/sprite.svg');
const resolve = name => {
  assert.ok(names.has(name), `Missing vendored Lucide icon: ${name}`);
  assert.ok(sprite.includes(`<symbol id="${name}" `), `Missing sprite icon: ${name}`);
};

test('only pinned, unmodified Lucide SVGs are vendored, with a reproducible stroke sprite', () => {
  assert.equal(manifest.package, 'lucide-static'); assert.equal(manifest.version, '1.59.0');
  assert.deepEqual(readdirSync('assets/icons').filter(n => n.endsWith('.svg') && n !== 'sprite.svg').sort(), [...names].map(n => n + '.svg').sort());
  for (const [name, hash] of Object.entries(manifest.icons)) {
    const svg = read(`assets/icons/${name}.svg`);
    assert.equal(createHash('sha256').update(svg).digest('hex'), hash, name);
    for (const attr of ['viewBox="0 0 24 24"', 'fill="none"', 'stroke="currentColor"', 'stroke-width="2"', 'stroke-linecap="round"', 'stroke-linejoin="round"']) assert.ok(svg.includes(attr), `${name}: ${attr}`);
    resolve(name);
  }
  assert.equal(sprite, buildSprite());
  assert.match(read('assets/icons/LICENSE'), /ISC License/);
  assert.match(read('assets/icons/LICENSE'), /Cole Bemis/);
  for (const m of read('index.html').matchAll(/data-ui-icon="([^"]+)"/g)) resolve(m[1]);
  assert.doesNotMatch(sprite, /Phosphor|256 256|fill="currentColor"/);
});

test('every icon reference in src resolves to the Lucide sprite', () => {
  for (const file of walk('src').filter(f => /\.js$/.test(f))) {
    const src = read(file).replace(/^\s*\/\/.*$/gm, '');
    // Direct helpers, component icon properties (including ternaries) and dynamic icon tables.
    for (const m of src.matchAll(/\b(?:icon|iconEl)\(\s*([^;\n]*?)(?=\)|,)|\b(?:icon|iconRight|statusIcon)\s*:\s*([^,}\n]+)/g)) {
      const expr = (m[1] || m[2]).replace(/(['"])[a-z][a-z0-9-]*\1(?=\s*(?:\?|\|\||&&|[=!]=))/g, '');
      for (const s of expr.matchAll(/(['"])([a-z][a-z0-9-]*)\1/g)) {
        if (s[2] === 'chevron-') { for (const dir of ['up', 'down', 'left', 'right']) resolve('chevron-' + dir); }
        else resolve(s[2]);
      }
    }
    // Icon-bearing table slots and resolver functions pass names through local variables.
    // Validate their values even when a new name is missing from the vendor manifest.
    if (/from ['"][^'"]*components\.js['"]/.test(src)) {
      const tableSlots = [
        /\[\s*['"][A-Z][^'"]*['"][^\[\]\n]*,\s*['"]([a-z][a-z0-9-]*)['"]\s*\]/g,
        /\[\s*['"][^'"]+['"],\s*['"][A-Z][^'"]*['"],\s*['"]([a-z][a-z0-9-]*)['"]\s*\]/g,
        /\[['"][A-Z /&_-]+['"],\s*['"]([a-z][a-z0-9-]*)['"](?=\s*[,\]])/g,
        /\b(?:tile|act)\(\s*['"][^'"]+['"],\s*['"]([a-z][a-z0-9-]*)['"]/g,
      ];
      for (const pattern of tableSlots) for (const m of src.matchAll(pattern)) resolve(m[1]);
      for (const m of src.matchAll(/const \w*Icon\s*=[^;]+/g)) {
        const expr = m[0].replace(/(['"])[a-z][a-z0-9-]*\1(?=\s*(?:\?|\|\||&&|[=!]=))/g, '');
        for (const n of expr.matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)) resolve(n[1]);
      }
    }
    // Canonical names in source tables also resolve to a sprite symbol.
    for (const m of src.matchAll(/(['"])([a-z][a-z0-9-]*)\1/g)) if (names.has(m[2])) resolve(m[2]);
    assert.doesNotMatch(src, /['"](?:car-profile|gear-six|users-three|flag-checkered|hand-tap|caret-(?:up|down|left|right)|music-notes)['"]/, file);
  }
});

test('UI labels and CSS contain no text arrow, check or close pseudo-icons', () => {
  for (const file of [...walk('src').filter(f => /\.(?:js|css|html)$/.test(f)), 'index.html']) {
    // World road signs are authored map artwork, not UI labels.
    if (file === 'src/road-sign-layout.js') continue;
    const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, />[×]<(?:\/button|\/span)/u, file);
    assert.doesNotMatch(src, /[\u2190-\u21ff\u2713-\u2718\u2039\u203a\u25b2\u25b6\u25bc\u25c0\u2161]/u, file);
  }
});

test('shared dropdown value, update and listbox retain direction icons and the independent selection check', () => {
  const html = C.select({ key: 'sort', label: 'SORT', value: 'power', options: [['power', 'POWER', { icon: 'arrow-down' }], ['weight', 'WEIGHT', { icon: 'arrow-up' }]] });
  assert.match(C.kbd('D UP'), /#arrow-up/);
  assert.match(html, /#arrow-down/);
  assert.match(html, /#chevron-down/);
  const val = { innerHTML: '' }, el = { dataset: { kind: 'select', options: JSON.stringify([['weight', 'WEIGHT', { icon: 'arrow-up' }]]) }, querySelector: () => val };
  C.setValue(el, 'weight', false);
  assert.match(val.innerHTML, /#arrow-up/);
  const js = read('src/ui/components.js'), css = read('src/ui/ui.css');
  assert.match(js, /iconLabel\(option\[1\], option\[2\]\?\.icon\)/);
  assert.match(js, /selectLabel\(\[v,l,o\]\)/);
  assert.match(css, /\.listbox__opt > \.ico\s*\{ visibility: hidden/);
  assert.match(C.option({ cls: 'option--tile option--hero' }), /option__start.*START.*#chevron-right/);
});


test('CSS icon URLs resolve to canonical Lucide symbols and compact touch labels use shared SVGs', () => {
  for (const file of walk('src').filter(f => /\.css$/.test(f))) {
    for (const m of read(file).matchAll(/assets\/icons\/([a-z][a-z0-9-]*)\.svg/g)) resolve(m[1]);
  }
  assert.match(C.touchControlLabel('pause', 'PAUSE'), /#pause/);
  assert.match(C.touchControlLabel('camera', 'CAM'), /#camera/);
  assert.match(C.touchSteeringLabel(), /#chevron-left[\s\S]*STEER[\s\S]*#chevron-right/);
});
