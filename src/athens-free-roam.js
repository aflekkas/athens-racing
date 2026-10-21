// Shared input/menu policy for the streamed free-roam entry. Pausing freezes physics,
// but must keep polling menu actions so Escape can resume the same session.
export function pickedAthensArea(query) {
  const spawn = (query.get('spawn') || '').split(',').map(Number);
  return spawn.length === 2 && spawn.every(Number.isFinite) ? (query.get('spawnArea') || '').trim().slice(0, 100) : '';
}
export function pollFreeRoam(input, dt, { speed, menu, blocked, action }) {
  input.update(dt, { speed, inMenu: menu.open, blocked });
  const inMenu = menu.open;
  for (const name of input.actions) {
    if ((inMenu && name === 'pause' && input.state.back) || (!inMenu && name === 'back')) continue;
    if (inMenu) menu.action(name); else action(name);
    if (!inMenu && menu.open) break;
  }
  if (menu.open) Object.assign(input.state, { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false });
  return input.state;
}
export function freeRoamHud(dial, vehicle, { map, tacho, spec, aidsOff }) {
  const state = { ...vehicle, free: true, redline: spec.redline, kmh: Math.abs(vehicle.vLong) * 3.6,
    gearLabel: vehicle.reverse ? 'R' : String(vehicle.gear), aidsOff };
  if (tacho) dial.drawTacho(state);
  if (map) dial.drawWorldMinimap(dial.mctx, dial.mini.width, dial.mini.height, state, dial.bigMap ? .35 : 2.2);
}

// Heap measurements already include the live scene and decoded tile arrays.
export const freeRoamJSBytes = (heap, scene, tiles, transient) => Math.max(heap, scene + tiles + transient);
