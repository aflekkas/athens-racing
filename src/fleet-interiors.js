import * as T from 'three';
import {brandBadgeMaterial} from './brand-badges.js';
// Native fleet furniture, kept in the player's POV group only. Stations come
// from the original passenger/commercial cabs and each model's camera rig.
export function buildFleetInterior(cockpit,model){
 const s=model.spec,d=model.shape,g=cockpit.group,kind=s.nativeFleet;
 const dark=new T.MeshStandardMaterial({color:'#202429',roughness:.8,flatShading:true});
 const mid=new T.MeshStandardMaterial({color:kind==='bus'?'#747b80':kind==='byd_atto3'?'#4d6680':'#41474b',roughness:.7,flatShading:true});
 const metal=new T.MeshStandardMaterial({color:'#939b9f',roughness:.55});
 const add=(geo,mat,pos,name,role=name)=>{const o=new T.Mesh(geo,mat);o.position.set(...pos);o.name='authored-'+name;o.userData.cockpitStructure=role;g.add(o);return o;};
 const box=(size,pos,mat,name,role=name)=>add(new T.BoxGeometry(...size),mat,pos,name,role);
 if(s.twoWheeler){
  model.root.updateMatrixWorld(true);const inv=model.body.matrixWorld.clone().invert();
  for(const source of [...model.visualLOD.levels[0].object.children,...model.root.children]){
   if(!source.isMesh)continue;source.geometry.computeBoundingBox();const b=source.geometry.boundingBox.clone().applyMatrix4(source.matrixWorld).applyMatrix4(inv),p=b.getCenter(new T.Vector3());
   const tank=/fuel-tank|leg-shield|handlebar-cowl|nose-fairing/.test(source.name),bar=source.userData.mirrorSupport||(p.y>1&&p.y<1.11&&p.z<-.25);
   if(!tank&&!bar)continue;if([].concat(source.material).some(m=>m.userData?.vehicleGlass))continue;
   const o=source.clone();o.applyMatrix4(inv.clone().multiply(source.parent.matrixWorld));o.userData={...o.userData,cockpitStructure:bar?'handlebars':'tank'};g.add(o);
  }
  const bars=new T.Group();bars.name='authored-handlebars';g.add(bars);g.updateMatrixWorld(true);bars.position.set(0,1.05,kind==='delivery'||kind==='scooter'?-.55:-.36);bars.updateMatrixWorld(true);
  for(const o of [...g.children])if(o.userData.cockpitStructure==='handlebars')bars.attach(o);
  cockpit.povSteering=bars;cockpit.updateStructure=st=>{bars.rotation.y=-st.steerInput*.45;};
  box([.20,.10,.03],cockpit.display.position.toArray().map((x,i)=>x+(i===2?-.02:0)),dark,'bike-clocks','dash');return;
 }
 const bus=kind==='bus',truck=kind==='truck',van=kind==='van',ev=!!s.electric;
 const width=d.W-(bus?.25:.36),front=d.cowl+.06,face=bus?d.cowl+.20:truck?d.cowl+.38:van?d.cowl+.36:d.cowl+.36;
 const top=model.seat.y-.28;cockpit.instrumentFaceZ=bus?d.cowl+.10:face+.08;
 box([width,.18,Math.max(.35,face-front)], [0,top-.09,(face+front)/2],dark,kind+'-dashboard','dash');
 box([width*.96,.065,.08],[0,top-.125,face+.015],mid,kind+'-fascia','dash');
 box([bus?.48:.24,.18,.55],[bus?-.15:0,top-.33,face+.15],mid,kind+'-console','console');
 const wheel=new T.Group();wheel.name='authored-steering-wheel';wheel.position.set(model.seat.x,model.seat.y-.20,face+.23);wheel.rotation.x=bus?-1.20:-.4;g.add(wheel);cockpit.steering=wheel;cockpit.wheelInfo.pos.copy(wheel.position);cockpit.wheelInfo.r=bus?.21:truck?.18:.18;
 const spin=new T.Group();wheel.add(spin);cockpit.povSteering=spin;
 const rim=add(new T.TorusGeometry(cockpit.wheelInfo.r,.019,5,20),dark,[0,0,0],'wheel-rim','wheel-rim');spin.add(rim);
 const hub=box([ev?.115:.10,.07,.04],[0,0,0],mid,'wheel-hub','wheel-hub');spin.add(hub);
 for(const a of [0,Math.PI,-Math.PI/2]){const spoke=box([.13,.03,.02],[Math.cos(a)*.10,Math.sin(a)*.10,0],metal,'spoke','wheel-spoke');spoke.rotation.z=a;spin.add(spoke);}
 const badge=add(new T.PlaneGeometry(.044,.044),brandBadgeMaterial(s),[0,0,.022],'wheel-badge','wheel-badge');spin.add(badge);
 cockpit.display.geometry.dispose();cockpit.display.geometry=new T.PlaneGeometry(ev?.25:bus?.34:.24,ev?.10:.10);cockpit.display.position.set(model.seat.x,model.seat.y-.15,face+.018);
 box([ev?.28:bus?.37:.31,bus?.11:.14,.065],[model.seat.x,model.seat.y-.15,face-.02],dark,kind+'-binnacle','binnacle');
 const nav=cockpit.navDisplay;nav.geometry.dispose();nav.geometry=new T.PlaneGeometry(ev?.36:van?.18:.24,ev?.22:.14);nav.position.set(bus?-.05:0,top-(ev?.02:.15),face+.06);
 box([ev?.39:.27,ev?.25:.17,.04],[nav.position.x,nav.position.y,face+.035],mid,kind+'-screen-frame','console');
 for(const x of [-width*.42,width*.42]){if(kind==='byd_atto3'){const vent=add(new T.CylinderGeometry(.045,.045,.03,8),metal,[x,top-.07,face+.025],'turbine-vent','vent');vent.rotation.x=Math.PI/2;}else box([.13,.045,.025],[x,top-.07,face+.025],mid,kind+'-vent','vent');}
 for(const side of [-1,1])box([.06,.25,.85],[side*width/2,top-.18,model.seat.z-.1],mid,kind+'-door','door-top');
 cockpit.updateStructure=st=>{spin.rotation.z=-st.steerInput*2.35;};
}
