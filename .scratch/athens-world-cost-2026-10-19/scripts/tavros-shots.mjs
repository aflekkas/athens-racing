// Place the car ON the Tavros underpass link (way 45190676) and shoot it at street level and from above.
// node tavros-shots.mjs APP R2 OUTDIR
import {mkdir} from 'node:fs/promises';import {startServer,launch,counters} from '/home/dev/projects/paraliaki-racing/.scratch/athens-world-centre-2026-10-19/scripts/lib.mjs';
const [app,r2,outdir]=process.argv.slice(2);await mkdir(outdir,{recursive:true});
const c=counters(),{server,port}=await startServer({app,r2,c}),{browser,page}=await launch();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(`http://127.0.0.1:${port}/?map=athens`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__athens,null,{timeout:600000});
 const placed=await page.evaluate(async()=>{const A=window.__athens;await A.stream.teleport({x:-5822,z:3978},()=>{});await new Promise(r=>setTimeout(r,6000));
  const edge=[...A.roads.graph.edges.values()].map(v=>v.value).find(e=>e.id.includes('way:45190676'));if(!edge)return {error:'edge not loaded'};
  const pts=edge.points,k=Math.floor(pts.length*.55),p=pts[k],q=pts[k+1];const yaw=Math.atan2(-(q[0]-p[0]),-(q[2]-p[2]));
  A.place({x:p[0],y:p[1]+.2,z:p[2],yaw});A.player.veh.vLong=0;A.setPaused(true);
  const contact=A.stream.contact(p[0],p[2],{referenceY:p[1],layer:0,requiredFlags:1});return {edge:edge.id,point:p,yaw,contact:contact&&{y:contact.y,surface:contact.surfaceId,layer:contact.layer}};});
 console.log(JSON.stringify(placed));
 for(const [name,cfg] of [['tavros-link-street',{carcam:[0,3.4,8,9],far:600}],['tavros-link-above',{above:[25,55,45],far:900}]]){
  await page.evaluate(([cfg])=>{const A=window.__athens;A.setCameraHook((cam,v,o)=>{cam.far=cfg.far;A.scene.fog.near=cam.far*.65;A.scene.fog.far=cam.far;cam.updateProjectionMatrix();
   if(cfg.carcam){const [side,up,back,ahead]=cfg.carcam,fx=-Math.sin(v.yaw),fz=-Math.cos(v.yaw),rx=Math.cos(v.yaw),rz=-Math.sin(v.yaw);
    cam.position.set(v.x-o.x-fx*back+rx*side,v.y+up,v.z-o.z-fz*back+rz*side);cam.lookAt(v.x-o.x+fx*ahead,v.y+1,v.z-o.z+fz*ahead);}
   else{const [dx,dy,dz]=cfg.above;cam.position.set(v.x-o.x+dx,v.y+dy,v.z-o.z+dz);cam.lookAt(v.x-o.x,v.y,v.z-o.z);}});},[cfg]);
  await page.waitForTimeout(9000);await page.screenshot({path:`${outdir}/${name}.png`});console.log('shot',name);
 }
}finally{await browser.close();server.close();console.log(JSON.stringify({errors:errors.slice(0,3)}));}
