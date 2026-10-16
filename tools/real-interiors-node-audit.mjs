import fs from 'node:fs/promises';
import * as T from 'three';
import {CARS,CarModel,Cockpit,triangles} from './vehicle-budget-support.mjs';
import {auditPov} from './pov-audit.js';
globalThis.Image=class{complete=true;naturalWidth=24;set src(v){}};
const rows=[];
for(const spec of CARS){const model=new CarModel(spec),cockpit=new Cockpit(spec,model);cockpit.setVisible(true);cockpit.update(0,{ignition:true,kmh:85,rpm:3500,redline:spec.redline,gearLabel:'3',steerInput:0,vehicle:{}});const camera=new T.PerspectiveCamera(66,1.6,.035,100);camera.position.copy(cockpit.eye);camera.rotation.x=cockpit.eyePitch;camera.updateMatrixWorld();const audit=auditPov(model,cockpit,camera);const row={id:spec.id,interior:triangles(cockpit.group),...audit};rows.push(row);if(row.flags.length)console.log(spec.id,row.nearRoadDistance,row.clusterOcclusion,row.telltalesBlocked,row.flags.join(','));cockpit.disposeMirrors();model.disposeDamage?.();}
await fs.mkdir('.scratch/real-interiors',{recursive:true});await fs.writeFile('.scratch/real-interiors/node-audit.json',JSON.stringify(rows,null,2));console.log('audited',rows.length,'max interior',Math.max(...rows.map(r=>r.interior)));
