import * as ENV from './env.js';
import { WorldLife, hourForTime } from './world-life.js';

export const worldLife = new WorldLife();
let applyAge = 0, broadcastAge = 0, lastWall = null, wasRunning = false;
export function configureWorldLife(def, conditions = ENV.getConditions()) {
  const chosen = { ...conditions, ...def.conditions };
  // Dynamic starts at the session's chosen preset; choosing it never jumps to noon.
  const hour = chosen.time === 'dynamic' ? conditions.hour ?? hourForTime(conditions.time) : hourForTime(chosen.time);
  const sample = worldLife.configure({ type: def.type, ...chosen, hour, dayMinutes: def.dayMinutes ?? new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('dayMinutes') ?? 30 });
  applyAge = broadcastAge = 0; lastWall = null; wasRunning = false;
  if (sample.dynamic) ENV.setWorldConditions(sample, { forceBake: true });
  else ENV.setConditions({ time: chosen.time, weather: chosen.weather });
}
export function receiveWorldLife(snapshot, age = 0) {
  if (!worldLife.adopt(snapshot, age)) return false;
  if (snapshot.dynamic) ENV.setWorldConditions(worldLife.sample());
  else ENV.setConditions({ time: snapshot.time, weather: snapshot.weather });
  return true;
}
export function tickWorldLife(dt, { running = true, online = null, wallClock = true } = {}) {
  const now = typeof performance === 'undefined' ? Date.now() : performance.now();
  const elapsed = wallClock ? wasRunning && lastWall !== null ? Math.max(0, (now - lastWall) / 1000) : 0 : dt;
  lastWall = now; wasRunning = running;
  if (!running) return;
  const sample = worldLife.advance(elapsed); applyAge += elapsed; broadcastAge += elapsed;
  if (sample.dynamic && applyAge >= .25) { ENV.setWorldConditions(sample); applyAge = 0; }
  if (online?.connected && online.lobby?.host === online.id && broadcastAge >= 1) {
    online.send({ type: 'world', raceId: online.lobby.raceId, generation: online.lobby.generation, world: worldLife.snapshot() }); broadcastAge = 0;
  }
}
if (typeof window !== 'undefined') window.__worldLife = { world: worldLife, configure: configureWorldLife, tick: (dt) => tickWorldLife(dt, { wallClock: false }), receive: receiveWorldLife };
