import {unpackFleetTemplate} from './fleet-template-codec.js';
import {seedFleetTemplate} from './traffic-fleet.js';

export async function prewarmFleet(build,{ready=()=>true,disposed=()=>false,signal,metrics={maxStepMs:0},createWorker=()=>new Worker(new URL('./traffic-fleet-worker.js',import.meta.url),{type:'module'})}={}){
 if(signal?.aborted)throw Error('Fleet preparation cancelled');
 const worker=createWorker(),pending=new Map(),prepared=new Set();let id=0,failure=null;
 const cancel=()=>{worker.terminate();for(const p of pending.values())p.reject(Error('Fleet preparation cancelled'));pending.clear();};signal?.addEventListener('abort',cancel,{once:true});
 worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.templates);};
 worker.onerror=error=>{failure=Error(error.message||'Fleet worker initialization failed');for(const p of pending.values())p.reject(failure);pending.clear();};
 const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
 const wait=async()=>{await frame();while(!ready()&&!disposed()&&!signal?.aborted)await frame();if(disposed()||signal?.aborted)throw Error('Fleet preparation cancelled');};
 try{
  let step,lastStage='pool';
  for(;;){
   await wait();if(failure)throw failure;const at=performance.now();step=build.next();const ms=performance.now()-at;metrics.steps??={};metrics.steps[lastStage]=Math.max(metrics.steps[lastStage]||0,ms);metrics.maxStepMs=Math.max(metrics.maxStepMs,ms);lastStage=step.value?.type?.id||step.value?.stage||'pool';if(step.done)return;
   const type=step.value?.type;if(!type||prepared.has(type.id))continue;
   const templates=await new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});worker.postMessage({id:n,type:type.id});});
   for(const packet of templates){const unpack=unpackFleetTemplate(packet);let result;
    do{await wait();const start=performance.now();do{result=unpack.next();}while(!result.done&&performance.now()-start<.75);const ms=performance.now()-start;metrics.restoreMaxMs=Math.max(metrics.restoreMaxMs||0,ms);metrics.maxStepMs=Math.max(metrics.maxStepMs,ms);}while(!result.done);
    seedFleetTemplate(result.value.key,result.value.car,result.value.cabin);
   }
   prepared.add(type.id);
  }
 }finally{signal?.removeEventListener('abort',cancel);worker.terminate();}
}
