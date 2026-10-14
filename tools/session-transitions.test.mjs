import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SessionTransitions} from '../src/session-transitions.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('quit invalidates queued restart and recovery already awaiting a response',async()=>{
 const session=new SessionTransitions(),calls=[];
 let finishRecovery;
 const recovery=new Promise(resolve=>{finishRecovery=resolve;});
 session.after(0,async current=>{await recovery;if(current())calls.push('old recovery');});
 session.after(30,()=>calls.push('old restart'));
 await wait(5);
 session.cancel();
 session.after(0,()=>calls.push('new map'));
 finishRecovery();await wait(40);
 assert.deepEqual(calls,['new map']);assert.equal(session.timers.size,0);
});
