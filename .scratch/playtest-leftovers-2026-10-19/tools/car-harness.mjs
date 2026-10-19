// usage: ROOT=<archive> OUT=<dir> IDS=a,b|ALL VIEWS=front34,... [W=640 H=400 SHEET=name COLS=n PER=n FULL=1 AUDIT=1] tools/browser-slot.sh node harness.mjs
import fs from 'node:fs/promises';import {createServer} from 'node:http';import {resolve} from 'node:path';
const {chromium}=await import('/home/dev/projects/spawn-platform/node_modules/.pnpm/playwright@1.62.0/node_modules/playwright/index.mjs');
const sharp=(await import('sharp')).default;
const root=process.env.ROOT,out=resolve(process.env.OUT);await fs.mkdir(out,{recursive:true});
const TW=+process.env.W||640,TH=+process.env.H||400;
const html=`<html><body style="margin:0"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script><script type="module">
import * as T from 'three';import {CARS,CarModel} from '/src/cars.js';
const W=${TW},H=${TH},renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(W,H);document.body.append(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#b1c3d1');scene.add(new T.HemisphereLight(0xffffff,0x555566,2.4));const sun=new T.DirectionalLight(0xffffff,2.6);sun.position.set(-3,5,-4);scene.add(sun);const sun2=new T.DirectionalLight(0xffffff,1.2);sun2.position.set(4,3,5);scene.add(sun2);
const ground=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:'#55575a',roughness:1}));ground.rotation.x=-Math.PI/2;scene.add(ground);
const camera=new T.PerspectiveCamera(34,W/H,.03,200);let model;window.ids=CARS.map(c=>c.id);
const V=(x,y,z)=>new T.Vector3(x,y,z);
window.capture=async(id,view)=>{
 if(!model||model.spec.id!==id){if(model){scene.remove(model.root);model.root.traverse(o=>o.geometry?.dispose());}
  model=new CarModel(CARS.find(c=>c.id===id));model.cockpit?.setVisible(false);scene.add(model.root);await new Promise(r=>setTimeout(r,1200));}
 model.update(.016,0,0,false,{heave:0,pitch:0,roll:0},null);model.root.updateMatrixWorld(true);
 const L=model.dims.L,Wd=model.dims.W,d=Math.max(6,L*1.5);let fov=34,pos,look;
 const find=(re)=>{let r=[];model.body.traverse(o=>{if(re.test(o.name))r.push(o);});return r;};
 const wp=o=>new T.Box3().setFromObject(o).getCenter(V(0,0,0));
 if(view==='front34'){pos=V(d*.7,1.3,-d*.75);look=V(0,.6,0);}
 else if(view==='front34L'){pos=V(-d*.7,1.3,-d*.75);look=V(0,.6,0);}
 else if(view==='rear34'){pos=V(-d*.7,1.4,d*.75);look=V(0,.65,0);}
 else if(view==='rear34R'){pos=V(d*.7,1.4,d*.75);look=V(0,.65,0);}
 else if(view==='front'){pos=V(0,.9,-d*1.15);look=V(0,.6,0);fov=26;}
 else if(view==='rear'){pos=V(0,1.0,d*1.15);look=V(0,.65,0);fov=26;}
 else if(view==='side'){pos=V(d*1.15,.9,0);look=V(0,.6,0);fov=26;}
 else if(view==='top'){pos=V(0.01,d*1.2,0.5);look=V(0,0,0);fov=30;}
 else if(view==='nose34'){pos=V(1.5,.85,-L/2-1.6);look=V(0,.62,-L/2+.1);fov=34;}
 else if(view==='tail34'){pos=V(-1.5,1.1,L/2+1.6);look=V(0,.75,L/2-.1);fov=34;}
 else if(view.startsWith('wheel')){const w=model.wheels.filter(w=>(view==='wheelF')===(w.front===true));const wl=w.find(x=>x.pivot.position.x>0)||w[0];const c=new T.Vector3();wl.pivot.getWorldPosition(c);pos=V(c.x+1.35,c.y+.15,c.z-(view==='wheelF'?.35:-.35));look=c;fov=30;}
 else if(view==='mirrorL'||view==='mirrorR'){const rx=view==='mirrorR'?1:-1;let best;for(const h of find(/mirror-housing/)){const c=wp(h);if(c.x*rx>0&&(!best||Math.abs(c.x)>Math.abs(best.x)))best=c;}
  if(!best)best=V(rx*Wd/2,model.dims.H*.55,-L*.12);pos=best.clone().add(V(rx*.9,.25,-.9));look=best;fov=32;}
 else if(view==='mirrorA'||view==='mirrorB'||view==='mirrorC'){let best;for(const h of find(/mirror-housing/)){const c=wp(h);if(c.x>0&&(!best||Math.abs(c.x)>Math.abs(best.x)))best=c;}
  if(!best)best=V(Wd/2,model.dims.H*.55,-L*.12);look=best.clone();fov=24;
  pos=view==='mirrorA'?best.clone().add(V(.15,.05,-1.4)):view==='mirrorB'?best.clone().add(V(1.4,.1,.05)):best.clone().add(V(.5,.2,.9));}
 else if(view==='mirrorTop'){pos=V(0,2.4,-.2);look=V(0,.9,-.2);fov=60;}
 else if(view==='wingR'||view==='wingL'){const rx=view==='wingR'?1:-1;look=V(rx*Wd/2,model.dims.H*.5,-L*.2);pos=V(rx*(Wd/2+1.1),look.y+.15,look.z-.1);fov=30;}
 else if(view==='bonnet'){pos=V(0,2.3,-L*.5-.9);look=V(0,.8,-L*.28);fov=45;}
 else if(view==='boot'){pos=V(0,1.4,L*.5+1.2);look=V(0,.8,L*.5-.1);fov=36;}
 else if(view==='cockpit'){const ck=model.cockpit;ck.setVisible(true);const st={ignition:true,rpm:3500,kmh:85,redline:model.spec.redline,gearLabel:'3',steerInput:0,vehicle:{}};ck.update(0,st);await new Promise(r=>setTimeout(r,100));ck.clusterKey=undefined;ck.update(0,st);
  pos=ck.eye.clone();model.body.localToWorld(pos);camera.fov=70;camera.position.copy(pos);camera.rotation.set(ck.eyePitch,0,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);renderer.render(scene,camera);ck.setVisible(false);return renderer.domElement.toDataURL('image/jpeg',.9).split(',')[1];}
 camera.fov=fov;camera.position.copy(pos);camera.lookAt(look);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);renderer.render(scene,camera);
 return renderer.domElement.toDataURL('image/jpeg',.9).split(',')[1];};
window.audit=id=>{const m=new CarModel(CARS.find(c=>c.id===id));m.root.updateMatrixWorld(true);const out=[];
 m.root.traverse(o=>{if(!o.isMesh)return;const mats=[].concat(o.material);const badge=mats.some(x=>x?.userData?.brandBadge);const trim=o.name==='trim-badge'||/badge|emblem|crest|mirror/.test(o.name);if(!badge&&!trim)return;
  const b=new T.Box3().setFromObject(o),c=b.getCenter(V(0,0,0)),sz=b.getSize(V(0,0,0));m.body.worldToLocal(c);
  let wheel=false;for(let p=o;p;p=p.parent)if(m.wheels.some(w=>w.spin===p||w.pivot===p))wheel=true;
  out.push({name:o.name,badge,wheel,x:+c.x.toFixed(3),y:+c.y.toFixed(3),z:+c.z.toFixed(3),w:+sz.x.toFixed(3),h:+sz.y.toFixed(3),d:+sz.z.toFixed(3)});});
 return {id,L:m.dims.L,W:m.dims.W,out};};
window.trimGap=id=>{const m=new CarModel(CARS.find(c=>c.id===id));m.root.updateMatrixWorld(true);const b=m.body;b.updateWorldMatrix(true,true);const shells=[];b.traverse(o=>{if(o.isMesh&&!o.material.transparent&&o.name!=='trim-badge'&&o.geometry?.attributes.position)shells.push(o);});
 const tb=[];b.traverse(o=>{if(o.name==='trim-badge')tb.push(o);});if(!tb.length)return null;const o=tb[0];const c=b.worldToLocal(new T.Box3().setFromObject(o).getCenter(V(0,0,0)));
 const org=b.localToWorld(V(c.x,c.y,m.dims.L/2+1));const dir=V(0,0,-1).transformDirection(b.matrixWorld);const hit=new T.Raycaster(org,dir,0,3).intersectObjects(shells,false)[0];
 const hz=hit?b.worldToLocal(hit.point.clone()).z:null;
 // lamp overlap: any mesh named light_r*/tail with bbox overlapping badge bbox in x,y
 const bb=new T.Box3().setFromObject(o);let lamp=0;b.traverse(q=>{if(q!==o&&q.isMesh&&(q.material===m.tail||/tail|light_r/.test(q.name+(q.userData.damagePart||'')))){const qb=new T.Box3().setFromObject(q);if(qb.min.x<bb.max.x&&qb.max.x>bb.min.x&&qb.min.y<bb.max.y&&qb.max.y>bb.min.y&&Math.abs((qb.min.z+qb.max.z)/2-(bb.min.z+bb.max.z)/2)<.12)lamp++;}});
 return {id,badge:[c.x,c.y,c.z].map(v=>+v.toFixed(3)),hitZ:hz==null?null:+hz.toFixed(3),gap:hz==null?null:+(c.z-hz).toFixed(3),lamp};};
window.lampProbe=id=>{const m=new CarModel(CARS.find(c=>c.id===id));m.root.updateMatrixWorld(true);const b=m.body;b.updateWorldMatrix(true,true);const out=[];
 b.traverse(o=>{if(!o.isMesh)return;const bb=new T.Box3().setFromObject(o);bb.min.copy(b.worldToLocal(bb.min.clone()));bb.max.copy(b.worldToLocal(bb.max.clone()));if(bb.min.z<m.dims.L*.3||bb.max.x<-.1||bb.min.x>1)return;const mats=[].concat(o.material);
  out.push([o.name,o.userData.damagePart,mats.map(x=>x.name+':'+(x.color?.getHexString()||'')+(x===m.tail?':TAIL':'')).join('|'),bb.min.toArray().map(v=>+v.toFixed(2)).join(','),bb.max.toArray().map(v=>+v.toFixed(2)).join(',')].join(' ; '));});
 return out;};
window.mirrorAudit=id=>{const m=new CarModel(CARS.find(c=>c.id===id));m.body.updateWorldMatrix(true,true);const r=[];
 m.body.traverse(g=>{if(!g.userData.mirrorAssembly)return;const h=g.getObjectByName('mirror-housing'),a=g.getObjectByName('mirror-stalk'),u=g.getObjectByName('mirror-stalk-upper');
  const bh=new T.Box3().setFromObject(h),ch=bh.getCenter(V(0,0,0)),sh=bh.getSize(V(0,0,0));m.body.worldToLocal(ch);
  const root=V(...g.userData.mirrorRoot);const tip=V(...g.userData.mirrorCenter);
  const meshes=[];g.traverse(o=>{if(o.isMesh)meshes.push(o.name||o.geometry.type);});
  r.push({name:g.name,housing:ch.toArray().map(v=>+v.toFixed(3)),size:sh.toArray().map(v=>+v.toFixed(3)),root:root.toArray().map(v=>+v.toFixed(3)),dist:+ch.distanceTo(root).toFixed(3),belt:m.shape?.belt,cowl:m.shape?.cowl,W:m.dims.W,meshes:meshes.join(',')});});
 return {id,r};};
window.ready=true;
</script></body></html>`;
const types={'.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.json':'application/json','.wav':'audio/wav'};
const server=createServer(async(req,res)=>{try{if(req.url==='/fixture'){res.setHeader('Content-Type','text/html');res.end(html);return;}const path=root+decodeURIComponent(req.url.split('?')[0]);const ext=path.slice(path.lastIndexOf('.'));res.setHeader('Content-Type',types[ext]||'application/octet-stream');res.end(await fs.readFile(path));}catch{res.statusCode=404;res.end('nf');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const tiles=new Map();
try{
 const page=await browser.newPage({viewport:{width:TW,height:TH}});page.on('pageerror',e=>console.log('PAGEERROR',e.message));page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,200));});
 await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');await page.waitForFunction(()=>window.ready,null,{timeout:120000});
 const ids=process.env.IDS&&process.env.IDS!=='ALL'?process.env.IDS.split(','):await page.evaluate(()=>ids);
 if(process.env.LAMP){console.log((await page.evaluate(id=>lampProbe(id),ids[0])).join('\n'));}
 else if(process.env.TAUDIT){const res=[];for(const id of ids)res.push(await page.evaluate(id=>trimGap(id),id));await fs.writeFile(out+'/taudit.json',JSON.stringify(res));}
 else if(process.env.MAUDIT){const res=[];for(const id of ids)res.push(await page.evaluate(id=>mirrorAudit(id),id));await fs.writeFile(out+'/maudit.json',JSON.stringify(res));}
 else if(process.env.AUDIT){const res=[];for(const id of ids)res.push(await page.evaluate(id=>audit(id),id));await fs.writeFile(out+'/audit.json',JSON.stringify(res));}
 else{const views=(process.env.VIEWS||'front34,rear34').split(',');
 for(const id of ids)for(const view of views){const b64=await page.evaluate(([id,view])=>capture(id,view),[id,view]);tiles.set(id+'/'+view,Buffer.from(b64,'base64'));if(process.env.FULL)await fs.writeFile(`${out}/${id}-${view}.jpg`,tiles.get(id+'/'+view));console.log(id,view);}}
}finally{await browser.close();server.close();}
if(!process.env.AUDIT&&!process.env.MAUDIT&&!process.env.TAUDIT&&!process.env.LAMP){
const ids=[...new Set([...tiles.keys()].map(k=>k.split('/')[0]))],views=(process.env.VIEWS||'front34,rear34').split(','),per=+process.env.PER||8,lh=22,cols=+process.env.COLS||views.length;
const items=[];for(const id of ids)for(const v of views)items.push([id,v]);
for(let s=0;s*per*views.length<items.length;s++){
 const chunk=items.slice(s*per*views.length,(s+1)*per*views.length),rows=Math.ceil(chunk.length/cols);
 const comp=await Promise.all(chunk.map(async([id,v],i)=>({input:await sharp({create:{width:TW,height:TH+lh,channels:3,background:'#000'}}).composite([{input:tiles.get(id+'/'+v),top:lh,left:0},{input:Buffer.from(`<svg width="${TW}" height="${lh}"><text x="6" y="16" font-size="14" font-family="monospace" fill="#fff">${id} ${v}</text></svg>`),top:0,left:0}]).png().toBuffer(),left:(i%cols)*TW,top:Math.floor(i/cols)*(TH+lh)})));
 await sharp({create:{width:cols*TW,height:rows*(TH+lh),channels:3,background:'#000'}}).composite(comp).webp({quality:80}).toFile(`${out}/${process.env.SHEET||'sheet'}-${String(s+1).padStart(2,'0')}.webp`);
}}
