// Reproducible OSM width/bridge attribution; no changes to the sampled race axis.
export function carriagewayWidth(tags = {}) {
  const explicit = String(tags.width || '').match(/^\s*(\d+(?:\.\d+)?)\s*(?:m)?\s*$/);
  if (explicit && +explicit[1] >= 3 && +explicit[1] <= 16) return +explicit[1];
  const defaults = { primary: 7.5, secondary: 7.2, tertiary: 6.8, unclassified: 6, residential: 5.5, service: 4.5 };
  const base = defaults[tags.highway] || 6.5, lanes = Number(tags.lanes);
  return lanes >= 1 && lanes <= 4 ? base / 2 * lanes : base;
}
export function applyPenteliWidths(data, elements) {
  const r = data.route, nodes = new Map(elements.filter(e => e.type === 'node').map(e => [e.id, e]));
  const ids = new Set(data.penteli.sourceWayIds), segments = [];
  const point = n => [(n.lon-data.proj.lon0)*data.proj.mlon, -(n.lat-data.proj.lat0)*data.proj.mlat];
  for (const way of elements.filter(e => e.type === 'way' && ids.has(e.id))) {
    const points = (way.geometry || way.nodes.map(id => nodes.get(id))).filter(Boolean).map(point);
    for(let i=1;i<points.length;i++) segments.push({a:points[i-1],b:points[i],way});
  }
  const sources = r.x.map((x,i) => {
    const z=r.z[i];let best=Infinity,way;
    for(const seg of segments){const [ax,az]=seg.a,dx=seg.b[0]-ax,dz=seg.b[1]-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1))),d=(x-ax-t*dx)**2+(z-az-t*dz)**2;if(d<best){best=d;way=seg.way;}}
    if(!way)throw Error('Missing Penteli source ways');return way;
  });
  const heading = i => {const a=Math.max(0,i-6),b=Math.min(r.x.length-1,i+6);return Math.atan2(r.z[b]-r.z[a],r.x[b]-r.x[a]);};
  const raw = sources.map((way,i)=>{
    const a=Math.max(0,i-8),b=Math.min(r.x.length-1,i+8),angle=heading(b)-heading(a),k=Math.abs(Math.atan2(Math.sin(angle),Math.cos(angle)))/((b-a)*r.step||1);
    // Up to 60 cm extra at tight bends; OSM explicit widths remain authoritative.
    return carriagewayWidth(way.tags)+(way.tags.width?0:.6*Math.max(0,Math.min(1,(k-.012)/.028)));
  });
  r.width = raw.map((w,i)=> sources[i].tags.width ? w : +((raw.slice(Math.max(0,i-8),i+9).reduce((a,b)=>a+b,0))/raw.slice(Math.max(0,i-8),i+9).length).toFixed(3));
  const bridges=[];for(let i=0;i<sources.length;i++)if(sources[i].tags.bridge==='yes'){
    let run=bridges.at(-1);if(!run||run.id!==sources[i].id||run.to<(i-1)*r.step){run={id:sources[i].id,from:i*r.step,to:i*r.step};bridges.push(run);}run.to=i*r.step;
  }
  data.penteli.bridges=bridges;
  data.penteli.widthSource={policy:'OSM width, then lanes × class default; secondary 7.2 m; up to 0.6 m hairpin allowance',ways:[...new Map(sources.map(w=>[w.id,{id:w.id,tags:w.tags}])).values()]};
  return data;
}
