import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {CARS,CarModel} from './vehicle-budget-support.mjs';
import {filterCars,carModel} from '../src/car-catalog.js';
import {badgeBrand,manufacturerOptions,BRAND_BADGES} from '../src/manufacturers.js';
import {createVehicleFraming,frameVehicle} from '../src/ui/vehicle-framing.js';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('every garage trim has the manufacturer artwork and drive pill inside its card media',async()=>{
 const doc=globalThis.document;delete globalThis.document;const C=await import('../src/ui/components.js');globalThis.document=doc;
 for(const car of CARS.filter(c=>carModel(c))){const brand=badgeBrand(car);assert.ok(BRAND_BADGES[brand],car.id);const html=C.carCard({id:car.id,brand,drive:car.drive,name:car.name});assert.match(html,new RegExp(`data-manufacturer="${brand}"`));assert.match(html,/car-card__brand/);assert.match(html,/atlas\.svg/);assert.match(html,/<div class="card__media">[\s\S]*<span class="card__badge">/);}
 const css=read('src/ui/ui.css');assert.match(css,/\.card--car \.card__media \{[^}]*position: relative;[^}]*overflow: visible/);assert.match(css,/\.card--car \.card__badge \{[^}]*inset: \.75rem \.75rem auto auto/);
});
test('brand filter covers every manufacturer and combines with the other filters',()=>{
 const options=manufacturerOptions(CARS.filter(c=>carModel(c)));assert.equal(options.length,new Set(CARS.filter(c=>carModel(c)).map(badgeBrand)).size);
 for(const [brand] of options){const list=filterCars(CARS,{brand});assert.ok(list.length,brand);assert.ok(list.every(({car})=>badgeBrand(car)===brand));}
 assert.deepEqual(filterCars(CARS,{brand:'volkswagen',search:'golf',category:'city',drive:'AWD',power:'mid',sort:'power'}).map(({car})=>car.id),['golf_r']);
 assert.equal(filterCars(CARS,{brand:'fiat',category:'super'}).length,0);
 const source=read('src/car-select.js');assert.match(source,/key: 'brand', label: 'BRAND'/);assert.match(source,/body: `\$\{toolbar\}<div class="car-grid/);
});
test('showroom has a transparent soft shadow receiver and no turntable disc',()=>{
 const source=read('src/car-select.js');assert.doesNotMatch(source,/CircleGeometry/);assert.match(source,/PlaneGeometry\(1,1\)[\s\S]*ShadowMaterial\(\{opacity:\.22\}/);assert.match(source,/frame\(\);renderer.render\(scene, camera\)/);
});
test('actual city, sports, van and bus vertices stay centred within half a pixel through full revolutions',()=>{
 for(const id of ['a160','panda','golf','carrera','huracan','van','bus']){
 const model=new CarModel(CARS.find(c=>c.id===id));model.root.traverse(o=>{if(o.isLOD){o.autoUpdate=false;o.levels.forEach((l,i)=>l.object.visible=i===0);}});
 const framing=createVehicleFraming(model.root),camera=new THREE.PerspectiveCamera(35);
 for(const [width,height] of [[800,600],[390,220],[320,600]])for(let a=0;a<Math.PI*2;a+=Math.PI/6){
 model.root.rotation.y=a;frameVehicle(camera,model.root,framing,width,height);let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 model.root.updateMatrixWorld(true);camera.updateMatrixWorld(true);
 model.root.traverseVisible(o=>{if(!o.isMesh)return;const pos=o.geometry.attributes.position;for(let i=0;i<pos.count;i++){const p=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld).project(camera);minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}});
 const why=`${id}, ${width}x${height}, ${a}`;assert.ok(Math.abs(minX+maxX)*width/4<.5,why+' horizontal');assert.ok(Math.abs(minY+maxY)*height/4<.5,why+' vertical');assert.ok(Math.max(Math.abs(minX),Math.abs(maxX),Math.abs(minY),Math.abs(maxY))<.94,why+' margins');
 }model.disposeDamage?.();}
});
test('spec panel has shared tiles, segmented trims and no unavailable paint or internal copy',async()=>{
 const doc=globalThis.document;delete globalThis.document;const {renderCarSelect}=await import('../src/car-select.js');globalThis.document=doc;
 for(const id of ['golf','van']){const html=renderCarSelect({index:CARS.findIndex(c=>c.id===id),detail:true,garage:true});assert.match(html,/vehicle-specs panel/);assert.doesNotMatch(html,/class="car-trim-browser"/);assert.match(html,/stats--boxed/);assert.equal((html.match(/class="stat-tile /g)||[]).length,6);assert.match(html,/data-key="carTrim"/);assert.match(html,/data-act="carConfirm"/);assert.doesNotMatch(html,/Existing fleet model|Custom paint|nativeFleet|placeholder|TODO|WIP/);assert.equal(html.includes('class="car-paints"'),id==='golf');}
});

test('browser measures drive-pill containment, manufacturer options and brand selection at desktop and phone sizes', {timeout:600000}, async()=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
 const {stdout}=await promisify(execFile)('bash',['tools/browser-slot.sh',process.execPath,'tools/garage-cards.browser.mjs'],{timeout:570000,env:{...process.env,BROWSER_SLOT_WAIT:'480'},maxBuffer:1024*1024});
 assert.match(stdout,/Garage browser bounds, logos and brand filter PASS 1280/);assert.match(stdout,/Garage browser bounds, logos and brand filter PASS 390/);
});
