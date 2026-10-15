import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Before} from './baseline-loader.mjs';
import {Vehicle as After} from '../../src/physics.js';
import {flatRoute,catalogue} from '../../tools/physics-test/powertrain.mjs';
const src=fs.readFileSync(new URL('./cars-before.js',import.meta.url),'utf8');
const old=Function('return '+src.split('export const CARS = ')[1].split('\n];')[0]+'\n];')();
const result=[];
for(const sp of catalogue()){
 const previous=old.find(s=>s.id===sp.id);if(JSON.stringify(sp)!==JSON.stringify(previous))continue;
 const run=Cls=>{const v=new Cls(sp,flatRoute),h=createHash('sha256');v.reset(0,0,18);v.gear=2;
  for(let i=0;i<900;i++){if(i===90)v.bodyKick(-.4,.04,.1);v.wheelBump=[0,i>300&&i<320?.05:0,0,0];v.update(1/60,{throttle:i<500?.5:0,brake:i>700?.7:0,steer:.12*Math.sin(i/60)});
   // Hash every original own state field; exclude only the two newly introduced setup fields.
   h.update(JSON.stringify(Object.fromEntries(Object.entries(v).filter(([key])=>!['cBar','susStep'].includes(key)))));}
  return h.digest('hex');};
 const before=run(Before),after=run(After);result.push({id:sp.id,before,after,identical:before===after});
}
fs.writeFileSync(new URL('./unchanged-results.json',import.meta.url),JSON.stringify(result,null,2));console.log(result.length,'unchanged specs, mismatches:',result.filter(r=>!r.identical));if(result.some(r=>!r.identical))process.exitCode=1;
