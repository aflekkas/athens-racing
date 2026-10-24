// Proof-only teardown. Every owned cleanup is attempted independently.
// Does not clear first-cause trace state or issue proof/navigation commands.
// Never coerce an arbitrary thrown object or invoke its custom accessors.
const nativeErrorStackGetter=Object.getOwnPropertyDescriptor(new Error(),'stack')?.get;
export function describeProofFailure(value){
 const limit=8192;
 if(value===null)return 'null';
 if(typeof value==='string')return value.slice(0,limit);
 if(['undefined','boolean','number'].includes(typeof value))return String(value);
 if(typeof value==='bigint')return '[bigint thrown]';
 if(typeof value==='symbol')return '[symbol thrown]';
 try{for(const key of ['stack','message']){
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(descriptor&&typeof descriptor.value==='string')return descriptor.value.slice(0,limit);
  if(key==='stack'&&nativeErrorStackGetter&&descriptor?.get===nativeErrorStackGetter){
   try{const stack=nativeErrorStackGetter.call(value);if(typeof stack==='string')return stack.slice(0,limit);}catch{}
  }
 }}catch{}
 return '[unprintable thrown value]';
}
export async function finalizeMaterialProof({report,hasPrimary=false,primaryError,browser,app,traces=[],save,admission=()=>null,timerClose=()=>null,recordPrimary=()=>{},getPrimary=()=>null}){
 const cleanup={attempts:0,failed:0,errors:[],droppedErrors:0,receiptWriteAttempted:false,complete:false};
 report.cleanup=cleanup;
 const syncAdmission=()=>{const state=admission();if(!hasPrimary&&state?.hasPrimary){hasPrimary=true;primaryError=state.primaryError;}if(hasPrimary)report.status='failed';};
 syncAdmission();
 const detail=error=>describeProofFailure(error).slice(0,512);
 const failed=(phase,error,receipt=false)=>{
  const existing=admission()||getPrimary();if(!hasPrimary&&existing?.hasPrimary){hasPrimary=true;primaryError=existing.primaryError;}
  cleanup.failed++;report.status='failed';
  const entry={phase,message:detail(error)};
  if(receipt)cleanup.receiptWriteError=entry;
  else if(cleanup.errors.length<8)cleanup.errors.push(entry);else cleanup.droppedErrors++;
  if(!hasPrimary){hasPrimary=true;primaryError=new Error('Material proof cleanup failed: '+phase);report.failure=describeProofFailure(primaryError);recordPrimary(primaryError);}
 };
 const attempt=async(phase,action)=>{cleanup.attempts++;try{await action();return true;}catch(error){failed(phase,error);return false;}};
 for(const trace of traces)await attempt('trace-begin',()=>trace.beginCleanup('outer-finally'));
 const browserAttempt=attempt('browser-close',()=>browser?.close());
 const proxyAttempt=attempt('proxy-close',()=>app?.close());
 const timerAttempt=attempt('deadline-browser-close',async()=>{const outcome=await timerClose();if(outcome?.hasPreparationError)failed('deadline-trace-begin',outcome.preparationError);if(outcome&&!outcome.ok)throw outcome.error;});
 const browserClosed=await browserAttempt,proxyClosed=await proxyAttempt;await timerAttempt;
 for(const trace of traces)await attempt('trace-finish',()=>trace.finish(browserClosed&&proxyClosed?'owned-browser-and-proxy-closed':'owned-cleanup-uncertain'));
 syncAdmission();
 cleanup.complete=cleanup.failed===0;
 cleanup.receiptWriteAttempted=true;
 const receipt=async()=>{try{await save({cleanup:true});}catch(error){failed('receipt-write',error,true);cleanup.complete=false;}};
 const admittedStatus=report.status;await receipt();syncAdmission();
 // A write may finish past the original deadline. Never accept its stale PASS.
 if(admittedStatus!=='failed'&&report.status==='failed'&&!cleanup.receiptWriteError)await receipt();
 syncAdmission();
 if(hasPrimary)throw primaryError;
}
