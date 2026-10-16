import fs from 'node:fs';
import {Before} from './baseline-loader.mjs';
import {Vehicle as After} from '../../src/physics.js';
import {catalogue} from '../../tools/physics-test/powertrain.mjs';
import {stabilityScenarios} from '../../tools/physics-test/heavy-stability.mjs';
const source=fs.readFileSync(new URL('./cars-before.js',import.meta.url),'utf8');
const beforeSpecs=Function('return '+source.split('export const CARS = ')[1].split('\n];')[0]+'\n];')();
for(const [label,cls,specs] of [['before',Before,beforeSpecs],['after',After,catalogue()]]){
 const rows=stabilityScenarios(specs.filter(s=>s.nativeFleet),cls,{cruise:false,traces:true});
 fs.writeFileSync(new URL('./'+label+'-controlled.json',import.meta.url),JSON.stringify(rows));
 console.log(label,rows.filter(r=>!r.ok).map(({trace,...r})=>r));
}
