// Megara scenery, georeferenced to the OSM bundle and Esri reference in SOURCES.md.
// Ground references: BIKEIT Megara gallery, May 2023; RallyDiaries paddock/start photos.
// No coastal avenue median, traffic markings, palms or invented spectator grandstands.
import * as THREE from 'three';

const WHITE = 0xe1e0d8, STEEL = 0x9ca5a4, TYRE = 0x242524;
const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .92, ...extra });
function groundMaterial(color, scale = 1) {
  const material = flat(color);
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGround;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGround;\nfloat grain(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }').replace('#include <color_fragment>', `#include <color_fragment>\nfloat smallGrain=grain(floor(vGround.xz*${(scale*13).toFixed(2)})); float broadGrain=grain(floor(vGround.xz*.35)); diffuseColor.rgb *= .84 + .23*smallGrain + .08*broadGrain;`);
  };
  material.customProgramCacheKey = () => 'megara-ground-' + scale;
  return material;
}
function strip(route, s0, s1, left, right, y, material, target, step = 2) {
  const n = Math.max(1, Math.ceil((s1-s0)/step)), pos=[], uv=[], idx=[];
  for (let i=0;i<=n;i++) {
    const s=s0+(s1-s0)*i/n;
    const edges=[typeof left==='function'?left(s):left, typeof right==='function'?right(s):right].sort((a,b)=>a-b);
    for(const u of edges) {
      const p=route.point(s,u); pos.push(p.x,p.y+y,p.z); uv.push(u/4,s/4);
    }
    if(i<n){const a=2*i;idx.push(a,a+1,a+2,a+1,a+3,a+2);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
  // Route point order can wind either way. All surface materials are double-sided.
  const mesh=new THREE.Mesh(g,material);mesh.receiveShadow=true;target.add(mesh);return mesh;
}
function polygon(points, y, material, target) {
  const contour=points.map(p=>new THREE.Vector2(p[0],p[1]));
  const faces=THREE.ShapeUtils.triangulateShape(contour,[]), pos=[],idx=[];
  for(const p of points) pos.push(p[0],typeof y==='function'?y(p[0],p[1]):y,p[1]);
  for(const t of faces)idx.push(t[0],t[2],t[1]);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();
  const mesh=new THREE.Mesh(g,material);mesh.receiveShadow=true;target.add(mesh);return mesh;
}
// Consolidate static, untransformed surface strips per material (kerbs stay two draws).
function mergeSurfaces(group) {
  const sets=new Map();
  for(const mesh of [...group.children]) {
    if(!mesh.isMesh||mesh.isInstancedMesh||mesh.position.lengthSq()>0||mesh.rotation.x||mesh.rotation.y||mesh.rotation.z)continue;
    let set=sets.get(mesh.material);if(!set){set=[];sets.set(mesh.material,set);}set.push(mesh);
  }
  for(const [material,meshes] of sets){
    if(meshes.length<2)continue;
    const pos=[],idx=[];
    for(const mesh of meshes){const g=mesh.geometry,base=pos.length/3;pos.push(...g.attributes.position.array);if(g.index)for(const i of g.index.array)idx.push(base+i);else for(let i=0;i<g.attributes.position.count;i++)idx.push(base+i);group.remove(mesh);g.dispose();}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();const mesh=new THREE.Mesh(g,material);mesh.receiveShadow=true;group.add(mesh);
  }
}
function batches(group) {
  const buckets=new Map(), unit=new THREE.BoxGeometry(1,1,1), dummy=new THREE.Object3D();
  function box(x,y,z,w,h,d,material,yaw=0) {
    let list=buckets.get(material);if(!list){list=[];buckets.set(material,list);}
    dummy.position.set(x,y,z);dummy.rotation.set(0,yaw,0);dummy.scale.set(w,h,d);dummy.updateMatrix();list.push(dummy.matrix.clone());
  }
  function beam(a,b,width,height,material) {
    const dx=b[0]-a[0],dz=b[2]-a[2];box((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2,width,height,Math.hypot(dx,dz),material,Math.atan2(dx,dz));
  }
  function flush(){for(const [mat,list]of buckets){const m=new THREE.InstancedMesh(unit,mat,list.length);list.forEach((v,i)=>m.setMatrixAt(i,v));m.receiveShadow=true;m.castShadow=true;m.computeBoundingSphere();group.add(m);}if(!buckets.size)unit.dispose();}
  return {box,beam,flush};
}

export function buildScenery(scene, map, {heightC,assets={}}={}) {
  const group=new THREE.Group();group.name='megara-circuit';scene.add(group);
  const obstacles=[];
  const roadGroup=new THREE.Group();roadGroup.name='megara-road';group.add(roadGroup);
  const route=map.route, data=map.data, circuit=data.circuit||{};
  const yAt=(x,z)=>heightC?heightC(x,z):map.terrain.height(x,z);
  const asphalt=groundMaterial(0x646563,1), gravel=groundMaterial(0xc1b797,.65), dirt=groundMaterial(0xa79c7a,.4);
  for(const m of [asphalt,gravel,dirt])m.side=THREE.DoubleSide;
  const white=flat(WHITE,{side:THREE.DoubleSide}),red=flat(0xa84036,{side:THREE.DoubleSide});
  const steel=flat(STEEL,{metalness:.48,roughness:.52}),black=flat(TYRE),glass=flat(0x38525d,{metalness:.25,roughness:.28});
  const canopy=flat(0x286762,{side:THREE.DoubleSide}),roof=flat(0xc4c9c6),timber=flat(0x65533c);
  const batch=batches(group);
  const proj=data.proj||{}, mlat=proj.mlat||111320,mlon=proj.mlon||111320*Math.cos(37.987*Math.PI/180);
  const pixel=(x,z)=>[(23.359+x/1600*.01-(proj.lon0??23.364))*mlon,-(37.992-z/1600*.01-(proj.lat0??37.987))*mlat];
  const pp=list=>list.map(([x,z])=>pixel(x,z));
  const pixelPoly=(list,mat,height=.04)=>polygon(pp(list),(x,z)=>yAt(x,z)+height,mat,group);
  const worldPath=(points,width,mat,height=.06)=>{
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1,nx=-dz/l*width/2,nz=dx/l*width/2;
      polygon([[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],[b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz]],(x,z)=>yAt(x,z)+height,mat,group);
    }
  };
  // Continuous full-width periodic asphalt. Edge markings remain white throughout.
  strip(route,0,route.length,s=>-route.edge(s),s=>route.edge(s),.045,asphalt,roadGroup);
  for(const side of [-1,1])strip(route,0,route.length,s=>side*(route.edge(s)-.21),s=>side*(route.edge(s)-.06),.061,white,roadGroup);
  // Route kerbs are also read by Ground: geometry and tyres use the same segments.
  route.kerbs=circuit.kerbs||[];
  for(const k of route.kerbs) {
    const width=k.width??.85,height=k.height??.045;
    for(let s=k.s0;s<k.s1;s+=2.4){
      const end=Math.min(s+2.4,k.s1),mat=Math.floor((s-k.s0)/2.4)%2?white:red;
      const inner=v=>k.side*route.edge(v),middle=v=>k.side*(route.edge(v)+width*.5),outer=v=>k.side*(route.edge(v)+width);
      strip(route,s,end,inner,middle,.045+height,mat,roadGroup,.8);
      strip(route,s,end,middle,outer,.045+height*.35,mat,roadGroup,.8);
    }
  }
  // Satellite traced paddock, pit lane and photographed pale dirt/gravel islands.
  for(const a of circuit.pavedAreas||[]){const p=Array.isArray(a.p[0])?a.p:Array.from({length:a.p.length/2},(_,i)=>[a.p[i*2],a.p[i*2+1]]);polygon(p,a.y!==undefined?a.y+.045:(x,z)=>yAt(x,z)+.045,asphalt,group);}
  if(!(circuit.pavedAreas||[]).length)pixelPoly([[117,897],[190,891],[223,902],[337,903],[382,1015],[177,1045]],asphalt);
  worldPath(pp([[341,903],[426,841],[512,769],[583,738],[658,729],[755,719]]),7,asphalt);
  const runoffs=[[[243,608],[385,616],[580,638],[650,644],[633,667],[460,699],[268,750]],[[728,855],[870,833],[915,847],[908,885],[751,909],[702,936]],[[917,639],[986,653],[1008,719],[1009,773],[757,820],[762,793],[858,777],[896,736]],[[1111,631],[1171,634],[1215,680],[1178,746],[1082,780],[1100,747],[1157,710],[1165,676]],[[450,884],[515,843],[608,825],[656,829],[647,842],[553,864],[518,914],[493,964],[464,979],[437,965]],[[699,742],[768,736],[825,718],[824,704],[783,678],[661,689],[575,714]]];
  runoffs.forEach(p=>pixelPoly(p,gravel,.025));
  // Perimeter is low concrete and mesh fence, as in the paddock/clubhouse photographs.
  function barrierPath(pixels,{tyres=false,wall=false}={}) {
    const pts=pp(pixels);
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(len/3);
      for(let j=0;j<n;j++){
        const t=j/n,t1=Math.min(1,(j+1)/n),x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,xx=a[0]+(b[0]-a[0])*t1,zz=a[1]+(b[1]-a[1])*t1,y=yAt(x,z);
        const midX=(x+xx)/2,midZ=(z+zz)/2,nearest=route.project(midX,midZ);
        if(Math.abs(nearest.u)>route.edge(nearest.s)+2)obstacles.push({x:midX,z:midZ,yaw:Math.atan2(xx-x,zz-z),hl:Math.hypot(xx-x,zz-z)/2,hw:tyres?.55:.18});
        if(wall)batch.beam([x,y+.65,z],[xx,yAt(xx,zz)+.65,zz],.32,1.3,white);
        else {batch.beam([x,y+.62,z],[xx,yAt(xx,zz)+.62,zz],.22,.32,steel);batch.box(x,y+.43,z,.13,.86,.13,steel);}
        if(tyres)for(let q=0;q<3;q++){const f=(j+q/3)/n;const tx=a[0]+(b[0]-a[0])*f,tz=a[1]+(b[1]-a[1])*f; tyreLocations.push([tx,yAt(tx,tz)+.34,tz]);}
      }
    }
  }
  const tyreLocations=[];
  barrierPath([[192,874],[158,841],[117,774],[97,708],[153,662],[164,589],[202,549],[1168,610],[1239,664],[1234,731],[1120,803]],{tyres:true});
  barrierPath([[209,1049],[393,1039],[557,1023],[901,1036],[1050,1133]],{wall:true});
  barrierPath([[361,888],[427,827],[504,761],[574,735],[662,721]],{tyres:true});
  barrierPath([[466,858],[564,823],[673,814]],{tyres:true});
  barrierPath([[749,771],[832,754],[860,735]],{tyres:true});
  if(tyreLocations.length){
    const g=new THREE.TorusGeometry(.37,.15,5,10),m=new THREE.InstancedMesh(g,black,tyreLocations.length*2),d=new THREE.Object3D();
    tyreLocations.forEach((p,i)=>{for(let j=0;j<2;j++){d.position.set(p[0],p[1]+j*.28,p[2]);d.rotation.x=Math.PI/2;d.updateMatrix();m.setMatrixAt(i*2+j,d.matrix);}});m.castShadow=true;m.receiveShadow=true;m.computeBoundingSphere();group.add(m);
  }
  // Extrude the actual OSM building outlines. Footprints remain true to the data.
  for(const b of data.buildings||[]){
    if(!b.p||b.p.length<6)continue;
    const points=Array.isArray(b.p[0])?b.p:Array.from({length:b.p.length/2},(_,i)=>[b.p[2*i],b.p[2*i+1]]);
    const cx=points.reduce((v,p)=>v+p[0],0)/points.length,cz=points.reduce((v,p)=>v+p[1],0)/points.length;
    const y=yAt(cx,cz),h=b.h||b.height||(b.levels||1)*3.5;
    polygon(points,y+h,roof,group);
    for(let i=0;i<points.length;i++){const a=points[i],c=points[(i+1)%points.length];batch.beam([a[0],y+h/2,a[1]],[c[0],y+h/2,c[1]],.28,h,white);}
  }
  // Two-storey white clubhouse: satellite footprint with glazed north-facing balcony.
  const club=pixel(611,932),clubY=yAt(...club),clubYaw=-.20;
  function localBox(cx,cz,cy,w,h,d,mat){const x=club[0]+cx*Math.cos(clubYaw)+cz*Math.sin(clubYaw),z=club[1]-cx*Math.sin(clubYaw)+cz*Math.cos(clubYaw);batch.box(x,clubY+cy,z,w,h,d,mat,clubYaw);}
  // This modern façade postdates some OSM imagery; photo dimensions are approximations.
  localBox(0,0,3.8,28,7.6,17,white);localBox(0,-8.6,2,26,3.4,.2,glass);localBox(0,-8.6,5.7,26,2.7,.2,glass);
  localBox(0,-10.1,3.7,29,.22,4,roof);localBox(0,-10.1,7.7,29,.22,4,roof);
  for(let x=-13;x<=13;x+=4.3){localBox(x,-10.8,3.8,.14,7.6,.14,steel);localBox(x,-8.8,5.8,.12,2.7,.14,steel);}
  for(const yy of [4.1,4.6,4.9])localBox(0,-11.8,yy,28,.06,.06,steel);
  // Teal stretched-fabric pit canopies; individual open bays, no invented garage walls.
  function shelter(px,pz,w,d,yaw=0){const [x,z]=pixel(px,pz),y=yAt(x,z);batch.box(x,y+3.2,z,w,.12,d,canopy,yaw);for(const xx of [-w/2,w/2])for(let zz=-d/2;zz<=d/2+.1;zz+=Math.min(7,d)){batch.box(x+xx*Math.cos(yaw)+zz*Math.sin(yaw),y+1.6,z-xx*Math.sin(yaw)+zz*Math.cos(yaw),.10,3.2,.10,steel);}}
  shelter(345,966,8,57,-.16);shelter(154,943,16,46,-.2);shelter(710,727,53,8,-.13);
  // START gantry at the timing line. Photographed asymmetrical cantilever and checkerboard pier.
  const startS=circuit.startS??0, frame=route.frame(startS,{}),gantryY=frame.y;
  function gantryBox(u,h,s,w,d,hh,mat){const p=route.point(startS+s,u);batch.box(p.x,gantryY+h,p.z,w,hh,d,mat,route.heading(startS));}
  const support=-route.edge(startS)-1.2;
  gantryBox(support,3.35,0,1.5,.6,6.7,white);gantryBox(support+5.3,6.3,0,12.1,.7,1.6,white);
  for(let row=0;row<8;row++)for(let col=0;col<2;col++)if((row+col)%2===0)gantryBox(support+(col-.5)*.72,.55+row*.72,-.325,.70,.02,.70,black);
  gantryBox(support+7,4.98,0,3.5,.48,.7,black);
  for(let i=0;i<6;i++)gantryBox(support+5.6+i*.56,4.98,-.26,.25,.035,.36,red);
  if(assets.makeLabel){const label=assets.makeLabel('START',5.8,1.05,'#eeeee5','#111111');const p=route.point(startS-.37,support+6);label.position.set(p.x,gantryY+6.36,p.z);label.rotation.y=route.heading(startS);group.add(label);const rear=label.clone();const q=route.point(startS+.37,support+6);rear.position.set(q.x,gantryY+6.36,q.z);rear.rotation.y+=Math.PI;group.add(rear);}
  // Timing booth alongside the gantry and a narrow painted start stripe.
  const booth=route.point(startS+3,support-3);batch.box(booth.x,booth.y+1.45,booth.z,2,2.9,2.1,white,route.heading(startS));
  const window=route.point(startS+1.91,support-3);batch.box(window.x,window.y+1.8,window.z,1.35,.95,.08,glass,route.heading(startS));
  strip(route,startS-.12,startS+.12,s=>-route.edge(s),s=>route.edge(s),.071,white,roadGroup,.12);
  // White grid boxes are only on the start straight, as shown in track/onboard imagery.
  for(let row=0;row<7;row++)for(const side of [-1,1]){
    const s=startS-10-row*8-(side<0?4:0),u=side*2.6;
    strip(route,s,s+.12,u-1,u+1,.073,white,roadGroup);
    strip(route,s,s+2,u-.99,u-.88,.073,white,roadGroup);
    strip(route,s,s+2,u+.88,u+.99,.073,white,roadGroup);
  }
  // Olive orchards follow the agricultural parcels north and south of the circuit.
  const trees=[],trunks=[],leaf=flat(0x647452);let seed=70043234;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(const [x0,z0,x1,z1] of [[310,1095,470,1280],[526,1097,618,1285],[791,1112,936,1260],[920,365,1045,452],[1220,330,1390,555],[1020,55,1215,295],[1355,523,1530,845]]){
    for(let z=z0;z<z1;z+=24)for(let x=x0;x<x1;x+=24){const p=pixel(x+(rand()-.5)*5,z+(rand()-.5)*5);const r=2.2+rand()*1.1;trees.push([p[0],yAt(...p)+3,p[1],r]);trunks.push([p[0],yAt(...p)+1.2,p[1]]);}
  }
  for(const t of trunks)batch.box(t[0],t[1],t[2],.3,2.4,.3,timber);
  if(trees.length){const g=new THREE.IcosahedronGeometry(1,1),m=new THREE.InstancedMesh(g,leaf,trees.length),d=new THREE.Object3D();trees.forEach((p,i)=>{d.position.set(p[0],p[1],p[2]);d.scale.set(p[3],p[3]*.7,p[3]);d.rotation.y=i*2.4;d.updateMatrix();m.setMatrixAt(i,d.matrix);m.setColorAt(i,new THREE.Color().setHSL(.20+rand()*.035,.12+rand()*.1,.29+rand()*.08));});m.receiveShadow=true;m.castShadow=true;m.computeBoundingSphere();group.add(m);}
  // Georeferenced rural access paths, outside the raceway perimeter.
  worldPath(pp([[9,1152],[100,1084],[277,1055],[576,1042],[833,1032],[927,1110],[1018,1201]]),4.5,dirt);
  worldPath(pp([[1062,1491],[1125,1250],[1139,1043],[1223,811],[1274,593],[1344,427],[1480,274]]),4,dirt);
  batch.flush();
  mergeSurfaces(roadGroup);mergeSurfaces(group);
  group.userData.reference='tools/maps/megara/SOURCES.md';
  // Every material, geometry and label remains below group for map-world disposal.
  return {group,obstacles,assets:{},road:{group:roadGroup,asphalt}};
}
