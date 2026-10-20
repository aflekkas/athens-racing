// Wheel input for the Attica maps (Track select and the free roam picker; owner 2026-10-20: "on trackpad it does not pan
// well"). A two-finger trackpad scroll pans, a pinch (the browser sends ctrl+wheel) zooms, and a real mouse wheel keeps
// zooming. Pure: no DOM, so tools/map-wheel.test.mjs can feed it synthetic events.
//
// Browsers do not say which device sent a wheel event, so the kind is read from the event itself:
//   ctrlKey                      a trackpad pinch (or ctrl + mouse wheel): zoom
//   deltaMode line / page        a mouse wheel (Firefox, most Linux / Windows mice): zoom
//   any deltaX                   a two-finger trackpad scroll: pan
//   a large whole-number deltaY  a notched mouse wheel in pixel mode (Chrome, Safari: 100 / 120 per notch): zoom
//   a multiple of 4.000244       a mouse wheel in Chrome / Arc / Edge on macOS, whose notches come in that odd step: zoom
//                                (owner 2026-10-20: "I could not scroll wheel to zoom out"; the same test web maps use)
//   anything else                small or fractional pixel deltas, a trackpad: pan
// A gesture keeps the kind it started with until the wheel rests (GESTURE_MS), so a trackpad scroll that slows to one
// large-looking event, or a fast flick, never flips into a zoom halfway through.
export const GESTURE_MS = 220;
export const MOUSE_NOTCH = 50;
export const MAC_WHEEL_STEP = 4.000244140625;
const macWheel = dy => dy !== 0 && Math.abs(dy / MAC_WHEEL_STEP - Math.round(dy / MAC_WHEEL_STEP)) < 1e-6;
const LINE = 16, PAGE = 400;

/** pixels for a wheel delta in any deltaMode */
export const wheelPixels = (delta, mode) => delta * (mode === 1 ? LINE : mode === 2 ? PAGE : 1);

/** 'zoom' | 'pan' for one event, ignoring gesture history */
export function wheelKind(e) {
  if (e.ctrlKey) return 'zoom';
  if (e.deltaMode === 1 || e.deltaMode === 2) return 'zoom';
  if (e.deltaX) return 'pan';
  const dy = Math.abs(e.deltaY);
  if (macWheel(e.deltaY)) return 'zoom';
  return dy >= MOUSE_NOTCH && Number.isInteger(e.deltaY) ? 'zoom' : 'pan';
}

/** A stateful classifier: the first event of a gesture decides; later events of the same gesture follow it. */
export function createWheelClassifier() {
  let kind = null, last = -Infinity;
  return (e, now = e.timeStamp ?? 0) => {
    // A pinch always zooms (it can follow a scroll without a pause); otherwise the gesture's kind holds while events keep coming.
    const fresh = wheelKind(e);
    if (e.ctrlKey || !kind || now - last > GESTURE_MS) kind = fresh;
    last = now;
    return kind;
  };
}

/** A mouse wheel zooms a fixed step per notch, as a web map does, whatever size the browser reports a notch as. */
export const NOTCH_ZOOM = 1.28;
/** notches in one wheel event: line mode 3 lines, page mode 1 page, Chrome on macOS 4.000244 px, other pixel wheels 100 px */
export const wheelNotches = e => e.deltaMode === 1 ? e.deltaY / 3 : e.deltaMode === 2 ? e.deltaY : macWheel(e.deltaY) ? e.deltaY / MAC_WHEEL_STEP : e.deltaY / 100;
/** The zoom factor (> 1 zooms in) for a zoom-kind event. A pinch is continuous (its small deltas scaled up); a wheel moves
 * NOTCH_ZOOM per notch, at most two notches per event so one burst of a free-spinning wheel cannot leap across the map. */
export function wheelZoomFactor(e) {
  if (e.ctrlKey) return Math.exp(-Math.max(-300, Math.min(300, wheelPixels(e.deltaY, e.deltaMode))) * .01);
  return NOTCH_ZOOM ** -Math.max(-2, Math.min(2, wheelNotches(e)));
}

/** The camera offset in screen pixels for a pan-kind event: the map follows the fingers, like a scrolled page. */
export function wheelPan(e) {
  return [-wheelPixels(e.deltaX, e.deltaMode), -wheelPixels(e.deltaY, e.deltaMode)];
}

/** Drag inertia: feed pointer moves while dragging, call release() on pointer up, then step(dt) each frame until it returns null. */
export function createGlide({ decay = .2, stopBelow = 12 } = {}) {
  let vx = 0, vy = 0, lastT = 0, gliding = false;
  return {
    track(dx, dy, now) {
      const dt = Math.max(1, now - lastT) / 1000; lastT = now;
      // A short exponential average of the drag speed (px / s), so one jittery event does not fling the map.
      const k = Math.min(1, dt / .05); vx += (dx / dt - vx) * k; vy += (dy / dt - vy) * k; gliding = false;
    },
    halt() { vx = vy = 0; gliding = false; },
    /** start gliding if the pointer was still moving when it let go (a pause before release means no fling) */
    release(now) { if (now - lastT > 80) vx = vy = 0; gliding = Math.hypot(vx, vy) > stopBelow * 4; return gliding; },
    step(dt) {
      if (!gliding) return null;
      const f = Math.exp(-dt / decay); vx *= f; vy *= f;
      if (Math.hypot(vx, vy) < stopBelow) { gliding = false; return null; }
      return [vx * dt, vy * dt];
    },
    get active() { return gliding; },
  };
}
