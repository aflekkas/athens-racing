// Original procedural hot-exhaust sound: continuously running pooled nodes,
// gated per visual pulse. No decoded samples or one-shot node allocation.
export class ExhaustVoice {
 constructor(ctx,dest){
  this.ctx=ctx;this.seen=0;
  const buffer=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate),data=buffer.getChannelData(0);let seed=770;
  for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;data[i]=(seed>>>0)/2147483648-1;}
  this.noise=ctx.createBufferSource();this.noise.buffer=buffer;this.noise.loop=true;
  this.filter=ctx.createBiquadFilter();this.filter.type='bandpass';this.filter.frequency.value=1150;this.filter.Q.value=.7;
  this.hiss=ctx.createGain();this.hiss.gain.value=0;
  this.body=ctx.createOscillator();this.body.type='triangle';this.body.frequency.value=95;
  this.thump=ctx.createGain();this.thump.gain.value=0;
  this.noise.connect(this.filter);this.filter.connect(this.hiss);this.hiss.connect(dest);this.body.connect(this.thump);this.thump.connect(dest);this.noise.start();this.body.start();
 }
 update(p,muted=false){
  if(!p||p.serial===this.seen)return;this.seen=p.serial;if(muted||p.life<=0)return;
  const t=this.ctx.currentTime,bang=p.kind===2,k=p.level,d=bang?.15:p.kind===3?.045:.075;
  this.filter.frequency.setValueAtTime(bang?850:p.kind===3?1800:650,t);
  this.body.frequency.setValueAtTime(bang?130:85,t);this.body.frequency.exponentialRampToValueAtTime(42,t+d);
  this.hiss.gain.cancelScheduledValues(t);this.hiss.gain.setValueAtTime(0,t);this.hiss.gain.linearRampToValueAtTime(k*(bang?.13:.065),t+.002);this.hiss.gain.exponentialRampToValueAtTime(.00001,t+d);
  this.thump.gain.cancelScheduledValues(t);this.thump.gain.setValueAtTime(0,t);this.thump.gain.linearRampToValueAtTime(k*(bang?.11:.045),t+.003);this.thump.gain.exponentialRampToValueAtTime(.00001,t+d);
 }
 stop(){this.noise.stop();this.body.stop();this.noise.disconnect();this.filter.disconnect();this.hiss.disconnect();this.body.disconnect();this.thump.disconnect();}
}
