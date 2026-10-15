// Coastal protection follows terrain hazards, not proximity to the sea.
// Keep the avenue's pavements, existing concrete barrier and beach approaches open.
export const RAIL_STEP = 2;
// OSM footways checked 2026-10-15. Stations are projected onto the shipped route;
// these are openings, not surveyed barrier extents (see tools/riviera-rails.md).
export const RIVIERA_ACCESS = [
  {s:2543,side:-1,way:1089856040}, {s:2594,side:1,way:1167947365},
  {s:7523,side:0,way:656855257}, {s:8783,side:1,way:1460036603},
  {s:9079,side:-1,way:121801034}, {s:9974,side:-1,way:121801199},
  {s:10214,side:-1,way:121801199}, {s:10293,side:-1,way:1460210417},
  {s:10597,side:0,way:924514927},
];
export function railDropHazard(drops, curvature = 0) {
  return drops[0] > 2.2 || drops[1] > 4.5 || drops[2] > 7 || (Math.abs(curvature) > .012 && drops[1] > 3.5);
}
export function planRivieraRails(map, heightC, network, road) {
  const {route:r,data}=map, samples=[],runs=[];
  const parks=(data.parkSpots||[]).map(p=>r.project(p.x,p.z));
  const lim=data.marks?.find(m=>m.id==='limanakia')?.s;
  const beachAccess=lim===undefined?[]:[lim-160,lim+25,lim+210];
  for(const side of [-1,1]) {
    const rows=[];
    for(let s=0;s<=r.length;s+=RAIL_STEP) {
      const e=r.edge(s),u=e+road.gutter+.18+road.sidewalk(r,s,side)-.04;
      const p=r.point(s,side*u);
      // The outer pavement is horizontal, not the extrapolated banked road plane.
      p.y=r.surfaceY(s,side*(e+road.gutter))+road.curbH(r,s)+.02;
      const blocked=r.urban(s)>=.5 || [-2,0,2].some(ds=>network?.mouth(s+ds,side,8))
        || !!r.localLayout?.contains(s)
        || (data.barriers||[]).some(b=>b.side===side&&s>=b.s0-8&&s<=b.s1+8)
        || RIVIERA_ACCESS.some(a=>(!a.side||a.side===side)&&Math.abs(a.s-s)<12)
        || parks.some(q=>Math.sign(q.u)===side&&Math.abs(q.s-s)<12&&Math.abs(q.u)<e+22)
        || (side===(r.seaR(s)<=r.seaL(s)?1:-1)&&beachAccess.some(a=>Math.abs(a-s)<65));
      const drops=[6,16,24].map(d=>{const q=r.point(s,side*(u+d));return p.y-heightC(q.x,q.z);});
      const a=r.frame(Math.max(0,s-4),{}),b=r.frame(Math.min(r.length,s+4),{});
      const curve=Math.atan2(a.tx*b.tz-a.tz*b.tx,a.tx*b.tx+a.tz*b.tz)/8;
      rows.push({s,u,p,drops,blocked,want:!blocked&&railDropHazard(drops,curve)});
    }
    // Close tiny terrain sampling holes without bridging any access exclusion.
    for(let i=0;i<rows.length;i++)if(!rows[i].blocked&&!rows[i].want){let j=i;while(j<rows.length&&!rows[j].want&&!rows[j].blocked)j++;
      if(i>0&&j<rows.length&&rows[i-1].want&&rows[j].want&&j-i<=4)for(let k=i;k<j;k++)rows[k].want=true;i=Math.max(i,j-1);}
    let run=[];
    const flush=()=>{if(run.length>=7)runs.push({side,pts:run});run=[];};
    for(const q of rows){if(q.want)run.push(q);else flush();}flush();
    samples.push(...rows.map(q=>({s:q.s,side,u:q.u,drops:q.drops,blocked:q.blocked,want:q.want})));
  }
  return {runs,samples};
}
