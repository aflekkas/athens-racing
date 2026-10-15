// HUD SWAY: the in-race HUD rides on the car like a dash-mounted display. Lateral g swings it sideways and rolls
// it, braking dips it and acceleration lifts it, suspension bumps jitter it and free look slides it the other
// way. Every input drives a spring-damper, so the HUD lags the car and settles rather than tracking it exactly.
//   const sway = createHudSway({ near: [dialBox, mapBox], far: [posBox, routeBox, sigBox] });
//   sway.update(dt, input); // reuse { active, cam, mode, ax, ay, heave, lookYaw, lookPitch }   // once per frame
// Near layers (the cluster, the minimap) move fully; far panels move less, with a quarter of the roll
// to avoid large arcs at the edges of their viewport-wide wrapper.
// Writes only the individual `translate` / `rotate` / `scale` properties, which compose with each element's own
// `transform` and stay on the compositor. Nothing is written while the HUD is settled or frozen.
import { clamp } from './util.js';

const G = 9.81;
/** settings.hudMotion -> overall gain */
export const HUD_MOTION = Object.freeze({ off: 0, subtle: 0.55, full: 1 });
/** camera -> gain: strongest from the driver's seat, gentler behind the car, barely there when watching */
export const HUD_MOTION_CAMERA = Object.freeze({ cockpit: 1, bonnet: 1, chase: 0.5, spectate: 0.3 });
/** full-strength amplitudes */
export const HUD_SWAY_TUNING = Object.freeze({
  latPx: 7,       // px per g of lateral acceleration, outward from the turn
  rollDeg: 1.1,   // deg per g of lateral acceleration
  longPx: 5,      // px per g: braking dips the HUD, acceleration lifts it
  longScale: 0.008, // scale per g: braking leans the HUD in, acceleration draws it back
  bumpPx: 260,    // px per metre of suspension heave off its running average
  lookPx: 9,      // px of counter-offset per radian of free look (saturates)
  maxPx: 8, maxDeg: 1.2, // hard limits, whatever the inputs
  hz: 1.7, zeta: 0.55,    // the mount: lags and overshoots a touch
  bumpHz: 7, bumpZeta: 0.35, // the jitter: fast and lively
  farGain: 0.45,  // top panels move this much of the cluster's motion
});

/** one spring-damper step toward target (semi-implicit Euler: stable for w * dt < 2) */
function spring(s, k, v, target, w, zeta, dt) {
  s[v] += (w * w * (target - s[k]) - 2 * zeta * w * s[v]) * dt;
  s[k] += s[v] * dt;
}

/** target pose for the inputs, in px / deg / scale delta, at gain 1 (pure, exported for tests) */
export function swayTarget(input, out = { x: 0, y: 0, r: 0, s: 0 }) {
  const T = HUD_SWAY_TUNING, lat = clamp((input.ay || 0) / G, -1.6, 1.6), lon = clamp((input.ax || 0) / G, -1.6, 1.6);
  // ay > 0 turning right: the HUD swings left (to the outside of the turn) and leans that way
  const yaw = Math.tanh(input.lookYaw || 0), pitch = Math.tanh(input.lookPitch || 0);
  out.x = -lat * T.latPx + yaw * T.lookPx;
  // braking (ax < 0) dips the HUD; looking down (pitch > 0) lifts it
  out.y = -lon * T.longPx - pitch * T.lookPx * 0.6;
  out.r = -lat * T.rollDeg;
  out.s = -lon * T.longScale;
  return out;
}

export function createHudSway({ near = [], far = [] } = {}) {
  const T = HUD_SWAY_TUNING, W = 2 * Math.PI * T.hz, WB = 2 * Math.PI * T.bumpHz;
  const s = { x: 0, xv: 0, y: 0, yv: 0, r: 0, rv: 0, sc: 0, scv: 0, b: 0, bv: 0, heaveAvg: null };
  const target = { x: 0, y: 0, r: 0, s: 0 };
  const q = [NaN, NaN, NaN, NaN]; let live = false;
  const layers = [[near.filter(Boolean), 1], [far.filter(Boolean), T.farGain]];
  function write(x, y, r, sc) {
    // quantised to 0.1 px / 0.01 deg so a settled HUD stops writing to the DOM
    const qx = Math.round(x * 10), qy = Math.round(y * 10), qr = Math.round(r * 100), qs = Math.round(sc * 1e4);
    if (qx === q[0] && qy === q[1] && qr === q[2] && qs === q[3]) return;
    q[0] = qx; q[1] = qy; q[2] = qr; q[3] = qs;
    for (let i = 0; i < layers.length; i++) {
      const els = layers[i][0], k = layers[i][1];
      const t = `${(x * k).toFixed(1)}px ${(y * k).toFixed(1)}px`, rot = `${(r * k * (i ? 0.25 : 1)).toFixed(2)}deg`, scl = (1 + sc * k).toFixed(4);
      for (let j = 0; j < els.length; j++) { const st = els[j].style; st.translate = t; st.rotate = rot; st.scale = scl; }
    }
  }
  function reset() {
    s.x = s.xv = s.y = s.yv = s.r = s.rv = s.sc = s.scv = s.b = s.bv = 0; s.heaveAvg = null;
    if (!live) return; live = false; q.fill(NaN);
    for (const [els] of layers) for (const el of els) { el.style.translate = el.style.rotate = el.style.scale = el.style.willChange = ''; }
  }
  return {
    state: s,
    /** input = { active, cam, mode, ax, ay, heave, lookYaw, lookPitch }; returns the applied gain */
    update(dt, input) {
      const modeGain = HUD_MOTION[input.mode] ?? 0;
      if (!modeGain) { reset(); return 0; }
      if (!input.active || !(dt > 0)) return 0; // freeze the mount in pause, menus and results
      const gain = modeGain * (HUD_MOTION_CAMERA[input.cam] ?? 0);
      if (!gain) return 0;
      dt = Math.min(dt, 0.05);
      // own compositor layers while swaying, so moving them never repaints the drop shadows under them
      if (!live) { live = true; for (let i = 0; i < layers.length; i++) for (let j = 0; j < layers[i][0].length; j++) layers[i][0][j].style.willChange = 'translate, rotate, scale'; }
      swayTarget(input, target);
      const heave = Number.isFinite(input.heave) ? input.heave : 0;
      s.heaveAvg = s.heaveAvg === null ? heave : s.heaveAvg + (heave - s.heaveAvg) * Math.min(1, dt * 3);
      const bump = clamp((heave - s.heaveAvg) * T.bumpPx, -4, 4) * gain;
      // Substeps keep the fast bump spring stable even at 20 fps / after a long frame.
      const steps = Math.ceil(dt * 120), h = dt / steps;
      for (let i = 0; i < steps; i++) {
        spring(s, 'x', 'xv', target.x * gain, W, T.zeta, h); spring(s, 'y', 'yv', target.y * gain, W, T.zeta, h);
        spring(s, 'r', 'rv', target.r * gain, W, T.zeta, h); spring(s, 'sc', 'scv', target.s * gain, W, T.zeta, h);
        spring(s, 'b', 'bv', bump, WB, T.bumpZeta, h);
      }
      write(clamp(s.x, -T.maxPx, T.maxPx), clamp(s.y + s.b, -T.maxPx, T.maxPx), clamp(s.r, -T.maxDeg, T.maxDeg), clamp(s.sc, -0.02, 0.02));
      return gain;
    },
    reset,
  };
}
