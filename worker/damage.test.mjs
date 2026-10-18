import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(specifier,context,next){
 if(specifier==='../.deploy/catalogue.json')return {url:'data:text/javascript,export default {maps:[],cars:[]}',shortCircuit:true};
 if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject {}',shortCircuit:true};
 return next(specifier,context);
}});
const { GameArena } = await import('./index.mjs');

test('Worker transport uses the same recoverable / terminal frontal damage boundary as Node',async()=>{
 const arena=Object.create(GameArena.prototype),forwarded=[],messages=[];
 arena.env={};arena.core={clientData:()=>({finish:null}),message:(ws,m)=>forwarded.push(JSON.parse(m))};arena.attach=()=>{};arena.persist=async()=>{};arena.relay=()=>{};
 const ws={send:m=>messages.push(JSON.parse(m)),close:()=>assert.fail('unexpected close')};
 for(const evidence of [{},{impactEbs:20/3.6},{impactEbs:60/3.6},{impactEbs:89/3.6},{impactMechanical:.97},{impactMechanical:2}])await arena.webSocketMessage(ws,JSON.stringify({type:'dnf',reason:'wrecked',...evidence}));
 assert.equal(forwarded.length,0);assert.equal(messages.length,6);assert.ok(messages.every(m=>m.type==='error'&&m.message.includes('recoverable')));
 for(const evidence of [{impactEbs:90/3.6},{impactEbs:60/3.6,impactMechanical:.98}])await arena.webSocketMessage(ws,JSON.stringify({type:'dnf',reason:'wrecked',...evidence}));
 assert.equal(forwarded.length,2);
 await arena.webSocketMessage(ws,JSON.stringify({type:'dnf',reason:'retired'}));assert.equal(forwarded.at(-1).reason,'retired');
});
