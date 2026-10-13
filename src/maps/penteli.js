// Penteli inland scenery. Road/elevations and land-use footprints come from the bundle.
// Vegetation is a deterministic reconstruction, not a tree-by-tree survey. The two
// crown forms evoke Mediterranean pines; their proportions do not assert species.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CellInstances, RNG, M, clamp, pointInPoly, polyBounds } from '../util.js';
import { TX } from '../tex.js';

const CHAPEL = [3023.3,880.68,3022.94,874.64,3007.82,875.52,3008.47,886.61,3013.55,886.31,3013.25,881.27];
const TAU = Math.PI * 2;

// Branch-aligned cylinders form a branching silhouette rather than a straight pole.
function branch(a, b, r0, r1) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a.x+b.x)/2, (a.y+b.y)/2, (a.z+b.z)/2);
  return g;
}
function pineTemplate(seed, upright = false) {
  const rng = new RNG(seed), limbs = [], clusters = [];
  const base = new THREE.Vector3(), fork = new THREE.Vector3(.28, 3.7, -.16);
  limbs.push(branch(base, fork, .23, .12));
  for (let i=0;i<7;i++) {
    const a = i*2.399 + rng.range(-.3,.3), r = upright ? 1.8-i*.16 : rng.range(1.7,3.1);
    const c = new THREE.Vector3(Math.cos(a)*r, upright ? 4+i*.47 : rng.range(5.1,6.8), Math.sin(a)*r);
    limbs.push(branch(fork, c, .095, .023));
    clusters.push({c, r: upright ? [1.6,1.5,1.6] : [2.1,1.25,1.8]});
  }
  const trunk = mergeGeometries(limbs); limbs.forEach(g=>g.dispose());
  return {trunk, close: needleCards(clusters,seed,14), far: needleCards(clusters,seed,4,1.35)};
}
function needleCards(clusters, seed, count, enlarge=1) {
  const rng = new RNG(seed), pos=[], uv=[], normals=[], colors=[], index=[];
  const right=new THREE.Vector3(), up=new THREE.Vector3(), normal=new THREE.Vector3(), q=new THREE.Vector3();
  for (const {c,r} of clusters) for (let i=0;i<count;i++) {
    const a=rng.range(0,TAU), h=rng.range(-.6,1), rad=Math.sqrt(1-h*h);
    const p=new THREE.Vector3(c.x+Math.cos(a)*rad*r[0], c.y+h*r[1], c.z+Math.sin(a)*rad*r[2]);
    right.set(Math.cos(a),rng.range(-.3,.3),Math.sin(a)).normalize();
    up.set(-Math.sin(a)*.45,.8,Math.cos(a)*.45).normalize();
    normal.crossVectors(right,up).normalize();
    const w=rng.range(1.7,2.7)*enlarge, hh=rng.range(1.4,2.1)*enlarge, start=pos.length/3;
    [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].forEach(([x,y],k)=>{
      q.copy(p).addScaledVector(right,x*w).addScaledVector(up,y*hh);
      pos.push(q.x,q.y,q.z);
      // Outward normals avoid the harsh alternating black planes of crossed billboards.
      const n=new THREE.Vector3(q.x-c.x,(q.y-c.y)*1.4,q.z-c.z).normalize().addScaledVector(normal,.15).normalize();
      normals.push(n.x,n.y,n.z); uv.push(k===1||k===2?.5:0,k>=2?.5:0);
      const shade=.7+.3*clamp((q.y-c.y+r[1])/(2*r[1]),0,1); colors.push(shade,shade,shade);
    });
    index.push(start,start+1,start+2,start,start+2,start+3);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(index);g.computeBoundingSphere();return g;
}
function polygons(data,key) { return (data.areas?.[key] || []).filter(a=>a.p?.length>=6).map(a=>({...a,b:polyBounds(a.p)})); }
function inside(x,z,polys) { return polys.some(a=>x>=a.b.x0&&x<=a.b.x1&&z>=a.b.z0&&z<=a.b.z1&&pointInPoly(x,z,a.p)); }

export function buildScenery(scene,map,{heightC=(x,z)=>map.terrain.height(x,z),assets={}}={}) {
  const {route,data,terrain}=map, rng=new RNG(2947);
  const group=new THREE.Group();group.name='penteli-mountain-scenery';scene.add(group);
  const geos=new Set(), mats=new Set(), ownedTextures=new Set();
  const geo=g=>(geos.add(g),g), mat=m=>(mats.add(m),m);
  const std=(color,extra={})=>mat(new THREE.MeshStandardMaterial({color,roughness:.92,...Object.fromEntries(Object.entries(extra).filter(([,v])=>v!==undefined))}));
  const stone=std('#aaa18e',{map:TX.rock_diff,normalMap:TX.rock_nor});
  const marble=std('#ddd9cc',{map:TX.rock_diff,normalMap:TX.rock_nor});
  const bark=std('#b5a18a',{map:TX.pinebark_diff,normalMap:TX.pinebark_nor});
  const leaf=std('#a0b19b',{map:TX.foliage,alphaTest:.38,alphaToCoverage:true,side:THREE.DoubleSide,vertexColors:true});
  const metal=std('#959a9e',{metalness:.68,roughness:.42,side:THREE.DoubleSide});
  const white=std('#e7e3d7'), black=std('#252a27'), red=std('#a83c2a',{roughness:.4});
  const box=geo(new THREE.BoxGeometry(1,1,1));
  const buckets=[];
  const instances=(g,m,options={})=>{geo(g);const b=new CellInstances(g,m,{cell:320,far:1100,...options});buckets.push(b);return b;};
  const posts=instances(box,metal,{far:700,shadow:false}), reflectorPosts=instances(box,white,{far:450,shadow:false});
  const reflectorBlack=instances(box,black,{far:350,shadow:false}), reflectorRed=instances(box,red,{far:350,shadow:false});
  const rockGeo=geo(new THREE.IcosahedronGeometry(1,0));
  const rocks=instances(rockGeo,stone,{colors:true,shadow:false,far:900});
  const quarryRocks=instances(rockGeo,marble,{colors:true,shadow:false,far:2200,cell:500});
  const pines=[pineTemplate(58),pineTemplate(92),pineTemplate(74,true)].map(t=>({
    trunk:instances(t.trunk,bark,{far:1200}),
    close:instances(t.close,leaf,{colors:true,far:490,cell:240}),
    far:instances(t.far,leaf,{colors:true,near:360,far:2300,cell:440,shadow:false}),
  }));
  const shrubGeo=needleCards([{c:new THREE.Vector3(0,.5,0),r:[.8,.5,.8]}],202,11);
  const shrubs=instances(shrubGeo,leaf,{colors:true,shadow:false,far:450});
  const forest=[...polygons(data,'forest'),...polygons(data,'wood')], quarries=polygons(data,'quarry');
  const buildings=(data.buildings||[]).filter(b=>b.p).map(b=>({...b,b:polyBounds(b.p)}));
  // Sample world-space cells once: nearby legs of a hairpin do not double plant.
  const seen=new Set();
  function plant(x,z,s,far=false) {
    const q=route.project(x,z);
    const roadGap=Math.abs(q.u);
    if(roadGap<route.edge(q.s)+(far?17:7.5)||inside(x,z,quarries)||inside(x,z,buildings))return;
    const y=heightC(x,z);if(!Number.isFinite(y)||y<10)return;
    const steep=Math.hypot(terrain.height(x+5,z)-terrain.height(x-5,z),terrain.height(x,z+5)-terrain.height(x,z-5))/10;
    const wooded=forest.length?inside(x,z,forest):q.s<6100;
    // Satellite review: open tawny slopes with regrowth dominate beyond Dionysos.
    // OSM wood polygons may predate fires, so they are a low-density mask.
    const town=q.s<550;
    const density=town?(wooded?.58:.30):(wooded?.085:.024);
    if(rng.next()>density*(1-clamp(steep-.6,0,.78))) {
      if(!far&&rng.next()<.30)shrubs.addTRS(x,y-.06,z,rng.range(0,TAU),rng.range(.6,1.5),rng.range(.6,1.2),rng.range(.6,1.5),'#8e9475');
      if(!far&&steep>.28&&rng.next()<.14)rocks.addTRS(x,y-.25,z,rng.range(0,TAU),rng.range(.5,1.9),rng.range(.3,.9),rng.range(.5,1.6),'#c8bca5');
      return;
    }
    const t=pines[rng.next()<.18?2:rng.int(0,1)], scale=town?rng.range(.8,1.5):rng.range(.48,1.1), yaw=rng.range(0,TAU);
    const m=M(x,y-.18,z,rng.range(-.025,.025),yaw,rng.range(-.025,.025),scale,scale*rng.range(.88,1.2),scale);
    const tint=new THREE.Color().setHSL(rng.range(.24,.30),rng.range(.14,.27),rng.range(.56,.78));
    t.trunk.add(m);t.close.add(m,tint);t.far.add(m,tint);
  }
  for(let s=0;s<route.length;s+=40) {
    const f=route.frame(s,{});
    for(const side of [-1,1])for(let d=14;d<650;d+=d<160?14:44){
      const cell=d<160?13:38, x0=Math.floor((f.x+f.rx*d*side)/cell),z0=Math.floor((f.z+f.rz*d*side)/cell);
      for(let j=-1;j<=1;j++){
        const cx=x0+Math.round(f.tx*j),cz=z0+Math.round(f.tz*j),key=cell+':'+cx+','+cz;if(seen.has(key))continue;seen.add(key);
        plant((cx+rng.range(.12,.88))*cell,(cz+rng.range(.12,.88))*cell,s,d>=160);
      }
    }
  }
  // Exposures stay within mapped quarry polygons. DEM provides their true relief.
  for(const a of quarries){const b=a.b;let count=0;for(let x=b.x0;x<b.x1;x+=22)for(let z=b.z0;z<b.z1;z+=22){
    if(count>1200||!pointInPoly(x,z,a.p))continue;count++;
    const xx=x+rng.range(0,10),zz=z+rng.range(0,10),y=heightC(xx,zz);if(y<0)continue;
    quarryRocks.addTRS(xx,y-.9,zz,rng.range(0,TAU),rng.range(3,10),rng.range(1,3),rng.range(3,8),'#e0d9c9');
  }}

  const rails=[];
  // These runs infer roadside engineering from DEM cut/drop; locations are not a survey.
  // Keep them beyond the generic road's 0.55 m gutter and 1.6 m shoulder.
  for(const side of [-1,1]){
    let run=null;
    for(let s=12;s<route.length-12;s+=2){
      const edge=route.edge(s)+2.25, p=route.point(s,side*edge),outer=route.point(s,side*(edge+8));
      const raw=terrain.height(outer.x,outer.z),drop=p.y-raw;
      const fork=data.marks?.find(m=>m.id==='agios-petros'||/fork/i.test(m.name||''))?.s??5744;
      const nearJunction=Math.abs(s-fork)<42||s<180;
      if(drop>2.8&&!nearJunction){if(!run){run={side,pts:[]};rails.push(run);}run.pts.push({s,u:edge,p:p.clone()});
        if(s%4===0)posts.addTRS(p.x,p.y+.43,p.z,route.heading(s),.11,.86,.09);
      }else run=null;
      if(s%40===12&&!nearJunction){reflectorPosts.addTRS(p.x,p.y+.50,p.z,route.heading(s),.13,1,.1);
        reflectorBlack.addTRS(p.x,p.y+.82,p.z,route.heading(s),.135,.19,.105);
        reflectorRed.addTRS(p.x,p.y+.82,p.z,route.heading(s),.07,.065,.109);
      }
    }
  }
  function mesh(g,m,name){geo(g);const o=new THREE.Mesh(g,m);o.name=name;o.receiveShadow=true;group.add(o);return o;}
  function sweep(samples,profile,material,name){
    if(samples.length<2)return;const pos=[],uv=[],idx=[],n=profile.length;
    samples.forEach((q,i)=>{for(const [du,dy] of profile){const p=route.point(q.s,q.side*(q.u+du));pos.push(p.x,q.y+dy,p.z);uv.push(q.s*.5,du+dy);}
      if(i)for(let j=0;j<n-1;j++){const a=(i-1)*n+j,b=a+n;idx.push(a,b,a+1,a+1,b,b+1);}});
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return mesh(g,material,name);
  }
  const wBeam=[[0,.51],[.07,.55],[.07,.61],[0,.66],[0,.71],[.07,.76],[.07,.82],[0,.85]];
  for(const run of rails)sweep(run.pts.map(q=>({...q,side:run.side,y:q.p.y})),wBeam,metal,'mountain-guardrail');
  const ditchMat=std('#817a69',{map:TX.concrete_diff,side:THREE.DoubleSide});
  const wallMat=std('#b5b0a1',{map:TX.rock_diff,normalMap:TX.rock_nor,side:THREE.DoubleSide});
  for(const side of [-1,1])for(let start=0;start<route.length;start+=240){
    let ditch=[],wall=[];
    const flush=()=>{sweep(ditch,[[0,.04],[.34,-.16],[.76,.07]],ditchMat,'cut-side-drain');ditch=[];sweep(wall,[[0,-.3],[.18,.65],[.46,1.1]],wallMat,'low-stone-cut-retaining');wall=[];};
    for(let s=start;s<=Math.min(route.length,start+240);s+=4){
      const u=route.edge(s)+2.18,p=route.point(s,side*u),o=route.point(s,side*(u+7)),rise=terrain.height(o.x,o.z)-p.y;
      if(rise>.8&&s>220&&Math.abs(s-5744)>45){ditch.push({s,u,y:p.y,side});if(rise>3.2)wall.push({s,u:u+.86,y:p.y,side});else{if(wall.length)sweep(wall,[[0,-.3],[.18,.65],[.46,1.1]],wallMat,'low-stone-cut-retaining');wall=[];}}
      else flush();
    }flush();
  }

  // Agios Petros: real OSM way 368804380, including its stepped footprint.
  // Architectural detail is deliberately modest until imagery supports finer detail.
  const chapel=data.buildings?.find(b=>String(b.id)==='368804380');
  const footprint=chapel?.p||CHAPEL,cx=3015.5,cz=880.5,baseY=heightC(cx,cz);
  const shape=new THREE.Shape();
  for(let i=0;i<footprint.length;i+=2){const x=footprint[i]-cx,z=footprint[i+1]-cz;i?shape.lineTo(x,-z):shape.moveTo(x,-z);}shape.closePath();
  const plaster=std('#e4dec8',{map:TX.plaster_diff}),tile=std('#895346');
  const body=geo(new THREE.ExtrudeGeometry(shape,{depth:3.3,bevelEnabled:false}));body.rotateX(-Math.PI/2);body.translate(cx,baseY,cz);const church=mesh(body,plaster,'Agios Petros · OSM 368804380');church.castShadow=true;
  // The main east-west gable follows the long axis of the OSM footprint.
  const yaw=.059,roofWidth=16.2,halfDepth=3.8,rise=1.65;
  for(const side of [-1,1]){const roof=mesh(new THREE.BoxGeometry(roofWidth,.18,Math.hypot(halfDepth,rise)),tile,'chapel-tiled-gable');
    roof.position.set(cx,baseY+3.3+rise/2,cz-2.1+side*halfDepth/2);roof.rotation.set(-side*Math.atan2(rise,halfDepth),yaw,0);roof.castShadow=true;}
  const crossMat=std('#dad8c9',{metalness:.1});
  const cross=mesh(new THREE.BoxGeometry(.12,1.2,.12),crossMat,'chapel-cross');cross.position.set(cx-5,baseY+5.5,cz-2.1);
  const crossbar=mesh(new THREE.BoxGeometry(.65,.11,.12),crossMat,'chapel-crossbar');crossbar.position.copy(cross.position);crossbar.position.y+=.15;
  const door=mesh(new THREE.BoxGeometry(.13,2,.95),std('#3b3026'),'chapel-door');door.position.set(cx-7.25,baseY+1,cz-1.2);door.rotation.y=yaw;
  if(assets.makeLabel){const sign=assets.makeLabel('ΑΓΙΟΣ ΠΕΤΡΟΣ',2.25,.34,'#ddd7c8','#4d4639');sign.position.set(cx-7.34,baseY+2.45,cz-1.2);sign.rotation.y=-Math.PI/2+yaw;group.add(sign);}

  // Small, real building footprints at the town exit. Heights use bundle estimates;
  // neutral plaster and flat terraces avoid inventing detailed private properties.
  const villaWall=std('#d4c8b3',{map:TX.plaster_diff}),villaRoof=std('#a8a399',{map:TX.concrete_diff});
  const windowMat=std('#3f5657',{roughness:.35,metalness:.12});
  const windows=instances(box,windowMat,{far:750,shadow:false});
  for(const b of data.buildings||[]){
    if(String(b.id)==='368804380'||!b.p||b.p.length<6)continue;
    const bounds=polyBounds(b.p),bx=(bounds.x0+bounds.x1)/2,bz=(bounds.z0+bounds.z1)/2,by=heightC(bx,bz),h=clamp(b.h||5.5,2.8,11);
    const sh=new THREE.Shape();for(let i=0;i<b.p.length;i+=2){i?sh.lineTo(b.p[i]-bx,bz-b.p[i+1]):sh.moveTo(b.p[i]-bx,bz-b.p[i+1]);}sh.closePath();
    const g=new THREE.ExtrudeGeometry(sh,{depth:h,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(bx,by,bz);
    const building=mesh(g,villaWall,'OSM building '+b.id);building.castShadow=true;
    const roof=new THREE.ShapeGeometry(sh);roof.rotateX(-Math.PI/2);roof.translate(bx,by+h+.03,bz);mesh(roof,villaRoof,'villa-terrace');
    for(let i=0;i+3<b.p.length;i+=2){
      const ax=b.p[i],az=b.p[i+1],dx=b.p[i+2]-ax,dz=b.p[i+3]-az,L=Math.hypot(dx,dz);if(L<4)continue;
      for(let t=2;t<L-1.5;t+=3.2)for(let yy=1.8;yy<h-.5;yy+=3){
        windows.addTRS(ax+dx*t/L,by+yy,az+dz*t/L,Math.atan2(-dz,dx),1,.95,.10);
      }
    }
  }

  // The actual EP29 continuation is deliberately visible at the Agios Petros fork.
  // Bundle extraction supplies the unused part of OSM way 224029663 separately.
  const marathonBranch=data.penteli?.marathonBranch||(data.sideRoads||[]).find(r=>String(r.id)==='224029663');
  if(marathonBranch?.p?.length>=4){
    const raw=marathonBranch.p,samples=[];
    for(let i=0;i+3<raw.length;i+=2){
      const ax=raw[i],az=raw[i+1],dx=raw[i+2]-ax,dz=raw[i+3]-az,L=Math.hypot(dx,dz),steps=Math.max(1,Math.ceil(L/5));
      for(let j=0;j<steps;j++)samples.push([ax+dx*j/steps,az+dz*j/steps]);
    }samples.push(raw.slice(-2));
    const vertices=[],uvs=[],idx=[],width=marathonBranch.w||6.8;
    samples.forEach(([x,z],i)=>{
      const prev=samples[Math.max(0,i-1)],next=samples[Math.min(samples.length-1,i+1)],dx=next[0]-prev[0],dz=next[1]-prev[1],len=Math.hypot(dx,dz)||1;
      for(const side of [-1,1]){
        const px=x-dz/len*width*.5*side,pz=z+dx/len*width*.5*side,q=route.project(px,pz),blend=clamp((Math.abs(q.u)-route.edge(q.s))/22,0,1);
        const y=route.surfaceY(q.s,q.u)*(1-blend)+heightC(px,pz)*blend;
        vertices.push(px,y+.048,pz);uvs.push(side*.5,i*1.1);
      }if(i){const a=(i-1)*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}
    });
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(idx);g.computeVertexNormals();
    mesh(g,std('#73716c',{map:TX.asphalt_diff,normalMap:TX.asphalt_nor,side:THREE.DoubleSide}),'EP29 real branch toward Nea Makri');
  }
  // Direction labels are geographic reconstructions, not a transcription of a
  // photographed sign. They explain the genuine fork without invented distances.
  if(assets.makeLabel){
    const s=(data.penteli?.fork||5744)-58,p=route.point(s,route.edge(s)+3.5),f=route.frame(s,{}),yaw=Math.atan2(-f.tx,-f.tz);
    for(const dx of [-1.25,1.25])posts.addTRS(p.x+Math.cos(yaw)*dx,p.y+1.8,p.z-Math.sin(yaw)*dx,yaw,.09,3.6,.09);
    for(const [j,text] of ['ΠΕΝΤΕΛΗ  /  PENTELI  →','ΝΕΑ ΜΑΚΡΗ  /  NEA MAKRI  ↑'].entries()){
      const label=assets.makeLabel(text,3.2,.46,'#155180','#f3efdd');label.position.set(p.x,p.y+3.45-j*.48,p.z);label.rotation.y=yaw;group.add(label);
    }
  }

  for(const b of buckets){b.build(group);b.cells.clear();}
  group.userData.reconstruction='OSM footprints; DEM-inferred roadside engineering; illustrative pine distribution';
  group.userData.treeCount=pines.reduce((n,p)=>n+p.trunk.meshes.reduce((m,o)=>m+o.count,0),0);
  let disposed=false;
  return {group,assets:{rails},dispose(){
    if(disposed)return;disposed=true;group.removeFromParent();
    // Shared TX textures and LabelAtlas materials belong to the application.
    for(const g of geos)g.dispose();for(const m of mats)m.dispose();for(const t of ownedTextures)t.dispose();group.clear();
  }};
}
