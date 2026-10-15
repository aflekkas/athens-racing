// Native fleet models already contain their seats, dashboard and steering column.
// Keep that cabin and place a small live instrument face at the real driver's station.
import * as THREE from 'three';
export class FleetCockpit{
 constructor(spec,model){
  this.spec=spec;this.model=model;this.eye=model.seat.clone();
  this.wheelInfo={pos:new THREE.Vector3(model.dash.x,model.dash.wheelY,model.dash.wheelZ),angle:0,euler:new THREE.Euler(-.55,0,0),r:model.dash.wheelR};
  this.canvas=document.createElement('canvas');this.canvas.width=256;this.canvas.height=128;this.ctx=this.canvas.getContext('2d');
  this.texture=new THREE.CanvasTexture(this.canvas);this.texture.colorSpace=THREE.SRGBColorSpace;
  this.material=new THREE.MeshBasicMaterial({map:this.texture,toneMapped:false});
  this.display=new THREE.Mesh(new THREE.PlaneGeometry(spec.twoWheeler?.16:.34,spec.twoWheeler?.08:.17),this.material);
  this.display.name='fleet-instruments';this.display.position.copy(this.wheelInfo.pos).add(new THREE.Vector3(0,.03,-.20));model.body.add(this.display);
  this.navCanvas=document.createElement('canvas');this.navCanvas.width=256;this.navCanvas.height=256;this.navTex=new THREE.CanvasTexture(this.navCanvas);this.navTex.colorSpace=THREE.SRGBColorSpace;
  this.navMaterial=new THREE.MeshBasicMaterial({map:this.navTex,toneMapped:false});this.navDisplay=new THREE.Mesh(new THREE.PlaneGeometry(spec.twoWheeler?.1:.22,spec.twoWheeler?.1:.22),this.navMaterial);this.navDisplay.name='fleet-navigation';this.navDisplay.position.copy(this.display.position).add(new THREE.Vector3(spec.twoWheeler?.14:.32,0,.01));model.body.add(this.navDisplay);
  this.steering=model.body.getObjectByName('steering-wheel');this.draw(-1,'N');
 }
 draw(speed,gear){const key=Math.round(speed)+'|'+gear;if(key===this.last)return;this.last=key;const c=this.ctx;c.fillStyle='#11191d';c.fillRect(0,0,256,128);c.fillStyle='#e7f1ef';c.textAlign='center';c.font='bold 62px sans-serif';c.fillText(String(Math.max(0,Math.round(speed))),105,75);c.font='22px sans-serif';c.fillText('km/h',105,108);c.fillText(String(gear),220,77);this.texture.needsUpdate=true;}
 update(dt,st){this.wheelInfo.angle=-st.steerInput*2.35;if(this.steering)this.steering.rotation.z=this.wheelInfo.angle;this.draw(st.kmh,st.gearLabel);}
 mirrorFov(){return 60;}
 renderMirrors(){}
 drawRearStrip(){}
 setVisible(v){this.display.visible=v;this.navDisplay.visible=v;}
 setDetail(){}
 disposeMirrors(){this.display.removeFromParent();this.display.geometry.dispose();this.material.dispose();this.texture.dispose();this.navDisplay.removeFromParent();this.navDisplay.geometry.dispose();this.navMaterial.dispose();this.navTex.dispose();}
}
