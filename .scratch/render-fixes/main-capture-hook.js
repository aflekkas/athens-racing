// Evidence-only hook in private archives; excluded from production commits.
const renderFixHook=setInterval(()=>{
 if(!window.__sim?.render)return;clearInterval(renderFixHook);
 const sim=window.__sim,draw=sim.render;let done=false;
 const capture=(name,diagnosis={})=>{sim.post.resetHistory();draw();sim.renderer.getContext().finish();console.error('__RENDER_FIX_CAPTURE__'+JSON.stringify({name,diagnosis,png:sim.canvas.toDataURL().split(',')[1]}));};
 sim.render=()=>{
  if(!done&&sim.player.veh.s>5000){
   done=true;
   const root=sim.player.model.root,saved={s:sim.player.veh.s,u:sim.player.veh.u,v:sim.player.veh.vLong,p:sim.camera.position.clone(),q:sim.camera.quaternion.clone(),root:root.position.clone()},sun=sim.scene.children.find(m=>m.isDirectionalLight),dir=sun.position.clone().sub(sun.target.position).normalize(),matrix=new THREE.Matrix4(),position=new THREE.Vector3();let lamp=null,shadowPoint=null;
   sim.scene.traverse(m=>{if(lamp||!m.isInstancedMesh||m.geometry.type!=='CylinderGeometry'||m.geometry.parameters.height!==9.5)return;for(let i=0;i<m.count;i++){m.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);const q=sim.route.project(position.x,position.z,null);if(q.s<100||q.s>11000)continue;for(const fraction of [.25,.5,.75,1]){const tip=position.clone().add(new THREE.Vector3(0,9.5*fraction,0)),p=tip.clone();for(let n=0;n<5;n++){const r=sim.route.project(p.x,p.z,null),y=sim.ground.at(p.x,p.z,r.s,r.u,{}).y;p.copy(tip).addScaledVector(dir,-(tip.y-y)/dir.y);}const r=sim.route.project(p.x,p.z,null);if(Math.abs(r.u)>sim.route.edge(r.s)-.6||Math.abs(r.u)<1.5)continue;lamp=m;shadowPoint=p;break;}if(lamp)break;}});
   if(lamp){
    const q=sim.route.project(shadowPoint.x,shadowPoint.z,null);sim.player.veh.reset(q.s,q.u+2.5,0);sim.step(1);
    const fwd=new THREE.Vector3(0,0,-1).applyQuaternion(root.quaternion);sim.camera.position.copy(root.position).addScaledVector(fwd,-4.5);sim.camera.position.y+=4;sim.camera.lookAt(root.position.clone().addScaledVector(fwd,1.8));sim.camera.updateMatrixWorld(true);
    const ray=new THREE.Raycaster(shadowPoint.clone().add(new THREE.Vector3(0,.002,0)),dir),hit=ray.intersectObject(lamp)[0],diagnosis={s:q.s,u:q.u,shadowPoint:shadowPoint.toArray(),caster:hit?{geometry:hit.object.geometry.type,height:hit.object.geometry.parameters.height,instanceId:hit.instanceId}:null};
    for(const on of [true,false]){lamp.castShadow=on;sim.renderer.shadowMap.needsUpdate=true;capture(on?'pole-band':'pole-band-caster-off',diagnosis);}lamp.castShadow=true;
    sim.player.veh.reset(saved.s,saved.u,saved.v);sim.step(1);
   }else console.error('__RENDER_FIX_DIAG__'+JSON.stringify({poleFound:false}));
   // A static visual fixture over the worst measured submerged bed; physics
   // driving is captured separately by the harness at 43 km/h on the road.
   const p=new THREE.Vector3(6727.630859375,.651430070400238,3021.921142578125),ter=sim.scene.getObjectByName('terrain'),ray=new THREE.Raycaster(p.clone().add(new THREE.Vector3(0,30,0)),new THREE.Vector3(0,-1,0)),groundY=ray.intersectObject(ter,true)[0]?.point.y;
   root.position.copy(p).add(new THREE.Vector3(3,.3,3));sim.camera.position.copy(p).add(new THREE.Vector3(5,8,7));sim.camera.lookAt(p);sim.camera.updateMatrixWorld(true);capture('beach-loungers-overhead',{groundY,waterY:0,intendedBedY:p.y});root.position.copy(saved.root);
   for(let i=0;i<3;i++){const angle=.35+i*.25;sim.camera.position.copy(root.position).add(new THREE.Vector3(Math.cos(angle)*7,5,Math.sin(angle)*7));sim.camera.lookAt(root.position);sim.camera.updateMatrixWorld(true);capture('orbit-'+i);}
   sim.camera.position.copy(saved.p);sim.camera.quaternion.copy(saved.q);sim.camera.updateMatrixWorld(true);sim.post.resetHistory();
  }
  return draw();
 };
},500);
