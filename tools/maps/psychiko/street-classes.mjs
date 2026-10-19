// Per-OSM-way street classes from the frozen survey reduction raw/street-classes.json (see street-survey.mjs).
// Mixed ways take the class of the nearest accepted survey station; X/unsurveyed ways return null.
import fs from 'node:fs';
const survey=JSON.parse(fs.readFileSync(new URL('./raw/street-classes.json',import.meta.url)));
export const PSYCHIKO_SURVEY=survey;
const cache=new WeakMap();
function samples(proj){let s=cache.get(proj);if(!s){s=new Map();for(const [id,v] of Object.entries(survey.ways))if(Array.isArray(v))s.set(+id,v.map(([k,lat,lon])=>({k,x:(lon-proj.lon0)*proj.mlon,z:-(lat-proj.lat0)*proj.mlat})));cache.set(proj,s);}return s;}
// Eleftherias circular square (park 491349809): its rim and closing portions are ring work, kept on the C7 treatment.
const ELEFTHERIAS={lat:38.0180861,lon:23.77022,r:60};
export function psychikoWayClass(id,x,z,proj){
 const v=survey.ways[id];if(!v)return null;
 if(Math.hypot(x-(ELEFTHERIAS.lon-proj.lon0)*proj.mlon,z+(ELEFTHERIAS.lat-proj.lat0)*proj.mlat)<ELEFTHERIAS.r)return 'C7';
 if(!Array.isArray(v))return v;
 let best=null,d=Infinity;for(const q of samples(proj).get(+id)){const e=(q.x-x)**2+(q.z-z)**2;if(e<d){d=e;best=q.k;}}return best;
}
/** Observed kerb parking share for a way: [both, one side, none] station counts, or null. */
export const psychikoWayParking=id=>survey.parking[id]||null;
