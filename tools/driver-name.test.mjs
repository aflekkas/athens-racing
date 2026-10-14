import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDriverName} from '../src/driver-name.js';
test('driver names accept all valid lengths and reject invalid or staff names',()=>{
 for(let n=3;n<=16;n++)assert.equal(normalizeDriverName('w'.repeat(n)),'W'.repeat(n));
 assert.equal(normalizeDriverName(' a-wwwwwwwwwwww-z '),'A-WWWWWWWWWWWW-Z');
 for(const value of ['AB','W'.repeat(17),'BAD NAME','A_B','ΚΩΣΤΑΣ','<svg>','ADMIN','0FFICIAL','SH1T'])assert.throws(()=>normalizeDriverName(value));
});
test('local identity defaults, persists, emits plate changes and needs no unique name or secret',async t=>{
 const data=new Map([['asr.device.v1','legacy'],['asr.account-intro.v1','legacy']]);
 globalThis.localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};t.after(()=>delete globalThis.localStorage);
 const {driverName:a}=await import('../src/driver-name.js?profile-a');
 assert.match(a.get(),/^GR-\d{4}$/);assert.equal(data.get('paraliaki.driver'),a.get());assert(!data.has('asr.device.v1'));
 const changed=[];const stop=a.onChange(n=>changed.push(n));a.set('abc');assert.equal(a.plate(),'ABC');assert.deepEqual(changed,['ABC']);a.set('ABC');assert.equal(changed.length,1);stop();
 const {driverName:b}=await import('../src/driver-name.js?profile-b');assert.equal(b.get(),'ABC');assert.equal(b.set('ABC'),'ABC');
 a.set('A-WWWWWWWWWWWW-Z');assert.equal(a.plate().length,16);assert.throws(()=>a.set('bad name'));assert.equal(a.get(),'A-WWWWWWWWWWWW-Z');
});
