import * as T from 'three';
import {opaqueCabinMeshes,unobstructed} from '../src/pov-camera.js';
import {cockpitLampLayout} from '../src/cockpit-telltales.js';
export function auditPov(model,cockpit,camera){
 model.root.updateMatrixWorld(true);camera.updateMatrixWorld(true);model.root.traverse(o=>{if(o.isLOD)o.update(camera);});
 const meshes=opaqueCabinMeshes(model,true),eye=camera.position,point=(x,y,z)=>model.body.localToWorld(new T.Vector3(x,y,z));
 const visible=p=>{const q=p.clone().project(camera);return Math.abs(q.x)<1&&Math.abs(q.y)<1&&unobstructed(eye,p,meshes);};
 let road=0,total=0;for(let d=8;d<=12;d++)for(let x=-1.5;x<=1.5;x+=.25){total++;if(visible(point(cockpit.eye.x+x,0,-model.dims.L/2-d)))road++;}
 // Near-road visibility is tested in the driver's forward corridor, not through
 // the A-pillars at the edges of a three-metre-wide synthetic lane.
 let nearRoadDistance=null;
 for(let d=.5;d<=20;d+=.25){let clear=true;for(const extra of [0,1,2])for(const x of [-.15,0,.15])if(!visible(point(cockpit.eye.x+x,0,-model.dims.L/2-d-extra)))clear=false;if(clear){nearRoadDistance=d;break;}}
 const cluster=cockpit.povCluster||cockpit.group?.getObjectByName('instrument-cluster')||cockpit.display;
 let blocked=0,rim=0,count=0,lamps=0;
 const wheel=cockpit.povSteering||cockpit.wheel||cockpit.steering,wheelMeshes=[];if(wheel?.visible)wheel?.traverse(o=>{if(o.isMesh)wheelMeshes.push(o);});
 const cp=(x,y)=>cluster.localToWorld(new T.Vector3((x-.5)*cluster.geometry.parameters.width,(.5-y)*cluster.geometry.parameters.height,0));
 const artCanvas=cockpit.clusterCanvas||cockpit.canvas,art=artCanvas?.getContext('2d')?.getImageData(0,0,artCanvas.width,artCanvas.height);
 if(cluster){for(let y=.1;y<1;y+=.1)for(let x=.05;x<1;x+=.1){if(art&&art.data[(Math.floor(y*art.height)*art.width+Math.floor(x*art.width))*4+3]<32)continue;const p=cp(x,y);count++;if(!visible(p))blocked++;if(!unobstructed(eye,p,wheelMeshes))rim++;}
 for(const [x,y]of cockpitLampLayout(model.spec.body))if(!visible(cp(x/1024,y/384)))lamps++;}
 let header=0,upper=0;for(let y=.6;y<=1;y+=.05)for(let x=-.8;x<=.8;x+=.1){upper++;const p=new T.Vector3(x,y,.5).unproject(camera);p.sub(eye).normalize().multiplyScalar(5).add(eye);if(!unobstructed(eye,p,meshes))header++;}
 const horizon=point(cockpit.eye.x,camera.position.clone().applyMatrix4(model.body.matrixWorld.clone().invert()).y,-10000).project(camera);
 const result={nearRoadDistance,pitch:camera.rotation.x,eye:model.body.worldToLocal(eye.clone()).toArray(),roadVisible:100*road/total,clusterOcclusion:100*blocked/count,rimOcclusion:100*rim/count,telltalesBlocked:lamps,horizonFromTop:50*(1-horizon.y),headerIntrusion:100*header/upper,geometry:cockpit.eyeGeometry};
 const mirrors=cockpit.mirrors||['l','r'].map(side=>({name:side==='l'?'left':'right',mesh:model.body.getObjectByName('mirror_'+side)?.getObjectByName('mirror-face')})).filter(m=>m.mesh);
 result.mirrors=mirrors.map(m=>{m.mesh.geometry.computeBoundingBox();const p=m.mesh.localToWorld(m.mesh.geometry.boundingBox.getCenter(new T.Vector3())),q=p.clone().project(camera);return {name:m.name,inView:Math.abs(q.x)<1&&Math.abs(q.y)<1,clear:unobstructed(eye,p,meshes.filter(o=>o!==m.mesh))};});
 let nearPlaneObstructions=0;for(const x of [-.8,0,.8])for(const y of [-.8,0,.8]){const p=new T.Vector3(x,y,-1).unproject(camera);if(!unobstructed(eye,p,meshes))nearPlaneObstructions++;}result.nearPlaneObstructions=nearPlaneObstructions;
 result.visibleCharacters=[];model.root.traverse(o=>{if(!o.isMesh)return;let character=false,shown=true;for(let p=o;p;p=p.parent){shown&&=p.visible;if(/^(driver|passenger|hands?|arms?|rider|attached-rider)(?:$|[-_])/.test(p.name))character=true;}if(shown&&character)result.visibleCharacters.push(o.name);});
 result.flags=[];if(result.visibleCharacters.length)result.flags.push('character');if(nearPlaneObstructions)result.flags.push('camera-clip');if(nearRoadDistance===null||nearRoadDistance>10)result.flags.push('road');if(result.clusterOcclusion>5||result.rimOcclusion>5||lamps)result.flags.push('cluster');if(result.horizonFromTop<35||result.horizonFromTop>60)result.flags.push('horizon');return result;
}
