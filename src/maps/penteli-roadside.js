// Reference inventory: tools/penteli-landmarks.md. Extents are reconstructed
// from Street View station04, not an automatic DEM/drop-to-barrier rule.
export const PENTELI_GUARDRAILS = Object.freeze([
  { from: 4400, to: 4760, side: -1, source: 'street-04', offset: 2.6 },
]);
export function penteliGuardrail(s, side) {
  return PENTELI_GUARDRAILS.find(run => run.side === side && s >= run.from && s <= run.to);
}

// Usable OSM junction arms. A road must actually leave the racing ribbon;
// little parallel residuals from geometric extraction are not junctions.
export function penteliJunctions(map) {
  const r = map.route, found = [];
  for (const road of map.data.roadNetwork?.roads || []) {
    const p = road.p; let length = 0, best = null;
    for (let i = 0; i < p.length; i += 2) {
      if (i) length += Math.hypot(p[i] - p[i-2], p[i+1] - p[i-1]);
      const q = map.roadNetwork?.project(p[i],p[i+1]) || r.project(p[i],p[i+1]);
      if (q.s < 0 || q.s > r.length) continue;
      if (!best || Math.abs(q.u) < Math.abs(best.u)) best = { ...q, x:p[i], z:p[i+1], index:i };
    }
    if (!best || Math.abs(best.u) > r.edge(best.s) + 7 || length < 25) continue;
    const far = [0,p.length-2].map(i => ({i, q:map.roadNetwork?.project(p[i],p[i+1]) || r.project(p[i],p[i+1])})).sort((a,b)=>Math.abs(b.q.u)-Math.abs(a.q.u))[0];
    if (Math.abs(far.q.u) < r.edge(far.q.s) + 12) continue;
    const side = Math.sign(far.q.u) || 1;
    if (found.some(j => Math.abs(j.s-best.s)<22 && j.side===side)) continue;
    found.push({ s:best.s, side, roadId:road.id, length, surface:road.sf, name:road.n || '', road });
  }
  return found.sort((a,b)=>a.s-b.s);
}
