// Owner decision 2026-10-18 (docs/OWNER-DECISIONS.md): free roam has no track to follow and no start/finish line.
// Do not restore a route line, start/finish arches, checkpoint markers or race HUD in free roam without a new owner decision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const LOCK = 'Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const { Hud } = await import('../src/hud.js');
function drawMinimap(state) {
  const rpts = []; for (let i = 0; i <= 100; i++) rpts.push(i * 10, 0);
  const hud = Object.create(Hud.prototype);
  Object.assign(hud, { CELL: 250, cells: new Map(), rpts, r0: 0, r1: 1000, land: {}, map: { terrain: { minX: 0, minZ: 0, GX: 1, GZ: 1, T: 1 }, data: {},
    route: { closed: false, length: 1000, finish: 1000, wrap: v => v, point: v => ({ x: v, z: 0 }) } } });
  const ops = []; let stroke = '', fill = '';
  const g = new Proxy({}, { get: (_, key) => key === 'strokeStyle' ? stroke : key === 'fillStyle' ? fill : (...args) => { ops.push({ op: key, stroke, fill, args }); },
    set: (_, key, value) => { if (key === 'strokeStyle') stroke = value; if (key === 'fillStyle') fill = value; return true; } });
  hud.drawMinimap(g, 300, 300, { s: 500, x: 500, z: 0, yaw: -Math.PI / 2, rx: null, rz: 0, traffic: [{ active: true, s: 520, u: 0 }], junctions: [{ s: 510, x: 510, z: 0, main: 'G' }], ...state }, 2.2);
  return ops;
}
test('owner lock: the free-roam minimap shows only the map, its streets and the heading arrow', () => {
  const ops = drawMinimap({ free: true, s: 900, x: 900, traffic: [{ active: true, s: 920, u: 0 }], junctions: [{ s: 910, x: 910, z: 0, main: 'G' }] });
  assert.equal(ops.filter(o => o.op === 'stroke' && ['#ff3b2f', 'rgba(0,0,0,.55)'].includes(o.stroke) && o.args.length === 0 && o.fill !== '#fff').length <= 1, true, 'only the heading arrow outline may be stroked red');
  assert.equal(ops.some(o => o.op === 'arc' && ['#ffc21a', '#22ff74', '#ff2a14', '#ffb000'].includes(o.fill)), false, `no finish dot or signal dots. ${LOCK}`);
  assert.equal(ops.some(o => o.op === 'fillRect' && o.fill === 'rgba(255,255,255,.75)'), false, `no traffic dots. ${LOCK}`);
  const racing = drawMinimap({ free: false, s: 900, x: 900, traffic: [{ active: true, s: 920, u: 0 }], junctions: [{ s: 910, x: 910, z: 0, main: 'G' }] });
  assert.ok(racing.some(o => o.op === 'stroke' && o.stroke === '#ff3b2f'), 'races keep their route');
  assert.ok(racing.some(o => o.op === 'arc' && o.fill === '#ffc21a'), 'races keep their finish');
});
test('owner lock: free roam hides every start/finish gantry, arch, stripe and race widget', async () => {
  const main = await read('src/main.js'), road = await read('src/road.js'), megara = await read('src/maps/megara.js'), css = await read('src/menu.css');
  assert.match(main, /markers\.group\.visible = def\.type !== 'free'/, LOCK);
  assert.match(main, /for \(const mark of route\.timingMarks \|\| \[\]\) mark\.visible = def\.type !== 'free'/, LOCK);
  // Every builder that stands a start or finish structure on a map registers it with the route so free roam can hide it.
  assert.match(road, /\(route\.timingMarks \|\|= \[\]\)\.push\(timing\)/, LOCK);
  assert.match(road, /timing\.add\(g\)/, LOCK); assert.doesNotMatch(road, /group\.add\(g\);\s*\n\s*const banner/, `gantries must not bypass the timing group. ${LOCK}`);
  assert.match(megara, /\(route\.timingMarks\|\|=\[\]\)\.push\(timingGroup\)/, LOCK);
  assert.doesNotMatch(megara, /batch\.box\((?:pier|booth|window)/, `Megara gantry and booth boxes belong to the timing batch. ${LOCK}`);
  assert.match(css, /body\[data-mode=free\] :is\(#routeBox,#lapTiming,#posBox,#evBox\)\s*\{\s*display:none!important/, LOCK);
});
