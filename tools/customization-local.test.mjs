import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeAppearance,normalizeManifest} from '../src/customization-data.js';import {createPresetRepository} from '../src/customization-repository.js';
const look={paint:'#aa1122',driver:{shirt:'#123456',hairStyle:'curly',helmet:true}};
test('local repository preserves paint/driver across select/reload/rename/delete and failed writes',async()=>{let disk=normalizeManifest({}),id=0;const make=()=>createPresetRepository({load:async()=>structuredClone(disk),write:async v=>(disk={...v,revision:disk.revision+1}),id:()=>String(++id).padStart(32,'0')});let repo=make();await repo.reload();const a=await repo.save('mini','Red',look),b=await repo.save('z4','Blue',{...look,paint:'#0000bb'});await assert.rejects(repo.select('mini',b.id),/not found/);repo=make();await repo.reload();assert.equal(repo.selected('mini').driver.hairStyle,'curly');await repo.rename(a.id,'Night');const copy=await repo.duplicate(a.id);assert.notEqual(copy.id,a.id);await repo.delete(copy.id);assert.equal(repo.forCar('z4').length,1);const fail=createPresetRepository({load:async()=>disk,write:async()=>{throw Error('offline');}});await fail.reload();const before=fail.snapshot();await assert.rejects(fail.delete(a.id),/offline/);assert.deepEqual(fail.snapshot(),before);});
test('normalization ignores car descriptors and identity while keeping bounded appearance',()=>{const v=normalizeAppearance({paint:'url(evil)',driver:{skin:'<svg>',shirt:'#123456',hairStyle:'script',email:'private'},decals:Array(100).fill({id:'photo',url:'evil'})});assert.equal(v.driver.shirt,'#123456');assert.ok(!('decals'in v));assert.ok(!JSON.stringify(v).includes('evil'));assert.ok(!('email'in v.driver));});

test('localStorage preset adapter persists paint and character looks without any network request',async t=>{
 const disk=new Map();globalThis.localStorage={getItem:k=>disk.get(k)||null,setItem:(k,v)=>disk.set(k,v)};t.after(()=>delete globalThis.localStorage);
 t.mock.method(globalThis,'fetch',()=>assert.fail('local presets must not fetch'));
 const store=await import('../src/customization-store.js?local-test');
 const [a,b]=await Promise.all([store.getCustomizationRepository(),store.getCustomizationRepository()]);assert.equal(a.repository,b.repository);
 const saved=await a.repository.save('mini','Local Red',look);store.applyCustomization({id:'mini'},saved);
 assert.equal(disk.get('paraliaki.paint.mini'),'#aa1122');assert.equal(store.currentCarAppearance({id:'mini'}).driver.shirt,'#123456');
 const again=await import('../src/customization-store.js?second-tab');await again.syncSavedCustomization();assert.equal(again.currentCarAppearance({id:'mini'}).paint,'#aa1122');
 const other=(await again.getCustomizationRepository()).repository;await a.repository.rename(saved.id,'First tab');await assert.rejects(other.rename(saved.id,'Stale tab'),/another tab/);
});
