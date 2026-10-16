import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {CARS,CarModel,Cockpit} from './vehicle-budget-support.mjs';
import {STRUCTURE_ROLES} from './cockpit-structure-mask.js';
import {readMaskPNG} from './pov-mask-evidence.mjs';
import {OWNER_VEHICLE_DECISION as WHY} from '../src/vehicle-budgets.js';
import {badgeBrand,BRAND_BADGES} from '../src/brand-badges.js';
const out='.scratch/pov-camera';
if(!globalThis.Image)globalThis.Image=class {complete=true;naturalWidth=24;set src(value){}};
function requireStructure(spec,roles){
 const required=spec.twoWheeler?['tank','handlebars','dash']:['dash','deck','pillar','header','door-top','wheel-rim','wheel-hub','wheel-badge','wiper'];
 for(const role of required)assert.ok(roles[role]?.pixels>=40,`${spec.id}: no visible ${role}. ${WHY}`);
 if(!spec.twoWheeler)assert.ok(roles.dash.maxX-roles.dash.minX>=832,`${spec.id}: dashboard does not span the view. ${WHY}`);
}
test('every rendered cockpit has visible own-car structure, including a rim, hub and badge (bikes: tank and bars)',async()=>{
 const rows=JSON.parse(await fs.readFile(out+'/mask-audit.json'));
 assert.deepEqual(rows.map(r=>r.id).sort(),CARS.map(c=>c.id).sort(),WHY);
 for(const row of rows){const png=readMaskPNG(await fs.readFile(out+'/structure-'+row.id+'-mask.png'));
  const roles=Object.fromEntries(STRUCTURE_ROLES.map(r=>[r,{pixels:0,minX:png.width,maxX:-1,minY:png.height,maxY:-1}]));
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const i=(y*png.width+x)*3;if(png.rgb[i+1]||png.rgb[i+2])continue;const role=STRUCTURE_ROLES[png.rgb[i]-1];if(!role)continue;const v=roles[role];v.pixels++;v.minX=Math.min(v.minX,x);v.maxX=Math.max(v.maxX,x);v.minY=Math.min(v.minY,y);v.maxY=Math.max(v.maxY,y);}
  assert.deepEqual(roles,row.structure,row.id+' structure PNG recount differs. '+WHY);requireStructure(CARS.find(c=>c.id===row.id),roles);
 }
});
test('ghost shells, missing bonnets, hidden steering wheels and missing badges are rejected',()=>{
 const spec=CARS.find(c=>!c.twoWheeler),good=Object.fromEntries(STRUCTURE_ROLES.map(r=>[r,{pixels:100,minX:0,maxX:1279}]));
 requireStructure(spec,good);
 for(const role of ['dash','deck','pillar','header','door-top','wheel-rim','wheel-hub','wheel-badge'])assert.throws(()=>requireStructure(spec,{...good,[role]:{pixels:0}}),/Owner-locked decision/,WHY);
});
test('all 70 cockpit controls visibly rotate with steering, retain badge atlas and switch with POV',()=>{
 for(const spec of CARS){const model=new CarModel(spec),cockpit=new Cockpit(spec,model);cockpit.setVisible(true);const wheel=cockpit.povSteering;assert.ok(wheel?.visible,spec.id+' missing steering. '+WHY);
  const state={ignition:true,rpm:3500,kmh:85,gearLabel:'3',steerInput:0,vehicle:{}};cockpit.update(0,state);const start=wheel.quaternion.clone();cockpit.update(.1,{...state,steerInput:.7});assert.ok(start.angleTo(wheel.quaternion)>.1,spec.id+' steering does not rotate. '+WHY);
  assert.ok(Math.abs((spec.twoWheeler?wheel.rotation.y:wheel.rotation.z)+.7*(spec.twoWheeler?.45:2.35))<1e-8,WHY);
  if(spec.convertible)assert.equal(cockpit.structure.getObjectByName('cockpit-window-frame'),undefined,spec.id+' open top must not acquire roof rails. '+WHY);
  if(!spec.twoWheeler){let min=Infinity,max=-Infinity;cockpit.structure.traverse(o=>{if(o.userData.cockpitStructure==='dash'){o.geometry.computeBoundingBox();min=Math.min(min,o.geometry.boundingBox.min.x+o.position.x);max=Math.max(max,o.geometry.boundingBox.max.x+o.position.x);}});assert.ok(max-min>=model.dash.w*.99,spec.id+' dash must span between both pillars. '+WHY);const badge=wheel.getObjectByName('cockpit-wheel-badge');assert.equal(badge.material.userData.brandBadge,true,WHY);assert.equal(badge.material.map.name,'shared-brand-badges',WHY);assert.ok(BRAND_BADGES[badgeBrand(spec)],spec.id+' missing manufacturer badge. '+WHY);assert.ok(model.cockpitWindscreen&&!model.cockpitWindscreen.parent,WHY);}
  cockpit.setVisible(false);assert.equal((cockpit.lod||cockpit.group).visible,false,WHY);cockpit.setVisible(true);assert.equal((cockpit.lod||cockpit.group).visible,true,WHY);cockpit.disposeMirrors();model.disposeDamage?.();
 }
});
test('rain is one shared alpha-texture overlay and blades remain on the framed windscreen',async()=>{
 const {cockpitDropMaterial}=await import('../src/cockpit-rain.js');const a=cockpitDropMaterial({value:0}),b=cockpitDropMaterial({value:0});assert.equal(a.uniforms.uDrops.value,b.uniforms.uDrops.value,WHY);assert.equal(a.uniforms.uDrops.value.image.width,128,WHY);assert.equal(a.transparent,true,WHY);assert.equal(a.depthWrite,false,WHY);assert.match(a.fragmentShader,/texture2D\(uDrops/,WHY);assert.match(a.fragmentShader,/since\(/,WHY);assert.doesNotMatch(a.fragmentShader,/gl_FragCoord|refract|blur/,WHY);
 for(const id of ['carrera','bus','mini']){const model=new CarModel(CARS.find(c=>c.id===id)),cockpit=new Cockpit(model.spec,model);const blades=[];cockpit.structure.traverse(o=>{if(o.name==='cockpit-wiper-blade')blades.push(o);});assert.equal(blades.length,2,WHY);const q=blades[0].quaternion.clone();model.updateCockpitWipers(.4,true);assert.ok(q.angleTo(blades[0].quaternion)>.1,WHY);cockpit.disposeMirrors();}
 a.dispose();b.dispose();
});
