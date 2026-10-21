// The mode and the position have independent controls. Keep each mode's last position.
export const CAMERA_POSITIONS = Object.freeze({ outside: ['chase', 'far', 'bumper'], pov: ['cockpit', 'hood'] });
export const CAMERA_NAMES = Object.freeze({ chase: 'CHASE', far: 'FAR CHASE', bumper: 'BUMPER', cockpit: 'DRIVER POV', hood: 'HOOD POV' });
export const MAX_CHASE_ELEVATION = 0.48; // radians, including temporary mouse orbit

export function createCameraViews(initial = null, storage = globalThis.localStorage) {
  let saved;
  try { saved = JSON.parse(storage?.getItem('paraliaki.camera.views') || 'null'); } catch {}
  const position = {
    outside: CAMERA_POSITIONS.outside.includes(saved?.outside) ? saved.outside : 'chase',
    pov: CAMERA_POSITIONS.pov.includes(saved?.pov) ? saved.pov : 'cockpit',
  };
  let mode = CAMERA_POSITIONS.pov.includes(initial) ? 'pov' : 'outside';
  if (CAMERA_POSITIONS[mode].includes(initial)) position[mode] = initial;
  const persist = () => { try { storage?.setItem('paraliaki.camera.views', JSON.stringify(position)); } catch {} };
  return {
    get mode() { return mode; }, get current() { return position[mode]; },
    get positions() { return { ...position }; },
    toggle() { mode = mode === 'pov' ? 'outside' : 'pov'; return position[mode]; },
    cycle() { const options = CAMERA_POSITIONS[mode]; position[mode] = options[(options.indexOf(position[mode]) + 1) % options.length]; persist(); return position[mode]; },
  };
}

export function chaseElevation(up, back, orbitPitch = 0) {
  const pitch = Number.isFinite(orbitPitch) ? orbitPitch : 0;
  return Math.min(MAX_CHASE_ELEVATION, Math.max(-0.08, Math.atan2(up, back) + pitch));
}
