import test from 'node:test';
import assert from 'node:assert/strict';
import { WheelRoom, PAIR_TTL, SESSION_TTL, wheelCode, validWheelCode } from './phone-wheel.mjs';
import { encodeWheel, decodeWheel, WheelInput, WHEEL_BYTES, neutralWheel } from '../src/phone-wheel-packet.js';
import { WheelMotion, requestWheelMotion } from '../src/phone-wheel-motion.js';
import { Input } from '../src/input.js';
import { WheelLink } from '../src/phone-wheel-link.js';
const socket = () => ({readyState:1,bufferedAmount:0,messages:[],send(v){this.messages.push(v);},close(){this.readyState=3;}});
test('codes, game capability, single phone, expiry and unpair',()=>{
  assert.ok(validWheelCode(wheelCode())); assert.equal(validWheelCode('../hack'),false);
  let now=100; const room=new WheelRoom({now:()=>now}), data=room.create(), game=socket(), phone=socket();
  assert.equal(room.create(),null); assert.equal(room.join(game,'game','wrong'),false);
  assert.equal(room.join(phone,'phone'),false); assert.ok(room.join(game,'game',data.token));
  assert.equal(room.join(socket(),'game',data.token),false); assert.ok(room.join(phone,'phone'));
  assert.equal(room.data.expires,100+SESSION_TTL); assert.equal(room.join(socket(),'phone'),false);
  const packet=encodeWheel({steer:.5,throttle:1},4); room.message(phone,packet); assert.equal(game.messages.at(-1),packet);
  room.message(game,packet); assert.notEqual(phone.messages.at(-1),packet);
  room.message(phone,JSON.stringify({type:'signal',data:{candidate:'test'}})); assert.match(game.messages.at(-1),/candidate/);
  room.message(phone,JSON.stringify({type:'unpair'})); assert.equal(game.readyState,3); assert.equal(phone.readyState,3);
  const expires=new WheelRoom({now:()=>now}), d=expires.create(); now+=PAIR_TTL;
  assert.equal(expires.join(socket(),'game',d.token),false);
});
test('rooms enforce session expiry and bounded relay traffic',()=>{
  let now=0;const room=new WheelRoom({now:()=>now}), d=room.create(), game=socket(), phone=socket();room.join(game,'game',d.token);room.join(phone,'phone');
  room.message(phone,new ArrayBuffer(1024));assert.equal(game.messages.length,1);
  for(let i=0;i<181;i++)room.message(phone,encodeWheel({},i));assert.equal(game.readyState,3);
  const expired=new WheelRoom({now:()=>now}), e=expired.create(), g=socket(),p=socket();expired.join(g,'game',e.token);expired.join(p,'phone');now=SESSION_TTL;expired.message(p,encodeWheel({},1));assert.equal(g.readyState,3);
});
test('binary codec clamps nonfinite axes, preserves flags and handles sequence wrap/reordering',()=>{
  const packet=encodeWheel({steer:-.5,throttle:Infinity,brake:1,pause:true},65535);assert.equal(packet.byteLength,WHEEL_BYTES);
  const value=decodeWheel(packet);assert.ok(Math.abs(value.steer+.5)<.0001);assert.equal(value.throttle,0);assert.equal(value.brake,1);assert.equal(value.pause,true);
  assert.equal(decodeWheel(new ArrayBuffer(2)),null);const corrupt=packet.slice(0);new Uint8Array(corrupt)[0]=2;assert.equal(decodeWheel(corrupt),null);
  const input=new WheelInput();assert.ok(input.receive(packet));assert.ok(input.receive(encodeWheel({},0)));assert.equal(input.receive(packet),false);assert.equal(input.receive(encodeWheel({},0)),false);
});
test('last input held for <200ms then all controls release, including buttons',()=>{
  let now=0;const input=new WheelInput(()=>now);input.receive(encodeWheel({steer:1,throttle:1,brake:1,handbrake:true,pause:true},1));
  now=199;assert.equal(input.sample().throttle,1);now=200;assert.deepEqual(input.sample(),neutralWheel());
  now=201;assert.ok(input.receive(encodeWheel({steer:-1},2)));assert.equal(input.sample().steer,-1);input.reset();assert.deepEqual(input.sample(),neutralWheel());
});
test('phone, keyboard and gamepad use most recently changed source without heartbeat stealing',()=>{
  let now=0,pads=[];const target=new EventTarget(),input=new Input({target,navigator:{getGamepads:()=>pads},document:null}); input.phoneWheel=new WheelInput(()=>now);input.update(1/60);
  input.phoneWheel.receive(encodeWheel({steer:.5,throttle:.8},1));input.update(1/60);assert.ok(input.state.steer>.49);
  const e=new Event('keydown');Object.assign(e,{code:'KeyA',repeat:false});target.dispatchEvent(e);input.update(.2);assert.equal(input.state.steer,-1);
  input.phoneWheel.receive(encodeWheel({steer:.5,throttle:.8},2));input.update(.2);assert.equal(input.state.steer,-1);
  input.phoneWheel.receive(encodeWheel({steer:.7,throttle:.8},3));input.update(.2);assert.ok(input.state.steer>.69);
  pads=[{id:'pad',index:0,axes:[-1,0,0,0],buttons:[]}];input.update(.2);assert.equal(input.state.steer,-1);
  input.phoneWheel.receive(encodeWheel({steer:1,throttle:1},4));input.update(.2);assert.equal(input.state.steer,1);
  now=200;input.update(.2);assert.equal(input.state.steer,0);assert.equal(input.state.throttle,0);
  input.phoneWheel.receive(encodeWheel({steer:1,throttle:1,pause:true},5));input.phoneButton('pause',true);input.update(.2,{inMenu:true});assert.equal(input.state.throttle,0);assert.equal(input.state.pause,true);input.update(.2,{inMenu:true});assert.equal(input.state.pause,false);input.destroy();
});
test('iOS permission awaits user approval and denial/error can retry',async()=>{
  let calls=0;await requestWheelMotion({DeviceOrientationEvent:{requestPermission:async()=>{calls++;return 'granted';}}});assert.equal(calls,1);
  await assert.rejects(requestWheelMotion({DeviceOrientationEvent:{requestPermission:async()=> 'denied'}}),/permission denied/);
  await assert.rejects(requestWheelMotion({DeviceOrientationEvent:{requestPermission:async()=>{throw Error('gesture');}}}),/gesture/);
  await assert.rejects(requestWheelMotion({}),/unavailable/);await requestWheelMotion({DeviceOrientationEvent:class{}});
});
test('landscape motion calibrates, unwraps, filters and supports both rotations',()=>{
  const motion=new WheelMotion();assert.equal(motion.update({beta:0,gamma:-80},90,0),0);motion.calibrate();
  for(let i=1;i<=20;i++) motion.update({beta:45,gamma:-80},90,i*16);assert.ok(motion.filtered>.45&&motion.filtered<.6);
  motion.calibrate();assert.equal(motion.filtered,0);motion.update({beta:45,gamma:-80},90,400);assert.equal(motion.filtered,0);
  const other=new WheelMotion();other.update({beta:0,gamma:80},270,0);for(let i=1;i<20;i++)other.update({beta:-45,gamma:80},270,i*16);assert.ok(other.filtered>.45);
});
test('WebRTC unavailable falls back to binary WebSocket and measures RTT',async()=>{
  class WS {constructor(){this.readyState=1;this.bufferedAmount=0;this.sent=[];}send(v){this.sent.push(v);}close(){}}
  const link=new WheelLink({code:'ABCD2345',role:'phone',WebSocket:WS,RTCPeerConnection:null,base:'http://localhost'});
  try {await link.message('{"type":"paired"}');const packet=encodeWheel({throttle:1},1);link.send(packet);assert.equal(link.ws.sent.at(-1),packet);link.pendingPings.set(10,performance.now()-3);link.data({pong:10});assert.ok(link.latency>=3);assert.equal(link.state,'Connected');}finally{link.close();}
});
test('keyboard and gamepad last-active selection is independent of held opposite inputs',()=>{
  const target=new EventTarget(),pad={id:'pad',index:0,axes:[1,0,0,0],buttons:[]},input=new Input({target,navigator:{getGamepads:()=>[pad]},document:null});
  const key=(type,code)=>{const e=new Event(type);Object.assign(e,{code,repeat:false});target.dispatchEvent(e);};
  input.update(.2);assert.equal(input.state.steer,1);key('keydown','KeyA');input.update(.2);assert.equal(input.state.steer,-1);
  pad.axes[0]=.7;input.update(.2);assert.ok(input.state.steer>.6);key('keyup','KeyA');input.update(.2);assert.equal(input.state.steer,0);input.destroy();
});
test('phone receives impact feedback, one pulse per shift and a bounded limiter cadence',async()=>{
  const input=new Input({target:new EventTarget(),navigator:{},document:null}),pulses=[];input.phoneWheelFeedback=ms=>pulses.push(ms);
  const v={limiter:false,gearChangeEvent:{serial:0}};input.observePhoneWheel(v,0);v.gearChangeEvent.serial=1;input.observePhoneWheel(v,10);input.observePhoneWheel(v,20);assert.deepEqual(pulses,[40]);
  v.limiter=true;input.observePhoneWheel(v,30);input.observePhoneWheel(v,40);input.observePhoneWheel(v,280);assert.deepEqual(pulses,[40,25,25]);
  await input.rumble(.5,.8,110);assert.equal(pulses.at(-1),110);input.destroy();
});

test('gravity roll keeps clockwise steering positive in portrait and on a natural-landscape tablet',()=>{
  for(const angle of [0,90,180,270]) {
    const m=new WheelMotion();m.fullLock=60;m.update({beta:90,gamma:0},angle,0);
    for(let i=1;i<20;i++)m.update({beta:30,gamma:90},angle,i*16);
    assert.ok(m.filtered>.97,'clockwise 60 degree roll');
    assert.equal(m.update({beta:0,gamma:0},angle,400),0,'flat phone centres steering');
  }
});
