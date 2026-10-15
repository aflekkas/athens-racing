// Camera coordinates are pixels relative to the viewport centre; scale is px / SVG unit.
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
export const coverScale = (view, asset) => Math.max(view.width / asset.width, view.height / asset.height);
export function routeBounds(routes) {
  return [Math.min(...routes.map(r => r.bounds[0])), Math.min(...routes.map(r => r.bounds[1])), Math.max(...routes.map(r => r.bounds[2])), Math.max(...routes.map(r => r.bounds[3]))];
}
export function clampCamera(camera, view, asset) {
  const scale = Math.max(coverScale(view, asset), camera.scale);
  const maxX = Math.max(0, (asset.width * scale - view.width) / 2);
  const maxY = Math.max(0, (asset.height * scale - view.height) / 2);
  return { scale, x: clamp(camera.x, -maxX, maxX), y: clamp(camera.y, -maxY, maxY) };
}
export function fitTracks(view, asset, bounds, padding = .08) {
  const scale = Math.max(coverScale(view, asset), Math.min(view.width * (1 - padding * 2) / (bounds[2] - bounds[0]), view.height * (1 - padding * 2) / (bounds[3] - bounds[1])));
  return clampCamera({ scale, x: (asset.width / 2 - (bounds[0] + bounds[2]) / 2) * scale, y: (asset.height / 2 - (bounds[1] + bounds[3]) / 2) * scale }, view, asset);
}
export function focusTrack(view, asset, bounds, home, pin) {
  // A restrained camera move; keep all routes inside a 6% safe margin.
  const scale = home.scale * 1.035;
  const cx = (bounds[0] + bounds[2]) / 2, cy = (bounds[1] + bounds[3]) / 2;
  const x = (asset.width / 2 - (cx + (pin[0] - cx) * .08)) * scale;
  const y = (asset.height / 2 - (cy + (pin[1] - cy) * .08)) * scale;
  return clampCamera({ scale,
    x: clamp(x, view.width * .06 - view.width / 2 - (bounds[0] - asset.width / 2) * scale, view.width * .94 - view.width / 2 - (bounds[2] - asset.width / 2) * scale),
    y: clamp(y, view.height * .06 - view.height / 2 - (bounds[1] - asset.height / 2) * scale, view.height * .94 - view.height / 2 - (bounds[3] - asset.height / 2) * scale),
  }, view, asset);
}
