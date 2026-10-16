import fs from 'node:fs';
import {TRAFFIC_TYPES,trafficModel,triangles} from './vehicle-budget-support.mjs';
import {RNG} from '../src/util.js';
const rows=[];for(const type of TRAFFIC_TYPES){for(const low of [false,true]){const car=trafficModel(type,'#718293',new RNG(7),{low});rows.push({id:type.id,low,triangles:triangles(car.root),wheels:car.wheels.map(w=>triangles(w.spin))});car.disposeDamage?.();}}
fs.writeFileSync(process.argv[2]||'/tmp/lowpoly-traffic.json',JSON.stringify(rows,null,2));
