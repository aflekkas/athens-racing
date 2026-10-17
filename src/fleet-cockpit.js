import {installCabinLOD} from './vehicle-cabin.js';
import {seatCockpitControls} from './cockpit-seating.js';
import {buildCockpitStructure} from './cockpit-structure.js';
import {drawFleetInstruments} from './fleet-instruments.js';
import {buildFleetInterior} from './fleet-interiors.js';
import {CockpitLamps,lampArtVersion} from './cockpit-telltales.js';
import {derivePovEye} from './pov-camera.js';
import {setVehicleCockpitView} from './glass-tint.js';
// Shared empty fleet cabin, instruments and connected structure.
import * as THREE from './vehicle-primitives.js';
export class FleetCockpit{
 constructor(spec,model){
  this.spec=spec;this.model=model;this.eye=model.seat.clone();
  const group=this.group=new THREE.Group();group.name="fleet-cockpit";model.body.add(group);
  this.wheelInfo={pos:new THREE.Vector3(model.dash.x,model.dash.wheelY,model.dash.wheelZ),angle:0,euler:new THREE.Euler(-.55,0,0),r:model.dash.wheelR};
  this.canvas=document.createElement('canvas');this.canvas.width=1024;this.canvas.height=384;this.ctx=this.canvas.getContext('2d');
  this.texture=new THREE.CanvasTexture(this.canvas);this.texture.colorSpace=THREE.SRGBColorSpace;
  this.material=new THREE.MeshBasicMaterial({map:this.texture,toneMapped:false});
  this.display=new THREE.Mesh(new THREE.PlaneGeometry(.34,.09),this.material);
  this.display.name='fleet-instruments';this.display.position.copy(this.wheelInfo.pos).add(new THREE.Vector3(0,.03,-.20));if(spec.nativeFleet==='bus')this.display.position.y=model.seat.y-.32;group.add(this.display);
  this.navCanvas=document.createElement('canvas');this.navCanvas.width=256;this.navCanvas.height=256;this.navTex=new THREE.CanvasTexture(this.navCanvas);this.navTex.colorSpace=THREE.SRGBColorSpace;
  this.navMaterial=new THREE.MeshBasicMaterial({map:this.navTex,toneMapped:false});this.navDisplay=new THREE.Mesh(new THREE.PlaneGeometry(.18,.06),this.navMaterial);this.navDisplay.name='fleet-navigation';this.navDisplay.position.copy(this.display.position).add(new THREE.Vector3(.32,0,.01));group.add(this.navDisplay);
  this.lamps=new CockpitLamps();this.draw(-1,'N');group.visible=false;buildCockpitStructure(model,this);buildFleetInterior(this,model);derivePovEye(model,this);seatCockpitControls(model,this);installCabinLOD(model,this);
 }
 draw(speed,gear){const key=[Math.round(speed),gear,Math.round((this.state?.rpm||0)/50),lampArtVersion,...(this.lampState||[]).map(l=>l[1])].join('|');if(key===this.last)return;this.last=key;drawFleetInstruments(this.canvas,{...this.state,kmh:speed,gearLabel:gear},this.lampState,this.spec);this.texture.needsUpdate=true;}
 update(dt,st){this.updateStructure(st);this.state=st;this.lampState=this.lamps.update(dt,st);this.wheelInfo.angle=-st.steerInput*2.35;this.draw(st.kmh,st.gearLabel);}
 mirrorFov(){return 60;}
 renderMirrors(){}
 setVisible(v){if(this.steering)this.steering.visible=true;this.structure.visible=v;this.lod.visible=true;this.lod.autoUpdate=!v;if(v)this.lod.levels.forEach((l,i)=>l.object.visible=i===0);setVehicleCockpitView(this.model,v);}
 setDetail(){}
 disposeMirrors(){this.group.removeFromParent();this.display.removeFromParent();this.display.geometry.dispose();this.material.dispose();this.texture.dispose();this.navDisplay.removeFromParent();this.navDisplay.geometry.dispose();this.navMaterial.dispose();this.navTex.dispose();}
}
