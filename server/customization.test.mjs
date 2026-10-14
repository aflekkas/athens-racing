import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {deflateSync} from 'node:zlib';
import {createMemoryCustomizationStore,createSqlCustomizationStore} from './customization-store.mjs';
import {createCustomizationService,inspectStickerImage,handleCustomizationRequest} from './customization.mjs';
import {createPresetRepository} from '../src/customization-repository.js';
import {normalizeAppearance,normalizeManifest,CUSTOMIZATION_LIMITS as L} from '../src/customization-data.js';
function crc32(b){let c=0xffffffff;for(const n of b){c^=n;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
const chunk=(tag,data)=>{const out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length);out.write(tag,4);data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,8+data.length)),8+data.length);return out;};
export function png(w=2,h=2){const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;const raw=Buffer.alloc(h*(1+w*4),255);for(let y=0;y<h;y++)raw[y*(1+w*4)]=0;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const sqlShim=db=>({exec(q,...args){if(q.includes(';')){db.exec(q);return [];}const s=db.prepare(q);return s.columns().length?s.all(...args):(s.run(...args),[]);}});
const appearance={paint:'#AA1122',decals:[{id:'roundel',position:'doors',number:33,color:'#ffffff',x:.2,y:-.4,scale:1.5,rotation:45,flipX:true}],driver:{skin:'#e8bd96',shirt:'#1253a2',hair:'#443322',hairStyle:'short',helmet:true}};
const preset=(id='1'.repeat(32),carId='mini')=>({id,carId,name:'Night Run',...structuredClone(appearance),updatedAt:1});
for(const [kind,make] of [['memory',()=>createMemoryCustomizationStore()],['SQLite',()=>createSqlCustomizationStore(sqlShim(new DatabaseSync(':memory:')))]] ){
  test(`${kind}: signed-in preset persistence, revision conflicts, ownership and delete lifecycle`,()=>{
    const store=make(),service=createCustomizationService(store,{cars:new Set(['mini','z4'])});
    const a=service.upload('owner-A',png(),'image/png'),b=service.upload('owner-B',png(),'image/png');
    assert.equal(a.size,png().length);assert.deepEqual(inspectStickerImage(service.image(a.id).bytes,'image/png').width,2);
    const p=preset();p.decals.push({id:'photo',assetId:a.id,position:'bonnet',x:.7,scale:.8});
    const out=service.save('owner-A',{revision:0,presets:[p],active:{mini:p.id}});assert.equal(out.revision,1);assert.equal(out.presets[0].driver.helmet,true);
    assert.equal(out.presets[0].decals[1].assetId,a.id);assert.equal(out.active.mini,p.id);
    assert.deepEqual(createCustomizationService(store).get('owner-A'),out,'service restart reloads persisted SQLite data');
    assert.deepEqual(service.get('owner-B').presets,[]);assert(!JSON.stringify(out).includes('owner-A'),'no identity in manifest or asset response');
    assert.throws(()=>service.save('owner-A',{revision:0,presets:[p]}),e=>e.status===409);
    assert.throws(()=>service.save('owner-B',{revision:0,presets:[p]}),e=>e.status===403);
    assert.throws(()=>service.delete('owner-B',a.id),e=>e.status===404);assert.throws(()=>service.delete('owner-A',a.id),e=>e.status===409);
    assert.throws(()=>service.save('owner-A',{revision:1,presets:[preset('2'.repeat(32),'missing')]}),e=>e.status===400);
    service.save('owner-A',{revision:1,presets:[],active:{}});service.delete('owner-A',a.id);assert.throws(()=>service.image(a.id),e=>e.status===404);assert(service.owns('owner-B',b.id));assert.equal(service.owns(undefined,'f'.repeat(32)),false);assert.equal(service.owns(null,b.id),false);
  });
  test(`${kind}: image/account quotas and executable/remote references rejected`,()=>{
    const service=createCustomizationService(make());assert.throws(()=>service.upload(null,png(),'image/png'),e=>e.status===401);
    assert.throws(()=>service.upload('a',new Uint8Array(L.assetBytes+1),'image/png'),e=>e.status===413);
    assert.throws(()=>service.upload('a',Buffer.from('<svg onload="alert(1)"/>'),'image/svg+xml'),e=>e.status===415);
    assert.throws(()=>service.upload('a',Buffer.from('<script>evil</script>'),'image/png'),e=>e.status===400);
    assert.throws(()=>service.upload('a',png(513,1),'image/png'),e=>e.status===413);
    assert.throws(()=>service.upload('a',Buffer.concat([png(),Buffer.from('<script>evil</script>')]),'image/png'),e=>e.status===400);
    const p=preset();p.decals=[{id:'photo',position:'doors',assetId:'https://attacker/x.png',url:'https://attacker'}];const out=service.save('a',{revision:0,presets:[p]});assert.deepEqual(out.presets[0].decals,[]);
    for(let i=0;i<L.assets;i++)service.upload('a',png(),'image/png');assert.throws(()=>service.upload('a',png(),'image/png'),e=>e.status===413);
  });
}
test('API sessions, username gate, body stream limits, fixed image serving and mutations',async()=>{
  const service=createCustomizationService(createMemoryCustomizationStore());let who={sub:'private-google-sub',username:'RACER'};
  const call=(path,method='GET',body,type='application/json',headers={})=>handleCustomizationRequest(new Request('https://game.test'+path,{method,...(body?{body}:{}),headers:{'Content-Type':type,...headers}}),{service,who:()=>who});
  who=null;assert.equal((await call('/api/customization')).status,401);who={sub:'x',username:''};assert.equal((await call('/api/customization')).status,403);who={sub:'private-google-sub',username:'RACER'};
  assert.equal((await call('/api/customization','PUT','{}','application/json',{Origin:'https://evil.test'})).status,403);
  assert.equal((await call('/api/customization','PUT','x'.repeat(L.manifestBytes+1))).status,413);
  assert.equal((await call('/api/customization','PUT','{invalid')).status,400);
  const r=await call('/api/customization/assets','POST',png(),'image/png');assert.equal(r.status,201);const asset=await r.json();assert(!JSON.stringify(asset).includes('private-google-sub'));
  who=null;const image=await call('/api/customization/assets/'+asset.id);assert.equal(image.status,200);assert.equal(image.headers.get('Content-Type'),'image/png');assert.equal(image.headers.get('X-Content-Type-Options'),'nosniff');assert.match(image.headers.get('Content-Security-Policy'),/sandbox/);assert.equal((await image.arrayBuffer()).byteLength,png().length);
  who={sub:'other',username:'OTHER'};assert.equal((await call('/api/customization/assets/'+asset.id,'DELETE')).status,404);
  who={sub:'private-google-sub',username:'RACER'};assert.equal((await call('/api/customization/assets/'+asset.id,'DELETE')).status,200);assert.equal((await call('/api/customization/assets/'+asset.id)).status,404);
});
test('guest repository save/reload, cross-car isolation, edit, rename, duplicate, select, delete, failed persistence',async()=>{
  let disk=normalizeManifest({}),counter=0;const make=()=>createPresetRepository({load:async()=>structuredClone(disk),write:async v=>(disk={...v,revision:disk.revision+1}),id:()=>String(++counter).padStart(32,'0'),clock:()=>100});
  const repo=make();await repo.reload();const one=await repo.save('mini','Track',appearance),two=await repo.save('z4','Coast',{...appearance,paint:'#228844'});assert.equal(repo.forCar('mini').length,1);
  await assert.rejects(repo.select('mini',two.id),/not found/);assert.equal(repo.selected('mini').id,one.id);
  const reloaded=make();await reloaded.reload();assert.equal(reloaded.selected('mini').decals[0].rotation,45);
  await reloaded.rename(one.id,'Changed');assert.equal(reloaded.forCar('mini')[0].name,'Changed');const duplicate=await reloaded.duplicate(one.id);assert.notEqual(duplicate.id,one.id);
  await reloaded.save('mini','Changed',{...appearance,paint:'#ffffff'},one.id);assert.equal(reloaded.selected('mini').paint,'#ffffff');await reloaded.select('mini',duplicate.id);assert.equal(reloaded.selected('mini').paint,'#aa1122');
  await reloaded.delete(duplicate.id);assert.equal(reloaded.selected('mini'),null);assert.equal(reloaded.forCar('z4').length,1);
  const failing=createPresetRepository({load:async()=>disk,write:async()=>{throw new Error('offline');}});await failing.reload();const before=failing.snapshot();await assert.rejects(failing.delete(one.id),/offline/);assert.deepEqual(failing.snapshot(),before);
});
test('normalization bounds layers/transforms/driver and strips executable or identity data',()=>{
  const appearance=normalizeAppearance({paint:'url(evil)',driver:{skin:'<svg>',hairStyle:'script',helmet:1,email:'secret'},decals:Array(100).fill({id:'stripes',position:'bonnet',color:'#ffffff',x:99,y:-99,scale:99,rotation:900,flipX:true,url:'evil'})});
  assert.equal(appearance.decals.length,8);assert.equal(appearance.decals[0].x,1);assert.equal(appearance.decals[0].rotation,180);assert.equal(appearance.decals[0].scale,2);assert(!JSON.stringify(appearance).includes('evil'));assert(!('email'in appearance.driver));
});
