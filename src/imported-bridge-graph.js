import {buildTileContactIndex,sampleTileContact} from './world-tile-contact.js';
// Older imported packets name graph surfaces generically. Upgrade only a deck
// proved against the packet's authenticated OSM structure and physical contacts.
export function bindImportedBridgeEdges(pack,edges) {
  const m=pack.metadata;if(!m.extensions?.worldDetail?.penteli)return edges;
  const structures=(m.structures||[]).filter(s=>s.kind==='osm-bridge-guarded'&&s.layer===1);
  if(!structures.length)return edges;
  let index;
  for(const e of edges){
    if(e.layer!==1||e.surface!=='surface:roads'||!/^penteli:e:main:\d+:[fr]$/.test(e.id))continue;
    index??=pack.contactIndex||buildTileContactIndex(pack.tables);
    const surfaces=new Set(structures.flatMap(s=>s.bridgeSources.map(id=>'surface:'+id)));let surface;
    for(let i=1;i<e.points.length;i++){
      const a=e.points[i-1],b=e.points[i],x=(a[0]+b[0])/2,z=(a[2]+b[2])/2,y=(a[1]+b[1])/2;
      const c=sampleTileContact(pack.tables,index,x-m.origin[0],z-m.origin[2],{referenceY:y,layer:1,requiredFlags:1,includeBoundary:true}),id=c&&m.ids[c.surface];
      if(!c||Math.abs(c.y-y)>.025||!surfaces.has(id)||surface&&surface!==id){surface=null;break;}
      surface=id;
    }
    if(surface){e.flags|=2;e.surface=surface;}
  }
  return edges;
}
