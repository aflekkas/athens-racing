import test from 'node:test';import assert from 'node:assert/strict';
import {NotificationQueue,notificationPlacement,projectedMirrorBounds} from '../src/ui/notification-queue.js';
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
test('visibility policy rejects pause/settings/lobby/loading/modal contexts',()=>{
 const body={classList:{contains:k=>k==='racing'},dataset:{}},doc={body,getElementById:()=>null,querySelector:()=>null};assert.equal(raceNotificationsActive(doc),true);
 for(const state of['ui-open','menu']){body.classList.contains=k=>k==='racing'||k===state;assert.equal(raceNotificationsActive(doc),false);}body.classList.contains=k=>k==='racing';
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
test('a renewed actionable warning replaces its old DOM node after dismissal',()=>{
 const oldDocument=globalThis.document;class Element{constructor(){this.dataset={};this.children=[];}setAttribute(){}append(...els){this.children.push(...els);}replaceChildren(...els){this.children=els;}get firstElementChild(){return this.children[0];}}
 globalThis.document={createElement:()=>new Element()};
 try{const manager=Object.create(notifications.constructor.prototype);manager.cards=new Map();const first=new Element(),second=new Element();const value={id:'tow',slot:'toast',signature:'same',node:first};const card=manager.card(value);assert.equal(card.firstElementChild,first);assert.equal(manager.card({...value,node:second}),card);assert.equal(card.firstElementChild,second,'renewed repair callback lives on the current node');}finally{globalThis.document=oldDocument;}
});

test('engine condition owns the recovery event, including a minimized tow offer; tow returns when damage clears',()=>{
 const q=new NotificationQueue();q.post({id:'tow',text:'Tow and repair',priority:60,persistent:true},0);q.post({id:'engine-condition',title:'ENGINE DISABLED',slot:'banner',priority:95,persistent:true},0);
 assert.deepEqual(commit(q,0).map(n=>n.id),['engine-condition']);assert.ok(q.items.has('tow'),'persistent fallback remains live');q.dismiss('engine-condition');assert.deepEqual(commit(q,1).map(n=>n.id),['tow']);
});
test('one route-direction warning wins across checkpoint, objective and wrong-way producers',()=>{
 const q=new NotificationQueue();for(const[id,priority]of[['objective-direction',82],['wrong-way',85],['checkpoint',100]])q.post({id,priority,slot:'banner',persistent:true},0);
 assert.deepEqual(commit(q,0).map(n=>n.id),['checkpoint']);q.dismiss('checkpoint');assert.deepEqual(commit(q,1).map(n=>n.id),['wrong-way']);
});
test('same copy from different producers merges visually without hiding unrelated notices',()=>{
 const q=new NotificationQueue();q.post({id:'input',title:'GAMEPAD CONNECTED',priority:40},0);q.post({id:'link',title:'GAMEPAD CONNECTED',priority:30},0);q.post({id:'music',title:'NOW PLAYING',priority:20},0);
 assert.deepEqual(commit(q,0).map(n=>n.id),['input','music']);
});
test('related police callouts preempt persistent status without duplicating it as a toast',()=>{
 const q=new NotificationQueue();q.post({id:'police-status',title:'POLICE PURSUIT',slot:'banner',priority:70,persistent:true},0);q.post({title:'BUSTED',priority:98},0);assert.deepEqual(commit(q,0).map(n=>n.title),['BUSTED']);
});
import {mirrorNoticeBounds} from '../src/ui/notification-queue.js';
test('mirror reservations and HUD obstacles stay clear at desktop, phone and landscape sizes in both views',()=>{
 for(const[width,height]of[[1280,800],[1920,1080],[390,844],[844,390]])for(const view of ['chase','cockpit']){
  const mirror=mirrorNoticeBounds(width,height,view),obstacles=[mirror,{left:8,right:110,top:110,bottom:220},{left:width-170,right:width-10,top:height-200,bottom:height-10}],heights=[90,42];
  const p=notificationPlacement({width,height,obstacles,heights});let y=p.top;for(const i of p.shown){const r={left:p.left,right:p.left+p.width,top:y,bottom:y+heights[i]};for(const b of obstacles)assert.ok(!(r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top),`${width}/${view}`);y=r.bottom+6;}assert.ok(p.shown.length);
 }
});
test('gamepad action requires explicit D-pad focus before confirm and routes the actual button click',()=>{
 const previous=globalThis.document;let clicks=0;const button={focus(){document.activeElement=this;},click(){clicks++;},blur(){document.activeElement=null;}},manager=Object.create(notifications.constructor.prototype);manager.active=true;manager.root={hidden:false,querySelectorAll:()=>[button]};globalThis.document={activeElement:null};
 try{assert.equal(manager.action('confirm',{gamepad:true}),false);assert.equal(clicks,0);assert.equal(manager.action('down',{gamepad:true}),true);assert.equal(manager.action('confirm',{gamepad:true}),true);assert.equal(clicks,1);manager.action('back',{gamepad:true});assert.equal(document.activeElement,null);}finally{globalThis.document=previous;}
});
test('merged cross-producer duplicates never return later or restart the original lifetime',()=>{
 const q=new NotificationQueue();q.post({id:'one',title:'CONTROLLER CONNECTED',ms:500},0);commit(q,0);assert.equal(q.post({id:'two',title:'CONTROLLER CONNECTED',ms:500},250),'one');assert.equal(q.items.size,1);commit(q,501);assert.equal(q.items.size,0);q.post({id:'three',title:'CONTROLLER CONNECTED'},502);assert.equal(q.items.size,0);
});
test('dismissing an alias clears its merged event, including its original visible card',()=>{
 const q=new NotificationQueue();q.post({id:'first',title:'CONNECTED',persistent:true},0);q.post({id:'second',title:'CONNECTED',persistent:true},0);commit(q,0);q.dismiss('second');assert.equal(q.items.size,0);assert.equal(q.visible.size,0);
});

test('manager dismissal resolves a merged producer alias',()=>{
 const manager=Object.create(notifications.constructor.prototype);manager.queue=new NotificationQueue();manager.update=()=>{};manager.queue.post({id:'first',title:'CONNECTED',persistent:true},0);manager.queue.post({id:'second',title:'CONNECTED',persistent:true},0);manager.dismiss('second');assert.equal(manager.queue.items.size,0);assert.equal(manager.dirty,true);
});

test('a higher-priority duplicate upgrades the visible action without extending its lifetime',()=>{
 const q=new NotificationQueue();q.post({id:'first',title:'TOW AVAILABLE',ms:1000},0);const signature=q.items.get('first').signature;const run=()=>{};q.post({id:'second',title:'TOW AVAILABLE',priority:90,tone:'bad',slot:'banner',actions:[{label:'Repair',run}]},200);const item=q.items.get('first');assert.equal(q.items.size,1);assert.equal(item.priority,90);assert.equal(item.slot,'banner');assert.equal(item.actions[0].run,run);assert.notEqual(item.signature,signature);assert.equal(item.remaining,1000);
});

test('phone disconnection and rejected shifts retain their actual severity',async()=>{
 const {noticeStyle}=await import('../src/ui/notice-style.js');assert.equal(noticeStyle({title:'GAMEPAD DISCONNECTED',tone:'warn'}).tone,'warn');assert.equal(noticeStyle({title:'GAMEPAD CONNECTED',tone:'good'}).tone,'good');assert.equal(noticeStyle({title:'SHIFT REJECTED',tone:'bad'}).tone,'bad');
});

test('safe placement finds room for the critical action before accepting a short low-priority gap',()=>{
 const p=notificationPlacement({width:1280,height:500,heights:[100,40],obstacles:[{left:400,right:880,top:150,bottom:220}]});assert.ok(p.shown.includes(0),'the engine repair action must not be displaced by a small informational toast');assert.ok(p.top>=228);
});

test('a higher-priority route banner cannot suppress the actionable recovery fallback',()=>{
 const q=new NotificationQueue();q.post({id:'tow',priority:60,persistent:true},0);q.post({id:'engine-condition',title:'ENGINE DISABLED',slot:'banner',priority:95,persistent:true},0);q.post({id:'checkpoint',title:'MISSED CHECKPOINT',slot:'banner',priority:100,persistent:true},0);assert.deepEqual(commit(q,0).map(n=>n.id),['checkpoint','tow']);q.dismiss('checkpoint');assert.deepEqual(commit(q,1).map(n=>n.id),['engine-condition']);
});

test('actual mirror projection reserves its glass and frame at different aspect ratios',async()=>{
 const {PerspectiveCamera,PlaneGeometry,Mesh,MeshBasicMaterial,Group}=await import('three');
 const camera=new PerspectiveCamera(90,2,.1,10);camera.updateMatrixWorld();
 const geometry=new PlaneGeometry(.4,.2),material=new MeshBasicMaterial(),mesh=new Mesh(geometry,material);mesh.position.set(0,.1,-1);
 const [r]=projectedMirrorBounds([{mesh}],camera,1000,500);
 for(const [key,value]of Object.entries({left:434,right:566,top:184,bottom:266}))assert.ok(Math.abs(r[key]-value)<.001,key);
 const parent=new Group();parent.add(mesh);parent.visible=false;assert.deepEqual(projectedMirrorBounds([{mesh}],camera,1000,500),[]);
 parent.visible=true;mesh.position.z=1;assert.deepEqual(projectedMirrorBounds([{mesh}],camera,1000,500),[]);
 mesh.position.set(2,.1,-1);const [edge]=projectedMirrorBounds([{mesh}],camera,1000,500);assert.equal(edge.right,1000);assert.ok(edge.left>900);
 geometry.dispose();material.dispose();
});
