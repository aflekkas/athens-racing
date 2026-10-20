// Reviewed corrections to the frozen OSM snapshot, applied in memory by every Psychiko builder and test.
// raw/osm.json.gz itself stays the untouched source response.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
// Plateia Eleftherias (park 491349809) is a circulating circle: rim 25053562 is oneway=yes and CCW, but it
// lacks junction=roundabout and closes through the oneway=no ends of 42110999 and 717372563. Split only those
// closing rim subsegments into the ring; the Nikiforou Lytra and Diamantidou approaches beyond it stay two-way.
// Street View survey (2026-10-19): CCW circulation on the main arc, three arms.
export const ELEFTHERIAS={park:491349809,rim:25053562,closing:[{way:42110999,ccw:[272561334,272498881]},{way:717372563,ccw:[272498881,6193531325]}]};
// Split-off rim pieces get ids that cannot collide with real OSM ways.
export const splitId=id=>1e10+id;
export function correctPsychikoOsm(elements){
 const out=[],ring={junction:'roundabout',oneway:'yes'};
 for(const e of elements){
  if(e.type!=='way'){out.push(e);continue;}
  if(e.id===ELEFTHERIAS.rim){out.push({...e,tags:{...e.tags,...ring}});continue;}
  const closing=ELEFTHERIAS.closing.find(c=>c.way===e.id);
  if(!closing){out.push(e);continue;}
  // Rim pieces are stored in counter-clockwise order so oneway=yes matches circulation.
  const [a,b]=closing.ccw,i=Math.min(e.nodes.indexOf(a),e.nodes.indexOf(b));
  if(i<0||Math.abs(e.nodes.indexOf(a)-e.nodes.indexOf(b))!==1)throw Error(`Eleftherias rim ${closing.ccw} no longer on way ${e.id}`);
  const tags={...e.tags,...ring};
  if(e.nodes.length===2){out.push({...e,nodes:[a,b],tags});continue;}
  // The rim is the way's first segment; the rest is the genuine two-way approach.
  if(i!==0)throw Error(`Eleftherias rim is not at the start of way ${e.id}`);
  out.push({...e,id:splitId(e.id),nodes:[a,b],tags,splitFrom:e.id},{...e,nodes:e.nodes.slice(1)});
 }
 return out;
}
export function loadPsychikoOsm(path=new URL('./raw/osm.json.gz',import.meta.url)){return correctPsychikoOsm(JSON.parse(gunzipSync(fs.readFileSync(path))).elements);}
// A reviewed course edge names the original way; after a split it lives on whichever piece holds both nodes.
export function wayForEdge(ways,id,a,b){const has=w=>w&&w.nodes.some((n,k)=>n===a&&(w.nodes[k-1]===b||w.nodes[k+1]===b));const w=ways.get(id);return has(w)?id:has(ways.get(splitId(id)))?splitId(id):id;}
