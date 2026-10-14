import test from 'node:test';import assert from 'node:assert/strict';
import {NotificationQueue,notificationPlacement} from '../src/ui/notification-queue.js';
import {raceNotificationsActive,notifications} from '../src/ui/notifications.js';
import {objectiveNotice} from '../src/ui/objective-notice.js';

const commit=(q,time,active=true)=>{const items=q.candidates(time,active);q.commitVisible(items.map(n=>n.id));return items;};
test('simultaneous sources share one prioritized banner and two prioritized toasts',()=>{
 const q=new NotificationQueue();for(const[id,slot,priority]of[['wrongway','banner',85],['missed','banner',100],['police','banner',70],['tow','toast',60],['fine','toast',80],['gearbox','toast',75],['tip','toast',5]])q.post({id,slot,priority,persistent:true},0);
 assert.deepEqual(commit(q,0).map(n=>n.id),['missed','fine','gearbox']);q.dismiss('missed');q.dismiss('fine');assert.deepEqual(commit(q,1).map(n=>n.id),['wrongway','gearbox','tow']);
});
test('duplicate bursts never multiply notices or restart their display lifetime',()=>{
 const q=new NotificationQueue();q.post({id:'gear',text:'MODE LOCKED',ms:1000},0);commit(q,0);
 for(let at=10;at<=1000;at+=10){q.post({id:'gear',text:'MODE LOCKED',ms:1000},at);commit(q,at);}
 assert.equal(q.items.size,0);q.post({id:'gear',text:'MODE LOCKED'},1001);assert.equal(q.items.size,0,'cooldown rejects the same repeated warning');
});
test('menus suppress all slots, pause remaining display time and drop stale queued warnings',()=>{
 const q=new NotificationQueue();q.post({id:'gear',ms:5000,staleAfter:20000},0);commit(q,0);assert.equal(commit(q,1000,false).length,0);commit(q,10000,false);assert.equal(commit(q,10001)[0].remaining,4000);
 q.post({id:'late-tip',priority:1,staleAfter:1000},10001);commit(q,12000,false);assert.ok(!q.items.has('late-tip'));assert.equal(q.visible.size,0);
});
test('persistent safety warnings survive preemption but disappear when their cause clears',()=>{
 const q=new NotificationQueue();q.post({id:'police',slot:'banner',persistent:true,priority:70},0);commit(q,0);q.post({id:'wrongway',slot:'banner',persistent:true,priority:85},1);commit(q,1000);q.dismiss('wrongway');assert.equal(commit(q,100000)[0].id,'police');q.dismiss('police');assert.deepEqual(commit(q,100001),[]);
});
test('bounded queue drops the lowest priority burst and reports shown notices only once',()=>{
 const q=new NotificationQueue({limit:4});let shown=0;for(let i=0;i<20;i++)q.post({id:String(i),priority:i,onShown:()=>shown++},0);
 assert.equal(q.items.size,4);commit(q,0);commit(q,10);assert.equal(shown,2);assert.deepEqual([...q.visible],['19','18']);
});
test('visibility policy rejects pause/settings/lobby/loading/customizer/modal contexts',()=>{
 const body={classList:{contains:k=>k==='racing'},dataset:{}},doc={body,getElementById:()=>null,querySelector:()=>null};assert.equal(raceNotificationsActive(doc),true);
 for(const state of['ui-open','menu']){body.classList.contains=k=>k==='racing'||k===state;assert.equal(raceNotificationsActive(doc),false);}body.classList.contains=k=>k==='racing';
 body.dataset.customizer='open';assert.equal(raceNotificationsActive(doc),false);delete body.dataset.customizer;
 doc.getElementById=id=>id==='multiplayer'?{hidden:false}:null;assert.equal(raceNotificationsActive(doc),false);doc.getElementById=()=>null;
 for(const state of['loading','modal']){doc.querySelector=()=>({state});assert.equal(raceNotificationsActive(doc),false);}
});
test('objective off-course warning uses the shared slot and clears without a separate banner',()=>{
 notifications.clear();const trips=[{pickup:{s:100,x:0,y:0,z:0,district:'ASTIR'},dropoff:{s:500,x:0,y:0,z:0}}],state={mode:'taxi',phase:'pickup',routeIndex:0,done:false};
 objectiveNotice(state,trips,{s:200});assert.equal(notifications.queue.items.get('objective-direction').slot,'banner');assert.match(notifications.queue.items.get('objective-direction').text,/ASTIR/);objectiveNotice(state,trips,{s:80});assert.equal(notifications.queue.items.has('objective-direction'),false);notifications.clear();
});
test('five viewport placements never overlap timer/minimap/dial/touch/route obstacles',()=>{
 for(const[width,height]of[[1280,720],[1920,1080],[2560,1440],[390,844],[844,390]]){
  const obstacles=[{left:12,right:width<500?210:290,top:12,bottom:90},{left:10,right:110,top:105,bottom:205},{left:width-200,right:width-10,top:height-350,bottom:height-150},{left:10,right:width-10,top:height-150,bottom:height-10}];
  const heights=[46,40,76],p=notificationPlacement({width,height,routeBottom:height<480?42:160,obstacles,heights});let y=p.top;
  for(const i of p.shown){const rect={left:p.left,right:p.left+p.width,top:y,bottom:y+heights[i]};assert.ok(rect.left>=0&&rect.right<=width&&rect.top>=0&&rect.bottom<=height);for(const b of obstacles)assert.ok(!(rect.left<b.right&&rect.right>b.left&&rect.top<b.bottom&&rect.bottom>b.top),`${width}x${height} overlap`);y=rect.bottom+6;}
  assert.ok(p.shown.length>0,`${width}x${height} has a safe lane`);
 }
});
