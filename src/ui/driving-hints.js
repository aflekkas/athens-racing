import { notifications } from './notifications.js';
// Binding-aware race-start strip and progressive tips. Dismissals/actions persist independently per tip.
import { input } from '../input.js';
import { bindingLabel } from '../input-labels.js';
import * as C from './components.js';
import { driverName } from '../driver-name.js';
import { TipSchedule } from './tip-schedule.js';
C.setHintBindings(() => input.bindings);
const KEY='paraliaki.drivingTips.v2';
let profiles={};try{profiles=JSON.parse(localStorage.getItem(KEY)||'{}');}catch{}
if(!profiles||typeof profiles!=='object'||Array.isArray(profiles))profiles={};
if(!profiles.guest){try{profiles.guest=JSON.parse(localStorage.getItem('paraliaki.drivingTips.v1')||'{}');}catch{}}
let profileId,saved={},schedule;
const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(profiles));}catch{}};
function profile(now){const id=driverName.get();if(id===profileId)return;profileId=id;const value=profiles[id];saved=value&&typeof value==='object'&&!Array.isArray(value)?value:{};profiles[id]=saved;schedule=new TipSchedule(saved);schedule.startRace(now);drivingHints.saved=saved;drivingHints.tipId=null;drivingHints.until=0;}
const bound=label=>label!=='UNBOUND';
// One row per control: its current binding(s) and what it does. Up/down shifting shares a row (keys in label order).
function controlRows({ device='keyboard', manual=false }={}) {
  const rows=[[['transmission'],'MANUAL / AUTO'],[['shiftUp','shiftDown'],manual?'SHIFT UP / DOWN':'PADDLE UP / DOWN'],[['handbrake'],'HANDBRAKE'],[['tractionControl'],'TC / ESC'],[['camera'],'POV / OUTSIDE'],[['cameraPosition'],'VIEW POSITION'],[['lookBack'],'LOOK BACK'],[['tow'],'TOW'],[['map'],'BIG MAP']];
  // An action with no binding on this device has no row (the kit's key hints omit them too): the controller's TOW and BIG MAP
  // are unbound by default (controller towing is the tow prompt's D-pad down, A) and appear once bound in Settings > Controls.
  return rows.map(([acts,label])=>({keys:acts.map(a=>bindingLabel(input.bindings,a,device)),label})).filter(({keys})=>keys.some(bound));
}
export function controlsStrip({ device='keyboard', car, manual=false }={}) {
  const pad=device==='gamepad',row=(keys,label)=>`<span><span class="driving-controls__keys">${keys}</span><b>${label}</b></span>`;
  // the mouse look row: Lucide's mouse in a key cap (a bare "RIGHT MOUSE" cap turned RIGHT into an arrow icon)
  return `<div class="driving-controls" aria-hidden="true">${controlRows({device,manual}).map(({keys,label})=>row(keys.map(k=>C.kbd(C.esc(k),pad)).join(''),label)).join('')}${pad?'':row(C.kbd(C.icon('mouse')),'HOLD TO LOOK')}</div>`;
}
// The same list as one readable sentence: the race notice's screen-reader line (the strip itself is decorative).
export function controlsText({ device='keyboard', manual=false }={}) {
  return [...controlRows({device,manual}).map(({keys,label})=>`${keys.join(' / ')}: ${label}`),...(device==='gamepad'?[]:['MOUSE BUTTON: HOLD TO LOOK'])].join('. ')+'.';
}
export const drivingHints={
  saved,lastState:null,
  seen(id){if(!id)return;if(!saved[id]){saved[id]=true;persist();}notifications.dismiss('tip:'+id);},
  toggle(){saved.strip=saved.strip===false;persist();if(saved.strip===false)for(const id of notifications.queue.items.keys())if(id.startsWith('tip:'))notifications.dismiss(id);return saved.strip!==false;},
  get enabled(){return saved.strip!==false;},
  action(name){this.seen(({transmission:'manual',shiftUp:'shifting',shiftDown:'shifting',camera:'camera',cameraPosition:'cameraPosition',lookBack:'lookBack',tow:'tow',handbrake:'handbrake'})[name]);},
  update(state){
    const now=Date.now();profile(now);const racing=state.state==='race',visible=racing&&!state.blocked;
    if(racing&&!['race','pause','paused'].includes(this.lastState))schedule.startRace(now);this.lastState=state.state;
    if(!visible||!this.enabled||!schedule.available(now))return;
    if(schedule.show('controls',now)){persist();notifications.post({id:'tip:controls',title:'DRIVING CONTROLS',text:controlsText(state),body:controlsStrip(state),priority:5,ms:6000,staleAfter:8000,actions:[{label:'HIDE TIPS',run:()=>this.toggle()}]});return;}
    const key=a=>bindingLabel(input.bindings,a,state.device);
    // [id, text, actions it names]: a tip whose actions are all unbound on this device is skipped (never "UNBOUND returns you…").
    const tips=[['manual',`${key('transmission')} switches between MANUAL and AUTO.`,['transmission']],...(state.manual?[['shifting',`MANUAL GEARS: ${key('shiftUp')} up / ${key('shiftDown')} down. Watch the rev bar.`,['shiftUp','shiftDown']]]:[]),['handbrake',`${key('handbrake')} is the handbrake. Release it to recover grip.`,['handbrake']],['camera',`${key('camera')} toggles POV and outside.`,['camera']],['cameraPosition',`${key('cameraPosition')} cycles the view position.`,['cameraPosition']],['tow',`${key('tow')} returns you to the road.`,['tow']],['lookBack',`Hold ${key('lookBack')} to look behind you.`,['lookBack']],...(state.device==='keyboard'?[['mouseLook','Hold the left or right mouse button and drag to look around. Mouse free look is in Settings > Camera.',[]]]:[])];
    const next=tips.find(([id,,acts])=>!saved[id]&&(!acts.length||acts.some(a=>bound(key(a)))));if(!next||!schedule.show(next[0],now))return;persist();this.tipId=next[0];notifications.post({id:'tip:'+next[0],text:next[1],priority:5,ms:9000,staleAfter:10000,actions:[{label:'GOT IT',run:()=>this.seen(next[0])}]});
  },
};
