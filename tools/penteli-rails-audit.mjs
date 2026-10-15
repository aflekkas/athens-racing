import fs from 'node:fs';import path from 'node:path';import {Group} from 'three';
import {loadMap} from '../src/map.js';import {RoadNetwork} from '../src/road-network-surface.js';import {buildTerrain} from '../src/terrain.js';import {buildPenteliRails} from '../src/maps/penteli-roadside.js';
const root=path.resolve(import.meta.dirname,'..');globalThis.fetch=async url=>new Response(fs.readFileSync(path.resolve(root,String(url))));globalThis.location={search:''};
const map=await loadMap(undefined,'./','penteli',{preload:false});map.roadNetwork=new RoadNetwork(map);
const t=buildTerrain(map.terrain,map.route,[],new Group(),{coastal:false,network:map.roadNetwork});
console.log(Object.keys(t));
const runs=buildPenteliRails(map,t.heightC),r=map.route;
const report={width:{min:Math.min(...r.W),max:Math.max(...r.W)},length:r.length,rails:runs.map(run=>({side:run.side,kind:run.kind,from:run.pts[0].s,to:run.pts.at(-1).s,hazards:[...new Set(run.pts.map(q=>q.hazard).filter(Boolean))],pts:run.pts.map(q=>[q.p.x,q.p.z,q.s,q.u])})),route:Array.from(r.X,(x,i)=>[x,r.Z[i]]),hairpins:Array.from(r.K,(k,i)=>({s:i*r.step,k})).filter(q=>Math.abs(q.k)>.025)};
fs.mkdirSync(path.join(root,'.scratch/penteli-rails'),{recursive:true});fs.writeFileSync(path.join(root,'.scratch/penteli-rails/placement.json'),JSON.stringify(report));console.log(JSON.stringify({runs:runs.length,metres:runs.reduce((n,r)=>n+r.pts.at(-1).s-r.pts[0].s,0),ranges:report.rails.map(({pts,...r})=>r),hairpins:report.hairpins.filter((q,i)=>i%50===0)},null,2));
