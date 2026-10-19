#!/usr/bin/env node
// One-off reduction of the 2026-10-19 municipal Street View survey into the frozen input raw/street-classes.json.
// Reads only the survey's own JSON (street-classes.json, stations.json); no imagery is read or copied.
// usage: node tools/maps/psychiko/street-survey.mjs [survey-dir]   (default .scratch/psychiko-realism/streetview)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const survey=path.resolve(root,process.argv[2]||'.scratch/psychiko-realism/streetview');
const read=n=>JSON.parse(fs.readFileSync(path.join(survey,n)));
const classes=read('street-classes.json'),stations=read('stations.json').stations.filter(s=>s.review?.acceptedOnStreetEvidence&&s.streetClass);
const paint={'double solid':'double',dashed:'dashed',none:'none'};
const out={source:'Palaio Psychiko municipal Street View survey, 2026-10-19 (1,034 accepted stations); visual size bands, not kerb measurements',
 attribution:'Street-level reference © Google, used for visual classification only; no imagery is stored or shipped. Way IDs © OpenStreetMap contributors (ODbL).',
 classes:{},ways:{},parking:{},observed:[]};
const r6=v=>+v.toFixed(6);
for(const c of classes){if(c.id==='X')continue;out.classes[c.id]={label:c.label,w:c.widthTargetM,range:c.widthRangeM,paint:paint[c.centrePaint]??'none',footway:c.footwayTargetM};}
const byWay=new Map();for(const c of classes)if(c.id!=='X')for(const id of c.osmWayIds){if(!byWay.has(id))byWay.set(id,new Set());byWay.get(id).add(c.id);}
for(const id of [...byWay.keys()].sort((a,b)=>a-b)){const set=byWay.get(id);
 if(set.size===1){out.ways[id]=[...set][0];continue;}
 // Mixed ways: keep each accepted station's class at its camera position; the nearest station decides.
 const samples=stations.filter(s=>s.osmWayIds.includes(id)&&set.has(s.streetClass)).map(s=>[s.streetClass,r6(s.lat),r6(s.lon)]);
 out.ways[id]=samples.length?samples:[...set].sort()[0];
}
for(const s of stations)for(const id of s.osmWayIds){const p=s.observedAttributes?.parking?.observed;if(!p)continue;const row=out.parking[id]||=[0,0,0];row[p==='both'?0:p==='one side'?1:2]++;}
out.parking=Object.fromEntries(Object.entries(out.parking).sort((a,b)=>a[0]-b[0]));
for(const s of stations){const o=s.observedAttributes||{},b=o.boundary||{},v=o.vegetation||{};
 const row={id:s.id,lat:r6(s.lat),lon:r6(s.lon),heading:s.heading,cls:s.streetClass,left:b.left?.types||null,right:b.right?.types||null,
  veg:Object.fromEntries(['pine','cypress','broadleaf','palm'].filter(k=>v[k]!=null).map(k=>[k,v[k]])),density:v.density0to3??null,lights:o.streetLights?.types||null,wires:o.overheadWires??null};
 if(row.left||row.right||Object.keys(row.veg).length||row.lights||row.wires!=null)out.observed.push(row);}
fs.writeFileSync(path.join(dir,'raw/street-classes.json'),JSON.stringify(out,null,1)+'\n');
console.log(JSON.stringify({classes:Object.keys(out.classes).length,ways:Object.keys(out.ways).length,mixed:Object.values(out.ways).filter(Array.isArray).length,parking:Object.keys(out.parking).length,observed:out.observed.length}));
