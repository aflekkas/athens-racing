// Playtest 2026-10-18: "the car looks really low-res". Dynamic resolution (and potato's own 0.6 base ratio) let the picture
// fall to 0.5-0.6 of the screen's pixels. The floors below keep the near field readable on every class, and potato starts
// sharper while still bottoming out where it always did, so a weak GPU gets the frame time it had.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERFORMANCE, PERF_CLASSES, DYNAMIC_FLOOR, dynamicFloor, resolveGraphics } from '../src/graphics.js';
import { RenderScale } from '../src/render-scale.js';

const OLD_FRAC = { potato: .83, low: .75, med: .65, high: .6 }; // main.js before: Math.max(.5, ratio * frac)
const oldFloor = (cls, ratio) => Math.min(ratio, Math.max(.5, ratio * OLD_FRAC[cls]));

test('no class can drop lower than it could before, and none under its sharpness floor', () => {
  for (const cls of PERF_CLASSES) for (const deviceRatio of [1, 1.25, 1.5, 2, 3]) {
    const { pixelRatio } = resolveGraphics({ perfClass: cls }, { deviceRatio }), floor = dynamicFloor(cls, pixelRatio);
    assert.ok(floor >= oldFloor(cls, pixelRatio) - 1e-9, `${cls}@${deviceRatio}: ${floor} >= ${oldFloor(cls, pixelRatio)}`);
    assert.ok(floor >= Math.min(pixelRatio, DYNAMIC_FLOOR[cls].min) - 1e-9 && floor <= pixelRatio + 1e-9, `${cls}@${deviceRatio}`);
  }
});

test('the near field never renders under 0.55 of the screen on any class, 0.72 from low up, 0.8 from med up', () => {
  const min = { potato: .55, low: .72, med: .8, high: .8 };
  for (const cls of PERF_CLASSES) for (const deviceRatio of [1, 1.5, 2]) {
    const { pixelRatio } = resolveGraphics({ perfClass: cls }, { deviceRatio });
    assert.ok(dynamicFloor(cls, pixelRatio) >= Math.min(pixelRatio, min[cls]) - 1e-9, `${cls}@${deviceRatio}`);
  }
  assert.equal(PERFORMANCE.potato.pixelRatio, .6, 'potato keeps the picture (and the frame time) it had');
  assert.equal(PERFORMANCE.low.pixelRatio, .8);
  assert.ok(dynamicFloor('potato', .6) >= .55 && dynamicFloor('low', .8) >= .72, 'the two weak classes shed at most 8% / 10% of their ratio');
});

test('classes stay ordered: a cheaper class never renders sharper than a dearer one', () => {
  for (let i = 1; i < PERF_CLASSES.length; i++) {
    const a = PERF_CLASSES[i - 1], b = PERF_CLASSES[i];
    assert.ok(PERFORMANCE[b].pixelRatio >= PERFORMANCE[a].pixelRatio, `${b} ratio >= ${a}`);
    assert.ok(DYNAMIC_FLOOR[b].min >= DYNAMIC_FLOOR[a].min, `${b} floor >= ${a}`);
  }
});

test('dynamic resolution that stays over budget stops at the floor instead of going on down', () => {
  for (const cls of PERF_CLASSES) {
    const max = resolveGraphics({ perfClass: cls }, { deviceRatio: 1 }).pixelRatio, min = dynamicFloor(cls, max);
    const s = new RenderScale({ max, min, budgetMs: 1000 / 60 });
    let low = max;
    // 90 ms frames whatever the resolution: far over budget, so it keeps trying; each trial that does not help is undone
    for (let i = 0; i < 8000; i++) { const r = s.sample(60 + 30 * s.ratio); if (r !== null) low = Math.min(low, r); }
    assert.ok(low >= min - 1e-9, `${cls}: lowest ratio ${low} >= floor ${min}`);
  }
});

test('main.js builds its dynamic resolution from dynamicFloor', () => {
  assert.match(readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'), /min: dynamicFloor\(GFX\.perfClass, GFX\.pixelRatio\)/);
});

test('a scene below 0.85 is shown on a canvas of at least 0.85 (reconstructed crisply), never smaller or larger than the screen', async () => {
  const { outputRatio, UPSCALE_OUTPUT } = await import('../src/graphics.js');
  assert.equal(UPSCALE_OUTPUT, .85);
  assert.equal(outputRatio(.6, 1), .85); assert.equal(outputRatio(.5, 1), .85); assert.equal(outputRatio(.8, 1), .85);
  assert.equal(outputRatio(1, 1), 1, 'a scene at or above 0.85 is drawn 1:1'); assert.equal(outputRatio(1.5, 2), 1.5);
  assert.equal(outputRatio(.6, .75), .75, 'never more pixels than the screen has'); assert.equal(outputRatio(.6, 3), .85);
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /post\.setSize\(w, h, pixelRatio, out\)/); assert.match(main, /renderer\.setPixelRatio\(out\)/);
});
