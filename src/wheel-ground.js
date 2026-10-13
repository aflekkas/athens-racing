// The ground under one wheel, split into the smooth plane the car is placed on (the road surface carried on under a
// kerb, or the terrain) and the step on top of it (kerb, median island, dirt hump, sand pile), plus what that wheel's
// tyre feels (the step, blended across a kerb edge over the tyre's width). Dependency-free so it can be unit-tested
// (tools/physics-test/suspension.mjs); ground.js calls it once per wheel per step.
//   route: edge(s), surfaceY(s, u), medHalf(s), div(s), wrap(s) / closed / length
//   road:  { gutter, curbH(route, s), sidewalk(route, s, side) } (ROAD)
//   a:     ground.at() result at the wheel (y, hump)
// Returns { plane, step, input, paved }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TYRE_HALF = 0.11; // half a tyre's width (m): the band either side of a kerb edge over which the load moves across

export function wheelGround(route, road, a, si, ui, out = {}) {
  const sc = route.closed ? route.wrap(si) : clamp(si, 0, route.length), au = Math.abs(ui), side = ui >= 0 ? 1 : -1;
  // Circuit kerbs are rounded profiles already sampled by at(), not urban pavement steps. Paved runoffs can
  // have their own height, so only split the kerb surface from the circuit's banked plane.
  if (route.closed) {
    out.step = a.surf === 'pavement' ? clamp(a.y - route.surfaceY(sc, ui), 0, 0.4) : (a.hump || 0);
    out.plane = a.y - out.step;
    out.input = out.step;
    out.paved = au <= route.edge(sc) || a.surf === 'asphalt' || a.surf === 'pavement';
    return out;
  }
  const eA = route.edge(sc) + road.gutter, uo = eA + 0.18 + road.sidewalk(route, sc, side), ch = clamp(road.curbH(route, sc), 0, 0.4);
  let step;
  if (au <= eA) step = a.y - route.surfaceY(sc, ui);                              // carriageway (0, or the median island)
  else if (au <= uo) step = clamp(a.y - route.surfaceY(sc, side * eA), 0, 0.4);   // pavement / verge: the kerb
  else step = (a.hump || 0) + ch * (1 - smoothstep(uo, uo + 1, au));             // off the edge: the kerb fades to terrain
  const kd = au - eA;
  out.step = step;
  out.plane = a.y - step;                                                         // the plane: always the real geometry
  out.input = Math.abs(kd) < TYRE_HALF && au <= uo ? ch * smoothstep(-TYRE_HALF, TYRE_HALF, kd) : step;
  // The median has the raised side towards u=0. Blend even while the wheel centre is still on the road, so
  // the tyre's inner edge meets the island before the entire contact patch rolls onto it.
  const mh = route.medHalf?.(sc) || 0, mhH = 0.2 * smoothstep(0.25, 0.6, route.div?.(sc) || 0);
  if (au <= eA && mhH > 0.03 && Math.abs(au - mh) < TYRE_HALF) {
    out.input = mhH * smoothstep(-TYRE_HALF, TYRE_HALF, mh - au);
  }
  out.paved = au <= uo;
  return out;
}
