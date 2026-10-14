// CPU-only storage/account isolation tests. Real account client, repository,
// service and SQLite contract; replace only GPU car material adapters.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createCustomizationService,handleCustomizationRequest} from '../server/customization.mjs';
import {createMemoryCustomizationStore} from '../server/customization-store.mjs';
const root=new URL('../',import.meta.url).pathname;
async function harness(){
  const result=await build({stdin:{contents:`export {account} from './src/account.js'; export * from './src/customization-store.js';`,resolveDir:root,sourcefile:'customization-sync-entry.js'},bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.url':JSON.stringify(new URL('../src/customization-store.js',import.meta.url).href)},logLevel:'error',plugins:[{name:'cpu-car-adapters',setup(b){
    b.onResolve({filter:/\/cars\.js$/},()=>({path:'catalog',namespace:'cpu'}));
    b.onLoad({filter:/.*/,namespace:'cpu'},()=>({contents:"export const CARS=[{id:'mini',color:'#bd1626'},{id:'z4',color:'#22679d'}];",resolveDir:root}));
  }}]});
  const disk=new Map();globalThis.localStorage={getItem:k=>disk.get(k)||null,setItem:(k,v)=>disk.set(k,String(v)),removeItem:k=>disk.delete(k)};
  const service=createCustomizationService(createMemoryCustomizationStore());let who=null,hold,release;
  globalThis.fetch=async(path,opts={})=>{if(path==='/api/me')return Response.json(who?{username:who.username}:{guest:true});if(path==='/auth/logout'){who=null;return Response.json({ok:true});}
    const identity=who?{...who}:null;if(opts.method==='PUT'&&hold)await hold;
    return handleCustomizationRequest(new Request('https://fixture.test'+path,opts),{service,who:identity});};
  const api=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64')+'#'+Math.random());
  return {api,service,disk,setUser:v=>{who=v;},holdWrites(){hold=new Promise(r=>release=r);},releaseWrites(){hold=null;release?.();}};
}
const guestLook={paint:'#bb2222',driver:{skin:'#b67c56',shirt:'#112233',hair:'#30231c',hairStyle:'curly',helmet:false}};
test('guest look restores after sign-out; signed-in presets remain account-owned and absent from guest collection',async()=>{
  const h=await harness(),{api}=h;await api.account.get();let state=await api.getCustomizationRepository();await state.repository.reload();await state.repository.save('mini','Guest Red',guestLook);api.applyCustomization({id:'mini',color:'#bd1626'},guestLook);
  h.setUser({sub:'A',username:'RACER-A'});await api.account.get();state=await api.getCustomizationRepository();await state.repository.reload();assert.deepEqual(state.repository.snapshot().presets,[]);
  const signed=await state.repository.save('mini','Account Blue',{...guestLook,paint:'#0000bb',driver:{...guestLook.driver,shirt:'#abcdef'}});api.applyCustomization({id:'mini',color:'#bd1626'},signed);assert.equal(h.service.get('A').presets.length,1);assert.equal(api.getDriverAppearance('mini').shirt,'#abcdef');
  await api.account.signOut();await api.syncSavedCustomization();state=await api.getCustomizationRepository();await state.repository.reload();assert.equal(state.repository.forCar('mini')[0].name,'Guest Red');assert.equal(api.currentCarAppearance({id:'mini',color:'#bd1626'}).paint,'#bb2222');assert.equal(api.getDriverAppearance('mini').shirt,'#112233');
  h.setUser({sub:'B',username:'RACER-B'});await api.account.get();state=await api.getCustomizationRepository();await state.repository.reload();assert.deepEqual(state.repository.snapshot().presets,[],'account B does not inherit A presets');
});
test('username gate and stale in-flight save cannot publish another account look',async()=>{
  const h=await harness(),{api}=h;h.setUser({sub:'A',username:''});await api.account.get();await assert.rejects(api.getCustomizationRepository(),/unique public username/);
  h.setUser({sub:'A',username:'RACER-A'});await api.account.get();let {repository}=await api.getCustomizationRepository();await repository.reload();h.holdWrites();const pending=repository.save('mini','Pending A',guestLook);
  h.setUser({sub:'B',username:'RACER-B'});await api.account.get();h.releaseWrites();await assert.rejects(pending,/Account changed/);({repository}=await api.getCustomizationRepository());await repository.reload();assert.equal(repository.forCar('mini').length,0);assert.equal(h.service.get('B').presets.length,0);
});
test('guest revision conflict does not overwrite changes made in another tab',async()=>{
  const h=await harness(),{api}=h;await api.account.get();const {repository}=await api.getCustomizationRepository();await repository.reload();const external={version:1,revision:1,presets:[],active:{}};h.disk.set('paraliaki.customization.guest.v1',JSON.stringify(external));await assert.rejects(repository.save('mini','Stale Tab',guestLook),/another tab/);assert.deepEqual(JSON.parse(h.disk.get('paraliaki.customization.guest.v1')),external);
});
