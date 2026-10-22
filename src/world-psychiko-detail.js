import {Route} from './map.js';
import {RoadNetwork} from './road-network-surface.js';
import {PsychikoStreetscape} from './maps/psychiko-streetscape.js';
import {Ground} from './ground.js';
import {carOverlap} from './crash-contact.js';
import {settings} from './settings.js';
import {fadeMergedVegetation} from './vegetation-fade.js';
import * as THREE from 'three';
import {BUILDING_PALETTE,buildingBlockGeometry,facadeMaterial} from './buildings.js';
import {createFacadeAtlas} from './facade-atlas.js';
import {buildingStyle} from './world-detail-policy.js';
import {bakeBlockShade} from './baked-realism.js';
import {GeoBatch,M,polyBounds,polyArea} from './util.js';
import {REFLECT_LAYER} from './env.js';
const P={lat0:37.98,lon0:23.73,mlat:111320,mlon:111320*Math.cos(37.98*Math.PI/180)};
/** Retains Vas-Per's actual streetscape recipes, with tile-lifetime geometry and shared world contact. */
export class WorldPsychikoDetail {
 constructor(session,parent,data){this.session=session;this.data=data;const p=data.proj;this.sx=P.mlon/p.mlon;this.sz=P.mlat/p.mlat;this.ox=(p.lon0-P.lon0)*P.mlon;this.oz=-(p.lat0-P.lat0)*P.mlat;this.roofs=new Map();this.buildings=new Map();this.roofQueue=new Set();
  const route=new Route(data.route),height=(x,z)=>session.stream.contact(this.ox+x*this.sx,this.oz+z*this.sz,{layer:0})?.y??0,map={id:'psychiko',route,data,terrain:{sceneryHeight:height}};
  map.roadNetwork=new RoadNetwork(map);map.roadNetwork.height=height;const originalPoint=route.point.bind(route);route.point=(s,u,out)=>{const p=originalPoint(s,u,out);p.y=height(p.x,p.z);return p;};
  this.street=new PsychikoStreetscape(map,parent,height);for(const mesh of this.street.parking){mesh.count=0;mesh.visible=false;}this.street.streamed=true;this.street.activeAt=(x,z)=>this.active(x,z);this.street.groundY=height;
  // The immutable scenery rebake certifies complete crown footprints against emitted contacts.
  const safeTrees=new Set(data.vegetationClearance?.version===1?data.vegetationClearance.allowedTreeSeeds:[]),drawTree=this.street.tree.bind(this.street);this.street.tree=(m,r)=>{if(safeTrees.has(r.seed))drawTree(m,r);};
  const buildCell=this.street.buildCell.bind(this.street);this.street.buildCell=(kind,key)=>{const mesh=buildCell(kind,key);return mesh?fadeMergedVegetation(mesh):mesh;};
  this.street.network.height=height;this.height=height;this.obstacleBuckets=new Map();for(const b of this.street.obstacles){const p={...b,...this.world(b.x,b.z),yaw:Math.atan2(Math.sin(b.yaw)*this.sx,Math.cos(b.yaw)*this.sz),hl:b.hl*Math.max(this.sx,this.sz),hw:b.hw*Math.max(this.sx,this.sz),kind:'parked'};const k=`${Math.floor(p.x/64)},${Math.floor(p.z/64)}`;if(!this.obstacleBuckets.has(k))this.obstacleBuckets.set(k,[]);this.obstacleBuckets.get(k).push(p);}this.off=session.subscribeTiles({activated:k=>this.changed(k,true),removed:k=>this.changed(k,false)});
 }
 world(x,z){return{x:this.ox+x*this.sx,z:this.oz+z*this.sz};}
 active(x,z){const p=this.world(x,z);return this.session.stream.readyAt(p.x,p.z);}
 changed(k,on){const street=this.street;for(const mesh of street.cells.values())if(mesh){mesh.removeFromParent();mesh.geometry.dispose();}street.cells.clear();street.last.x=Infinity;
  const previous=this.roofs.get(k);if(previous){previous.removeFromParent();previous.geometry.dispose();previous.material.dispose();this.roofs.delete(k);}
  this.removeBuildings(k);
  if(on)this.roofQueue.add(k);else this.roofQueue.delete(k);
 }
 removeBuildings(k){const entry=this.buildings.get(k);if(!entry)return;entry.group.traverse(o=>o.geometry?.dispose());entry.group.removeFromParent();for(const b of entry.roofs)this.street.shells.delete(b.id);this.buildings.delete(k);}
 buildRoof(k){const street=this.street,packet=this.session.stream.tiles.get(k)?.packet,records=packet?.metadata.psychikoShells||[];if(!records.length)return;
  if(packet.metadata.psychikoSourceMapSha256&&packet.metadata.psychikoSourceMapSha256!==this.data.sourceMapSha256)throw Error('Authored Psychiko shell release mismatch');
  const buildings=records.map(([index,groundMin,groundMax])=>({...this.data.buildings[index],groundMin,groundMax}));
  const built=buildAuthoredShells(buildings,street.group.parent,this.buildingMaterial);this.buildingMaterial||=built.group.children[0]?.material;built.group.name='psychiko-authored-buildings:'+k;this.buildings.set(k,built);
  for(const b of built.roofs)street.shells.set(b.id,b);
  const mesh=street.buildRoofs(built.roofs);this.roofs.set(k,mesh);street.roofs=null;
  // Recognition facades use the same base/top as the restored shells, including sloping lots.
  for(const cell of street.cells.values())if(cell){cell.removeFromParent();cell.geometry.dispose();}street.cells.clear();street.last.x=Infinity;
 }
 update(player){if(this.roofQueue.size){const k=this.roofQueue.values().next().value;this.roofQueue.delete(k);this.buildRoof(k);}const o=this.session.stream.origin,group=this.street.group;group.position.set(this.ox-o.x,0,this.oz-o.z);group.scale.set(this.sx,1,this.sz);for(const b of this.buildings.values()){b.group.position.copy(group.position);b.group.scale.copy(group.scale);}const p={x:(player.x-this.ox)/this.sx,z:(player.z-this.oz)/this.sz};this.street.update({position:p});}
 nearby(p){const result=[],x=Math.floor(p.x/64),z=Math.floor(p.z/64);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const b of this.obstacleBuckets.get(`${x+dx},${z+dz}`)||[])if(this.session.stream.readyAt(b.x,b.z)&&Math.hypot(b.x-p.x,b.z-p.z)<12)result.push(b);return result;}
 safe(p,{halfLength,halfWidth}){return !this.nearby(p).some(b=>carOverlap({...p,halfL:halfLength,halfW:halfWidth},{...b,halfL:b.hl,halfW:b.hw}));}
 resolve(v){for(const b of this.nearby(v)){const c=carOverlap(v,{...b,halfL:b.hl,halfW:b.hw});if(c)Ground.prototype._hit.call(this,v,c.nx,c.nz,c.depth,undefined,b);}}
 dispose(){this.off?.();this.off=null;for(const mesh of this.roofs.values()){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}this.roofs.clear();for(const k of [...this.buildings.keys()])this.removeBuildings(k);this.buildingMaterial?.map?.dispose();this.buildingMaterial?.dispose();this.street.dispose();this.street.group.removeFromParent();}
}

// Tile adapter for the original building kit. Geometry, shade, palette, facade atlas and
// storey/bay coordinates stay identical; the worker supplies the shared collision/roof fit.
function buildAuthoredShells(buildings,parent,sharedMaterial){
 const group=new THREE.Group(),chunks=new Map(),roofs=[];parent.add(group);
 for(const b of buildings){const p=b.p,bb=polyBounds(p),cx=(bb.x0+bb.x1)/2,cz=(bb.z0+bb.z1)/2,lo=b.groundMin,base=lo-.6,top=b.groundMax+Math.max(2.6,Number(b.h)||5.5);
  const g=buildingBlockGeometry(p,top-base);g.translate(0,base,0);const key=Math.floor(cx/500)+','+Math.floor(cz/500);if(!chunks.has(key))chunks.set(key,new GeoBatch());
  const batch=chunks.get(key),start=batch.count;batch.add(g,M(0,0,0),b.color||BUILDING_PALETTE[Math.abs(Number(b.id)||0)%BUILDING_PALETTE.length]);bakeBlockShade(batch,start,base,top);batch.facade||=[];const style=buildingStyle(b);
  for(let i=start;i<batch.count;i++){const j=i*3,nx=batch.nor[j],ny=batch.nor[j+1],nz=batch.nor[j+2];batch.facade.push(((batch.pos[j]-cx)*nz-(batch.pos[j+2]-cz)*nx)/(b.windowBay||5.5),(batch.pos[j+1]-base)/(b.storeyHeight?(top-base)/(b.lv||2):3.1),style,Math.abs(ny)>.5?1:0);}
  g.dispose();roofs.push({...b,p,bb,cx,cz,gmin:lo,top,area:Math.abs(polyArea(p)),roofOccupied:[]});
 }
 const material=sharedMaterial||facadeMaterial(typeof document==='undefined'?null:createFacadeAtlas());
 for(const [key,batch]of chunks){const g=batch.build();g.setAttribute('aFacade',new THREE.Float32BufferAttribute(batch.facade,4));const mesh=new THREE.Mesh(g,material);mesh.name='building-blocks:'+key;mesh.layers.enable(REFLECT_LAYER);group.add(mesh);}
 return{group,roofs};
}
