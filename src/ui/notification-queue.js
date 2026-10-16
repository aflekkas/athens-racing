// Related persistent sources remain queued as fallbacks; only the most useful one is shown.
export function noticeGroup(item) {
  if (item.group) return item.group;
  const id=item.id || '', text=`${item.title || ''} ${item.text || ''}`.toUpperCase();
  if (['engine-condition','tow'].includes(id)) return 'vehicle-recovery';
  if (['checkpoint','objective-direction','wrong-way'].includes(id)) return 'route-direction';
  if (id.startsWith('police-') || /POLICE|BUSTED|PURSUIT|PULLED OVER/.test(text)) return 'police';
  return null;
}
// Pure arbitration: one critical warning and up to two toast notices.
export class NotificationQueue {
  constructor({limit=24}={}) { this.limit=limit;this.items=new Map();this.aliases=new Map();this.recent=new Map();this.sequence=0;this.lastAt=null;this.visible=new Set(); }
  post(value,now) {
    const id=value.id||`${value.slot||'toast'}:${value.title||''}:${value.text||''}`;
    const contentKey=JSON.stringify([value.title||'',value.text||'']);
    if(contentKey!=='["",""]'){
      const duplicate=[...this.items.values()].find(n=>n.id!==id&&JSON.stringify([n.title||'',n.text||''])===contentKey);
      if(duplicate){this.aliases.set(id,duplicate.id);if(this.aliases.size>this.limit*2)this.aliases.delete(this.aliases.keys().next().value);if((value.priority??30)>duplicate.priority){duplicate.priority=value.priority??30;duplicate.tone=value.tone??duplicate.tone;duplicate.slot=value.slot??duplicate.slot;duplicate.node=value.node??duplicate.node;duplicate.actions=value.actions??duplicate.actions;duplicate.signature=JSON.stringify([duplicate.title||'',duplicate.text||'',duplicate.tone||'info',duplicate.slot||'toast',duplicate.priority]);}return duplicate.id;}
      if((this.recent.get('copy:'+contentKey)||-Infinity)>now&&!value.persistent)return id;
    }
    this.aliases.delete(id);
    const previous=this.items.get(id),signature=JSON.stringify([value.title||'',value.text||'',value.tone||'info',value.slot||'toast',value.priority??30]);
    if(previous?.signature===signature){Object.assign(previous,{node:value.node??previous.node,actions:value.actions??previous.actions,onShown:value.onShown??previous.onShown});return id;}
    if(!previous&&!value.persistent&&(this.recent.get(id)||-Infinity)>now)return id;
    const item={...value,id,signature,slot:value.slot==='banner'?'banner':'toast',priority:value.priority??30,at:now,order:++this.sequence,remaining:value.persistent?Infinity:value.ms??3200,staleAt:value.persistent?Infinity:now+(value.staleAfter??15000),shown:false};
    this.items.set(id,item);
    if(this.items.size>this.limit){const low=[...this.items.values()].sort((a,b)=>a.priority-b.priority||a.order-b.order)[0];this.dismiss(low.id,now);}
    return id;
  }
  dismiss(id,now=0) {
    id=this.aliases.get(id)||id;const item=this.items.get(id);
    if(this.items.delete(id)){this.recent.set(id,now+4000);this.recent.set('copy:'+JSON.stringify([item.title||'',item.text||'']),now+4000);}
    for(const[alias,target]of this.aliases)if(target===id)this.aliases.delete(alias);
    this.visible.delete(id);
  }
  clear() { this.items.clear();this.aliases.clear();this.recent.clear();this.visible.clear();this.lastAt=null; }
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
    const groups=new Set(),copies=new Set(),banners=[],toasts=[];
    for(const item of [...this.items.values()].sort((a,b)=>b.priority-a.priority||a.order-b.order)){
      const group=noticeGroup(item),copy=JSON.stringify([item.title||'',item.text||'']);
      if(group&&groups.has(group)||copy!=='["",""]'&&copies.has(copy))continue;
      const bucket=item.slot==='banner'?banners:toasts,limit=item.slot==='banner'?1:2;
      if(bucket.length>=limit)continue;
      // Claim a group only after its slot is accepted: a blocked banner must not hide its tow fallback.
      bucket.push(item);if(group)groups.add(group);copies.add(copy);
    }
    return [...banners,...toasts];
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
    if(end-top>=(heights[0]??Infinity)){bottom=end;break;}
    top=Math.max(top,r.bottom+8);
  }
  bottom=Math.min(bottom,height-margin,top+Math.min(210,height*.34));
  const shown=[];let cursor=top;
  for(let i=0;i<heights.length;i++){const h=heights[i];if(cursor+h>bottom)continue;shown.push(i);cursor+=h+gap;}
  return {left,top,width:laneWidth,bottom,shown};
}

// The chase strip is drawn into the canvas, so DOM obstacle queries cannot see it.
// Cockpit mirrors vary by car; reserve the upper centre of the windscreen across the fleet.
export function mirrorNoticeBounds(width,height,view='chase') {
  const w=Math.min(width*.3,height*.75),top=height*.012;
  return view==='cockpit' ? {left:width*.2,right:width*.8,top:0,bottom:height*.33}
    : {left:(width-w)/2,right:(width+w)/2,top,bottom:top+w/4.6};
}

// Project the actual cockpit mirror glass, including its frame clearance. No renderer or world allocation.
export function projectedMirrorBounds(mirrors,camera,width,height) {
  if(!camera)return [];
  const bounds=[];
  for(const entry of mirrors||[]){
    const mesh=entry.mesh||entry;let visible=true;
    for(let parent=mesh;parent;parent=parent.parent)if(parent.visible===false)visible=false;
    if(!visible||!mesh.geometry||camera.layers&&!camera.layers.test(mesh.layers))continue;
    mesh.updateWorldMatrix(true,false);if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
    const box=mesh.geometry.boundingBox;if(!box)continue;
    const v=mesh.position.clone();let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
    for(let i=0;i<8;i++){
      v.set(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      if(v.z>=0)continue;v.applyMatrix4(camera.projectionMatrix);
      const x=(v.x+1)*width/2,y=(1-v.y)*height/2;if(!Number.isFinite(x+y))continue;
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
    const pad=Math.max(16,(right-left)*.08);
    left=Math.max(0,left-pad);right=Math.min(width,right+pad);top=Math.max(0,top-pad);bottom=Math.min(height,bottom+pad);
    if(right>left&&bottom>top)bounds.push({left,right,top,bottom});
  }
  return bounds;
}
