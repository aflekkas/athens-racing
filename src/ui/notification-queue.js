// Pure arbitration: one critical warning and up to two toast notices.
export class NotificationQueue {
  constructor({limit=24}={}) { this.limit=limit;this.items=new Map();this.recent=new Map();this.sequence=0;this.lastAt=null;this.visible=new Set(); }
  post(value,now) {
    const id=value.id||`${value.slot||'toast'}:${value.title||''}:${value.text||''}`;
    const previous=this.items.get(id),signature=JSON.stringify([value.title||'',value.text||'',value.tone||'info',value.slot||'toast',value.priority??30]);
    if(previous?.signature===signature){Object.assign(previous,{node:value.node??previous.node,actions:value.actions??previous.actions,onShown:value.onShown??previous.onShown});return id;}
    if(!previous&&!value.persistent&&(this.recent.get(id)||-Infinity)>now)return id;
    const item={...value,id,signature,slot:value.slot==='banner'?'banner':'toast',priority:value.priority??30,at:now,order:++this.sequence,remaining:value.persistent?Infinity:value.ms??3200,staleAt:value.persistent?Infinity:now+(value.staleAfter??15000),shown:false};
    this.items.set(id,item);
    if(this.items.size>this.limit){const low=[...this.items.values()].sort((a,b)=>a.priority-b.priority||a.order-b.order)[0];this.dismiss(low.id,now);}
    return id;
  }
  dismiss(id,now=0) { if(this.items.delete(id))this.recent.set(id,now+4000);this.visible.delete(id); }
  clear() { this.items.clear();this.recent.clear();this.visible.clear();this.lastAt=null; }
  advance(now) {
    const dt=this.lastAt==null?0:Math.max(0,now-this.lastAt);this.lastAt=now;
    for(const item of this.items.values()){
      if(this.visible.has(item.id))item.remaining-=dt;
      if(item.remaining<=0||now>=item.staleAt)this.dismiss(item.id,now);
    }
    for(const[id,until]of this.recent)if(until<=now)this.recent.delete(id);
  }
  candidates(now,active=true) {
    this.advance(now);if(!active){this.visible.clear();return [];}
    const sorted=[...this.items.values()].sort((a,b)=>b.priority-a.priority||a.order-b.order);
    return [...sorted.filter(n=>n.slot==='banner').slice(0,1),...sorted.filter(n=>n.slot==='toast').slice(0,2)];
  }
  commitVisible(ids) {this.visible=new Set(ids);for(const id of ids){const n=this.items.get(id);if(n&&!n.shown){n.shown=true;n.onShown?.();}}}
}
// Find a central vertical gap below the route bar, respecting every HUD obstacle.
export function notificationPlacement({width,height,routeBottom=0,obstacles=[],heights=[],gap=6,margin=12,laneWidth=Math.min(360,width-24)}={}) {
  const left=(width-laneWidth)/2,right=left+laneWidth;
  let top=Math.max(height<=480?42:90,routeBottom+8),bottom=height-margin;
  const intersect=obstacles.filter(r=>r.right>left-margin&&r.left<right+margin&&r.bottom>top&&r.top<height-margin).sort((a,b)=>a.top-b.top);
  for(const r of intersect){
    if(r.bottom<top)continue;
    const end=r.top-8;
    if(end-top>=Math.min(...heights,Infinity)){bottom=end;break;}
    top=Math.max(top,r.bottom+8);
  }
  bottom=Math.min(bottom,height-margin,top+Math.min(210,height*.34));
  const shown=[];let cursor=top;
  for(let i=0;i<heights.length;i++){const h=heights[i];if(cursor+h>bottom)continue;shown.push(i);cursor+=h+gap;}
  return {left,top,width:laneWidth,bottom,shown};
}
