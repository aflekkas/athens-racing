import test from 'node:test';
import assert from 'node:assert/strict';
import { account } from '../src/account.js';
import { friends } from '../src/friends.js';
import { createAddFriendButton } from '../src/ui/friend-actions.js';

test('opponent ADD posts the public username once, and request errors allow retry',async()=>{
 const oldDoc=globalThis.document,oldRequest=friends.request;globalThis.document={createElement:()=>({dataset:{},setAttribute(){},disabled:false})};
 const profile=account.cached();account.adopt({guest:false,username:'NIKOS'});friends.adopt({type:'friends',friends:[],outgoing:[],incoming:[]});
 try{
  assert.equal(createAddFriendButton('NIKOS'),null);assert.equal(createAddFriendButton(''),null);
  let finish,requests=[];friends.request=username=>{requests.push(username);return new Promise(resolve=>finish=resolve);};const reports=[];const button=createAddFriendButton('eleni',message=>reports.push(message));
  const pending=button.onclick();await button.onclick();assert.deepEqual(requests,['ELENI']);assert.equal(button.disabled,true);finish({ok:true});await pending;assert.equal(button.textContent,'REQUEST SENT');assert.match(reports[0],/ELENI/);
  friends.request=async()=>{throw new Error('Driver not found.');};const retry=createAddFriendButton('MARIA',message=>reports.push(message));await retry.onclick();assert.equal(retry.disabled,false);assert.equal(retry.textContent,'ADD');assert.equal(reports.at(-1),'Driver not found.');
  account.adopt({guest:true});assert.equal(createAddFriendButton('ELENI'),null);
 }finally{globalThis.document=oldDoc;friends.request=oldRequest;account.adopt(profile||{guest:true});}
});
