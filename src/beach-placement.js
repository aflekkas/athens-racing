// Fit each sunbed to its own four support corners, after terrain conformation.
// yaw uses three's local +X/+Z convention; the returned tilt uses YXZ order.
export function beachBedPose(heightC, x, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw), w = .35, d = .95;
  const at = (u, v) => heightC(x + c * u + s * v, z - s * u + c * v);
  const a = at(-w,-d), b = at(w,-d), e = at(-w,d), f = at(w,d);
  const dx = (b + f - a - e) / (4 * w), dz = (e + f - a - b) / (4 * d);
  const pitch = -Math.atan(dz), roll = Math.atan(dx * Math.cos(pitch));
  // Put the lowest support on the surface even when a triangle edge crosses the bed.
  const height = Math.max(...[[-w,-d,a],[w,-d,b],[-w,d,e],[w,d,f]].map(([u,v,h]) => h - Math.cos(pitch)*Math.sin(roll)*u + Math.sin(pitch)*v));
  return { height, pitch, roll };
}
