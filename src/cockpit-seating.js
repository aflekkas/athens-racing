import * as T from 'three';
// Adjust column height and the authored binnacle once at construction. Each
// dashboard keeps its own shapes/art; personal seat sliders never move furniture.
export function seatCockpitControls(model,cockpit){
 if(model.spec.twoWheeler)return;
 const wheel=cockpit.wheel||cockpit.steering,cluster=cockpit.group.getObjectByName('instrument-cluster')||cockpit.display;
 if(!wheel||!cluster)return;
 model.root.updateMatrixWorld(true);
 const point=o=>model.body.worldToLocal(o.getWorldPosition(new T.Vector3())),eye=cockpit.eye;
 let wp=point(wheel);const distance=T.MathUtils.clamp(eye.z-wp.z,.50,.62);
 const station=wp.clone();station.z=eye.z-distance;
 wheel.position.copy(wheel.parent.worldToLocal(model.body.localToWorld(station)));
 model.root.updateMatrixWorld(true);wp=point(wheel);
 const y=eye.y+distance*Math.tan(Math.atan(-.82*Math.tan(66*Math.PI/360))+cockpit.eyePitch);
 wheel.position.y+=y-wp.y-(model.spec.nativeFleet==='bus'?.07:0);model.root.updateMatrixWorld(true);wp=point(wheel);
 const opening=model.spec.nativeFleet==='bus'?wp.clone().add(new T.Vector3(0,.19,-.10)):model.body.worldToLocal(wheel.localToWorld(new T.Vector3(0,model.spec.nativeFleet==='city'?.09:['mini','mini_jcw'].includes(model.spec.body)?.115:.105,.025)));
 let cp=point(cluster);const assembly=cockpit.instrumentAssembly;
 const clusterZ=Math.max(wp.z-T.MathUtils.clamp(wp.z-cp.z,.18,.28),model.shape.cowl+.10,cockpit.instrumentFaceZ??-Infinity),deltaZ=clusterZ-cp.z;
 if(assembly)assembly.position.z+=deltaZ/(assembly.parent.getWorldScale(new T.Vector3()).z/model.body.getWorldScale(new T.Vector3()).z);else cluster.position.z+=deltaZ;
 model.root.updateMatrixWorld(true);cp=point(cluster);
 const ratio=(eye.z-cp.z)/(eye.z-opening.z),target=eye.clone().lerp(opening,ratio);
 if(assembly){
  if(model.spec.centerCluster){assembly.position.x+=.05-cp.x;target.y=eye.y-.13;}
  assembly.position.y+=target.y-cp.y;
  model.root.updateMatrixWorld(true);
  // A deep support connects the original cluster hood to the original dash.
  const bottom=target.y-cluster.geometry.parameters.height*assembly.scale.y/2;
  const top=model.seat.y-.21;
  if(bottom>top){const support=new T.Mesh(new T.BoxGeometry(cluster.geometry.parameters.width*assembly.scale.x,.01+bottom-top,.07),new T.MeshStandardMaterial({color:'#16191c',roughness:.8}));support.name='authored-binnacle-support';support.userData.cockpitStructure='binnacle';support.position.set(model.spec.centerCluster?.05:cp.x,(bottom+top)/2,cp.z-.04);cockpit.group.add(support);}
 }else{
  const oldY=cluster.position.y;cluster.position.y+=target.y-cp.y;
  for(const o of cockpit.group.children)if(o.name.endsWith('-binnacle')){o.position.y+=cluster.position.y-oldY;o.position.z+=deltaZ;}
 }
 cockpit.wheelInfo.pos.copy(point(wheel));
 model.root.updateMatrixWorld(true);
}
