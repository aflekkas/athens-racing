// Regression: an exhaust pop is a frame hitch when it changes the scene's light set (three.js re-resolves, and the
// first time recompiles, every material's program), reveals a never-compiled material, or allocates GPU/audio objects.
// Owner report 2026-10-18: "the exhaust pops create a lag spike in the car". Browser numbers: tools/exhaust-pops-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {CARS,CarModel} from './vehicle-budget-support.mjs';
import {flashLight,warmFlamePipelines} from '../src/exhaust-flames.js';
const svj=CARS.find(c=>c.exhaustPops),kinds=[1,2,3,1,2],idle={rpm:8000,redline:8500,throttle:0,overrun:false};
// Mirror main.js: the scene owns the model root, the mirror copy and the one shared flash light (added once at scene setup).
function build(){
 const scene=new THREE.Scene(),model=new CarModel(svj),f=model.exhaustFlames;
 scene.add(model.root,f.mirrorRoot,flashLight);scene.updateMatrixWorld(true);
 return {scene,model,f};
}
const visibleLights=scene=>{let n=0;scene.traverseVisible(o=>{if(o.isLight)n++;});return n;};
function inventory(scene){
 const mats=new Set(),geos=new Set(),maps=new Set(),lights=new Set(),bufs=new Set();
 scene.traverse(o=>{
  if(o.isLight)lights.add(o);
  for(const m of [].concat(o.material||[])){mats.add(m);if(m.map)maps.add(m.map);for(const v of Object.values(m.uniforms||{}))if(v.value?.isTexture)maps.add(v.value);}
  if(o.geometry){geos.add(o.geometry);for(const a of Object.values(o.geometry.attributes))bufs.add(a.array);}
 });
 return {mats,geos,maps,lights,bufs};
}
// the two three.js passes: main (car visible, mirror copy hidden) and cockpit mirror (car hidden, copy shown)
function lightsInPass(model,f,mirror){
 if(!mirror)return visibleLights(model.root.parent);
 f.beginMirror(model.body);model.root.visible=false;const n=visibleLights(model.root.parent);model.root.visible=true;f.endMirror();return n;
}
// Fire a pop every 25 frames and let update() decay/animate it; `each(frame)` runs after every update.
function drive(f,quality,frames,each){for(let i=0;i<frames;i++){if(i%25===0)f.pulse.fire(kinds[i/25%kinds.length|0],1);f.update(1/60,{...idle},true,quality);each(i);}}
for(const [quality,lights] of [['high',1],['med',1],['low',0],['potato',0]]){
 test(`${quality}: pops keep the visible light count at ${lights} in the main and mirror pass`,()=>{
  const {scene,model,f}=build(),counts=new Set(),shown=new Set();
  drive(f,quality,420,()=>{scene.updateMatrixWorld(true);counts.add(lightsInPass(model,f,false)+'/'+lightsInPass(model,f,true));shown.add(f.group.visible);});
  assert.deepEqual([...counts],[`${lights}/${lights}`]);
  assert.deepEqual([...shown].sort(),[false,true],'both idle and flaming frames were exercised');
 });
}
test('firing pops allocates no materials, geometries, textures, lights or vertex buffers',()=>{
 const {scene,model,f}=build();scene.updateMatrixWorld(true);const before=inventory(scene);
 drive(f,'high',600,()=>{lightsInPass(model,f,true);});
 const after=inventory(scene);
 for(const k of Object.keys(before)){assert.equal(after[k].size,before[k].size,k+' count changed');for(const x of after[k])assert.ok(before[k].has(x),'a new object appeared in '+k);}
 assert.ok(before.mats.size>=8&&before.lights.size>=1,'inventory saw the flame materials and the flash light');
});
test('cars with flames joining or leaving never change the light count (remote players)',()=>{
 const {scene,model,f}=build(),seen=new Set();
 drive(f,'high',60,()=>seen.add(lightsInPass(model,f,false)));
 const other=new CarModel(svj);scene.add(other.root,other.exhaustFlames.mirrorRoot); // a remote SVJ joins mid-session
 drive(f,'high',60,()=>seen.add(lightsInPass(model,f,false)));
 other.exhaustFlames.dispose(); // ...and leaves
 drive(f,'high',60,()=>seen.add(lightsInPass(model,f,false)));
 assert.deepEqual([...seen],[1]);
});
test('one light serves every car: the strongest live pop drives it and it returns to zero',()=>{
 const {f}=build(),other=new CarModel(svj).exhaustFlames;
 f.pulse.fire(1,.3);other.pulse.fire(2,1);f.update(1/60,{...idle},true,'high');other.update(1/60,{...idle},true,'high');
 assert.ok(Math.abs(flashLight.intensity-other.flash)<1e-9&&other.flash>f.flash);
 for(let i=0;i<30;i++){f.update(1/60,{...idle},true,'high');other.update(1/60,{...idle},true,'high');}
 assert.equal(flashLight.intensity,0);assert.equal(flashLight.visible,true,'idle light stays in the light set at zero intensity');
 other.dispose();
});
test('flame pipelines are drawn into every render target before the first pop, then never again',async()=>{
 const {f}=build(),calls=[],drawn=new Set(),fog=new THREE.FogExp2();
 const renderer={_t:null,autoClear:true,shadowMap:{autoUpdate:true},getRenderTarget(){return this._t;},setRenderTarget(t){this._t=t;},
  async compileAsync(sc){calls.push(['compile',this._t]);},render(sc,cam){calls.push(['render',this._t,sc.fog===fog,this.autoClear]);sc.traverseVisible(o=>{for(const m of [].concat(o.material||[]))drawn.add(m);});}};
 const camera=new THREE.PerspectiveCamera(),rt=[null,{name:'mirror'}];
 assert.equal(await warmFlamePipelines(renderer,camera,fog,rt),true);
 const kinds=m=>[...drawn].filter(x=>x.isShaderMaterial===m.shader&&x.isSpriteMaterial===m.sprite&&x.isPointsMaterial===m.points).length;
 assert.equal(kinds({shader:true,sprite:undefined,points:undefined}),f.flames.length,'every ribbon material is drawn');
 assert.equal(kinds({shader:undefined,sprite:true,points:undefined}),f.glows.length,'every glow sprite material is drawn');
 assert.equal(kinds({shader:undefined,sprite:undefined,points:true}),1,'the spark material is drawn');
 assert.deepEqual(calls.filter(c=>c[0]==='render').map(c=>c[1]),rt,'one draw per render target');assert.ok(calls.filter(c=>c[0]==='render').every(c=>c[2]&&c[3]===false));
 assert.equal(renderer.getRenderTarget(),null);assert.equal(renderer.autoClear,true);assert.equal(renderer.shadowMap.autoUpdate,true);
 assert.equal(await warmFlamePipelines(renderer,camera,fog,rt),false,'once per session');assert.equal(calls.filter(c=>c[0]==='render').length,2);
 assert.equal(f.group.visible,false,'the real flame objects are untouched');
});
test('main.js owns the flash light and warms the flame pipelines at load and on join',()=>{
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.match(main,/scene\.add\(flashLight\)/);
 assert.match(main,/await warmExhaustFlames\(\);[^]*?flamesWarmable = true;\s*tlog\('compiled'\)/,'warmed at load, behind the loading screen');
 assert.match(main,/if\(model\.exhaustFlames\)\{[^}]*flamesWarmable\)warmExhaustFlames\(\)/,'and when a remote SVJ joins');
});
test('the SVJ exhaust voice builds its graph once: pops create no nodes, buffers or decodes',()=>{
 const calls={},node=()=>({connect(){},disconnect(){},start(){},stop(){},frequency:param(),gain:param(),Q:{value:0}}),param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){}});
 const ctx=new Proxy({sampleRate:8000,currentTime:1,createBuffer:()=>({getChannelData:()=>new Float32Array(8000)})},{get:(t,k)=>t[k]!==undefined?(typeof t[k]==='function'?(...a)=>{calls[k]=(calls[k]||0)+1;return t[k](...a);}:t[k]):/^create/.test(k)?()=>{calls[k]=(calls[k]||0)+1;return node();}:k==='decodeAudioData'?()=>{calls[k]=(calls[k]||0)+1;}:undefined});
 return import('../src/audio/exhaust-voice.js').then(({ExhaustVoice})=>{
  const voice=new ExhaustVoice(ctx,node()),built={...calls};
  for(let s=1;s<=200;s++)voice.update({serial:s,kind:1+s%3,level:.6,life:.06},false);
  assert.deepEqual(calls,built,'pop updates must not create or decode anything');assert.equal(calls.decodeAudioData,undefined);
 });
});
