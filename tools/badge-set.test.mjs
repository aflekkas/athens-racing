// Badge set of every catalogue car (playtest 2026-10-18: "what is going on with this GLA ... it has every single logo").
// One manufacturer mark on the front (grille / bonnet), one on the rear, model lettering at most once, a centre cap on each
// wheel, nothing on the flanks, and every mark resting on the finished skin rather than sunk into it or hovering off it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARS, CarModel } from './vehicle-budget-support.mjs';
import { badgeInventory } from './badge-probe-support.mjs';

const seated = (gap, lo = -.012, hi = .045) => Number.isFinite(gap) && gap >= lo && gap <= hi;
for (const spec of CARS) test(`${spec.id}: badge set is one mark per end, one cap per wheel, no duplicates`, () => {
  const car = new CarModel(spec), inv = badgeInventory(car);
  const marks = inv.filter(i => i.kind === 'badge' && !i.wheel), letters = inv.filter(i => i.kind === 'lettering'), caps = inv.filter(i => i.wheel);
  if (!marks.length && !caps.length) return; // commercial models carry their own painted livery marks
  const at = zone => marks.filter(i => i.zone === zone);
  assert.equal(at('front').length, 1, `${spec.id}: exactly one mark on the nose, got ${at('front').map(i => i.name)}`);
  assert.equal(at('rear').length, 1, `${spec.id}: exactly one mark on the tail, got ${at('rear').map(i => i.name)}`);
  assert.equal(at('body').length, 0, `${spec.id}: no marks on the flanks, got ${at('body').map(i => i.name)}`);
  assert.equal(caps.length, car.wheels.length, `${spec.id}: one centre cap per wheel`);
  assert.equal(new Set(caps.map(i => i.wheelRef)).size, car.wheels.length, `${spec.id}: caps on four different wheels`);
  for (const mark of [...at('front'), ...at('rear')]) assert.ok(seated(mark.gap), `${spec.id} ${mark.name || 'mark'} is not on the skin (gap ${mark.gap.toFixed?.(3)} m)`);
  assert.ok(letters.filter(i => i.name === 'trim-badge').length <= 1, `${spec.id}: model lettering once`);
  assert.equal(letters.filter(i => i.name === 'model-badge').length, 0, `${spec.id}: a second model lettering duplicates the trim badge`);
  assert.ok(letters.length <= 2, `${spec.id}: at most the wordmark and the model lettering, got ${letters.map(i => i.name)}`);
  for (const l of letters) assert.equal(l.zone, 'rear', `${spec.id} ${l.name} belongs on the tail`);
  if (spec.marque === 'mercedes') {
    // star on the grille and on the tailgate, model lettering on the tailgate, a star on every wheel centre
    assert.equal(at('front').length + at('rear').length, 2, spec.id);
    assert.equal(letters.filter(i => i.name === 'trim-badge').length, 1, `${spec.id}: Mercedes model lettering on the tailgate`);
  }
});
