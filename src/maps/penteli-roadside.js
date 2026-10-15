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

// Measured against the rendered terrain, beyond its six-metre re-entry apron.
// A coarse DEM cannot locate individual culverts: only OSM bridges are asserted.
export function penteliRailHazard({drop8, drop16, drop24, curvature, side, bridge=false, reference=false}) {
  if (bridge) return 'bridge';
  if (reference) return 'reference';
  const slope=(drop16-drop8)/8, outside=curvature*side<-.012;
  if (drop8>1.8 && slope>.22 || drop16>4 && slope>.28 || drop24>8 && slope>.32) return 'drop';
  if (outside && drop16>2.5 && slope>.15) return 'hairpin';
  return null;
}
export function buildPenteliRails(map, height) {
  const {route:r}=map, runs=[], fork=map.data.penteli?.fork??5744;
  for(const side of [-1,1]) {
    const samples=[];
    for(let s=12;s<r.length-12;s+=2) {
      const reference=penteliGuardrail(s,side), u=r.edge(s)+(reference?.offset??.9), p=r.point(s,side*u);
      p.y=height(p.x,p.z);
      const blocked=s<180||Math.abs(s-fork)<42||!!map.roadNetwork?.mouth(s,side,10)
        ||[0,4,8].some(d=>{const q=r.point(s,side*(u+d));return !!map.roadNetwork?.sample(q.x,q.z);});
      const bridge=map.data.penteli?.bridges?.some(b=>s>=b.from-6&&s<=b.to+6);
      const drop=d=>{const q=r.point(s,side*(r.edge(s)+d));return p.y-height(q.x,q.z);};
      const hazard=blocked?null:penteliRailHazard({drop8:drop(8),drop16:drop(16),drop24:drop(24),curvature:r.curv(s),side,bridge,reference:!!reference});
      samples.push({s,u,p,blocked,hazard,kind:bridge?'concrete':'steel'});
    }
    // Add 12 m approach protection, and avoid isolated two-metre on/off fragments.
    const wanted=samples.map((q,i)=>!q.blocked&&samples.slice(Math.max(0,i-6),i+7).some(a=>a.hazard));
    let run=null;
    for(let i=0;i<samples.length;i++) {
      const q=samples[i];
      if(!wanted[i]){run=null;continue;}
      if(!run||run.kind!==q.kind){run={side,kind:q.kind,pts:[]};runs.push(run);}
      run.pts.push(q);
    }
  }
  return runs.filter(r=>r.pts.length>=9||r.kind==='concrete').map(run=>{
    const first=run.pts[0].s,last=run.pts.at(-1).s;
    for(const q of run.pts) {
      q.terminal=run.kind==='steel'?Math.min(1,(q.s-first)/6,(last-q.s)/6):1;
      // Turn ends down into the verge and flare away from traffic.
      q.u+=(1-q.terminal)*.5;const p=map.route.point(q.s,run.side*q.u);p.y=height(p.x,p.z);q.p=p;
    }
    return run;
  });
}
