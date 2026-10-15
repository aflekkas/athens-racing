// Sample nearby route-space vehicles at 10 Hz. A close car already in the lane
// is not a cut-in: require observed lateral entry / a pull-out, then braking.
export class RoadRageDetector {
  constructor() { this.reset(); }
  reset() { this.t=0; this.next=0; this.previous=new WeakMap(); this.pending=null; this.speed=null; }
  update(dt, player, cars, brake=0) {
    if (!(dt>0) || dt>.5) { this.reset(); return null; }
    this.t+=dt;
    const direction=player.direction || Math.sign(player.vs) || 1, speed=Math.max(0,player.vs*direction);
    const deceleration=this.speed==null?0:(this.speed-speed)/dt;this.speed=speed;
    for(const c of cars) {
      const key=c.speaker, before=this.previous.get(key), width=(player.halfW || .9)+(c.halfW || .9)+.2;
      this.previous.set(key,{u:c.u,playerU:player.u,mode:c.mode,cross:c.cross,time:this.t});
      if(!before || this.t-before.time>.35 || speed<5)continue;
      const gap=(c.s-player.s)*direction-(player.halfL || 2.2)-(c.halfL || 2.2);
      const closing=speed-c.vs*direction, ttc=closing>.5?gap/closing:Infinity;
      const inPath=Math.abs(c.u-player.u)<=width;
      const entering=Math.abs(before.u-before.playerU)>width && inPath && Math.abs(c.u-before.u)>.06 && Math.abs(player.u-before.playerU)<.45;
      const pulledOut=inPath && ((before.mode==='parked' && c.mode!=='parked') || (before.cross && !c.cross));
      if((entering || pulledOut) && gap>0 && gap<40 && (gap<8 || ttc>0 && ttc<=1.5)) this.pending={speaker:key,expires:this.t+1.5,severity:gap<4 || ttc<.75?'hard':'normal'};
    }
    if(this.pending && this.t>this.pending.expires)this.pending=null;
    if(this.pending && this.t>=this.next && brake>=.3 && deceleration>=1.5) {
      const result=this.pending;this.pending=null;this.next=this.t+12;return result;
    }
    return null;
  }
}
