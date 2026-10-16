import fs from 'node:fs';
import {Vehicle} from '../src/physics.js';
import {CARS} from './vehicle-budget-support.mjs';
const route={GR:null,medHalf:()=>0,div:()=>0,frame(s,o){return Object.assign(o,{tx:0,tz:-1,rx:1,rz:0,grade:0,bank:0});},point(s,u){return{x:u,z:-s,y:0};},y:()=>0,surfaceY:()=>0,urban:()=>1,edge:()=>900,lin:()=>0,project(x,z){return{s:-z,u:x};}};
const rows=[];
for(const spec of CARS){const v=new Vehicle(spec,route);v.reset(0,0,0);const t=process.cpuUsage();for(let i=0;i<3600;i++)v.update(1/60,{throttle:i<2400?.75:0,brake:i>=3000?.6:0,steer:Math.sin(i/200)*.03});const cpu=process.cpuUsage(t);rows.push({id:spec.id,cpuMs:(cpu.user+cpu.system)/1000,x:v.x,z:v.z,speed:v.kmh,gear:v.gear});}
fs.writeFileSync(process.argv[2],JSON.stringify({steps:3600,dt:1/60,cpuMs:rows.reduce((n,r)=>n+r.cpuMs,0),rows},null,2));
