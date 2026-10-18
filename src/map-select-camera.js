// Camera coordinates are pixels relative to the viewport centre; scale is screen px per map unit.
// `safe` is the part of the viewport the map can frame things in: {left, top, right, bottom} in viewport px,
// i.e. the full-screen map minus the header, the footer and the floating track card.
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
export const coverScale = (view, asset) => Math.max(view.width / asset.width, view.height / asset.height);
export const MAX_SCALE = 20;
// A selected track fills most of the free area, framing never less than about 3 km of map, so even the compact
// Megara circuit keeps its surroundings.
export const TRACK_FRAME = { pad: .14, minSpan: 34, maxScale: MAX_SCALE };
export function routeBounds(routes) {
  return [Math.min(...routes.map(r => r.bounds[0])), Math.min(...routes.map(r => r.bounds[1])), Math.max(...routes.map(r => r.bounds[2])), Math.max(...routes.map(r => r.bounds[3]))];
}
export function clampCamera(camera, view, asset) {
  const scale = clamp(camera.scale, coverScale(view, asset), Math.max(coverScale(view, asset), MAX_SCALE));
  const maxX = Math.max(0, (asset.width * scale - view.width) / 2);
  const maxY = Math.max(0, (asset.height * scale - view.height) / 2);
  return { scale, x: clamp(camera.x, -maxX, maxX), y: clamp(camera.y, -maxY, maxY) };
}
export function frameBounds(view, asset, bounds, safe, { pad = .1, minSpan = 0, maxScale = MAX_SCALE } = {}) {
  const s = safe || { left: 0, top: 0, right: view.width, bottom: view.height };
  const bw = Math.max(minSpan, bounds[2] - bounds[0]), bh = Math.max(minSpan, bounds[3] - bounds[1]);
  const scale = clamp(Math.min((s.right - s.left) * (1 - 2 * pad) / bw, (s.bottom - s.top) * (1 - 2 * pad) / bh), coverScale(view, asset), maxScale);
  const cx = (bounds[0] + bounds[2]) / 2, cy = (bounds[1] + bounds[3]) / 2;
  const px = (s.left + s.right - view.width) / 2, py = (s.top + s.bottom - view.height) / 2;
  return clampCamera({ scale, x: px - (cx - asset.width / 2) * scale, y: py - (cy - asset.height / 2) * scale }, view, asset);
}
/** every track in view (the flight between two tracks passes through at most this zoom-out) */
export const fitTracks = (view, asset, bounds, safe) => frameBounds(view, asset, bounds, safe, { pad: .1 });
/** the selected track's whole route, centred in the free area */
export const focusTrack = (view, asset, route, safe) => frameBounds(view, asset, route.bounds, safe, TRACK_FRAME);
/** a fly-to between two cameras: centre eases across, scale eases in log space and dips out far enough that both
 *  ends are on screen half-way (van Wijk-style), so a long hop reads as "up, across, down" rather than a smear */
export function flight(from, to, view, asset) {
  const world = cam => [asset.width / 2 - cam.x / cam.scale, asset.height / 2 - cam.y / cam.scale];
  const c0 = world(from), c1 = world(to), d = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
  const l0 = Math.log(from.scale), l1 = Math.log(to.scale);
  const need = Math.log(Math.max(coverScale(view, asset), Math.min(view.width, view.height) / Math.max(1e-6, d * 1.35)));
  const bump = Math.max(0, (l0 + l1) / 2 - need);
  const duration = Math.min(1500, 520 + Math.abs(l1 - l0) * 90 + bump * 260 + Math.min(d * Math.min(from.scale, to.scale), 900) * .25);
  return { duration, at(e) {
    const scale = Math.exp(l0 + (l1 - l0) * e - bump * Math.sin(Math.PI * e)), c = [c0[0] + (c1[0] - c0[0]) * e, c0[1] + (c1[1] - c0[1]) * e];
    return { scale, x: -(c[0] - asset.width / 2) * scale, y: -(c[1] - asset.height / 2) * scale };
  } };
}
