// node --import ./tools/damage-test-register.mjs tools/airborne-logs.mjs [before|after]
import { mkdir,writeFile } from 'node:fs/promises';
import { Vehicle } from '../src/physics.js';
import { Ground } from '../src/ground.js';
import { catalogue } from './physics-test/powertrain.mjs';
import { runAirborneScenario } from './physics-test/airborne-scenarios.mjs';
const label=process.argv[2]||'after',out=process.env.AIRBORNE_OUT||'.scratch/airborne';await mkdir(out,{recursive:true});
const scenarios=[];
for(const name of ['crest','barrier','bus','sports']){const r=runAirborneScenario(Vehicle,catalogue(),name,Ground);scenarios.push(r);const {trace,contacts,...summary}=r;console.log(JSON.stringify(summary));}
await writeFile(`${out}/${label}.json`,JSON.stringify(scenarios,null,2));
