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
