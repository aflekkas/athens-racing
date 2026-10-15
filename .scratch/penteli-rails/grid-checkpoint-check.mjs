// Run from repository root. Exercise the actual production gridSlot function.
import fs from 'node:fs';import assert from 'node:assert/strict';import {Route} from '../../src/map.js';import {checkpointFrame} from '../../src/checkpoints.js';
const d=JSON.parse(fs.readFileSync('data/maps/penteli/map.json')),r=new Route(d.route),source=fs.readFileSync('src/main.js','utf8'),code=source.slice(source.indexOf('function gridSlot('),source.indexOf('function placeVeh('));
const rows=[];
for(const dir of [-1,1]){const G={ev:{r:{dir,s0:dir>0?r.start:r.finish}}},slot=Function('route','G','clamp',code+';return gridSlot;')(r,G,(x,a,b)=>Math.max(a,Math.min(b,x)));
 for(let i=0;i<16;i++){const q=slot(i);assert.ok(Math.abs(q.u)+1.1<r.edge(q.s));assert.ok(q.s>0&&q.s<r.length);assert.ok(Number.isFinite(q.yaw));rows.push({dir,i,...q,edge:r.edge(q.s)});}
 for(let s=r.start;s<=r.finish;s+=250){const frame=checkpointFrame(r,s,dir);assert.ok(Object.values(frame).filter(x=>typeof x==='number').every(Number.isFinite));}
}
fs.writeFileSync('.scratch/penteli-rails/grid-checkpoint-report.json',JSON.stringify(rows,null,2));console.log('PASS: 32 production grid slots (both race directions), whole 2.2 m wide car inside asphalt; checkpoint frames finite.');
