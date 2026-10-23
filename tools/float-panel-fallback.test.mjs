// The floating track card (shared .panel--float) is glass only while it blurs the map. Without the blur (low / potato tint,
// reduced transparency, no backdrop-filter, the map moving) it used the 90% panel tint, so crisp map labels and pins showed
// through and ran into the card's own pager ("PSYCHIKO … CIRCUIT" under "1 / 6"). Every no-blur state is now opaque.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/ui/ui.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]*\.panel--float[^{}]*)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));

test('the solid surface token is the panel colour, fully opaque', () => {
  const token = css.match(/--ui-surface-solid:\s*([^;]+);/)?.[1].trim();
  assert.equal(token, 'rgb(12, 17, 23)');
  assert.match(css, /--ui-surface:\s*rgba\(12, 17, 23, \.9\)/, 'same colour as the panel tint');
});

test('every floating-panel state without the blur paints the opaque surface', () => {
  const noBlur = rules.filter(r => /backdrop-filter:\s*none/.test(r.body));
  assert.ok(noBlur.length >= 3, 'tint, reduced transparency and moving');
  for (const r of noBlur) assert.match(r.body, /background(?:-color)?:\s*var\(--ui-surface-solid\)/, r.sel);
  const unsupported = css.match(/@supports not \(\(backdrop-filter[^{]*\{\s*\.panel--float\s*\{([^}]*)\}/)?.[1];
  assert.match(unsupported || '', /background:\s*var\(--ui-surface-solid\)/, 'no backdrop-filter support');
  for (const r of rules) assert.doesNotMatch(r.body, /background(?:-color)?:\s*var\(--ui-surface\)/, `${r.sel}: not the translucent tint`);
});

test('the blurred glass card is unchanged (owner-locked track map)', () => {
  const glass = rules.find(r => r.sel === '.panel--float' && /backdrop-filter:\s*blur\(16px\)/.test(r.body));
  assert.ok(glass);
  assert.match(glass.body, /background:\s*rgba\(9, 13, 18, \.7\)/);
});
