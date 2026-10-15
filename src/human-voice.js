// Consume classified impact events only: a motorcycle collision alone is not
// evidence of a person being hit or ejected. The physics owner supplies that fact.
export function humanVoiceEvent(event, routePoint) {
  const e = event;
  if (e.kind === 'rider-thrown' && e.target === 'rider' && e.c?.rider) {
    const rider = e.c.rider, point = routePoint(e.s, e.u);
    const fallback = { x:point.x, y:(point.y || 0) + 1, z:point.z };
    return { category:'rider', speaker:rider, locate:() => {
      const b = e.c.rider === rider && e.c.riderBody;
      return b?.active && b.kind === 'rider' && b.owner === e.c.id ? {x:b.p[9],y:b.p[10],z:b.p[11]} : fallback;
    }, options:{} };
  }
  if (e.target !== 'pedestrian' || !e.p || !['hit','dive','startle'].includes(e.kind)) return null;
  const p = e.p, body = e.body, owner = body?.owner;
  const fallback = {x:e.x ?? p.x,y:(e.y ?? p.wy ?? p.y) + 1.5,z:e.z ?? p.z};
  return {category:e.kind === 'startle' ? 'near' : 'pedestrian', speaker:p,
    locate:() => {
      if (e.kind === 'hit') return body?.active && body.owner === owner && body.kind === 'pedestrian' ? {x:body.p[9],y:body.p[10],z:body.p[11]} : fallback;
      return p.active ? {x:p.x,y:(p.wy ?? p.y) + (p.look?.h || 1.7)*.9,z:p.z} : null;
    }, options:{gender:p.look?.female === undefined ? undefined : p.look.female ? 'female' : 'male',older:p.look?.old}};
}

export class HumanVoiceEvents {
  constructor(voices, routePoint) { this.voices=voices; this.routePoint=routePoint; this.reset(); }
  reset() { this.queue=[]; this.busy=false; this.generation=(this.generation || 0)+1; }
  offer(event) {
    const reaction=humanVoiceEvent(event,this.routePoint);
    if (!reaction || this.queue.some(q=>q.speaker === reaction.speaker) || this.queue.length >= 2) return false;
    this.queue.push({...reaction,expires:(this.voices.audio.ctx?.currentTime || 0)+8,retryAt:0});return true;
  }
  async tick() {
    const v=this.voices, now=v.audio.ctx?.currentTime || 0;
    this.queue=this.queue.filter(q=>q.expires>=now);
    if(this.busy || !v.enabled || v.pending || v.active || now<v.next)return;
    const job=this.queue[0];if(!job || now<job.retryAt)return;
    job.retryAt=now+.5;this.busy=true;const generation=this.generation;
    const played=await v.trigger(job.category,job.speaker,job.locate,job.options);
    if(generation!==this.generation)return;
    this.busy=false;if(played)this.queue=this.queue.filter(q=>q!==job);
  }
}
