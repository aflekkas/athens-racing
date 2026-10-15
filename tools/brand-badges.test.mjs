import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BRAND_BADGES, badgeBrand, brandBadgeMaterial } from '../src/brand-badges.js';
import { cockpitLampLayout, drawCockpitLamps } from '../src/cockpit-telltales.js';
test('brand artwork and fallback flags cover the garage bodies',()=>{
 for(const body of ['panda','jazz','yaris','ibiza','golf','mini','mini_jcw','gr_yaris','gla','corolla','octavia','superb','cla','cle','z4','carrera','huracan','gtv','e36','police_octavia']){
  const brand=badgeBrand({body});assert.ok(BRAND_BADGES[brand],body);assert.ok(fs.existsSync(new URL(`../assets/brand-badges/${brand}.svg`,import.meta.url)));assert.equal(typeof BRAND_BADGES[brand].enabled,'boolean');
 }
 assert.equal(new Set(Object.values(BRAND_BADGES).map(b=>b.cell)).size,Object.keys(BRAND_BADGES).length);
});
test('all 13 telltales have separate, bounded mountings in every cluster style',()=>{
 for(const style of ['gtv','taxi','carrera','mini','mini_jcw','huracan','gr_yaris','yaris','e36']){
  const points=cockpitLampLayout(style);assert.equal(points.length,13);
  for(const [i,[x,y]] of points.entries()){
   assert.ok(x>=13&&x<=1011&&y>=13&&y<=371,style);
   for(const [a,b] of points.slice(i+1))assert.ok(Math.hypot(a-x,b-y)>=25,`${style}: overlapping symbols`);
  }
 }
});
test('extinguished telltales do not draw or allocate artwork',()=>{
 drawCockpitLamps({drawImage(){assert.fail('unlit bulb drawn');}},[['engine',null]],'gtv');
});

test('brands share one texture and disabling a brand selects the generic medallion',()=>{
 const previous=globalThis.document,enabled=BRAND_BADGES.lamborghini.enabled;
 globalThis.document={createElementNS:()=>({addEventListener(){},removeEventListener(){}})};
 try{
  const bull=brandBadgeMaterial({body:'huracan'}),crest=brandBadgeMaterial({body:'carrera'});
  assert.equal(bull.map,crest.map);assert.equal(bull.map.anisotropy,1);
  BRAND_BADGES.lamborghini.enabled=false;
  const generic=brandBadgeMaterial({body:'huracan'});
  assert.notEqual(generic,bull);assert.equal(generic,brandBadgeMaterial({body:'unknown'}));assert.equal(generic.map,bull.map);
 }finally{BRAND_BADGES.lamborghini.enabled=enabled;globalThis.document=previous;}
});
