// OSM multipolygon relations (raw/relations.json) assembled from the frozen snapshot's member ways.
import * as THREE from 'three';
const key=p=>p.join(',');
// Join member ways end to end into closed rings; chains that cannot close (members outside the bbox) are dropped.
export function assembleRings(members,ways){
 const open=members.map(m=>ways.get(m.ref)?.nodes).filter(n=>n?.length>1).map(n=>[...n]),rings=[];
 while(open.length){const ring=open.shift();let grew=true;
  while(ring[0]!==ring.at(-1)&&grew){grew=false;for(let i=0;i<open.length;i++){const w=open[i];
   if(w[0]===ring.at(-1)){ring.push(...w.slice(1));}else if(w.at(-1)===ring.at(-1)){ring.push(...w.slice(0,-1).reverse());}else if(w.at(-1)===ring[0]){ring.unshift(...w.slice(0,-1));}else if(w[0]===ring[0]){ring.unshift(...w.slice(1).reverse());}else continue;
   open.splice(i,1);grew=true;break;}}
  if(ring[0]===ring.at(-1)&&ring.length>3)rings.push(ring);}
 return rings;
}
const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
const inside=(p,ring)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
/** [{id, tags, outer:[[x,z]...], holes:[[[x,z]...]]}] for every closed outer ring, its inner rings attached */
export function multipolygons(relations,elements,project){
 const nodes=new Map(elements.filter(e=>e.type==='node').map(e=>[e.id,e])),ways=new Map(elements.filter(e=>e.type==='way').map(e=>[e.id,e])),out=[];
 const pts=ring=>ring.slice(0,-1).map(id=>nodes.get(id)).every(Boolean)?ring.slice(0,-1).map(id=>project(nodes.get(id))):null;
 for(const rel of relations){
  const outers=assembleRings(rel.members.filter(m=>m.role!=='inner'),ways).map(pts).filter(Boolean),inners=assembleRings(rel.members.filter(m=>m.role==='inner'),ways).map(pts).filter(Boolean);
  for(const outer of outers)out.push({id:rel.id,tags:rel.tags,outer,holes:inners.filter(h=>inside(h[0],outer))});
 }
 return out;
}
// Owner-locked blocks stay <=40 triangles: a courtyard (or >10-vertex) footprint becomes several simple pieces of
// at most `max` vertices, merged from the hole-respecting triangulation. Shared inner walls are coincident.
export function footprintPieces(outer,holes=[],max=10){
 if(!holes.length&&outer.length<=max)return [outer];
 const ccw=p=>area(p)<0?[...p].reverse():p,o=ccw(outer),hs=holes.map(h=>ccw(h).reverse()),all=[...o,...hs.flat()];
 const faces=THREE.ShapeUtils.triangulateShape(o.map(p=>new THREE.Vector2(...p)),hs.map(h=>h.map(p=>new THREE.Vector2(...p)))).map(f=>{const t=f.map(i=>all[i]);return area(t)<0?t.reverse():t;});
 const used=new Array(faces.length).fill(false),pieces=[];
 for(let s=0;s<faces.length;s++){if(used[s])continue;used[s]=true;let poly=[...faces[s]],grew=true;
  while(grew&&poly.length<max){grew=false;
   for(let f=0;f<faces.length&&!grew;f++){if(used[f])continue;const t=faces[f];
    for(let e=0;e<3&&!grew;e++){const a=t[e],b=t[(e+1)%3],c=t[(e+2)%3],i=poly.findIndex((p,k)=>key(p)===key(b)&&key(poly[(k+1)%poly.length])===key(a));
     // Shared edge b->a on the piece: insert the far vertex unless it already lies on the piece (a pinch).
     if(i<0||poly.some(p=>key(p)===key(c)))continue;poly.splice(i+1,0,c);used[f]=true;grew=true;}}}
  pieces.push(poly);}
 return pieces;
}
