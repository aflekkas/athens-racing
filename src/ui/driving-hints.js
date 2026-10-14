// Binding-aware race-start strip and progressive tips. Dismissals/actions persist independently per tip.
import { input } from '../input.js';
import { bindingLabel } from '../input-labels.js';
import { carTransmission } from '../transmission.js';
import * as C from './components.js';
C.setHintBindings(() => input.bindings);
const KEY='paraliaki.drivingTips.v1';
let saved={};try{saved=JSON.parse(localStorage.getItem(KEY)||'{}');}catch{}
const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(saved));}catch{}};
export function controlsStrip({ device='keyboard', car, manual=false }={}) {
  const labels=[['handbrake','HANDBRAKE'],['camera','CAMERA'],['tow','TOW']];
  if(manual||carTransmission(car)!=='manual')labels.unshift(['shiftUp',manual?'SHIFT UP':'PADDLE UP'],['shiftDown',manual?'SHIFT DOWN':'PADDLE DOWN']);
  if(carTransmission(car)==='both')labels.unshift(['transmission','MANUAL / AUTO']);
  return `<div class="driving-controls">${labels.map(([act,label])=>`<span>${C.kbd(C.esc(bindingLabel(input.bindings,act,device)),device==='gamepad')}<b>${label}</b></span>`).join('')}${device==='keyboard'?'<span>'+C.kbd('MOUSE')+'<b>LOOK · CLICK ROAD TO CAPTURE</b></span>':''}</div>`;
}
export const drivingHints={
  saved, lastState:null, signature:null, nextAt:0,
  seen(id){if(!id||saved[id])return;saved[id]=true;persist();if(this.tipId===id){this.tipId=null;this.tip.hidden=true;}},
  toggle(){saved.strip=saved.strip===false;persist();return saved.strip!==false;},
  get enabled(){return saved.strip!==false;},
  action(name){this.seen(({transmission:'manual',shiftUp:'shifting',shiftDown:'shifting',camera:'camera',tow:'tow',handbrake:'handbrake'})[name]);},
  mount(){if(this.root)return;this.root=document.createElement('aside');this.root.id='drivingHints';this.root.hidden=true;document.body.append(this.root);this.tip=document.createElement('aside');this.tip.id='drivingTip';this.tip.setAttribute('role','status');this.tip.hidden=true;document.body.append(this.tip);
    this.root.addEventListener('click',()=>{this.toggle();this.root.hidden=true;});this.tip.addEventListener('click',()=>{this.seen(this.tipId);this.nextAt=performance.now()+25000;});},
  update(state){
    this.mount();const now=performance.now(), racing=['race','countdown'].includes(state.state), visible=racing&&!state.blocked;
    if(state.state==='countdown'&&this.lastState!=='countdown'||state.state==='race'&&!['countdown','race','pause'].includes(this.lastState)){this.until=now+15000;this.nextAt=now+18000;}
    this.lastState=state.state;
    const sig=JSON.stringify([state.device,state.car?.id,state.manual,input.bindings]);if(sig!==this.signature){this.signature=sig;this.state=state;this.root.innerHTML=controlsStrip(state)+C.button({label:'HIDE',icon:'x',size:'sm',cls:'driving-dismiss',focusable:false});}
    this.root.hidden=!visible||!this.enabled||now>(this.until||0);
    if(!visible){this.tip.hidden=true;return;}
    if(this.tipId&&now<this.tipUntil){this.tip.hidden=false;return;}
    if(this.tipId){this.seen(this.tipId);this.nextAt=now+20000;}
    if(now<this.nextAt)return;
    const key=a=>bindingLabel(input.bindings,a,state.device), kind=carTransmission(state.car);
    const tips=[...(kind==='both'?[['manual',`${key('transmission')} switches between MANUAL and AUTO.`]]:[]),...(state.manual?[['shifting',`MANUAL GEARS: ${key('shiftUp')} up / ${key('shiftDown')} down. Watch the rev bar.`]]:[]),['handbrake',`${key('handbrake')} is the handbrake. Release it to recover grip.`],['camera',`${key('camera')} changes the camera.`],['tow',`${key('tow')} returns you to the road.`],...(state.device==='keyboard'?[['mouseLook','Click the road to capture the mouse and look around. Esc releases it.']]:[])];
    const next=tips.find(([id])=>!saved[id]);if(!next)return;this.tipId=next[0];this.tipUntil=now+9000;this.tip.innerHTML=C.icon('info')+`<span>${C.esc(next[1])}</span>`+C.button({label:'GOT IT',icon:'x',size:'sm',focusable:false});this.tip.hidden=false;
  },
};
