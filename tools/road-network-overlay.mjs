// A north-up orthographic camera and its OSM overlay share this single metre-to-pixel transform.
export function overlayView(cx,cz,worldWidth=580,pixelWidth=1280,pixelHeight=800){const worldHeight=worldWidth*pixelHeight/pixelWidth;return {cx,cz,worldWidth,worldHeight,pixelWidth,pixelHeight,minX:cx-worldWidth/2,maxX:cx+worldWidth/2,minZ:cz-worldHeight/2,maxZ:cz+worldHeight/2};}
export function overlayPixel(view,x,z){return[(x-view.minX)/view.worldWidth*view.pixelWidth,(z-view.minZ)/view.worldHeight*view.pixelHeight];}
export function osmHighways(data,elements){const nodes=new Map(elements.filter(e=>e.type==='node').map(e=>[e.id,e]));return elements.filter(e=>e.tags?.highway).map(e=>({id:e.id,tags:e.tags,p:(e.geometry||e.nodes?.map(id=>nodes.get(id))||[]).filter(Boolean).map(n=>[(n.lon-data.proj.lon0)*data.proj.mlon,-(n.lat-data.proj.lat0)*data.proj.mlat])})).filter(e=>e.p.length>1);}
export function highwayOverlayClass(way,networkIds){if(networkIds.has(way.id))return'network';if(['track','path','footway','steps','pedestrian','cycleway'].includes(way.tags.highway))return'path';if(way.tags.bridge==='yes'||way.tags.tunnel==='yes'||Number(way.tags.layer))return'structure';return'other';}
export function drawHighwayOverlay(ctx,view,ways,networkIds,route){ctx.save();ctx.globalAlpha=.65;for(const way of ways){const kind=highwayOverlayClass(way,networkIds);ctx.strokeStyle={network:'#00e5fa',path:'#ffc870',structure:'#e497ff',other:'#dedde0'}[kind];ctx.lineWidth=kind==='network'?2:1.25;ctx.setLineDash(kind==='path'?[5,4]:kind==='structure'?[2,4]:[]);ctx.beginPath();for(let i=0;i<way.p.length;i++){const p=overlayPixel(view,...way.p[i]);i?ctx.lineTo(...p):ctx.moveTo(...p);}ctx.stroke();}ctx.strokeStyle='#ff665e';ctx.lineWidth=2;ctx.setLineDash([]);ctx.beginPath();for(let i=0;i<route.x.length;i++){const p=overlayPixel(view,route.x[i],route.z[i]);i?ctx.lineTo(...p):ctx.moveTo(...p);}ctx.stroke();ctx.restore();}

// Footprint provenance is separate from architectural style: OSM shapes and generated infill use the same renderer.
export function drawBuildingOverlay(ctx,view,mapped,infill,box){
 const inside=(x,z,b)=>x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ;
 const counts={mapped:0,infill:0};ctx.save();ctx.globalAlpha=.9;ctx.setLineDash([]);ctx.lineWidth=2;
 for(const [kind,buildings,color]of [['mapped',mapped,'#92ffac'],['infill',infill,'#ff75cf']]){
  ctx.strokeStyle=color;
  for(const b of buildings){let x=0,z=0,n=b.p.length/2;for(let i=0;i<b.p.length;i+=2){x+=b.p[i];z+=b.p[i+1];}x/=n;z/=n;if(box&&inside(x,z,box))counts[kind]++;if(!inside(x,z,view))continue;
   ctx.beginPath();for(let i=0;i<b.p.length;i+=2){const p=overlayPixel(view,b.p[i],b.p[i+1]);i?ctx.lineTo(...p):ctx.moveTo(...p);}ctx.closePath();ctx.stroke();
  }
 }
 if(box){const a=overlayPixel(view,box.minX,box.minZ),b=overlayPixel(view,box.maxX,box.maxZ);ctx.strokeStyle='#ff75cf';ctx.lineWidth=3;ctx.setLineDash([10,6]);ctx.strokeRect(a[0],a[1],b[0]-a[0],b[1]-a[1]);}
 ctx.restore();return counts;
}
