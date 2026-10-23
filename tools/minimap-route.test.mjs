// The minimap draws the route in the direction of travel and never marks a hidden spare rival
// (owner feedback 2026-10-18: "what the fuk are these white dots", the unexplained blue dot, a route that
// looked finished ahead of the car).
import test from 'node:test';
import assert from 'node:assert/strict';
const { Hud } = await import('../src/hud.js');
function draw({ closed = false, length = 1000, s, r0, r1, rx = null, remotes, traffic }) {
  const rpts = []; for (let i = 0; i <= length / 10; i++) rpts.push(i * 10, 0);
  const hud = Object.create(Hud.prototype);
  Object.assign(hud, { CELL: 250, cells: new Map(), rpts, r0, r1, land: {}, map: { terrain: { minX: 0, minZ: 0, GX: 1, GZ: 1, T: 1 }, data: {},
    route: { closed, length, finish: r1 ?? length, wrap: v => ((v % length) + length) % length, point: (v) => ({ x: v, z: 0 }) } } });
  const strokes = []; strokes.cyan = 0; let colour = '', fill = '', path = [];
  const g = new Proxy({}, { get: (_, key) => key === 'strokeStyle' ? colour : key === 'fillStyle' ? fill : (...args) => {
    if (key === 'beginPath') path = []; if (key === 'moveTo' || key === 'lineTo') path.push(args[0] / 10);
    if (key === 'arc' && fill === '#29d8ff') strokes.cyan++;
    if (key === 'stroke') strokes.push({ colour, from: Math.min(...path), to: Math.max(...path) });
  }, set: (_, key, value) => { if (key === 'strokeStyle') colour = value; if (key === 'fillStyle') fill = value; return true; } });
  hud.drawMinimap(g, 300, 300, { s, x: s, z: 0, yaw: -Math.PI / 2, rx, rz: 0, remotes, traffic: traffic || [] }, 2.2);
  return strokes;
}
const long = x => x.to - x.from > 5, bright = strokes => strokes.filter(x => x.colour === '#ff3b2f' && long(x)), dim = strokes => strokes.filter(x => x.colour.startsWith('rgba(255,255,255') && long(x));
test('forward events: behind the car dim, ahead bright', () => {
  const s = draw({ s: 500, r0: 0, r1: 1000 });
  assert.ok(bright(s).every(x => x.from >= 49) && bright(s).length, JSON.stringify(s));
  assert.ok(dim(s).every(x => x.to <= 51) && dim(s).length);
});
test('reverse events: ahead (lower s) bright, behind (higher s) dim', () => {
  const s = draw({ s: 500, r0: 1000, r1: 0 });
  assert.ok(bright(s).every(x => x.to <= 51) && bright(s).length, JSON.stringify(s));
  assert.ok(dim(s).every(x => x.from >= 49) && dim(s).length);
});
test('a circuit stays bright ahead across its lap seam and on later laps', () => {
  for (const s of [-30, 1000 + 40, 2000 - 20]) {
    const strokes = draw({ closed: true, s, r0: 0, r1: 2000 });
    assert.ok(bright(strokes).length, `route ahead of s=${s} is drawn bright`);
  }
});
test('no marker for a spare rival that nobody races, but rivals and remote drivers are marked', () => {
  assert.equal(draw({ s: 500, r0: 0, r1: 1000, rx: null }).cyan, 0, 'a parked spare car is not drawn, and gets no off-map pointer');
  assert.ok(draw({ s: 500, r0: 0, r1: 1000, rx: 520 }).cyan >= 1, 'a racing rival is marked');
  assert.equal(draw({ s: 500, r0: 0, r1: 1000, remotes: [{ x: 510, z: 0 }, { x: 530, z: 0 }] }).cyan >= 2, true);
});

// The wide driving map must keep the published streets even when their render cells unload.
const { indexMapRoads, visibleMapRoads, mapScreenPoint, drawMapDestination } = await import('../src/world-minimap.js');
const { atticaFromAthens } = await import('../src/spawn-spots.js');
const road = (points, major = false) => ({ major, pts: points.flatMap(p => atticaFromAthens(...p)) });
const makePath = () => ({ moveTo() {}, lineTo() {} });
test('a road crossing the view is retained even when both endpoints are over 500 metres away', () => {
  const cells = indexMapRoads([road([[-1800, 0], [1800, 0]])], makePath);
  assert.equal(visibleMapRoads(cells, 0, 0, 180).size, 1);
  assert.equal(visibleMapRoads(cells, 0, 1800, 180).size, 0);
});
test('connected roads survive cell boundaries and wide-view culling without duplicate drawing', () => {
  const cells = indexMapRoads([road([[-800, 500], [600, 500]]), road([[600, 500], [1200, 800]])], makePath);
  const roads = [...visibleMapRoads(cells, 512, 512, 1800)];
  assert.equal(roads.length, 2);
  assert.ok(Math.abs(roads[0].box[2] - roads[1].box[0]) < .001);
});
test('map heading aligns world positions with the player and destination remains labeled on either range', () => {
  const st = { x: 10, z: 20, yaw: Math.PI / 2 };
  assert.deepEqual(mapScreenPoint(300, 300, st, 1, 10, 20), [150, 186]);
  const [x, y] = mapScreenPoint(300, 300, st, 1, 110, 20);
  assert.ok(Math.abs(x - 150) < .001 && Math.abs(y - 286) < .001);
  for (const scale of [1.1, .175]) {
    const calls = [], g = new Proxy({}, { get: (_, key) => (...args) => calls.push([key, ...args]), set: () => true });
    drawMapDestination(g, 300, 300, st, scale, { x: 5000, z: -5000 }, 'FINISH');
    assert.ok(calls.some(c => c[0] === 'fillText' && c[1] === 'FINISH'));
    const circle = calls.find(c => c[0] === 'arc');
    assert.ok(circle[1] >= 28 && circle[1] <= 272 && circle[2] >= 65 && circle[2] <= 235);
    assert.ok(!calls.some(c => c[0] === 'fillRect'), 'no unexplained square flag');
  }
});

// The corner caption names the nearest listed place only within PLACE_LABEL_MAX_M (a UI heuristic, not a region boundary):
// on Megara, ~25 km from the nearest listed place, it read PIRAEUS. Beyond the limit the corner is blank; nothing is inferred.
test('the minimap names a nearby place, and stays blank rather than naming a remote one', async () => {
  const { drawMapLabels, PLACE_LABEL_MAX_M } = await import('../src/world-minimap.js');
  const { AREA_STARTS, ATHENS_DISTRICTS, athensFromLonLat } = await import('../src/spawn-spots.js');
  const caption = (lon, lat) => {
    const [x, z] = athensFromLonLat(lon, lat), calls = [];
    const g = new Proxy({}, { get: (_, key) => key === 'measureText' ? () => ({ width: 40 }) : (...args) => calls.push([key, ...args]), set: () => true });
    drawMapLabels(g, 300, 300, { x, z, yaw: 0 }, 1);
    return calls.find(c => c[0] === 'fillText' && c[2] === 14 && c[3] === 14)?.[1] ?? null;
  };
  const megara = AREA_STARTS.find(s => s.id === 'megara');
  assert.equal(caption(megara.lon, megara.lat), null, 'Megara: no PIRAEUS from 25 km away');
  assert.equal(caption(23.778, 37.815), 'VOULIAGMENI', 'the Riviera start keeps its caption');
  const syntagma = ATHENS_DISTRICTS.find(d => d.name === 'SYNTAGMA');
  assert.equal(caption(syntagma.lon, syntagma.lat), 'SYNTAGMA');
  assert.equal(PLACE_LABEL_MAX_M, 8000);
});
