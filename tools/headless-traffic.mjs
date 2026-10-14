// The real src/traffic.js and src/signals.js decision code without WebGL: the models are plain records, the
// signal heads are not drawn. Used by tools/traffic-race.test.mjs and tools/traffic-race-sim.mjs to run civilians
// beside real Vehicle physics. `loadTraffic()` is the module; `buildWorld()` wires a route, signals and bus stops.
// TRAFFIC_JS=<path> runs another copy of traffic.js with the same harness (before/after comparisons).
import { readFileSync } from 'node:fs';
import { RNG, clamp, lerp, smoothstep } from '../src/util.js';
import { trafficByHour } from '../src/world-life.js';
import { damageIncrement, equivalentBarrierSpeed } from '../src/damage-math.js';

const read = (p) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');
const strip = (src) => src.replace(/^import .*;$/gm, '').replace(/^export /gm, '');

class Vec3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
const node = () => ({ position: new Vec3(), scale: new Vec3(1, 1, 1), rotation: {}, add() {}, visible: false });
class Any { constructor() { Object.assign(this, node(), { instanceMatrix: {}, userData: {} }); } translate() { return this; } setMatrixAt() {} compose() { return this; } setFromEuler() { return this; } set() { return this; } }
const THREE = new Proxy({ Vector3: Vec3 }, { get: (t, k) => t[k] ?? Any });

/** TRAFFIC_TYPES from cars.js (which cannot be imported headless: it builds three.js models at load) */
function trafficTypes() {
  const src = read('cars.js');
  const cars = src.slice(src.indexOf('export const CARS = ['), src.indexOf('\n];', src.indexOf('export const CARS = [')) + 3);
  const tail = src.slice(src.indexOf('export function defaultTrafficWeight'), src.indexOf('export function trafficModel'));
  return new Function(strip(cars + '\n' + tail) + '\nreturn TRAFFIC_TYPES;')();
}

const COND = { hour: 15 };
let loaded = null;
/** { Traffic, TRAFFIC_TYPES, Signals, findJunctions } */
export function loadTraffic() {
  if (loaded) return loaded;
  const TRAFFIC_TYPES = trafficTypes();
  // a model is a record of the few fields traffic.js touches; setStrobe stops it building its own light bar
  const trafficModel = (type) => ({ root: node(), body: node(), tail: { emissiveIntensity: 0 }, setStrobe() {}, updateDamage() {}, setDamage() {}, damage: {}, damageDebris: [], lodLevel: 0 });
  const ROAD = { gutter: 0.55, sidewalk: () => 2.4 };
  const T = new Function('THREE', 'COND', 'trafficByHour', 'hourForTime', 'TRAFFIC_TYPES', 'trafficModel', 'skipHiddenMatrices', 'RNG', 'clamp', 'lerp', 'smoothstep',
    'ROAD', 'LANE_W', 'SURF', 'mergeGeometries', 'bakeParkedFleet', 'damageIncrement', 'equivalentBarrierSpeed',
    strip(process.env.TRAFFIC_JS ? readFileSync(process.env.TRAFFIC_JS, 'utf8') : read('traffic.js')) + '\nreturn { Traffic, routeVel, extents };')(
    THREE, COND, trafficByHour, () => 15, TRAFFIC_TYPES, trafficModel, () => {}, RNG, clamp, lerp, smoothstep,
    ROAD, 3.3, {}, () => null, () => null, damageIncrement, equivalentBarrierSpeed);
  const S = new Function('THREE', 'mergeGeometries', 'ROAD', 'RNG', 'clamp', 'canvasTex', strip(read('signals.js')) + '\nreturn { Signals, findJunctions };')(THREE, () => null, ROAD, RNG, clamp, () => null);
  return (loaded = { ...T, TRAFFIC_TYPES, ...S });
}

/** the lights, bus stops and civilians of a map as main.js (map-world.js) builds them, minus the drawing */
export function buildWorld(route, data, { hour = 15 } = {}) {
  COND.hour = hour;
  const { Traffic, Signals, findJunctions } = loadTraffic();
  route.seaR = route.seaL = () => 999;
  const zones = data.zones?.length ? data.zones : [{ s: 0, urban: 0, zone: 'town' }];
  route.urban = (s) => {
    s = route.wrap(s); let v = zones[0].urban;
    for (let i = 1; i < zones.length; i++) v += (zones[i].urban - zones[i - 1].urban) * smoothstep(zones[i].s - 120, zones[i].s + 130, s);
    return v;
  };
  route.district = (s) => { s = route.wrap(s); let z = zones[0]; for (const q of zones) if (s >= q.s) z = q; return z.zone; };
  const J = findJunctions({ route, data });
  const signals = Object.create(Signals.prototype);
  Object.assign(signals, { route, J, t: 0, paint() {} });
  for (const j of J) { j.pmats = [{}, {}]; j.vis = {}; j.main = null; }
  signals.reset = function () { this.t = -1.35; for (const j of this.J) { j.main = null; j.spawnT.L = j.spawnT.R = 0.5; } this.update(0, 0); };
  signals.reset();
  // bus stops as road.js picks them: kerb-side stops that are not at a junction, at least 80 m apart
  const busStops = [], used = [];
  for (const f of data.furniture) {
    if (f.t === 'bus_stop' && f.u > 0 && !J.some((j) => Math.abs(j.s - f.s) < 18) && !used.some((s) => Math.abs(s - f.s) < 80)) { used.push(f.s); busStops.push(f.s); }
  }
  busStops.sort((a, b) => a - b);
  const traffic = new Traffic({ add() {} }, route, data);
  traffic.signals = signals; traffic.people = null; traffic.busStops = busStops;
  traffic.drawRange = 650;
  return { traffic, signals, busStops };
}
