import fs from 'node:fs';
import {CARS,CarModel,metrics} from './vehicle-budget-support.mjs';
const result=[];for(const spec of CARS){const car=new CarModel(spec);result.push(metrics(car));car.disposeDamage?.();}
fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));
