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
    const car=s.car||s.at||s.eye;
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
      A.setCameraHook((cam,v,o)=>{A.__o=o;
        if(cfg.carcam){cam.far=cfg.far||700;A.scene.fog.near=cam.far*.65;A.scene.fog.far=cam.far;cam.updateProjectionMatrix();const [side,up,back,ahead]=cfg.carcam,fx=-Math.sin(v.yaw),fz=-Math.cos(v.yaw),rx=Math.cos(v.yaw),rz=-Math.sin(v.yaw);cam.position.set(v.x-o.x-fx*back+rx*side,v.y+up,v.z-o.z-fz*back+rz*side);cam.lookAt(v.x-o.x+fx*ahead,v.y+1,v.z-o.z+fz*ahead);return;}
        cam.far=cfg.far||850;A.scene.fog.near=cam.far*.65;A.scene.fog.far=cam.far;cam.updateProjectionMatrix();
        if(cfg.eye){ // eye [x,z,height above the ground there], look [x,z,absolute y]: a ground-level view toward any point
          const c=A.stream.contact(cfg.eye[0],cfg.eye[1],{referenceY:cfg.eyeRef??v.y}),gy=cfg.eyeY??(c?c.y:v.y);
          cam.position.set(cfg.eye[0]-o.x,gy+cfg.eye[2],cfg.eye[1]-o.z);cam.lookAt(cfg.look[0]-o.x,cfg.look[2],cfg.look[1]-o.z);return;}
        const [ax,az,ry]=cfg.at,c=A.stream.contact(ax,az,{referenceY:cfg.deckAt?v.y:(ry??v.y),layer:cfg.layer}),y=cfg.fixedY??(c?c.y:v.y);
        cam.position.set(ax-o.x+cfg.cam[0],y+cfg.cam[1],az-o.z+cfg.cam[2]);cam.lookAt(ax-o.x,y+(cfg.lookUp||0),az-o.z);
      });},[{at:s.deck&&!s.at?[s.deck[0],s.deck[1]]:s.at,cam:s.cam,far:s.far,lookUp:s.lookUp,carcam:s.carcam,eye:s.eye,look:s.look,eyeRef:s.eyeRef,eyeY:s.eyeY,layer:s.layer,fixedY:s.fixedY,deckAt:!!s.deck&&!s.at}]);
    if(s.pre)await page.evaluate(code=>{const A=window.__athens;return eval(code);},s.pre);
    await page.waitForTimeout(s.wait||9000);await page.screenshot({path:`${outdir}/${s.name}.png`});const info=await page.evaluate(()=>{const A=window.__athens,i=A.renderer.info;i.autoReset=false;i.reset();A.render(.016);const out={calls:i.render.calls,triangles:i.render.triangles,textures:i.memory.textures,geometries:i.memory.geometries};i.autoReset=true;return out;});report.shots.push({name:s.name,placed:res,info});console.log('shot',s.name,JSON.stringify(res));
    if(s.measure)report[s.name+'-measure']=await page.evaluate(()=>{const A=window.__athens,o=A.__o,cam=A.camera;
      cam.updateMatrixWorld();const el=A.renderer.domElement,W=el.clientWidth,Hh=el.clientHeight,V=cam.position.constructor,dir=new V();cam.getWorldDirection(dir);
      const box=(x,y,z,yaw,L,Wd,Hg)=>{const sn=Math.sin(yaw),cs=Math.cos(yaw);let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;for(const l of [-L/2,L/2])for(const w of [-Wd/2,Wd/2])for(const h of [0,Hg]){const v=new V(x+sn*l+cs*w-o.x,y+h,z+cs*l-sn*w-o.z);if(v.clone().applyMatrix4(cam.matrixWorldInverse).z>-.3)return null;v.project(cam);const px=(v.x*.5+.5)*W,py=(-v.y*.5+.5)*Hh;x0=Math.min(x0,px);x1=Math.max(x1,px);y0=Math.min(y0,py);y1=Math.max(y1,py);}
        const bw=x1-x0,bh=y1-y0,cosA=Math.abs(dir.x*sn+dir.z*cs);return {w:+bw.toFixed(1),h:+bh.toFixed(1),hw:+(bh/bw).toFixed(3),alongAxis:+cosA.toFixed(2)};};
      const out={cars:[],player:null,viewport:[W,Hh]};
      for(const r of A.props.near){if(r.kind!==11)continue;const d=Math.hypot(r.x-o.x-cam.position.x,r.z-o.z-cam.position.z);if(d<20||d>60)continue;{const b=box(r.x,r.y,r.z,r.yaw,4.3,1.92,1.43);if(b)out.cars.push({d:+d.toFixed(1),...b});}}
      out.cars.sort((a,b)=>a.d-b.d);const v=A.player.veh;if(v)out.player={d:+Math.hypot(v.x-o.x-cam.position.x,v.z-o.z-cam.position.z).toFixed(1),...box(v.x,v.y??0,v.z,v.yaw,4.5,1.9,1.4)};
      return out;}).catch(e=>String(e.message).slice(0,300));
  }
}catch(e){report.failure=e.stack;console.log(e.stack)}finally{await browser.close();server.close();console.log(JSON.stringify({errors:report.errors.slice(0,6),worldBytes:c.world.bytes,cells:c.world.count}));const {writeFile}=await import('node:fs/promises');await writeFile(outdir+'/report.json',JSON.stringify(report,null,1));}
