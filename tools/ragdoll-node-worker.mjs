import { parentPort } from 'node:worker_threads';
import { batchRagdollWorker } from '../src/ragdoll-worker.js';
parentPort.on('message', batchRagdollWorker((m,t)=>parentPort.postMessage(m,t)));
