import {attachCockpitWipers} from './cockpit-rain.js';
import * as T from 'three';

// Only the inner windscreen frame, cowl and mirror attachments are shared.
// Dashboard, console, instruments and steering retain their authored layouts.
export function buildCockpitStructure(model,cockpit){
 const spec=model.spec,group=new T.Group();group.name='cockpit-structure';cockpit.group.add(group);cockpit.structure=group;
 const trim=new T.MeshStandardMaterial({color:'#292b2e',roughness:.85,flatShading:true,side:T.DoubleSide});
 const paint=model.paint||model.materials?.paint||trim;
 const v=(x,y,z)=>new T.Vector3(x,y,z);
 const mesh=(geo,mat,role)=>{const o=new T.Mesh(geo,mat);o.name='cockpit-'+role;o.userData.cockpitStructure=role;group.add(o);return o;};
 const beam=(a,b,w,mat,role,d=w)=>{const o=mesh(new T.BoxGeometry(w,a.distanceTo(b),d),mat,role);o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(v(0,1,0),b.clone().sub(a).normalize());return o;};
 const panel=(p,mat,role)=>{const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(p.flatMap(x=>x.toArray()),3));geo.setIndex([0,1,2,0,2,3]);geo.computeVertexNormals();return mesh(geo,mat,role);};
 const glass=model.windscreen||model.body.getObjectByName('cab-windscreen-glass')||model.body.getObjectByName('panoramic-front-glass');
 model.root.updateMatrixWorld(true);
 const points=[];
 if(glass){const pos=glass.geometry.attributes.position;for(let i=0;i<pos.count;i++)points.push(model.body.worldToLocal(glass.localToWorld(v(0,0,0).fromBufferAttribute(pos,i))));}
 const bounds=new T.Box3().setFromPoints(points),sh=model.shape,half=(model.dash.w||sh.W*.8)/2;
 const station=top=>{const y=top?bounds.max.y:bounds.min.y,rows=points.filter(p=>Math.abs(p.y-y)<.035);if(!rows.length)return[v(-half,top?sh.H-.08:sh.belt,top?sh.header:sh.cowl),v(half,top?sh.H-.08:sh.belt,top?sh.header:sh.cowl)];return [rows.reduce((a,p)=>p.x<a.x?p:a).clone(),rows.reduce((a,p)=>p.x>a.x?p:a).clone()];};
 const [bl,br]=station(false),[tl,tr]=station(true);
 for(const p of [tl,tr]){p.y=spec.nativeFleet?p.y+.08:sh.H+.025;p.z=spec.nativeFleet?p.z:sh.header+.02;}
 for(const p of [bl,br,tl,tr])p.z+=.012;
 const thickness=spec.nativeFleet==='bus'?.105:spec.nativeFleet==='truck'?.095:spec.convertible?.055:.06;
 beam(tl,tr,.045,trim,'header',.075);
 if(!spec.convertible&&!sh.open)panel([tl,tr,v(half,tr.y+.06,model.seat.z+.4),v(-half,tl.y+.06,model.seat.z+.4)],trim,'headliner');
 beam(tl.clone().add(v(0,-.026,.018)),tr.clone().add(v(0,-.026,.018)),.009,trim,'visor-edge');
 for(const [s,b,t]of [[-1,bl,tl],[1,br,tr]]){
  beam(b,t,thickness,trim,'pillar',.045);
  const cap=b.clone();if(spec.nativeFleet==='bus')cap.y=Math.max(cap.y,model.seat.y-.27);beam(cap,v(s*half,cap.y-.02,model.seat.z+.25),.075,trim,'door-top',.085);
  if(!spec.convertible)beam(t,v(s*half,t.y,model.seat.z+.30),.065,trim,'window-frame',.085);
 }
 // Follow the actual body cowl/front height; bus has no bonnet beyond its glass.
 if(spec.nativeFleet!=='bus'){
  const z=-model.dims.L/2+.18,fy=Math.min(bl.y-.06,sh.front??bl.y-.12);
  panel([bl.clone().add(v(0,-.035,-.025)),br.clone().add(v(0,-.035,-.025)),v(half*.9,fy,z),v(-half*.9,fy,z)],paint,'deck');
 }
 attachCockpitWipers(model,group,[bl,br,tr,tl],trim);
 const interior=cockpit.mirrors?.find(m=>m.name==='interior')?.mesh;
 if(interior){cockpit.mirrorStem.visible=false;cockpit.mirrorMount.visible=false;beam(model.body.worldToLocal(interior.getWorldPosition(v(0,0,0))).add(v(0,.04,-.02)),tl.clone().lerp(tr,.5),.014,trim,'mirror-mount');}
 for(const key of ['mirrorL','mirrorR']){const m=model[key]||model.body.getObjectByName(key==='mirrorL'?'mirror_l':'mirror_r')?.getObjectByName('mirror-face');if(!m)continue;const p=model.body.worldToLocal(m.getWorldPosition(v(0,0,0)));beam(p.x<0?bl:br,p,.04,paint,'mirror-mount');}
 cockpit.updateStructure=()=>{};
}
