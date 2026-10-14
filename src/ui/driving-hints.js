import { notifications, notificationText } from './notifications.js';
// Binding-aware race-start strip and progressive tips. Dismissals/actions persist independently per tip.
import { input } from '../input.js';
import { bindingLabel } from '../input-labels.js';
import * as C from './components.js';
import { account } from '../account.js';
import { TipSchedule } from './tip-schedule.js';
C.setHintBindings(() => input.bindings);
const KEY='paraliaki.drivingTips.v2';
let profiles={};try{profiles=JSON.parse(localStorage.getItem(KEY)||'{}');}catch{}
if(!profiles||typeof profiles!=='object'||Array.isArray(profiles))profiles={};
if(!profiles.guest){try{profiles.guest=JSON.parse(localStorage.getItem('paraliaki.drivingTips.v1')||'{}');}catch{}}
let profileId,saved={},schedule;
const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(profiles));}catch{}};
function profile(now){const id=account.cached()?.username||'guest';if(id===profileId)return;profileId=id;const value=profiles[id];saved=value&&typeof value==='object'&&!Array.isArray(value)?value:{};profiles[id]=saved;schedule=new TipSchedule(saved);schedule.startRace(now);drivingHints.saved=saved;drivingHints.tipId=null;drivingHints.until=0;}
export function controlsStrip({ device='keyboard', car, manual=false }={}) {
  const labels=[['handbrake','HANDBRAKE'],['tractionControl','TC / ESC'],['camera','CAMERA'],['tow','TOW']];
  labels.unshift(['shiftUp',manual?'SHIFT UP':'PADDLE UP'],['shiftDown',manual?'SHIFT DOWN':'PADDLE DOWN']);
  labels.unshift(['transmission','MANUAL / AUTO']);
  return `<div class="driving-controls">${labels.map(([act,label])=>`<span>${C.kbd(C.esc(bindingLabel(input.bindings,act,device)),device==='gamepad')}<b>${label}</b></span>`).join('')}${device==='keyboard'?'<span>'+C.kbd('MOUSE')+'<b>LOOK · CLICK ROAD TO CAPTURE</b></span>':''}</div>`;
}
export const drivingHints={
  saved,lastState:null,
  seen(id){if(!id)return;if(!saved[id]){saved[id]=true;persist();}notifications.dismiss('tip:'+id);},
  toggle(){saved.strip=saved.strip===false;persist();if(saved.strip===false)for(const id of notifications.queue.items.keys())if(id.startsWith('tip:'))notifications.dismiss(id);return saved.strip!==false;},
  get enabled(){return saved.strip!==false;},
  action(name){this.seen(({transmission:'manual',shiftUp:'shifting',shiftDown:'shifting',camera:'camera',tow:'tow',handbrake:'handbrake'})[name]);},
  update(state){
    const now=Date.now();profile(now);const racing=state.state==='race',visible=racing&&!state.blocked;
    if(racing&&!['race','pause','paused'].includes(this.lastState))schedule.startRace(now);this.lastState=state.state;
    if(!visible||!this.enabled||!schedule.available(now))return;
    if(schedule.show('controls',now)){persist();notifications.post({id:'tip:controls',title:'DRIVING CONTROLS',text:notificationText(controlsStrip(state)),priority:5,ms:6000,staleAfter:8000,actions:[{label:'HIDE TIPS',run:()=>this.toggle()}]});return;}
    const key=a=>bindingLabel(input.bindings,a,state.device);
    const tips=[['manual',`${key('transmission')} switches between MANUAL and AUTO.`],...(state.manual?[['shifting',`MANUAL GEARS: ${key('shiftUp')} up / ${key('shiftDown')} down. Watch the rev bar.`]]:[]),['handbrake',`${key('handbrake')} is the handbrake. Release it to recover grip.`],['camera',`${key('camera')} changes the camera.`],['tow',`${key('tow')} returns you to the road.`],...(state.device==='keyboard'?[['mouseLook','Click the road to capture the mouse and look around. Esc releases it.']]:[])];
    const next=tips.find(([id])=>!saved[id]);if(!next||!schedule.show(next[0],now))return;persist();this.tipId=next[0];notifications.post({id:'tip:'+next[0],text:next[1],priority:5,ms:9000,staleAfter:10000,actions:[{label:'GOT IT',run:()=>this.seen(next[0])}]});
  },
};
