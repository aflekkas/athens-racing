// Regenerates auto-input-baseline.json (the frozen automatic-gearbox trajectory manual.test.mjs compares against)
// with the current physics. Run only when a deliberate physics change moves the car, and say why in the commit:
//   node --import ./tools/physics-test/register.mjs tools/physics-test/gen-auto-baseline.mjs
// Same spec, route, inputs and frames as the test (read from manual.test.mjs / the existing baseline's frame list).
import { readFileSync, writeFileSync } from 'node:fs';
import { Vehicle } from '../../src/physics.js';
const testSrc = readFileSync(new URL('./manual.test.mjs', import.meta.url), 'utf8');
const pick = (name) => new Function('return ' + testSrc.match(new RegExp(`const ${name} = (\\{.*\\});`))[1])();
const route = pick('route'), spec = pick('spec');
const file = new URL('./auto-input-baseline.json', import.meta.url);
const frames = JSON.parse(readFileSync(file, 'utf8')).map(([i]) => i);
const a = new Vehicle(spec, route), out = [];
for (let i = 0; i < 900; i++) {
  a.update(1 / 60, { throttle: i < 600 ? 1 : 0.2, brake: i > 750 ? 0.6 : 0, steer: Math.sin(i / 40) * 0.15 });
  if (frames.includes(i)) out.push([i, [a.x, a.z, a.vLong, a.vLat, a.w, a.rpm, a.gear, a.pendingGear, a.shiftT]]);
}
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${out.length} frames`);
