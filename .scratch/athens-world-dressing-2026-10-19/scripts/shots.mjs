// Spec-driven screenshots of the streamed world. node shots.mjs APP R2 OUTDIR SPEC.json
// spec: [{name, car:[x,z], at:[x,z,refY?], cam:[dx,dy,dz], far?, wait?}]  - the car is teleported to the nearest tow anchor of `car`;
// the camera sits at (ground at `at`) + cam and looks at it. Fog and far plane are reset for every shot.
import {readFile,mkdir} from 'node:fs/promises';import {startServer,launch,counters} from './lib.mjs';
const [app,r2,outdir,specFile]=process.argv.slice(2);await mkdir(outdir,{recursive:true});
const spec=JSON.parse(await readFile(specFile,'utf8')),c=counters(),{server,port}=await startServer({app,r2,c});
const {browser,page}=await launch();const report={errors:[],shots:[]};page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/THREE\.WebGL|shader|GLSL/i.test(m.text()))report.errors.push(m.text().slice(0,400));});
try{
  await page.goto(`http://127.0.0.1:${port}/?map=athens`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__athens,null,{timeout:600000});
  for(const s of spec){
    const car=s.car||s.at;
    // Nearest anchor across the whole manifest requires the tile loaded; teleport through the stream by cell, then pick locally.
    const res=await page.evaluate(async([x,z])=>{const A=window.__athens;
      const near=()=>[...A.roads.anchors({validate:true})].sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))[0];
      let a=near();
      for(let i=0;i<4&&(!a||Math.hypot(a.x-x,a.z-z)>60);i++){
        await A.stream.teleport({x,z},()=>{});await new Promise(r=>setTimeout(r,4000));a=near();
      }
      if(!a)return {error:'no anchor'};
      await A.goto(a.id,a.x,a.z);return {id:a.id,d:Math.hypot(a.x-x,a.z-z)};},[car[0],car[1]]).catch(e=>({error:String(e.message).slice(0,200)}));
    if(s.deck)report[s.name+'-deck']=await page.evaluate(async([x,z])=>{const A=window.__athens;
      for(let r=0;r<=60;r+=4)for(let a=0;a<(r?8:1);a++){const px=x+Math.cos(a*Math.PI/4)*r,pz=z+Math.sin(a*Math.PI/4)*r;
        for(const ry of [8,14,20,26,32,40]){const c=A.stream.contact(px,pz,{referenceY:ry});
          if(c&&c.layer===1&&(c.flags&1)){const n=A.roads.graph.nearest(px,pz,{layer:1,referenceY:c.y,maxDistance:20});if(!n)continue;
            A.place({x:px,y:c.y,z:pz,yaw:n.yaw});A.player.veh.vLong=0;return {x:px,y:c.y,z:pz,yaw:n.yaw,edge:n.edge};}}}
      return null;},s.deck).catch(e=>String(e.message).slice(0,200));
    await page.evaluate(async d=>{(await import('/src/settings.js')).setSetting('worldDetail',d);},s.detail!==false);
    await page.evaluate(([cfg])=>{const A=window.__athens;A.setPaused(true);
      A.setCameraHook((cam,v,o)=>{
        if(cfg.carcam){cam.far=cfg.far||700;A.scene.fog.near=cam.far*.65;A.scene.fog.far=cam.far;cam.updateProjectionMatrix();const [side,up,back,ahead]=cfg.carcam,fx=-Math.sin(v.yaw),fz=-Math.cos(v.yaw),rx=Math.cos(v.yaw),rz=-Math.sin(v.yaw);cam.position.set(v.x-o.x-fx*back+rx*side,v.y+up,v.z-o.z-fz*back+rz*side);cam.lookAt(v.x-o.x+fx*ahead,v.y+1,v.z-o.z+fz*ahead);return;}
        cam.far=cfg.far||850;A.scene.fog.near=cam.far*.65;A.scene.fog.far=cam.far;cam.updateProjectionMatrix();
        const [ax,az,ry]=cfg.at,c=A.stream.contact(ax,az,{referenceY:cfg.deckAt?v.y:(ry??v.y),layer:cfg.layer}),y=cfg.fixedY??(c?c.y:v.y);
        cam.position.set(ax-o.x+cfg.cam[0],y+cfg.cam[1],az-o.z+cfg.cam[2]);cam.lookAt(ax-o.x,y+(cfg.lookUp||0),az-o.z);
      });},[{at:s.deck&&!s.at?[s.deck[0],s.deck[1]]:s.at,cam:s.cam,far:s.far,lookUp:s.lookUp,carcam:s.carcam,layer:s.layer,fixedY:s.fixedY,deckAt:!!s.deck&&!s.at}]);
    if(s.pre)await page.evaluate(code=>{const A=window.__athens;return eval(code);},s.pre);
    await page.waitForTimeout(s.wait||9000);await page.screenshot({path:`${outdir}/${s.name}.png`});const info=await page.evaluate(()=>{const A=window.__athens,i=A.renderer.info;i.autoReset=false;i.reset();A.render(.016);const out={calls:i.render.calls,triangles:i.render.triangles,textures:i.memory.textures,geometries:i.memory.geometries};i.autoReset=true;return out;});report.shots.push({name:s.name,placed:res,info});console.log('shot',s.name,JSON.stringify(res));
  }
}catch(e){report.failure=e.stack;console.log(e.stack)}finally{await browser.close();server.close();console.log(JSON.stringify({errors:report.errors.slice(0,6),worldBytes:c.world.bytes,cells:c.world.count}));const {writeFile}=await import('node:fs/promises');await writeFile(outdir+'/report.json',JSON.stringify(report,null,1));}
