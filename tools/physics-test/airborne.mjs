import { Vehicle } from '../../src/physics.js';
import { catalogue } from './powertrain.mjs';
import { runAirborneScenario } from './airborne-scenarios.mjs';
export const airborneScenario = name => runAirborneScenario(Vehicle,catalogue(),name);
if(process.argv[1]?.endsWith('/airborne.mjs'))for(const name of ['crest','barrier','bus','sports']){const {trace,...r}=airborneScenario(name);console.log(JSON.stringify(r));}
