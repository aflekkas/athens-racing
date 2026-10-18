import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {CARS,CarModel,Cockpit} from './vehicle-budget-support.mjs';
import {STRUCTURE_ROLES} from './cockpit-structure-mask.js';
import {readMaskPNG,readPovEvidence} from './pov-mask-evidence.mjs';
import {OWNER_VEHICLE_DECISION as WHY} from '../src/vehicle-budgets.js';
import {badgeBrand,BRAND_BADGES} from '../src/brand-badges.js';
if(!globalThis.Image)globalThis.Image=class {complete=true;naturalWidth=24;set src(value){}};
function requireStructure(spec,roles){
 const required=['dash',...(['bus','truck'].includes(spec.nativeFleet)||['cla','huracan','jazz'].includes(spec.body)?[]:['deck']), 'pillar','door-top','wheel-rim','wheel-hub','wheel-badge'];
 for(const role of required)assert.ok(roles[role]?.pixels>=40,`${spec.id}: no visible ${role}. ${WHY}`);
 {assert.ok(roles.dash.pixels>=15000,`${spec.id}: dashboard must have substantial visible depth. ${WHY}`);assert.ok(roles.pillar.pixels>=5000,`${spec.id}: pillar trim must be substantial. ${WHY}`);assert.ok(roles.dash.maxX-roles.dash.minX>=832,`${spec.id}: dashboard does not span the view. ${WHY}`);}
}
test('every rendered cockpit has visible own-car structure, including a rim, hub and badge',async()=>{
 const rows=JSON.parse(await readPovEvidence('mask-audit.json'));
 assert.deepEqual(rows.map(r=>r.id).sort(),CARS.map(c=>c.id).sort(),WHY);
 for(const row of rows){const png=readMaskPNG(await readPovEvidence('structure-'+row.id+'-mask.png'));
  const roles=Object.fromEntries(STRUCTURE_ROLES.map(r=>[r,{pixels:0,minX:png.width,maxX:-1,minY:png.height,maxY:-1}]));
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const i=(y*png.width+x)*3;if(png.rgb[i+1]||png.rgb[i+2])continue;const role=STRUCTURE_ROLES[png.rgb[i]-1];if(!role)continue;const v=roles[role];v.pixels++;v.minX=Math.min(v.minX,x);v.maxX=Math.max(v.maxX,x);v.minY=Math.min(v.minY,y);v.maxY=Math.max(v.maxY,y);}
  assert.deepEqual(roles,row.structure,row.id+' structure PNG recount differs. '+WHY);requireStructure(CARS.find(c=>c.id===row.id),roles);
 }
});
test('ghost shells, missing bonnets, hidden steering wheels and missing badges are rejected',()=>{
 const spec=CARS[0],good=Object.fromEntries(STRUCTURE_ROLES.map(r=>[r,{pixels:20000,minX:0,maxX:1279}]));
 requireStructure(spec,good);
 for(const role of ['dash','deck','pillar','door-top','wheel-rim','wheel-hub','wheel-badge'])assert.throws(()=>requireStructure(spec,{...good,[role]:{pixels:0}}),/Owner-locked decision/,WHY);
});
test('all catalogue cockpit controls visibly rotate with steering, retain badge atlas and switch with POV',()=>{
 for(const spec of CARS){const model=new CarModel(spec),cockpit=new Cockpit(spec,model);cockpit.setVisible(true);const wheel=cockpit.wheelSpin||cockpit.povSteering||cockpit.steering;assert.ok(wheel?.visible,spec.id+' missing steering. '+WHY);
  const state={ignition:true,rpm:3500,kmh:85,gearLabel:'3',steerInput:0,vehicle:{}};cockpit.update(0,state);const start=wheel.quaternion.clone();cockpit.update(.1,{...state,steerInput:.7});assert.ok(start.angleTo(wheel.quaternion)>.1,spec.id+' steering does not rotate. '+WHY);
  assert.ok(Math.abs(wheel.rotation.z+.7*2.35)<1e-8,WHY);
  if(spec.convertible)assert.equal(cockpit.structure.getObjectByName('cockpit-window-frame'),undefined,spec.id+' open top must not acquire roof rails. '+WHY);
  {let badge;cockpit.group.traverse(o=>{if(o.userData.cockpitStructure==='wheel-badge')badge=o;});assert.ok(badge,spec.id+' missing badge. '+WHY);assert.equal(badge.material.userData.brandBadge,true,WHY);assert.equal(badge.material.map.name,'shared-brand-badges',WHY);assert.ok(BRAND_BADGES[badgeBrand(spec)],spec.id+' missing manufacturer badge. '+WHY);assert.ok(model.cockpitWindscreen&&!model.cockpitWindscreen.parent,WHY);
   const pillars=[];cockpit.group.traverse(o=>{if(o.userData.cockpitStructure==='pillar')pillars.push(o);});assert.equal(pillars.length,2,WHY);assert.ok(pillars.every(o=>o.geometry.parameters.width>=.05),spec.id+' pillar trim must have real thickness. '+WHY);
   if(spec.nativeFleet!=='bus')assert.ok(cockpit.structure.getObjectByName('cockpit-deck'),spec.id+' front deck geometry missing. '+WHY);
   assert.ok(cockpit.structure.getObjectByName('cockpit-header'),spec.id+' missing windscreen header. '+WHY);
  }
  cockpit.setVisible(false);assert.equal((cockpit.lod||cockpit.group).visible,true,'Empty authored cabin remains visible outside. '+WHY);cockpit.setVisible(true);
  assert.equal(cockpit.group.parent,model.body,'POV furniture must be attached to the body. '+WHY);
  assert.equal(cockpit.group.visible,true,'The authored POV furniture must be visible. '+WHY);
  for(let part=wheel;part;part=part.parent)assert.equal(part.visible,true,'The steering wheel must be visible through its entire ancestry. '+WHY);
  assert.equal(cockpit.lod.visible,false,'The separate exterior snapshot must not overlap the POV cabin. '+WHY);
  cockpit.disposeMirrors();model.disposeDamage?.();
 }
});
test('rain is one shared alpha-texture overlay and blades remain on the framed windscreen',async()=>{
 const {cockpitDropMaterial}=await import('../src/cockpit-rain.js');const a=cockpitDropMaterial({value:0}),b=cockpitDropMaterial({value:0});assert.equal(a.uniforms.uDrops.value,b.uniforms.uDrops.value,WHY);assert.equal(a.uniforms.uDrops.value.image.width,128,WHY);assert.equal(a.transparent,true,WHY);assert.equal(a.depthWrite,false,WHY);assert.match(a.fragmentShader,/texture2D\(uDrops/,WHY);assert.match(a.fragmentShader,/since\(/,WHY);assert.doesNotMatch(a.fragmentShader,/gl_FragCoord|refract|blur/,WHY);
 for(const id of ['carrera','bus','mini']){const model=new CarModel(CARS.find(c=>c.id===id)),cockpit=new Cockpit(model.spec,model);const blades=[];cockpit.structure.traverse(o=>{if(o.name==='cockpit-wiper-blade')blades.push(o);});assert.equal(blades.length,2,WHY);const q=blades[0].quaternion.clone();model.updateCockpitWipers(.4,true);assert.ok(q.angleTo(blades[0].quaternion)>.1,WHY);cockpit.disposeMirrors();}
 a.dispose();b.dispose();
});

test('authored cockpit families retain different furniture and cluster artwork, never the uniform POV strip',async()=>{
 const source=await fs.readFile('src/cockpit.js','utf8'),fleet=await fs.readFile('src/fleet-cockpit.js','utf8');
 assert.doesNotMatch(source+fleet,/drawPovInstruments/,WHY);
 for(const marker of ["five overlapping instruments","2021 F57's oval TFT","MY24 GR Yaris","G29 cabin","2000 GTV","spec.taxi"] )assert.ok(source.includes(marker),marker+' authored feature removed. '+WHY);
 const signatures=new Set();for(const id of ['mini','carrera','aventador_svj','gtv','e36','cle','taxi','gr_yaris']){const spec=CARS.find(s=>s.id===id),model=new CarModel(spec),cockpit=new Cockpit(spec,model);let vertices=0;const palette=new Set();const furniture=cockpit.group.getObjectByName('authored-cockpit-furniture');assert.ok(furniture,id+' authored furniture absent. '+WHY);furniture.traverse(o=>{if(o.isMesh){vertices+=o.geometry.attributes.position.count;for(const m of [].concat(o.material))palette.add(m.color?.getHexString());}});signatures.add(vertices+'|'+[...palette].sort().join(','));cockpit.disposeMirrors();model.disposeDamage?.();}
 assert.equal(signatures.size,8,'Authored families collapsed to shared furniture. '+WHY);
});
