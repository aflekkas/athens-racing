import {attachCockpitWipers} from './cockpit-rain.js';
import * as T from 'three';
import {brandBadgeMaterial} from './brand-badges.js';

// A small, vehicle-space inner shell. Exterior LODs can be culled in POV, but
// never the cowl, windscreen frame, door tops or the driver's own controls.
// Stations are fitted once at construction; they do not follow the camera or
// seat sliders. The actual chassis, glass, wheel and collision anchors stay put.
export function buildCockpitStructure(model,cockpit){
 const spec=model.spec,eye=cockpit.eye,group=new T.Group();group.name='cockpit-structure';cockpit.group.add(group);cockpit.structure=group;
 const trim=new T.MeshStandardMaterial({color:'#202429',roughness:.8,flatShading:true,side:T.DoubleSide});
 const edge=new T.MeshStandardMaterial({color:'#444a50',roughness:.65,flatShading:true,side:T.DoubleSide});
 const paint=model.paint||new T.MeshStandardMaterial({color:spec.color,roughness:.5,flatShading:true,side:T.DoubleSide});
 const v=(x,y,z)=>new T.Vector3(x,y,z);
 const mesh=(geo,mat,role)=>{const o=new T.Mesh(geo,mat);o.name='cockpit-'+role;o.userData.cockpitStructure=role;group.add(o);return o;};
 const beam=(a,b,w,mat,role,h=w)=>{const o=mesh(new T.BoxGeometry(w,a.distanceTo(b),h),mat,role);o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(v(0,1,0),b.clone().sub(a).normalize());return o;};
 const panel=(points,mat,role)=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(points.flatMap(p=>p.toArray()),3));g.setIndex(points.length===4?[0,1,2,0,2,3]:[0,1,2]);g.computeVertexNormals();return mesh(g,mat,role);};
 // These correspond to the bottom part of the fixed default 66-degree view.
 // Wide dash cheeks run back to the doors, closing the old floating-bar gap.
 const yAt=(d,ndc)=>eye.y+d*Math.tan(Math.atan(ndc*Math.tan(66*Math.PI/360))-.055);
 const cluster=cockpit.group.getObjectByName('instrument-cluster')||cockpit.display;
 if(spec.twoWheeler){
  const z=eye.z-.54,y=yAt(.54,-.93);
  const tank=mesh(new T.BoxGeometry(.28,.19,.44),paint,'tank');tank.position.set(0,y-.13,z+.04);
  const bars=new T.Group();bars.name='cockpit-handlebars';bars.position.set(0,y,z);group.add(bars);cockpit.povSteering=bars;
  for(const side of [-1,1]){const b=beam(v(0,y-.025,z-.04),v(side*.30,y+.005,z+.04),.018,edge,'handlebars');bars.attach(b);const grip=beam(v(side*.25,y+.005,z+.04),v(side*.36,y+.005,z+.04),.028,trim,'handlebars');bars.attach(grip);}
  const clocks=mesh(new T.BoxGeometry(.24,.10,.04),trim,'dash');clocks.position.copy(cluster.position).add(v(0,0,-.025));
  cockpit.updateStructure=st=>{bars.rotation.y=-st.steerInput*.45;};return;
 }
 if(spec.nativeFleet)cluster.position.y+=.025;
 const W=model.dash.w||model.dims.W*.86,half=W*.5;
 const fd=eye.z-cluster.position.z+.035,rd=.38;
 const fz=eye.z-fd,rz=eye.z-rd,fy=yAt(fd,-.94),ry=yAt(rd,-1.48);
 panel([v(-half,fy,fz),v(half,fy,fz),v(half,ry,rz),v(-half,ry,rz)],trim,'dash');
 panel([v(-half,ry,rz),v(half,ry,rz),v(half,ry-.55,rz),v(-half,ry-.55,rz)],trim,'dash');
 panel([v(-half,yAt(fd+.05,-.91),fz-.05),v(half,yAt(fd+.05,-.91),fz-.05),v(half,fy-.2,fz-.05),v(-half,fy-.2,fz-.05)],trim,'dash');
 const nav=cockpit.group.getObjectByName('navigation-band')||cockpit.navDisplay;
 if(nav){nav.scale.setScalar(.7);const d=eye.z-nav.position.z;nav.position.y=yAt(d,-.95);const backing=mesh(new T.BoxGeometry(nav.geometry.parameters.width*.7+.012,nav.geometry.parameters.height*.7+.012,.025),trim,'navigation-binnacle');backing.position.copy(nav.position).add(v(0,0,-.015));}
 // Raised instrument face is seated in the fascia rather than floating over it.
 const face=mesh(new T.BoxGeometry(cluster.geometry.parameters.width+.03,cluster.geometry.parameters.height+.025,.035),trim,'cluster-binnacle');face.position.copy(cluster.position).add(v(0,0,-.024));
 const deckD=fd+.25,deckY=yAt(deckD,-.86),deckZ=eye.z-deckD;
 panel([v(-half,fy-.008,fz-.01),v(half,fy-.008,fz-.01),v(half*.83,deckY,deckZ),v(-half*.83,deckY,deckZ)],paint,'deck');
 for(const s of [-1,1])beam(v(s*half*.75,fy,fz),v(s*half*.69,deckY+.002,deckZ),.008,edge,'deck-seam');
 const roofY=Math.max(eye.y+.10,Math.min(model.shape.H-.025,eye.y+.32));
 const hd=(roofY-eye.y)/Math.tan(Math.atan(.975*Math.tan(66*Math.PI/360))-.055),hz=eye.z-hd;
 const topLeft=Math.max(-half,eye.x-hd*1.6*Math.tan(66*Math.PI/360)*.97),topRight=half;
 const left=v(topLeft,roofY,hz),right=v(topRight,roofY,hz);
 const thick=['bus','truck'].includes(spec.nativeFleet)?.012:.007;
 beam(left,right,.004,trim,'header');
 beam(left.clone().add(v(0,.002,-.003)),right.clone().add(v(0,.002,-.003)),.003,edge,'visor-edge');
 for(const [s,top]of [[-1,left],[1,right]]){
  const base=v(s*half,fy,fz);
  beam(base,top,thick,paint,'pillar');beam(base.clone().add(v(-s*.004,0,.002)),top.clone().add(v(-s*.004,0,.002)),.004,trim,'pillar-trim');
  beam(base,v(s*half,ry-.015,eye.z+.12),.026,trim,'door-top');
  if(!spec.convertible)beam(top,v(s*half,roofY,eye.z+.18),.018,trim,'window-frame');
 }
 attachCockpitWipers(model,group,[v(-half,fy,fz),v(half,fy,fz),right,left],trim);
 // Real mirror faces remain render-target driven; attach their housings to
 // the new header/door structure rather than leaving them in empty space.
 const interior=cockpit.mirrors?.find(m=>m.name==='interior')?.mesh;
 if(interior){const a=interior.position.clone().add(v(0,.045,-.02));const mountX=eye.x+(a.x-eye.x)*hd/(eye.z-a.z);beam(a,v(mountX,roofY,hz),.007,trim,'mirror-mount');cockpit.mirrorStem.visible=false;cockpit.mirrorMount.visible=false;}
 for(const [key,name]of [['mirrorL','mirror_l'],['mirrorR','mirror_r']]){const m=model[key]||model.body.getObjectByName(name)?.getObjectByName('mirror-housing');if(!m)continue;model.root.updateMatrixWorld(true);const p=model.body.worldToLocal(m.getWorldPosition(v(0,0,0))),s=Math.sign(p.x);const base=v(s*half,fy,fz),top=s<0?left:right,axis=top.clone().sub(base);const mount=base.clone().addScaledVector(axis,T.MathUtils.clamp(p.clone().sub(base).dot(axis)/axis.lengthSq(),0,1));beam(mount,p,.022,paint,'mirror-mount');}
 // The original control anchors remain for paddles and shift animation. The
 // visible low-poly rim/hub has its own fitted station and rotates with steer.
 const wheel=new T.Group();wheel.name='cockpit-steering-wheel';group.add(wheel);cockpit.povSteering=wheel;
 const wd=fd*.80,wr=spec.nativeFleet==='bus'?.21:.19;
 wheel.position.set(eye.x,yAt(wd,-.93),eye.z-wd);wheel.rotation.x=spec.nativeFleet==='bus'?-.65:-.18;
 const rim=mesh(new T.TorusGeometry(wr,.012,3,12),trim,'wheel-rim');wheel.add(rim);
 const hub=mesh(new T.BoxGeometry(.085,.035,.015),trim,'wheel-hub');hub.position.z=0;wheel.add(hub);
 for(const s of [-1,1]){const spoke=mesh(new T.BoxGeometry(wr-.04,.018,.015),edge,'wheel-spoke');spoke.position.set(s*(wr+.035)/2,0,0);wheel.add(spoke);}
 const badge=mesh(new T.PlaneGeometry(.032,.032),brandBadgeMaterial(spec),'wheel-badge');badge.position.z=.009;wheel.add(badge);
 cockpit.updateStructure=st=>{wheel.rotation.z=-st.steerInput*2.35;};
}
