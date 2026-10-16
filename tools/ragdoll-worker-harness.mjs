import { Worker } from 'node:worker_threads';
export function nodeWorker() {
  const worker = new Worker(new URL('./ragdoll-node-worker.mjs', import.meta.url));
  const adapter = { postMessage: (m,t)=>worker.postMessage(m,t), terminate: ()=>worker.terminate(), onmessage: null, onerror: null };
  worker.on('message',data=>adapter.onmessage?.({data}));worker.on('error',error=>adapter.onerror?.(error));return adapter;
}
export function waitForIdle(client) {
  if (!client.jobs.size) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{client.fallback();reject(new Error('Ragdoll worker timed out'));},5000);
    const original=client.receive;
    client.receive=function(m){original.call(this,m);if(!this.jobs.size){this.receive=original;clearTimeout(timer);resolve();}};
  });
}
