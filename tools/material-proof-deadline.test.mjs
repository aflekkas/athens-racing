import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createProofDeadline} from './material-proof-deadline.mjs';
import {finalizeMaterialProof,describeProofFailure} from './material-proof-cleanup.mjs';
const source=await readFile(new URL('./terrain-material.browser.mjs',import.meta.url),'utf8');
const hashSource=source.slice(source.indexOf('const hash=b=>'),source.indexOf('\nconst report='));
const saveSource=source.slice(source.indexOf('const save=async'),source.indexOf('\nconst deadlineMs='));
const declarations=source.slice(source.indexOf('let deadline,primaryError'),source.indexOf('\ntry{\n app='));
const timerSource=source.match(/workDeadline=createProofDeadline\([^\n]+/)[0];
const post=source.slice(source.indexOf('  // Fail if a concurrent change'));
const AF=Object.getPrototypeOf(async function(){}).constructor;
// Actual hash, save, timer installation, full post-source audit, semantic block,
// success assignment, catch and independent finalizer -- no alternate final path.
const run=new AF('createProofDeadline','finalizeMaterialProof','describeProofFailure','report','browser','app','traces','fs','createHash','JSON','assert','input','policiesInput',
 `let workDeadline=null;const root='root',out='out',phase=input.phase||'before',target='limestone',diagnosticOnly=false,deadlineMs=10;const resolve=(...s)=>s.join('/');${hashSource}\n${saveSource}\n${declarations}\npolicies.push(...policiesInput);try{${timerSource}\nif(input.hasEarlier)throw input.earlier;if(true){${post}`);
async function fixture(stage,options={}){
 let time=0,fire=()=>{},fired=false,closeCalls=0,proxyCalls=0,done=false,postWriteReads=0;const writes=[],calls=[];let rejected=false,caught,release;
 const pending=new Promise(resolve=>{release=resolve;});
 const report={status:'preparing',sources:{'src/last.js':'pin'},runs:[],selectedCases:['fixed'],egressSignature:'e',target:'limestone',protocol:'p',casesHash:'c',worldRevision:'w',manifestHash:'m'};
 const advance=name=>{if(stage===name&&!fired){fired=true;time=options.at??10;if(options.fire!==false)fire();}};
 const actualReport=new Proxy(report,{set(o,key,value){o[key]=value;if(key==='status'&&value==='passed')advance('status');return true;}});
 const browser={close(){closeCalls++;calls.push('browser-close');if(closeCalls===1){advance('close');if(options.closeReject)return Promise.reject(options.closeReject);if(options.pendingClose)return pending;}}};
 const app={close(){proxyCalls++;calls.push('proxy-close');}};
 const traces=[{beginCleanup(){calls.push('trace-begin');},finish(){calls.push('trace-finish');}}];
 const factory=opts=>createProofDeadline({...opts,now:()=>{if(writes.length&&++postWriteReads===2)advance('return');return time;},schedule(fn){fire=fn;return{unref(){}};},cancel(){calls.push('cancel');}});
 const fs={async readFile(path){advance(path.endsWith('before.json')?'comparison-read':'read');if(path.endsWith('before.json'))return globalThis.JSON.stringify({...report,status:'passed'});return 'source';},async writeFile(_path,text){writes.push(globalThis.JSON.parse(text));calls.push('write');if(report.status==='passed')advance('write');if(options.writeReject&&fired)throw options.writeReject;}};
 const json={parse:globalThis.JSON.parse,stringify(...args){const text=globalThis.JSON.stringify(...args);if(report.status==='passed')advance('serialize');if(options.serializeReject&&fired)throw options.serializeReject;return text;}};
 const createHash=()=>({update(){return this;},digest(){advance('hash');return 'pin';}});
 const checked=new Proxy(assert,{get(o,key){const value=Reflect.get(o,key);return typeof value==='function'?(...args)=>{advance('semantic');return value.apply(o,args);}:value;}});
 const policies=options.egressError?[{check(){throw options.egressError;}}]:[];
 const operation=run(factory,finalizeMaterialProof,describeProofFailure,actualReport,browser,app,traces,fs,createHash,json,checked,options,policies).then(()=>{done=true;},e=>{done=true;rejected=true;caught=e;});
 if(options.pendingClose){for(let i=0;i<30;i++)await Promise.resolve();assert.equal(done,false);assert.equal(proxyCalls,1);assert.ok(!writes.some(w=>w.status==='passed'));release();}
 await operation;return{report,writes,calls,rejected,caught,closeCalls,proxyCalls};
}
for(const stage of ['read','hash','comparison-read','semantic','status','serialize','write','close','return'])test('actual final path rejects deadline during '+stage+' and saves failed final receipt',async()=>{
 const f=await fixture(stage,{phase:['semantic','comparison-read'].includes(stage)?'after':'before'});
 assert.equal(f.rejected,true);assert.match(f.caught.message,/MATERIAL_WORK_DEADLINE_EXCEEDED/);assert.equal(f.report.deadlineExceeded,true);assert.equal(f.report.status,'failed');assert.equal(f.writes.at(-1).status,'failed');assert.equal(f.writes.at(-1).deadlineExceeded,true);assert.ok(f.calls.includes('trace-finish'));assert.equal(f.proxyCalls,1);
});
for(const at of [9,10,11])test('absolute limit boundary '+at+' with late timer callback suppressed',async()=>{
 const f=await fixture('write',{at,fire:false});assert.equal(f.rejected,at>=10);assert.equal(f.writes.at(-1).status,at>=10?'failed':'passed');
});
for(const [i,earlier]of [undefined,null,0,false,'',new Error('EARLIER')].entries())test('earlier primary '+i+' survives later cleanup deadline',async()=>{
 const f=await fixture('close',{hasEarlier:true,earlier});assert.equal(f.rejected,true);assert.ok(Object.is(f.caught,earlier));assert.equal(f.report.failure,describeProofFailure(earlier));assert.equal(f.writes.at(-1).status,'failed');assert.equal(f.report.deadlineExceeded,true);
});
test('earlier egress failure precedes deadline first cause',async()=>{
 const earlier=new Error('EARLIER_EGRESS');const f=await fixture('close',{egressError:earlier});assert.equal(f.caught,earlier);assert.equal(f.report.failure,describeProofFailure(earlier));assert.equal(f.writes.at(-1).status,'failed');
});
test('timer-triggered browser close rejection is owned secondary evidence',async()=>{
 const closeReject=new Error('CLOSE_REJECT');const f=await fixture('read',{closeReject});assert.equal(f.rejected,true);assert.match(f.caught.message,/DEADLINE/);assert.ok(f.report.cleanup.errors.some(e=>e.phase==='deadline-browser-close'&&e.message.includes('CLOSE_REJECT')));assert.ok(f.closeCalls>=2);assert.equal(f.writes.at(-1).status,'failed');
});
test('unsettled timer close cannot return success; proxy cleanup still starts before outer bound',async()=>{
 const f=await fixture('read',{pendingClose:true});assert.equal(f.rejected,true);assert.equal(f.writes.at(-1).status,'failed');
});
test('deadline guard prevents all later page proof commands',async()=>{
 let time=0,primary={hasPrimary:false},calls=0;const report={};const gate=createProofDeadline({report,limitMs:10,now:()=>time,schedule:()=>null,cancel(){},getPrimary:()=>primary,recordPrimary:primaryError=>{if(!primary.hasPrimary)primary={hasPrimary:true,primaryError};},closeBrowser(){}});
 const page=gate.guardPage({evaluate(){calls++;},goto(){calls++;}});time=10;await assert.rejects(page.evaluate('NO_LATER_COMMAND'),/DEADLINE/);await assert.rejects(page.goto('NO_LATER_NAV'),/DEADLINE/);assert.equal(calls,0);
});
test('early timer never overrides absolute under-limit admission',()=>{
 let fire,time=0,primary={hasPrimary:false},closed=0;const report={};const gate=createProofDeadline({report,limitMs:10,now:()=>time,schedule:f=>(fire=f,null),cancel(){},getPrimary:()=>primary,recordPrimary:primaryError=>{if(!primary.hasPrimary)primary={hasPrimary:true,primaryError};},closeBrowser(){closed++;}});
 time=9;fire();gate.check();assert.equal(closed,0);time=10;assert.throws(gate.check,/DEADLINE/);
});

for(const [stage,key]of [['write','writeReject'],['serialize','serializeReject']])test('deadline primary survives later '+stage+' failure; failed write cannot produce accepted success',async()=>{
 const f=await fixture(stage,{[key]:new Error('LATE_IO_OR_SERIALIZE')});assert.equal(f.rejected,true);assert.match(f.caught.message,/MATERIAL_WORK_DEADLINE_EXCEEDED/);assert.equal(f.report.status,'failed');assert.ok(f.report.cleanup.receiptWriteError);assert.equal(f.report.cleanup.complete,false);
});

test('absolute deadline still precedes a late normal close rejection with timer canceled',async()=>{
 const f=await fixture('close',{fire:false,closeReject:new Error('LATE_CLOSE')});assert.equal(f.rejected,true);assert.match(f.caught.message,/MATERIAL_WORK_DEADLINE_EXCEEDED/);assert.ok(f.report.cleanup.errors.some(e=>e.phase==='browser-close'&&e.message.includes('LATE_CLOSE')));assert.equal(f.writes.at(-1).status,'failed');
});
