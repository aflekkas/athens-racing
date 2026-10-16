import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bakeBlockShade} from '../src/baked-realism.js';
import {GeoBatch,M} from '../src/util.js';
import {buildingBlockGeometry} from '../src/buildings.js';
test('baked block shading changes only existing colours, keeps roof bright and bases darker',()=>{
 const b=new GeoBatch(),g=buildingBlockGeometry([0,0,10,0,10,10,0,10],10);
 b.add(g,M(0,0,0),'#ffffff');const pos=b.pos.slice(),nor=b.nor.slice(),uv=b.uv.slice(),count=b.count;
 bakeBlockShade(b,0,0,10);assert.equal(b.count,count);assert.deepEqual(b.pos,pos);assert.deepEqual(b.nor,nor);assert.deepEqual(b.uv,uv);
 for(let i=0;i<count;i++){
  const c=b.col[i*3];assert.ok(c>=.54&&c<=1);
  if(b.nor[i*3+1]>.5)assert.equal(c,1);
  if(Math.abs(b.nor[i*3+1])<.5 && b.pos[i*3+1]<.01)assert.ok(c<.72);
 }
 g.dispose();
});
test('tile bakes do not recolour earlier blocks',()=>{
 const b={pos:[0,1,0,0,0,0],nor:[0,1,0,1,0,0],col:[1,1,1,1,1,1]};
 bakeBlockShade(b,1,0,1);assert.deepEqual(b.col.slice(0,3),[1,1,1]);assert.ok(b.col[3]<1);
});
test('realism helper cannot create real-time shadow, AO, reflection or post passes',()=>{
 const code=readFileSync(new URL('../src/baked-realism.js',import.meta.url),'utf8');
 assert.doesNotMatch(code,/\bimport\b|\bnew\b|Shader|Material|Texture|RenderTarget|shadowMap|castShadow|receiveShadow|EffectComposer|SSAOPass|GTAO|Bloom|DOF|requestAnimationFrame/);
 const buildings=readFileSync(new URL('../src/buildings.js',import.meta.url),'utf8');
 assert.match(buildings,/bakeBlockShade\(batch,start,base,top\)/);
});
