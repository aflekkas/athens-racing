import { WorldRoadGraph } from './world-tile-graph.js';
import { tileKey } from './world-tile-format.js';
import {MEGARA_RACEWAY,MEGARA_DRIVE_SURFACES} from './route-surface.js';

/** Graph and contact queries share the scene's activation/eviction transaction. */
export class WorldTileRoads {
  constructor(stream) { this.stream=stream;this.graph=new WorldRoadGraph(); }
  publicSurfaces(layer){
    // Contact ownership can change inside overlapping OSM junction polygons.
    // Width is the contiguous physical asphalt interval, not one polygon label.
    if(this.surfaceRevision!==this.graph.revision){this.surfaceRevision=this.graph.revision;this.surfaceLayers=new Map();for(const {value:e}of this.graph.edges.values())if(!(e.flags&8)){if(!this.surfaceLayers.has(e.layer))this.surfaceLayers.set(e.layer,new Map());this.surfaceLayers.get(e.layer).set(e.surface,e.layer);}}return this.surfaceLayers.get(layer)||new Map();
  }
  adapter(scene) {
    const roads=this;
    return {
      warmup:packet=>scene.warmup?.(packet),rebase:(...args)=>scene.rebase?.(...args),
      prepare(key,packet,origin) {
        const build=scene.prepare(key,packet,origin);let installed=false,disposed=false;
        return {steps:build.steps,commit(){
          try{roads.graph.install(key,packet);installed=true;return build.commit();}
          catch(error){if(installed){roads.graph.remove(key);installed=false;}build.dispose();throw error;}
        },dispose(){if(disposed)return;disposed=true;if(installed)roads.graph.remove(key);build.dispose();}};
      }
    };
  }
  /** A cross section of the canonical road triangles, bounded by contact CSR cells.
   * This also handles reverse edges and narrower sections of the same OSM surface.
   * Never estimate physical width from directional laneCount or a surface maximum.
   */
  connected(edge){
    const result=new Map([[edge.surface,edge.layer]]);
    if(MEGARA_RACEWAY.test(edge.id)&&edge.surface==='surface:roads'&&edge.layer===0&&!(edge.flags&8))for(const surface of MEGARA_DRIVE_SURFACES)result.set(surface,0);
    for(const {value:e} of this.graph.edges.values()){if(e.flags&8)continue;if((e.from===edge.to&&this.graph.legal(edge.id,e)||e.to===edge.from&&this.graph.legal(e.id,edge))&&Math.abs((e.from===edge.to?e.points[0][1]-edge.points.at(-1)[1]:e.points.at(-1)[1]-edge.points[0][1]))<.025)result.set(e.surface,e.layer);if(e.layer!==edge.layer)continue;for(const [node,y]of [[edge.from,edge.points[0][1]],[edge.to,edge.points.at(-1)[1]]])if(e.from===node&&Math.abs(e.points[0][1]-y)<.025||e.to===node&&Math.abs(e.points.at(-1)[1]-y)<.025)result.set(e.surface,e.layer);}
    return result;
  }
  width(point,{radius=16,heightTolerance=1,connected=false,bounded=false}={}) {
    if(!(radius>0&&radius<=32))throw new Error('Invalid road width search radius');
    const edge=this.graph.edges.get(point.edge)?.value;if(!edge)return null;
    const surfaces=connected?new Map([...this.publicSurfaces(edge.layer),...this.connected(edge)]):new Map([[edge.surface,edge.layer]]);if(point.surfaceId)surfaces.set(point.surfaceId,edge.layer);
    const rx=Math.cos(point.yaw),rz=-Math.sin(point.yaw),intervals=[],visited=new Set();
    for(let d=-radius;d<=radius;d+=4){
      const x=point.x+rx*d,z=point.z+rz*d,key=tileKey(x,z),tile=this.stream.tiles.get(key);
      if(tile?.state!=='active'||!this.stream.readyAt(x,z))continue;
      const {tables:t,metadata:m,contactIndex:index}=tile.packet,lx=x-m.origin[0],lz=z-m.origin[2],cell=Math.min(31,Math.floor(lz/16))*32+Math.min(31,Math.floor(lx/16));
      for(let k=index.offsets[cell];k<index.offsets[cell+1];k++){
        const ref=index.refs[k],fine=!!(ref&0x80000000),row=ref&0x7fffffff;
        // Compact tiles hold their ground contact rows as the fine triangles; legacy tiles hold them in contactTriangles.
        if(fine&&!t.fineSurface)continue;
        const id=key+':'+ref;if(visited.has(id))continue;visited.add(id);
        const positions=fine?t.finePositions:t.contactPositions,triangles=fine?t.fineTriangles:t.contactTriangles,i=row*(fine?3:5);
        const flags=fine?t.fineFlags[row]:t.contactTriangles[i+4],surface=fine?t.fineSurface[row]:t.contactTriangles[i+3],layer=fine?0:t.contactLayers[row];
        if(!(flags&1)||flags&8||surfaces.get(m.ids[surface])!==layer)continue;
        const vertices=[];
        for(let j=0;j<3;j++){const p=triangles[i+j]*3,dx=positions[p]+m.origin[0]-point.x,dz=positions[p+2]+m.origin[2]-point.z;vertices.push({d:dx*rx+dz*rz,f:dx*(-rz)+dz*rx,y:positions[p+1]});}
        const hits=[];
        for(let j=0;j<3;j++){const a=vertices[j],b=vertices[(j+1)%3];if(Math.abs(a.f)<1e-7)hits.push(a);if(a.f*b.f<0){const f=a.f/(a.f-b.f);hits.push({d:a.d+(b.d-a.d)*f,y:a.y+(b.y-a.y)*f});}}
        if(hits.length>=2&&hits.every(h=>Math.abs(h.y-point.y)<=heightTolerance+Math.abs(h.d)*Math.tan(Math.PI/6)))intervals.push([Math.min(...hits.map(h=>h.d)),Math.max(...hits.map(h=>h.d))]);
      }
    }
    intervals.sort((a,b)=>a[0]-b[0]);const merged=[];
    for(const a of intervals){const p=merged.at(-1);if(p&&a[0]<=p[1]+.002)p[1]=Math.max(p[1],a[1]);else merged.push(a.slice());}
    const span=merged.find(a=>a[0]<=.002&&a[1]>=-.002);if(!span||!bounded&&(span[0]<=-radius||span[1]>=radius))return null;
    const left=Math.min(radius,-span[0]),right=Math.min(radius,span[1]);return {left,right,width:left+right};
  }
  /** Full footprint stays on the same public physical road and outside buildings. */
  safe(point,{halfWidth=1,halfLength=2.5,clearance=.15,connected=false}={}) {
    const edge=this.graph.edges.get(point.edge)?.value;if(!edge||edge.flags&8)return false;
    const surfaces=connected?this.connected(edge):new Map([[edge.surface,edge.layer]]);if(point.surfaceId)surfaces.set(point.surfaceId,edge.layer);
    const sin=Math.sin(point.yaw),cos=Math.cos(point.yaw),corners=[];
    for(const along of [-halfLength,0,halfLength])for(const across of [-halfWidth,0,halfWidth]){
      const x=point.x-sin*along+cos*across,z=point.z-cos*along-sin*across,c=this.stream.contact(x,z,{referenceY:point.y,layer:connected?null:edge.layer,requiredFlags:1});
      if(!c||surfaces.get(c.surfaceId)!==c.layer||Math.abs(c.y-point.y)>1)return false;
      corners.push([x,z]);
    }
    // Building owners are already one-hop resident whenever contact is ready.
    const rectangle=[corners[0],corners[2],corners[8],corners[6]];
    for(const tile of this.stream.tiles.values())if(tile.state==='active'){
      const {metadata:m,tables:t}=tile.packet;
      for(let i=0;i<t.buildings.length;i+=4){const h=i/2;if(point.y+2<t.buildingHeights[h]||point.y>t.buildingHeights[h]+t.buildingHeights[h+1])continue;
        const polygon=[];for(let j=t.buildings[i+1];j<t.buildings[i+1]+t.buildings[i+2];j++)polygon.push([t.buildingCorners[j*2]+m.origin[0],t.buildingCorners[j*2+1]+m.origin[2]]);
        if(polygonsOverlap(rectangle,polygon,clearance))return false;
      }
    }
    return true;
  }
  *anchors({kind=null,validate=true}={}) {
    const seen=new Set();
    for(const tile of this.stream.tiles.values())if(tile.state==='active'){
      const {metadata:m,tables:t}=tile.packet;
      for(let i=0;i<t.anchors.length;i+=5){const id=m.ids[t.anchors[i]];if(seen.has(id)||kind!==null&&t.anchors[i+3]!==kind)continue;seen.add(id);const p=this.stream.anchor(id);if(p&&(!validate||this.safe(p)))yield {...p,id};}
    }
  }
  gps(from,to) {
    const a=this.graph.nearest(from.x,from.z,{referenceY:from.y,layer:from.layer,maxDistance:30}),b=this.graph.nearest(to.x,to.z,{referenceY:to.y,layer:to.layer,maxDistance:30});
    if(!a||!b)return null;
    const first=this.graph.edges.get(a.edge).value,last=this.graph.edges.get(b.edge).value;
    // Same edge backwards requires a legal directed loop, never a shortcut.
    const station=(e,p)=>{let total=0,best=Infinity,s=0;for(let i=1;i<e.points.length;i++){const u=e.points[i-1],v=e.points[i],dx=v[0]-u[0],dz=v[2]-u[2],l=Math.hypot(dx,dz),f=Math.max(0,Math.min(1,((p.x-u[0])*dx+(p.z-u[2])*dz)/(l*l||1))),d=Math.hypot(p.x-u[0]-dx*f,p.z-u[2]-dz*f);if(d<best){best=d;s=total+l*f;}total+=l;}return s;};
    if(first.id===last.id&&station(first,b)>=station(first,a))return {edges:[first.id],start:a,end:b,seconds:(station(first,b)-station(first,a))/((first.speedKph||50)/3.6)};
    const path=this.graph.route(first.to,last.from,{initialEdge:first.id,terminalEdge:last});
    if(!path||!this.graph.legal(path.edges.at(-1)||first.id,last))return null;
    return {edges:[first.id,...path.edges,last.id],start:a,end:b,seconds:path.seconds+(first.length-station(first,a))/((first.speedKph||50)/3.6)+station(last,b)/((last.speedKph||50)/3.6)};
  }
  /** Low-density traffic advances only over loaded, legal directed fragments.
   * Unknown continuation and failed footprint checks stop the car in place.
   */
  advance(point,metres,{halfWidth=1,halfLength=2.5}={}) {
    if(!(metres>=0&&metres<=10))throw new Error('Traffic step must be bounded');
    let edge=this.graph.edges.get(point.edge)?.value;if(!edge)return null;
    let nearest=null,best=20;for(let i=1;i<edge.points.length;i++){const a=edge.points[i-1],b=edge.points[i],dx=b[0]-a[0],dz=b[2]-a[2],f=Math.max(0,Math.min(1,((point.x-a[0])*dx+(point.z-a[2])*dz)/(dx*dx+dz*dz||1))),x=a[0]+dx*f,z=a[2]+dz*f,d=Math.hypot(point.x-x,point.z-z);if(d<best){best=d;nearest={x,z,yaw:Math.atan2(-dx,-dz)};}}
    if(!nearest)return null;
    const offset=(point.x-nearest.x)*Math.cos(nearest.yaw)-(point.z-nearest.z)*Math.sin(nearest.yaw);
    let remaining=metres,started=false;
    for(let transitions=0;transitions<8;transitions++){
      for(let i=1;i<edge.points.length;i++){
        const a=edge.points[i-1],b=edge.points[i],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);if(!length)continue;
        let f=0;
        if(!started){f=((nearest.x-a[0])*dx+(nearest.z-a[2])*dz)/(length*length);if(f<-.0001||f>1.0001||Math.hypot(a[0]+dx*f-nearest.x,a[2]+dz*f-nearest.z)>.01)continue;f=Math.max(0,Math.min(1,f));started=true;}
        const available=length*(1-f);
        if(remaining<=available){f+=remaining/length;const yaw=Math.atan2(-dx,-dz),p={edge:edge.id,x:a[0]+dx*f+Math.cos(yaw)*offset,y:a[1]+(b[1]-a[1])*f,z:a[2]+dz*f-Math.sin(yaw)*offset,yaw,layer:edge.layer};
          const width=this.width(p,{connected:true}),c=this.stream.contact(p.x,p.z,{referenceY:p.y,layer:p.layer,requiredFlags:1});
          if(!width||Math.min(width.left,width.right)<halfWidth+.15||!c||!this.safe(p,{halfWidth,halfLength,connected:true}))return null;
          p.y=c.y;return p;
        }remaining-=available;
      }
      const next=[...(this.graph.outgoing.get(edge.to)||[])].map(id=>this.graph.edges.get(id)?.value).filter(e=>e&&this.graph.legal(edge.id,e)&&Math.abs(e.points[0][1]-edge.points.at(-1)[1])<.025).sort((a,b)=>a.id.localeCompare(b.id))[0];
      if(!next)return null;edge=next;started=true;
    }return null;
  }
  async tow(id,move,options) {
    const target=this.stream.anchor(id);if(!target)throw new Error('Unknown loaded tow anchor');
    return this.stream.teleport(target,()=>{const p=this.stream.anchor(id);if(!p||!this.safe(p))throw new Error('Tow footprint unavailable');return move(p);},options);
  }
  dispose(){this.graph.dispose();}
}
function polygonsOverlap(a,b,clearance){
  const inside=(p,q)=>{let result=false;for(let i=0,j=q.length-1;i<q.length;j=i++){const u=q[i],v=q[j];if((u[1]>p[1])!==(v[1]>p[1])&&p[0]<(v[0]-u[0])*(p[1]-u[1])/(v[1]-u[1])+u[0])result=!result;}return result;};
  if(a.some(p=>inside(p,b))||b.some(p=>inside(p,a)))return true;
  const distance=(p,u,v)=>{const dx=v[0]-u[0],dz=v[1]-u[1],f=Math.max(0,Math.min(1,((p[0]-u[0])*dx+(p[1]-u[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-u[0]-dx*f,p[1]-u[1]-dz*f);};
  const cross=(u,v,p)=>(v[0]-u[0])*(p[1]-u[1])-(v[1]-u[1])*(p[0]-u[0]);
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){const u=a[i],v=a[(i+1)%a.length],p=b[j],q=b[(j+1)%b.length];if(cross(u,v,p)*cross(u,v,q)<0&&cross(p,q,u)*cross(p,q,v)<0)return true;if(Math.min(distance(p,u,v),distance(q,u,v),distance(u,p,q),distance(v,p,q))<=clearance)return true;}
  return false;
}
