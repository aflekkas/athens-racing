import {buildCockpitStructure} from './cockpit-structure.js';
import {drawPovInstruments} from './pov-instruments.js';
import {CockpitLamps,lampArtVersion} from './cockpit-telltales.js';
import {derivePovEye} from './pov-camera.js';
import {setVehicleCockpitView} from './glass-tint.js';
// Cockpit-only instruments and connected structure; exterior fleet shells have no interior.
import * as THREE from './vehicle-primitives.js';
export class FleetCockpit{
 constructor(spec,model){
  this.spec=spec;this.model=model;this.eye=model.seat.clone();
  const group=this.group=new THREE.Group();group.name="fleet-cockpit";model.body.add(group);
  this.wheelInfo={pos:new THREE.Vector3(model.dash.x,model.dash.wheelY,model.dash.wheelZ),angle:0,euler:new THREE.Euler(-.55,0,0),r:model.dash.wheelR};
  this.canvas=document.createElement('canvas');this.canvas.width=1024;this.canvas.height=384;this.ctx=this.canvas.getContext('2d');
  this.texture=new THREE.CanvasTexture(this.canvas);this.texture.colorSpace=THREE.SRGBColorSpace;
  this.material=new THREE.MeshBasicMaterial({map:this.texture,toneMapped:false});
  this.display=new THREE.Mesh(new THREE.PlaneGeometry(spec.twoWheeler?.16:.34,spec.twoWheeler?.06:.09),this.material);
  this.display.name='fleet-instruments';this.display.position.copy(this.wheelInfo.pos).add(new THREE.Vector3(0,.03,-.20));if(spec.nativeFleet==='bus')this.display.position.y=model.seat.y-.32;group.add(this.display);
  this.navCanvas=document.createElement('canvas');this.navCanvas.width=256;this.navCanvas.height=256;this.navTex=new THREE.CanvasTexture(this.navCanvas);this.navTex.colorSpace=THREE.SRGBColorSpace;
  this.navMaterial=new THREE.MeshBasicMaterial({map:this.navTex,toneMapped:false});this.navDisplay=new THREE.Mesh(new THREE.PlaneGeometry(spec.twoWheeler?.1:.18,spec.twoWheeler?.06:.06),this.navMaterial);this.navDisplay.name='fleet-navigation';this.navDisplay.position.copy(this.display.position).add(new THREE.Vector3(spec.twoWheeler?.14:.32,0,.01));group.add(this.navDisplay);
  if(!spec.twoWheeler){const trim=new THREE.MeshStandardMaterial({color:'#161c20',roughness:.7});const wheel=this.steering=new THREE.Mesh(new THREE.TorusGeometry(model.dash.wheelR,.015,3,8),trim);wheel.position.copy(this.wheelInfo.pos);wheel.rotation.x=-.55;group.add(wheel);}this.lamps=new CockpitLamps();this.draw(-1,'N');group.visible=false;derivePovEye(model,this);buildCockpitStructure(model,this);
 }
 draw(speed,gear){if(this.model.cockpitView){const key=[Math.round(speed),gear,Math.round((this.state?.rpm||0)/50),lampArtVersion,...(this.lampState||[]).map(l=>l[1])].join('|');if(key===this.povLast)return;this.povLast=key;drawPovInstruments(this.canvas,{...this.state,kmh:speed,gearLabel:gear},this.lampState,this.spec);this.texture.needsUpdate=true;return;}const key=Math.round(speed)+'|'+gear;if(key===this.last)return;this.last=key;const c=this.ctx;c.save();c.scale(4,3);c.fillStyle='#11191d';c.fillRect(0,0,256,128);c.fillStyle='#e7f1ef';c.textAlign='center';c.font='bold 62px sans-serif';c.fillText(String(Math.max(0,Math.round(speed))),105,75);c.font='22px sans-serif';c.fillText('km/h',105,108);c.fillText(String(gear),220,77);c.restore();this.texture.needsUpdate=true;}
 update(dt,st){this.updateStructure(st);this.state=st;this.lampState=this.lamps.update(dt,st);this.wheelInfo.angle=-st.steerInput*2.35;if(this.steering)this.steering.rotation.z=this.wheelInfo.angle;this.draw(st.kmh,st.gearLabel);}
 mirrorFov(){return 60;}
 renderMirrors(){}
 setVisible(v){if(this.steering)this.steering.visible=false;this.group.visible=v;setVehicleCockpitView(this.model,v);}
 setDetail(){}
 disposeMirrors(){this.group.removeFromParent();this.display.removeFromParent();this.display.geometry.dispose();this.material.dispose();this.texture.dispose();this.navDisplay.removeFromParent();this.navDisplay.geometry.dispose();this.navMaterial.dispose();this.navTex.dispose();}
}
