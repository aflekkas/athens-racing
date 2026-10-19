// Weaker classes switch OTHER drivers' cars (rivals, online players) to their road-distance model sooner (graphics.js PERFORMANCE.lod).
// A full model is ~65 draw calls; the road-distance one keeps the painted shell, glass and lamps and drops mirror housings, brake
// calipers, lamp internals and trim, which no one makes out on a picture drawn at 0.6 of the screen from 8 m. The local player's own
// car is never scaled. Safe to call again whenever the class changes (it works from each level's authored distance).
const MIN_NEAR = 5;
export function scaleVehicleLod(model, k = 1) {
  const lods = [model?.visualLOD, ...(model?.wheels || []).flatMap(w => w.spin.children.filter(o => o.isLOD))];
  for (const lod of lods) {
    if (!lod?.levels) continue;
    let previous = 0;
    lod.levels.forEach((level, i) => {
      level.authored ??= level.distance;
      if (i > 0) previous = level.distance = Math.max(previous + MIN_NEAR, level.authored * Math.min(1, k)); // levels stay in ascending order
    });
  }
}
