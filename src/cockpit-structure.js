import {attachCockpitWipers} from './cockpit-rain.js';
import * as T from 'three';
import {DEFAULTS} from './settings.js';
import {derivePovEye} from './pov-camera.js';

// The glass the frame is built on, found the same way for every body family (and by pov-camera's windscreenBounds).
export const windscreenGlass=model=>model.windscreen||model.body.getObjectByName('windscreen-glass')||model.body.getObjectByName('cab-windscreen-glass')||model.body.getObjectByName('panoramic-front-glass');

// A closed car has a roof: its header (and headliner edge) must show across the top of the default POV frame.
export const closedCockpit=model=>!model.spec.convertible&&!model.shape?.open;
// Where the header's lower edge lands on screen (NDC y, 1 = top of frame) in the default POV (shared with the guard).
export const HEADER_BAND_NDC=.95;

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
 const glass=windscreenGlass(model);
 model.root.updateMatrixWorld(true);
 const points=[];
 if(glass){const pos=glass.geometry.attributes.position;for(let i=0;i<pos.count;i++)points.push(model.body.worldToLocal(glass.localToWorld(v(0,0,0).fromBufferAttribute(pos,i))));}
 const bounds=new T.Box3().setFromPoints(points),sh=model.shape,half=(model.dash.w||sh.W*.8)/2;
 // The four frame corners are the outermost glass vertices of the lower and upper halves. Bowed (arched) screens have
 // their highest vertices at the centre line, so "highest row" would pull the pillar tops inward into bent beams.
 const corners=()=>{
  if(!points.length)return null;
  const mid=(bounds.min.y+bounds.max.y)/2,low=points.filter(p=>p.y<mid),high=points.filter(p=>p.y>=mid);
  const out=(rows,sign)=>rows.reduce((a,p)=>sign*p.x>sign*a.x+1e-4||(Math.abs(p.x-a.x)<=1e-4&&(rows===high?p.y>a.y:p.y<a.y))?p:a).clone();
  return [out(low,-1),out(low,1),out(high,-1),out(high,1)];
 };
 const frame=corners();
 const [bl,br]=frame?[frame[0],frame[1]]:[v(-half,sh.belt,sh.cowl),v(half,sh.belt,sh.cowl)];
 const [tl,tr]=frame?[frame[2],frame[3]]:[v(-half,sh.H-.08,sh.header),v(half,sh.H-.08,sh.header)];
 // Pillars carry on along the glass edge past the corner (the sealed frame), never off towards another point.
 // Cars carry the pillars up to the body's roof line (shape.H) at most .22 m beyond the glass corner; commercial
 // bodies keep their short fixed frame.
 const commercial=['van','truck','bus'].includes(spec.nativeFleet);
 const dirs=[[bl,tl],[br,tr]].map(([b,t])=>t.clone().sub(b).normalize());
 let exts=[[bl,tl],[br,tr]].map(([b,t],i)=>commercial||!frame?.08:Math.min(.22,Math.max(.05,(sh.H+.025-t.y)/Math.max(dirs[i].y,.2))));
 if(frame&&closedCockpit(model)&&!commercial){
  // Closed cars keep a thin header band in view: the pillars carry on (at most .22 m past the glass) until the header's
  // lower edge sits at the top of the default frame. (Van / truck / bus windscreens are taller than the frame.)
  const eye=derivePovEye(model,cockpit),cam=new T.PerspectiveCamera(DEFAULTS.cockpitFov,1.6,.035,100);
  cam.position.copy(eye);cam.rotation.set(cockpit.eyePitch,0,0);cam.updateMatrixWorld(true);
  const lowerEdge=e=>{
   const p=[tl,tr].map((t,i)=>t.clone().addScaledVector(dirs[i],e)),y=(p[0].y+p[1].y)/2,z=(p[0].z+p[1].z)/2+.012;
   const lift=Math.max(0,bounds.max.y+e*.5-y);
   return v(0,y+lift-.013,z).project(cam).y;
  };
  let best=0;for(let e=0;e<=.22+1e-9;e+=.005)if(lowerEdge(e)<=HEADER_BAND_NDC)best=e;
  exts=exts.map(()=>best);
 }
 for(const [i,[b,t]]of [[bl,tl],[br,tr]].entries())t.addScaledVector(dirs[i],exts[i]);
 const ext=(exts[0]+exts[1])/2;
 for(const p of [bl,br,tl,tr])p.z+=.012;
 // The header is straight but the glass top edge bows up at the centre: lift it so no frame crosses the aperture.
 const bow=frame?Math.max(0,bounds.max.y+ext*.5-(tl.y+tr.y)/2):0,headerL=tl.clone().add(v(0,bow,0)),headerR=tr.clone().add(v(0,bow,0));
 const thickness=spec.nativeFleet==='bus'?.105:spec.nativeFleet==='truck'?.08:spec.convertible?.055:.05;
 const fleet=commercial;
 beam(headerL,headerR,fleet?.045:.026,trim,'header',fleet?.075:.04);
 if(!spec.convertible&&!sh.open)panel([headerL,headerR,v(half,headerR.y+(fleet?.06:.05),fleet?model.seat.z+.4:headerR.z+.07),v(-half,headerL.y+(fleet?.06:.05),fleet?model.seat.z+.4:headerL.z+.07)],trim,'headliner');
 beam(headerL.clone().add(v(0,-.026,.018)),headerR.clone().add(v(0,-.026,.018)),.009,trim,'visor-edge');
 for(const [s,b,t]of [[-1,bl,tl],[1,br,tr]]){
  // the pillar stands outboard of the glass: its inner face is flush with the glass edge instead of straddling it
  const out=v(s*Math.min(thickness/2,.03),0,0);beam(b.clone().add(out),t.clone().add(out),thickness,trim,'pillar',['bus','truck'].includes(spec.nativeFleet)?.045:.02);
  const cap=b.clone();if(spec.nativeFleet==='bus')cap.y=Math.max(cap.y,model.seat.y-.27);beam(cap,v(s*half,cap.y-.02,model.seat.z+.25),fleet?.075:.032,trim,'door-top',fleet?.085:.04);
  if(!spec.convertible)beam(t,v(s*half,t.y,model.seat.z+.30),fleet?.065:.028,trim,'window-frame',fleet?.085:.03);
 }
 // Follow the actual body cowl/front height; bus has no bonnet beyond its glass.
 if(spec.nativeFleet!=='bus'){
  const z=-model.dims.L/2+.18,fy=Math.min(bl.y-.06,sh.front??bl.y-.12);
  panel([bl.clone().add(v(0,-.035,-.025)),br.clone().add(v(0,-.035,-.025)),v(half*.9,fy,z),v(-half*.9,fy,z)],paint,'deck');
 }
 attachCockpitWipers(model,group,[bl,br,tr,tl],trim);
 const interior=cockpit.mirrors?.find(m=>m.name==='interior')?.mesh;
 if(interior){
  // The stalk drops from the top glass edge straight above the mirror (it stays on the roof side of the glass).
  cockpit.mirrorStem.visible=false;cockpit.mirrorMount.visible=false;
  const mirror=model.body.worldToLocal(interior.getWorldPosition(v(0,0,0))),top=frame?points.reduce((a,p)=>p.y>a.y?p:a).clone():headerL.clone().lerp(headerR,.5);
  beam(mirror.clone().add(v(0,.05,-.02)),v(mirror.x,top.y+.01,top.z+.012),.014,trim,'mirror-mount');
 }
 for(const key of ['mirrorL','mirrorR']){const m=model[key]||model.body.getObjectByName(key==='mirrorL'?'mirror_l':'mirror_r')?.getObjectByName('mirror-face');if(!m)continue;const p=model.body.worldToLocal(m.getWorldPosition(v(0,0,0)));beam(p.x<0?bl:br,p,.028,paint,'mirror-mount');}
 cockpit.updateStructure=()=>{};
}
