// Owner decisions 2026-10-19 ("Free roam: pick where to spawn, not a track") and 2026-10-20 ("Free roam: click anywhere on
// the map, no POI list; trackpad pans"), docs/OWNER-DECISIONS.md: "would it not make sense for free roam to just be click
// anywhere on the map". FREE ROAM opens a spawn picker on the Attica map: a click anywhere snaps to the nearest drivable
// road, the arrows step through general areas (one per playable map), there are no POI pins, and the car is placed on
// the nearest road with the tow placement. Do not bring the track list, a track name, length, laps or a leaderboard back to
// free roam. Owner 2026-10-21 activated the full Athens world for normal Free Roam placement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap } from '../src/map.js';
import { MAPS } from '../src/map-catalog.js';
import { getPlayableMaps, PLAYABLE_MAPS } from '../src/enabled-maps.js';
import { Vehicle } from '../src/physics.js';
import { Ground } from '../src/ground.js';
import { RoadNetwork } from '../src/road-network-surface.js';
import { routeTowAdapter } from '../src/road-recovery.js';
import { planTow, RoadIndex } from '../src/tow-placement.js';
import { CARS } from '../src/cars.js';
import { freeRoam } from '../src/events.js';
import { TRACK_ROUTES } from '../src/attica-map-data.js';
import { initialMapId } from '../src/menu-map.js';
import { AREA_STARTS, ATHENS_DISTRICTS, spawnAreas, athensEnabled, decodeSpawnRoads, snapToRoad, atticaFromLocal, localFromAttica, atticaFromLonLat, lonLatFromAttica, athensFromAttica, athensFromLonLat, athensCell } from '../src/spawn-spots.js';
import { buildSpawnRoads, UNIT } from './build-spawn-roads.mjs';

const OWNER = 'Owner-locked decision (2026-10-19 free roam picks a spawn point, no tracks; 2026-10-20 click anywhere, areas not POIs), see docs/OWNER-DECISIONS.md. Ask the owner before changing.';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const main = read('src/main.js'), menu = read('src/menu.js'), boot = read('src/boot.js'), pickerSource = read('src/spawn-select.js');
const section = (a, b) => main.slice(main.indexOf(a), main.indexOf(b, main.indexOf(a)));
const roadsJson = JSON.parse(read('assets/maps/spawn-roads.json')), roads = decodeSpawnRoads(roadsJson);
const METRES = 87.65875176038091; // metres per Attica map unit (MAP_VIEW.metersPerUnit)

// ---------------------------------------------------------------- the picker
// The screens build markup from pure functions; only the stylesheet link needs a document, so it is stubbed around the call.
async function renderPicker(search = '', data = {}) {
  const { renderSpawnSelect } = await import('../src/spawn-select.js');
  const before = { document: globalThis.document, location: globalThis.location };
  globalThis.document = { getElementById: () => ({}) }; globalThis.location = { search };
  try { return renderSpawnSelect({ data, h: { carSpec: () => ({ name: 'TEST CAR' }) } }); }
  finally { for (const key of ['document', 'location']) before[key] === undefined ? delete globalThis[key] : (globalThis[key] = before[key]); }
}
test('FREE ROAM opens the spawn picker on the full-page Attica map, not the track list', async () => {
  const html = await renderPicker();
  // The shared map screen with the floating glass panel: a full screen, not a dialog.
  assert.match(html, /scr--maps scr--spawn/, OWNER); assert.match(html, /map-preview panel panel--float/, OWNER); assert.match(html, /attica-canvas/, OWNER);
  assert.doesNotMatch(html, /role="dialog"|data-dialog/, OWNER);
  assert.match(html, /CHOOSE WHERE TO START/, OWNER);
  assert.match(html, /data-act="spawnDrive"/, `the panel has DRIVE. ${OWNER}`); assert.match(html, /data-act="spawnCar"/, `and the existing change-car path. ${OWNER}`);
  assert.match(html, /list-row[^>]*data-act="spawnCar"[^]*?<b>TEST CAR<\/b>/, `and the car. ${OWNER}`);
  assert.doesNotMatch(html, /RESET|mapReset/, `no reset button. ${OWNER}`);
  // No POI pins or list: one marker names the chosen road point, and the panel's arrows step through areas.
  assert.doesNotMatch(html, /spawn-pin|data-spot=|track-pin/, `no POI pins. ${OWNER}`);
  assert.match(html, /class="spawn-marker on"[^]*?class="spawn-marker__name">SYNTAGMA</, `the marker names the place. ${OWNER}`);
  assert.match(html, /map-track-count">SYNTAGMA</, `the arrows show the area. ${OWNER}`);
  assert.match(html, /Click anywhere/, OWNER);
  assert.doesNotMatch(html, /data-map-id|track-pin__dot">\d|data-confirm-track|SELECT TRACK/, `no track pins or SELECT TRACK. ${OWNER}`);
  // The menu routes FREE ROAM to it and keeps the track picker for Quick Race.
  assert.match(menu, /case 'free': this\.filter = 'free'; this\.show\('maps', \{ filter: 'free', mode: 'free' \}, true\)/, OWNER);
  assert.match(menu, /r_maps\(\) \{ return this\.data\.mode === 'free' \? renderSpawnSelect\(this\) : renderMapSelect\(/, OWNER);
  assert.match(menu, /this\.data\.mode === 'free' \? mountSpawnSelect\(this\.root, this\) : mountMapSelect\(this\.root\)/, OWNER);
  // Owner 2026-10-21: expose the Athens races in the normal production menu.
  assert.match(menu, /case 'quick': void this\.openQuickRace\(\)/, 'Quick Race opens the enabled Athens routes');
  assert.match(menu, /case 'classicTracks': this\.filter = 'sprint'; this\.show\('maps', \{ filter: 'sprint', mode: 'quick' \}, true\)/, 'Original tracks remain available from the route picker');
  assert.doesNotMatch(read('src/map-select.js'), /mode === 'free'|'free:' \+ id/, `the track picker no longer has a free roam branch. ${OWNER}`);
  assert.match(menu, /'FREE ROAM', 'Pick where to start on the map[^']*', '[^']*', 'CHOOSE SPAWN'/, OWNER);
});
test('the picker snaps a click anywhere to a road, steps through areas with the arrows and has no reset', () => {
  const code = strip(pickerSource);
  assert.match(code, /snapToRoad\(roads, wx, wy, radius\)/, `a click snaps to the nearest drivable road. ${OWNER}`);
  assert.match(code, /NO ROAD HERE/, `and says so when there is none. ${OWNER}`);
  assert.match(code, /render\(roadChoice\(snap(?:, areas)?\)\);/, `a click places the start where you clicked. ${OWNER}`);
  assert.match(code, /flyTo\(areaCamera\(/, `stepping to an area flies the camera there. ${OWNER}`);
  assert.match(code, /const cycle = delta => \{ const i = Math\.max\(0, areas\.findIndex/, `the arrows cycle areas, not POIs. ${OWNER}`);
  assert.doesNotMatch(code, /spawnSpots|SPAWN_SPOTS|spawn-pin/, `no POI list. ${OWNER}`);
  assert.match(code, /\['left', 'shiftDown', 'mapPrev'\]\.includes\(name\)\) \{ cycle\(-1\)/, `A / LB / previous. ${OWNER}`); assert.match(code, /\['right', 'shiftUp', 'mapNext'\]\.includes\(name\)\) \{ cycle\(1\)/, `D / RB / next. ${OWNER}`);
  assert.match(code, /e\.key === 'ArrowLeft' \|\| e\.key === 'ArrowRight'/, OWNER);
  assert.match(code, /map\.addEventListener\('wheel'/, `wheel and trackpad input (tools/map-wheel.test.mjs). ${OWNER}`); assert.match(code, /pinch/, `pinch zooms. ${OWNER}`); assert.match(code, /drag/, `drag pans. ${OWNER}`);
  assert.doesNotMatch(code, /reset|RESET|rotate-ccw/, `no reset control. ${OWNER}`);
  assert.doesNotMatch(code, /<select|C\.dialog\(|role="dialog"/, `no native dropdowns or dialogs. ${OWNER}`);
  const css = strip(read('src/map-select.css')), spawn = css.slice(css.indexOf('.spawn-marker'), css.indexOf('Map labels'));
  assert.doesNotMatch(spawn, /outline|:focus|border-color:\s*(?:#[0-9a-f]*[bf]\b|blue)/i, `no outlines. ${OWNER}`);
  assert.match(spawn, /transition:/, `selection states animate. ${OWNER}`);
});
test('areas: exactly one per playable map, each with a start on that map\'s own road network', () => {
  const playable = getPlayableMaps(MAPS).map(m => m.id), areas = spawnAreas();
  assert.deepEqual(areas.map(a => a.mapId), playable.filter(id => areas.some(a => a.mapId === id)), 'in menu order');
  assert.deepEqual(areas.map(a => a.mapId).sort(), [...playable].sort(), `one area per playable map, and only playable maps. ${OWNER}`);
  for (const id of ['riviera', 'penteli', 'psychiko', 'megara']) assert.ok(playable.includes(id));
  for (const area of areas) {
    assert.ok(/^[A-Z ]+$/.test(area.name), `${area.id}: a general area name, not a POI`);
    const snap = snapToRoad(roads, ...area.at, 40 / METRES);
    assert.ok(snap && snap.mapId === area.mapId, `${area.id}: its start is on a drivable road of ${area.mapId}`);
  }
  assert.ok(AREA_STARTS.every(s => PLAYABLE_MAPS.includes(s.mapId)), 'no area belongs to a map players cannot drive');
});
test('clicking the map snaps to the nearest drivable road within a sensible radius, otherwise there is no road', () => {
  const [ax, ay] = atticaFromLonLat(23.78291, 37.81348), snap = snapToRoad(roads, ax, ay, 1.4);
  assert.ok(snap && snap.distance * METRES < 25 && snap.mapId === 'riviera' && snap.street, 'Vouliagmeni snaps to a named street');
  const off = snapToRoad(roads, ax + 6 / METRES, ay + 6 / METRES, .12); assert.ok(off && off.distance * METRES <= 10, 'a click 8 m off a road still lands on it');
  assert.equal(snapToRoad(roads, ...atticaFromLonLat(23.55, 37.78), 1.4), null, 'open sea: no road here');
  assert.equal(snapToRoad(roads, ...atticaFromLonLat(23.70, 38.05), 1.4), null, 'the city outside every drivable map: no road here');
  // A snapped point converts back to map metres that are on that map's road network.
  const [x, z] = snap.local, back = atticaFromLocal('riviera', x, z); assert.ok(Math.hypot(back[0] - snap.at[0], back[1] - snap.at[1]) * METRES < .5, 'round trip');
});
test('projections match the generated Attica map, the shipped maps and the Athens world', () => {
  const [lon, lat] = lonLatFromAttica(...atticaFromLonLat(23.78, 37.81)); assert.ok(Math.abs(lon - 23.78) < 1e-9 && Math.abs(lat - 37.81) < 1e-9);
  for (const [id, file] of Object.entries({ riviera: 'data/map.json', megara: 'data/maps/megara/map.json', penteli: 'data/maps/penteli/map.json', psychiko: 'data/maps/psychiko/map.json' })) {
    const data = JSON.parse(read(file)), [ax, ay] = atticaFromLocal(id, data.route.x[0], data.route.z[0]), start = TRACK_ROUTES[id].start;
    assert.ok(Math.hypot(ax - start[0], ay - start[1]) < .02, `${id}: the route start lands where tools/build-attica-map.py put it`);
    const [x, z] = localFromAttica(id, ax, ay); assert.ok(Math.hypot(x - data.route.x[0], z - data.route.z[0]) < .01, `${id}: and back`);
  }
  const [ex, ez] = athensFromLonLat(23.73, 37.98); assert.ok(Math.abs(ex) < 1e-6 && Math.abs(ez) < 1e-6, 'the Athens world origin');
});
test('assets/maps/spawn-roads.json is the maps\' drivable roads (regenerate with node tools/build-spawn-roads.mjs)', () => {
  assert.equal(read('assets/maps/spawn-roads.json'), JSON.stringify(buildSpawnRoads()), 'stale: run node tools/build-spawn-roads.mjs');
  assert.equal(roadsJson.unit, UNIT); assert.deepEqual(Object.keys(roads).sort(), ['megara', 'penteli', 'psychiko', 'riviera']);
  assert.ok(readFileSync(new URL('../assets/maps/spawn-roads.json', import.meta.url)).length < 200e3, 'small enough to fetch when the picker opens');
});

// ---------------------------------------------------------------- the placement
const forward = yaw => [-Math.sin(yaw), -Math.cos(yaw)];
for (const def of getPlayableMaps(MAPS)) test(`${def.id}: the area start and every clicked road point puts the car on the road, at road level, facing along it, clear of traffic`, async () => {
  const beforeFetch = globalThis.fetch; globalThis.fetch = async u => new Response(readFileSync(new URL('../' + u, import.meta.url)));
  let map; try { map = await loadMap(undefined, './', def.id, { preload: false }); } finally { globalThis.fetch = beforeFetch; }
  const r = map.route, network = new RoadNetwork(map); network.source = map.terrain.H; map.roadNetwork = network;
  const ground = new Ground(map, (x, z) => map.terrain.height(x, z), { network }), v = new Vehicle(CARS.find(c => c.id === 'corolla'), r); v.ground = ground;
  const traffic = { cars: [], point(c, out) { out.x = c.x; out.z = c.z; return true; } }, grid = [];
  const spawnOnRoad = Function('route', 'ground', 'traffic', 'grid', 'planTow', 'RoadIndex', 'routeTowAdapter',
    section('// Tow, reset and automatic recovery put', 'function backOnRoad(') + section('/** Free roam starts where', '/** offline reset onto the active event') + 'return spawnOnRoad;')(r, ground, traffic, grid, planTow, RoadIndex, routeTowAdapter);
  const onRoad = (plan, where) => {
    assert.ok([v.x, v.y, v.z, v.s, v.u, v.yaw].every(Number.isFinite), `${where}: finite pose`);
    if (plan.kind === 'road') {
      const sample = network.sample(v.x, v.z); assert.ok(sample && sample.step === 0, `${where}: on the tarmac of a street`);
      assert.ok(Math.abs(v.y - network.height(v.x, v.z)) < 1e-6, `${where}: at road level, not the DEM`);
      // A junction can expose two almost-parallel polyline pieces. Match the legal lane on any actual
      // candidate rather than choosing the first neighbour's extended axis before testing lane centring.
      const [fx, fz] = forward(v.yaw), seg = network.candidates(v.x, v.z).find(g => {
        const u=Math.abs((v.x-g.ax)*-g.dz/g.L+(v.z-g.az)*g.dx/g.L);
        return network.distance(g,v.x,v.z)<=g.hw+.3&&Math.abs(fx*g.dx/g.L+fz*g.dz/g.L)>.999&&u<=g.hw-v.halfW+.05&&(u<.05||Math.abs(u-g.hw*.5)<.05);
      });
      assert.ok(seg, `${where}: faces along the street`);
      const lateral = Math.abs((v.x - seg.ax) * -seg.dz / seg.L + (v.z - seg.az) * seg.dx / seg.L);
      assert.ok(lateral <= seg.hw - v.halfW + .05, `${where}: the whole car is on the street (${lateral.toFixed(2)} of ${seg.hw})`);
      assert.ok(lateral < .05 || Math.abs(lateral - seg.hw * .5) < .05, `${where}: in a lane centre, not the line (${lateral.toFixed(2)})`);
    } else {
      assert.ok(Math.abs(v.u) + v.halfW <= r.edge(v.s) + 1e-6, `${where}: the whole car is on the carriageway`);
      assert.ok(Math.abs(v.y - r.point(v.s, v.u).y) < 1e-6, `${where}: at road level, not the DEM`);
      const f = r.contactFrame(v.s, v.u, {}), [fx, fz] = forward(v.yaw); assert.ok(Math.abs(fx * f.tx + fz * f.tz) > .999, `${where}: faces along the road`);
    }
  };
  let spots = 0, clicks = 0, streets = 0;
  for (const spot of spawnAreas().filter(s => s.mapId === def.id)) {
    const plan = spawnOnRoad(v, { x: spot.local[0], z: spot.local[1], name: spot.name }); onRoad(plan, spot.id); spots++; streets += plan.kind === 'road';
    assert.ok(plan.distance < 45, `${spot.id}: the spot is a road, the car lands within ${plan.distance.toFixed(1)} m of it`);
    ground.resolve(v, 1 / 60); assert.ok(v._network ? network.sample(v.x, v.z)?.step === 0 : Math.abs(v.u) + v.halfW < r.edge(v.s) + .05, `${spot.id}: the first live step stays on the road`);
    // Traffic in the way: a car parked on that very pose pushes the spawn clear of it.
    traffic.cars = [{ active: true, crash: false, x: v.x, z: v.z }];
    const [bx, bz] = [v.x, v.z], moved = spawnOnRoad(v, { x: spot.local[0], z: spot.local[1] }); onRoad(moved, spot.id + ' with traffic');
    assert.ok(Math.hypot(v.x - bx, v.z - bz) > v.halfL + 3 || moved.clear === false, `${spot.id}: clear of the traffic car`);
    traffic.cars = [];
  }
  // Clicks: points of this map's roads (as the picker snaps them) and points between roads, 20 m into the verge.
  const list = roads[def.id].roads;
  for (let i = 0; i < list.length; i += Math.max(1, Math.floor(list.length / 24))) {
    const p = list[i].pts, k = Math.floor(p.length / 4) * 2, snap = snapToRoad({ [def.id]: roads[def.id] }, p[k], p[k + 1], 1.4);
    if (!snap) continue; for (const away of [0, 20]) { const plan = spawnOnRoad(v, { x: snap.local[0] + away, z: snap.local[1] }); onRoad(plan, `${def.id} click ${i} +${away} m`); clicks++; }
  }
  assert.ok(spots === 1 && clicks >= 10, `${def.id}: its area start and ${clicks} clicks placed (${streets} on side streets)`);
});

// ---------------------------------------------------------------- free roam stays clean
test('free roam carries a spawn and nothing of a track: no route, start/finish, race HUD, track name, length, laps or leaderboard', async () => {
  const def = freeRoam('riviera', { x: 10, z: 20, name: 'VOULIAGMENI' });
  assert.equal(def.type, 'free'); assert.deepEqual(def.spawn, { x: 10, z: 20, name: 'VOULIAGMENI' }); assert.equal(def.rivals, 0, 'no rivals'); assert.deepEqual(def.targets, {}, 'no medals or targets');
  assert.equal('spawn' in freeRoam('riviera'), false, 'without a choice it keeps the old start');
  const html = await renderPicker('', {}), text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.doesNotMatch(text, /\b(?:LENGTH|LAPS?|LEADERBOARD|BEST|SELECT TRACK|CHOOSE YOUR TRACK|HILL CLIMB|CIRCUIT|POINT TO POINT|SPRINT)\b/i, `no track name, length, laps or leaderboard. ${OWNER}`);
  const spawnCode = strip(pickerSource);
  assert.doesNotMatch(spawnCode, /getMapPersonalBest|leaderboard|TRACK_ROUTES|routes\[|fmtDist|raceLaps|routeLength/i, `the picker knows nothing of tracks. ${OWNER}`);
  // The session itself stays as 2026-10-18 made it (tools/owner-locked-free-roam-clean.test.mjs): no gantries, arches or race HUD.
  assert.match(main, /markers\.group\.visible = def\.type !== 'free'/, OWNER);
  assert.match(main, /for \(const mark of route\.timingMarks \|\| \[\]\) mark\.visible = def\.type !== 'free'/, OWNER);
  // DRIVE starts a free session with the chosen point, and the game places the car with the tow placement.
  assert.match(strip(pickerSource), /menu\.h\.startFree\?\.\(\{ \.\.\.freeRoam\(choice\.mapId, \{ x, z, name: choice\.name \}\) \}\)/, OWNER);
  assert.match(boot, /startFree: async def => \{[^}]*flow\.startEvent\(def, \{ car \}\)/, OWNER); assert.match(main, /startFree: def => startEvent\(def, \{ car: G\.carIdx \}\)/, OWNER);
    assert.match(main, /const spawn = solo && def\.type === 'free' \? def\.spawn : null;[^\n]*\n\s*if \(spawn\) spawnOnRoad\(player\.veh, spawn\);/, OWNER);
  assert.match(section('/** Free roam starts where', '/** offline reset onto the active event'), /planTow\(\{ x: spawn\.x, z: spawn\.z, yaw: spawn\.yaw \?\? 0, route: kit\.adapter, index: kit\.index, dir: 1, course: null, clear: towClearance\(pv\) \}\)/, OWNER);
  assert.doesNotMatch(menu, /dataset\.spot/, `there are no spawn pins to confirm on. ${OWNER}`);
  assert.match(menu, /case 'spawnDrive': driveFromSpawn\(this\); break;/, OWNER); assert.match(menu, /case 'spawnCar': this\.h\.garage\?\.\(\); break;/, OWNER);
});

// ---------------------------------------------------------------- normal Free Roam uses the whole world
test('normal Free Roam exposes the whole-Athens world without special URL flags', async () => {
  for (const search of ['', '?menu=1', '?map=riviera', '?routes=1&route=riviera-coast', '?map=athens']) assert.equal(athensEnabled(search), true);
  assert.ok(!spawnAreas().some(s => s.mapId === 'athens'), 'legacy area helpers remain available for original tracks');
  // The picker is the open world, one connected city: its areas are its districts, centre first.
  const districts = spawnAreas({ athens: true });
  assert.ok(districts.length >= 10 && districts.every(s => s.mapId === 'athens'), 'the areas are the Athens districts');
  assert.equal(districts[0].name, 'SYNTAGMA');
  assert.equal(spawnAreas({ athens: true, athensCells: new Set() }).length, 0, 'none that the world does not host');
  assert.ok(ATHENS_DISTRICTS.every(s => s.mapId === 'athens' && s.id.startsWith('athens:')));
  const plain = await renderPicker(); assert.match(plain, /map-track-count">SYNTAGMA</, 'the normal menu starts in central Athens'); assert.match(plain, /KYPSELI/, 'districts outside the original tracks are selectable');
  const flagged = await renderPicker('?map=athens&menu=1'); assert.match(flagged, /map-track-count">SYNTAGMA</, 'existing direct links still show it');
  assert.ok(!PLAYABLE_MAPS.includes('athens') && !MAPS.some(m => m.id === 'athens'), 'it is not a catalogue map');
  assert.ok(!JSON.stringify(roadsJson).includes('athens'), 'the road data is only the playable maps\'');
  const code = strip(pickerSource); assert.match(code, /const athensMode = athensEnabled\(\)/, OWNER);
  assert.match(code, /if \(athensMode\) loadAthens\(\)/, 'published cells define the selectable world'); assert.match(code, /loadRoads\(athensMode\)/, 'the picker loads its full street file');
  assert.match(code, /athens \? 'assets\/athens\/streets\.json' : 'assets\/maps\/spawn-roads\.json'/, OWNER);
  // The flag still boots the world directly (dev tooling); the menu route needs ?menu=1.
  assert.match(boot, /\(query\.get\('map'\)==='athens' && !query\.has\('menu'\)\) \|\| direct/, OWNER);
  assert.doesNotThrow(() => initialMapId(new URLSearchParams('map=athens&menu=1')), 'the catalogue lookup ignores the open world');
  // A spot's cell is a hosted 512 m cell of the Athens world projection.
  const [x, z] = athensFromAttica(...atticaFromLonLat(23.754, 37.866)); assert.equal(athensCell(x, z), `${Math.floor(x / 512)},${Math.floor(z / 512)}`);
  const athensWorld = strip(read('src/athens-world.js')); assert.match(athensWorld, /query\.get\('spawn'\)/, 'the open world takes the chosen point'); assert.match(athensWorld, /async function spawnAt\(x,z\)/);
});


test('DRIVE enters the Athens world at the chosen point and clears stale race parameters', async () => {
  const { driveFromSpawn } = await import('../src/spawn-select.js');
  const prior = globalThis.location;
  try {
    for (const search of ['', '?routes=1&route=riviera-coast&routeEvent=quick&setup=1&menu=1&event=quick&quick=1']) {
      let destination;
      globalThis.location = { search, assign: url => { destination = new URL(url, 'https://athensracing.com/'); } };
      driveFromSpawn({ data: { spawn: { choice: { mapId: 'athens', local: [1234.56, -987.65] } } }, h: { carSpec: () => ({ id: 'mini' }) } });
      assert.equal(destination.searchParams.get('map'), 'athens');
      assert.equal(destination.searchParams.get('spawn'), '1234.6,-987.6');
      assert.equal(destination.searchParams.get('car'), 'mini');
      for (const key of ['menu', 'routes', 'route', 'routeEvent', 'setup', 'event', 'quick']) assert.equal(destination.searchParams.has(key), false, key);
    }
  } finally { if (prior === undefined) delete globalThis.location; else globalThis.location = prior; }
});
