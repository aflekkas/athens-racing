import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createProofEgress} from './material-proof-egress.mjs';
import {finalizeMaterialProof,describeProofFailure} from './material-proof-cleanup.mjs';
const source=await readFile(new URL('./terrain-material.browser.mjs',import.meta.url),'utf8');
// Execute the ACTUAL runner catch AND finally, including all thrown-value handling.
assert.match(source,/import \{finalizeMaterialProof,describeProofFailure\} from '\.\/material-proof-cleanup\.mjs'/);
assert.ok(source.includes('let deadline,primaryError,hasPrimary=false;'));
const tail=source.slice(source.lastIndexOf('}catch(error){'));
assert.match(tail,/hasPrimary=true;primaryError=error/);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const runRunner=new AsyncFunction('finalizeMaterialProof','describeProofFailure','report','proof','browser','app','traces','save','deadline','let workDeadline=null;const recordPrimary=()=>{};let primaryError,hasPrimary=false;try{await proof();'+tail);
async function fixture(fail=[],options={}){
 const {primary,count=1}=options,hasPrimary=Object.hasOwn(options,'primary');
 const calls=[],saved=[],report={status:'passed'};
 const errors=Object.fromEntries(fail.map(k=>[k,new Error(k+' '+ 'x'.repeat(900))]));
 const action=(name,ret)=>()=>{calls.push(name);if(errors[name])throw errors[name];return ret;};
 const browser={close:action('browser')},app={close:action('app')};
 const traces=Array.from({length:count},(_,i)=>({beginCleanup:action('begin'+i),finish:label=>{calls.push('finish'+i+':'+label);if(errors['finish'+i])throw errors['finish'+i];}}));
 const save=()=>{calls.push('save');if(errors.write)throw errors.write;saved.push(JSON.parse(JSON.stringify(report)));};
 let caught,rejected=false;try{await runRunner(finalizeMaterialProof,describeProofFailure,report,()=>{if(hasPrimary)throw primary;},browser,app,traces,save,undefined);}catch(e){rejected=true;caught=e;}
 return{calls,saved,report,caught,rejected,errors};
}
test('actual runner happy cleanup closes both owners, finishes trace and saves once',async()=>{
 const f=await fixture();assert.equal(f.caught,undefined);assert.deepEqual(f.calls,['begin0','browser','app','finish0:owned-browser-and-proxy-closed','save']);assert.equal(f.saved.length,1);assert.equal(f.saved[0].status,'passed');assert.equal(f.saved[0].cleanup.complete,true);
});
for(const phase of ['browser','app','begin0','finish0','write'])test('actual runner independently attempts remaining cleanup after '+phase+' failure',async()=>{
 const f=await fixture([phase]);assert.ok(f.caught);assert.equal(f.report.status,'failed');assert.equal(f.report.cleanup.complete,false);assert.equal(f.report.cleanup.failed,1);
 for(const name of ['begin0','browser','app','save'])assert.ok(f.calls.includes(name),name);
 assert.ok(f.calls.some(c=>c.startsWith('finish0:')));assert.equal(f.saved.length,phase==='write'?0:1);
 if(phase==='write')assert.equal(f.report.cleanup.receiptWriteError.phase,'receipt-write');
 else {assert.equal(f.saved[0].status,'failed');assert.equal(f.saved[0].cleanup.errors.length,1);assert.ok(f.saved[0].cleanup.errors[0].message.length<=512);}
 if(['browser','app'].includes(phase))assert.ok(f.calls.includes('finish0:owned-cleanup-uncertain'));
});
test('combined failures preserve exact original proof error and still attempt receipt',async()=>{
 const primary=Object.freeze(new Error('proof-first-cause'));
 const f=await fixture(['begin0','browser','app','finish0','write'],{primary});
 assert.equal(f.caught,primary);assert.equal(f.report.failure,describeProofFailure(primary));assert.equal(f.report.cleanup.failed,5);assert.equal(f.report.cleanup.errors.length,4);assert.equal(f.report.cleanup.receiptWriteError.phase,'receipt-write');assert.equal(f.calls.at(-1),'save');
});
test('cleanup secondary list is bounded independently; write error has its own slot',async()=>{
 const fail=['browser','app','write',...Array.from({length:20},(_,i)=>['begin'+i,'finish'+i]).flat()];
 const f=await fixture(fail,{count:20});assert.equal(f.report.cleanup.errors.length,8);assert.equal(f.report.cleanup.droppedErrors,34);assert.equal(f.report.cleanup.failed,43);assert.equal(f.report.cleanup.receiptWriteError.message.length,512);assert.equal(f.calls.length,43);assert.match(f.caught.message,/trace-begin/);
});
test('guard-fatal path keeps first cause and never runs a later proof command',async()=>{
 let later=0,saved,primary;
 const policy=createProofEgress({localOrigin:'http://127.0.0.1:8123',dependency:{},readThree:()=>{throw Error('NO_READ');}});
 const guarded=policy.guardPage({evaluate:async()=>{later++;}});
 policy.fail('REQUEST_FAILED','http://127.0.0.1:8123/cell','net::ERR_ABORTED');
 const first=policy.report.firstCause,report={status:'passed'},trace={report:{firstCause:first},beginCleanup(){},finish(){assert.equal(this.report.firstCause,first);}};
 const proof=async()=>{try{await guarded.evaluate('FORBIDDEN_AFTER_FATAL');}catch(e){primary=e;throw e;}};
 await assert.rejects(runRunner(finalizeMaterialProof,describeProofFailure,report,proof,{close:async()=>{}},{close:async()=>{}},[trace],()=>{saved=structuredClone(report);},undefined),e=>e===primary);
 assert.equal(later,0);assert.equal(policy.report.firstCause,first);assert.equal(trace.report.firstCause,first);assert.equal(saved.failure,describeProofFailure(primary));assert.equal(saved.status,'failed');assert.equal(saved.cleanup.complete,true);
});
test('trace finish is attempted after another trace throws and receipt still saved',async()=>{
 const f=await fixture(['finish0'],{count:2});assert.ok(f.calls.includes('finish1:owned-browser-and-proxy-closed'));assert.equal(f.saved.length,1);assert.equal(f.saved[0].status,'failed');
});
for(const phase of ['browser','app','begin0','finish0','write'])test('original error identity survives isolated '+phase+' cleanup error',async()=>{
 const primary=Object.freeze(new Error('ORIGINAL'));
 const f=await fixture([phase],{primary});assert.equal(f.caught,primary);assert.equal(f.report.failure,describeProofFailure(primary));assert.equal(f.report.status,'failed');assert.equal(f.report.cleanup.failed,1);assert.equal(f.calls.at(-1),'save');
});

const thrownValues=[undefined,null,0,false,''];
for(const [index,primary]of thrownValues.entries())for(const failure of [null,'browser','app','begin0','finish0','write'])test('actual catch/finally preserves falsy thrown value '+index+' with '+(failure||'no cleanup failure'),async()=>{
 const f=await fixture(failure?[failure]:[],{primary});assert.equal(f.rejected,true);assert.ok(Object.is(f.caught,primary));assert.equal(f.report.status,'failed');assert.equal(f.report.failure,describeProofFailure(primary));
 for(const name of ['begin0','browser','app','save'])assert.ok(f.calls.includes(name));assert.ok(f.calls.some(c=>c.startsWith('finish0:')));
 assert.equal(f.saved.length,failure==='write'?0:1);for(const receipt of f.saved)assert.equal(receipt.status,'failed');
 assert.equal(f.report.cleanup.failed,failure?1:0);
});
test('safe failure description never invokes hostile coercion or stack/message getters',async()=>{
 let calls=0;const hostile={toString(){calls++;throw Error('NO');},get stack(){calls++;throw Error('NO');},get message(){calls++;throw Error('NO');}};
 for(const primary of [hostile,new Proxy({},{getOwnPropertyDescriptor(){throw Error('NO');}})]){
  const f=await fixture(['browser','write'],{primary});assert.equal(f.rejected,true);assert.equal(f.caught,primary);assert.equal(f.report.failure,'[unprintable thrown value]');assert.equal(f.report.cleanup.failed,2);
 }
 assert.equal(calls,0);assert.equal(describeProofFailure('x'.repeat(9000)).length,8192);
 const e=new Error('normal');assert.equal(describeProofFailure(e),e.stack);
});
for(const [index,value]of thrownValues.entries())test('falsy cleanup rejection '+index+' becomes primary only when no proof failure exists',async()=>{
 const report={status:'passed'},calls=[];let caught,rejected=false,saved;
 try{await runRunner(finalizeMaterialProof,describeProofFailure,report,()=>{},{close(){calls.push('browser');throw value;}},{close(){calls.push('app');}},[],()=>{calls.push('save');saved=structuredClone(report);},undefined);}catch(e){rejected=true;caught=e;}
 assert.equal(rejected,true);assert.ok(caught instanceof Error);assert.match(caught.message,/browser-close/);assert.deepEqual(calls,['browser','app','save']);assert.equal(saved.status,'failed');assert.equal(saved.cleanup.failed,1);assert.equal(saved.cleanup.errors[0].message,describeProofFailure(value));
});

// Execute the ENTIRE actual detail loop/inner finally inside the actual outer
// catch/finally. Browser and writer are inert; loop statements/assertions stay intact.
const innerStart=source.indexOf('   let bodyCompletedSuccessfully=false;');
const innerEnd=source.indexOf('\n   egress.check();assert.deepEqual(run.httpFailures',innerStart);
assert.ok(innerStart>0&&innerEnd>innerStart);
const innerBody=source.slice(innerStart,innerEnd);
const runInner=new AsyncFunction('page','egress','run','report','save','target','phase','quality','view','fs','resolve','out','hash','assert','console',innerBody);
async function innerFixture(options={}){
 const hasBodyError=Object.hasOwn(options,'bodyError'),calls=[],receipts=[],report={status:'passed'},run={frames:[]};let rejected=false,caught,restoreCalls=0;
 const restoreError=new Error('RESTORE_FAILURE');
 const policy=createProofEgress({localOrigin:'http://127.0.0.1:8123',dependency:{},readThree:()=>{throw Error('NO_READ');}});
 const raw={evaluate:async(_fn,args)=>{if(!args){restoreCalls++;calls.push('restore');if(options.restoreReject)throw restoreError;return;}calls.push('frame');return{jpeg:Buffer.alloc(21000).toString('base64'),effective:[],unrunnable:[],resources:{}};}};
 const page=policy.guardPage(raw);
 const egress={check:policy.check,assertCaptureReady(){if(hasBodyError){if(options.latchWithBody)policy.fail('REQUEST_FAILED','http://127.0.0.1:8123/cell','net::ERR_ABORTED');throw options.bodyError;}policy.check();}};
 const save=()=>{calls.push('save');if(run.frames.length===2&&options.latchBeforeRestore)policy.fail('REQUEST_FAILED','http://127.0.0.1:8123/cell','net::ERR_ABORTED');receipts.push(structuredClone(report));};
 const proof=()=>runInner(page,egress,run,report,save,'limestone','before','high',{id:'fixed'}, {writeFile:async()=>calls.push('write-frame')},(_out,name)=>name,'unused',()=> 'fake-pin',assert,{log(){}});
 const browser={close:async()=>{calls.push('browser-close');}},app={close:async()=>{calls.push('proxy-close');}};
 const traces=[{beginCleanup(){calls.push('trace-begin');},finish(){calls.push('trace-finish');}}];
 try{await runRunner(finalizeMaterialProof,describeProofFailure,report,proof,browser,app,traces,save,undefined);}catch(e){rejected=true;caught=e;}
 return{rejected,caught,restoreError,restoreCalls,calls,receipts,report,policy};
}
for(const [i,bodyError]of [new Error('ORIGINAL_PROOF_FAILURE'),undefined,null,0,false,''].entries())test('actual inner+outer failed body '+i+' skips rejecting restoration and preserves primary',async()=>{
 const f=await innerFixture({bodyError,restoreReject:true});assert.equal(f.rejected,true);assert.ok(Object.is(f.caught,bodyError));assert.equal(f.restoreCalls,0);assert.equal(f.calls.includes('frame'),false);assert.equal(f.report.status,'failed');assert.equal(f.report.failure,describeProofFailure(bodyError));
 assert.deepEqual(f.calls,['trace-begin','browser-close','proxy-close','trace-finish','save']);assert.equal(f.receipts.length,1);assert.equal(f.receipts[0].status,'failed');
});
test('actual happy detail body restores exactly once and outer teardown still completes',async()=>{
 const f=await innerFixture();assert.equal(f.rejected,false);assert.equal(f.restoreCalls,1);assert.equal(f.calls.filter(c=>c==='frame').length,2);assert.equal(f.calls.filter(c=>c==='write-frame').length,2);assert.equal(f.report.status,'passed');assert.ok(f.calls.indexOf('restore')<f.calls.indexOf('browser-close'));assert.equal(f.calls.at(-1),'save');
});
test('actual restoration-only error becomes primary and failed receipt is saved',async()=>{
 const f=await innerFixture({restoreReject:true});assert.equal(f.rejected,true);assert.equal(f.caught,f.restoreError);assert.equal(f.restoreCalls,1);assert.equal(f.report.status,'failed');assert.equal(f.report.failure,describeProofFailure(f.restoreError));assert.equal(f.receipts.at(-1).status,'failed');assert.equal(f.report.cleanup.complete,true);
});
test('actual fatal latched between completed body and restoration blocks dispatch',async()=>{
 const f=await innerFixture({latchBeforeRestore:true,restoreReject:true});assert.equal(f.rejected,true);assert.match(f.caught.message,/REQUEST_FAILED/);assert.equal(f.restoreCalls,0);assert.equal(f.calls.filter(c=>c==='frame').length,2);assert.equal(f.report.status,'failed');assert.equal(f.receipts.at(-1).status,'failed');assert.equal(f.calls.at(-1),'save');assert.equal(f.policy.report.firstCause.code,'REQUEST_FAILED');
});
test('body failure is not masked by a separately latched fatal guard',async()=>{
 const bodyError=Object.freeze(new Error('ORIGINAL_WITH_FATAL'));
 const f=await innerFixture({bodyError,latchWithBody:true,restoreReject:true});assert.equal(f.caught,bodyError);assert.equal(f.restoreCalls,0);assert.equal(f.policy.report.firstCause.code,'REQUEST_FAILED');assert.equal(f.receipts.at(-1).failure,describeProofFailure(bodyError));
});
