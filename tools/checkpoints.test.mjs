import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCourse, observeCourse } from '../src/checkpoints.js';
import { EventRun } from '../src/events.js';
const geometry={step:20,x:[0,20,40,60,80,100,120,140,160,180,200],z:Array(11).fill(0),y:Array(11).fill(0),lanes:Array(11).fill(1),div:Array(11).fill(0)};
const event={s0:0,s1:200,dir:1,checkpoints:[{s:100,d:100}]};
const pose=(s,u=0)=>({s,u,x:s,z:u,y:0,t:s/20});
test('gates reject land, forged progress and teleport but allow go-back, reverse and multiple laps',()=>{
 const c=buildCourse(event,geometry);observeCourse(c,pose(60),2);observeCourse(c,pose(60,40),3);assert.equal(observeCourse(c,pose(110,40),6).missed,true);assert.equal(c.passed,0);observeCourse(c,pose(60),9);assert.equal(observeCourse(c,pose(110),12).passed,2);
 const reverse=buildCourse({...event,s0:200,s1:0,dir:-1},geometry);for(const s of [150,110,70,30,0])observeCourse(reverse,pose(s),20-s/20);assert.equal(reverse.passed,reverse.gates.length);
 const closed={...geometry,closed:true,x:[0,20,40,20,0],z:[0,0,20,20,0],y:[0,0,0,0,0]};const laps=buildCourse({s0:0,s1:160,dir:1},closed);assert.equal(laps.gates.at(-1).s,160);assert.equal(laps.gates.at(-1).x,0);
 const forged=buildCourse(event,geometry);assert.equal(observeCourse(forged,{...pose(85),x:0},5).passed,0);const jump=buildCourse(event,geometry);assert.equal(observeCourse(jump,pose(200),.1).passed,0);
});
test('solo run cannot award skipped split/finish; warning hook identifies the missing gate',()=>{
 const route={start:0,finish:200,length:200,frame(s,out){return Object.assign(out,{x:s,y:0,z:0,tx:1,tz:0})},edge(){return 4}};
 const run=new EventRun({id:'test',type:'sprint',from:'start',to:'finish'}, {route,marks:[{id:'mid',name:'Mid',s:100}]},{storage:{getItem(){return null}}});run.start();run.update(2,{...pose(60),t:2});run.update(3,{...pose(60,40),t:3});const warnings=run.update(3,{...pose(110,40),t:6});assert.ok(warnings.some(e=>e.kind==='checkpoint'&&e.missed));assert.equal(run.cpIdx,0);assert.equal(run.update(3,{...pose(200),t:9}).some(e=>e.kind==='finish'),false);for(const [i,s]of [60,90,170].entries())run.update(3,{...pose(s),t:12+i*3});assert.ok(run.update(3,{...pose(200),t:21}).some(e=>e.kind==='finish'));
});

test('another carriageway plane cannot warn before the legal gate; real misses still require going back', () => {
  for (const dir of [1, -1]) {
    const c = buildCourse({ s0: dir === 1 ? 0 : 160, s1: 80, dir }, geometry);
    const gate = c.gates[0];
    gate.halfWidth = 2;
    gate.lanes = [{ ...gate }, { x: 80, y: 0, z: -dir * 4, tx: Math.SQRT1_2, tz: Math.SQRT1_2, halfWidth: 2 }];
    observeCourse(c, pose(80 - dir * 5), 2);
    const before = observeCourse(c, pose(80 - dir * 2), 3);
    assert.equal(before.missed, false, 'crossed only the other carriageway plane, outside its width');
    assert.equal(before.passed, 0, 'the legal gate is still ahead');
    assert.equal(observeCourse(c, pose(80 + dir), 4).passed, 1);

    const cut = buildCourse({ s0: dir === 1 ? 0 : 160, s1: 80, dir }, geometry);
    observeCourse(cut, pose(80 - dir * 5), 1);
    observeCourse(cut, pose(80 - dir * 5, 40), 2);
    assert.equal(observeCourse(cut, pose(80 + dir * 5, 40), 3).passed, 0);
    assert.equal(observeCourse(cut, pose(80 + dir * 6, 40), 4).missed, true);
    assert.equal(cut.passed, 0, 'deferring a warning must never award a bypassed gate');
    observeCourse(cut, pose(80 - dir * 5), 5);
    const recovered = observeCourse(cut, pose(80 + dir), 6);
    assert.equal(recovered.missed, false);
    assert.equal(recovered.passed, 1);
  }
});
