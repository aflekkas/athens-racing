import {buildRoadworks,roadworksForEvent} from './roadworks.js';
import {carOverlap} from './crash-contact.js';
import {Ground} from './ground.js';
const key=(x,z)=>`${Math.floor(x/512)},${Math.floor(z/512)}`;
// Lobby/session-local overlay: no free-roam meshes, colliders, or blocked graph exits.
export class RouteClosures {
 constructor(session,scene,blocks=[]){Object.assign(this,{session,scene,blocks});this.cells=new Map();this.active=false;this.off=session.subscribeTiles({activated:k=>this.install(k),removed:k=>this.remove(k)});}
 setEvent(def){const on=roadworksForEvent({roadworks:this.blocks},def).length>0;if(on===this.active)return;this.active=on;if(!on){for(const k of [...this.cells.keys()])this.remove(k);}else for(const [k,t]of this.session.stream.tiles)if(t.state==='active')this.install(k);}
 install(k){if(!this.active||this.cells.has(k))return;const blocks=this.blocks.filter(b=>key(b.x,b.z)===k);if(!blocks.length)return;
  const heightC=(x,z)=>this.session.stream.contact(x,z,{layer:0})?.y;
  if(blocks.some(b=>[-b.hl,0,b.hl].some(a=>!Number.isFinite(heightC(b.x+Math.sin(b.yaw)*a,b.z+Math.cos(b.yaw)*a)))))return;
  const ground={heightC,parked:[]},layer=buildRoadworks({id:'athens',data:{roadworks:blocks}},this.scene,ground);layer.setEvent({type:'sprint'});layer.group.position.set(-this.session.stream.origin.x,0,-this.session.stream.origin.z);this.cells.set(k,layer);
 }
 remove(k){const layer=this.cells.get(k);if(!layer)return;this.cells.delete(k);const geos=new Set(),mats=new Set();layer.group.traverse(o=>{if(o.geometry)geos.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])mats.add(m);});layer.group.removeFromParent();for(const g of geos)g.dispose();for(const m of mats)m.dispose();}
 update(){for(const [k,t]of this.session.stream.tiles)if(t.state==='active')this.install(k);for(const layer of this.cells.values())layer.group.position.set(-this.session.stream.origin.x,0,-this.session.stream.origin.z);}
 get colliders(){return [...this.cells.values()].flatMap(l=>l.colliders);}
 blocksEdge(edge){if(!this.active)return false;return this.blocks.some(b=>edge.points.some(p=>Math.hypot(p[0]-b.x,p[2]-b.z)<b.hl+2)&&edge.id.startsWith('osm:way:'+b.way+':'));}
 resolve(v){for(const b of this.colliders){const y=this.session.stream.contact(b.x,b.z,{referenceY:v.y,layer:0})?.y;if(!Number.isFinite(y)||Math.abs(v.y-y)>2)continue;const c=carOverlap(v,{...b,y,halfL:b.hl,halfW:b.hw});if(c)Ground.prototype._hit.call(this,v,c.nx,c.nz,c.depth,0,b);}}
 safe(p,footprint){return !this.colliders.some(b=>carOverlap({...p,halfL:footprint.halfLength,halfW:footprint.halfWidth},{...b,halfL:b.hl,halfW:b.hw}));}
 dispose(){this.off?.();this.off=null;for(const k of [...this.cells.keys()])this.remove(k);this.active=false;}
}
