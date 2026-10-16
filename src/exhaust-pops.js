// Persistent per-trim preference and allocation-free event envelope shared by sound/render.
const choices=new Map();
export function exhaustPopsEnabled(spec){
 if(!spec?.exhaustPops)return false;
 if(!choices.has(spec.id)){let on=true;try{on=localStorage.getItem('paraliaki.exhaust.'+spec.id)!=='off';}catch{}choices.set(spec.id,on);}
 return choices.get(spec.id);
}
export function setExhaustPops(spec,on){choices.set(spec.id,!!on);try{localStorage.setItem('paraliaki.exhaust.'+spec.id,on?'on':'off');}catch{}}
export class ExhaustPulse {
 constructor(){this.serial=0;this.kind=0;this.level=0;this.life=0;this.seen=0;this.clock=0;this.next=0;this.until=0;this.overrun=false;this.previousLoad=0;this.remoteSerial=null;}
 fire(kind,level){this.serial++;this.kind=kind;this.level=level;this.life=kind===2?.08:kind===3?.075:.06;}
 update(dt,p,enabled=true){
  this.clock+=dt;this.life=Math.max(0,this.life-dt);
  if(!enabled){if(p.exhaustSerial!=null)this.remoteSerial=p.exhaustSerial;this.life=0;this.seen=p.events?.at(-1)?.serial||this.seen;this.overrun=false;return;}
  if(p.exhaustSerial!=null){if(this.remoteSerial!==null&&p.exhaustSerial!==this.remoteSerial)this.fire(p.exhaustKind||1,p.exhaustKind===2?1:.6);this.remoteSerial=p.exhaustSerial;return;}
  const hot=p.rpm>p.redline*.58;
  if(p.events)for(let i=0;i<p.events.length;i++){
   const e=p.events[i];if(e.serial<=this.seen)continue;this.seen=e.serial;
   if(hot&&e.type==='shift-start'&&e.direction>0&&(p.throttle>.6||this.previousLoad>.6))this.fire(2,1);
   if(hot&&e.type==='shift-end'&&e.direction>0&&p.throttle>.6)this.fire(1,.25);
   if(hot&&e.type==='limiter-hit')this.fire(3,.65);
  }
  if(hot&&p.overrun){if(!this.overrun){this.until=this.clock+1.4;this.next=this.clock;}if(this.clock>=this.next&&this.clock<this.until){this.fire(1,.45+.15*Math.sin(this.serial*2.4));this.next=this.clock+.10+(this.serial%3)*.045;}}
  this.overrun=!!p.overrun;this.previousLoad=p.throttle;
 }
}
