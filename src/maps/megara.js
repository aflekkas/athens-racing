// Megara scenery, georeferenced to the OSM bundle and Esri reference in SOURCES.md.
// Ground references: BIKEIT Megara gallery, May 2023; RallyDiaries paddock/start photos.
// No coastal avenue median, traffic markings, palms or invented spectator grandstands.
import * as THREE from 'three';
import { TX, GLSL_HELPERS } from '../tex.js';
import { createTyreWalls } from '../tyre-walls.js';

const WHITE = 0xe1e0d8, STEEL = 0x9ca5a4, TYRE = 0x242524;
const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .92, ...extra });
function groundMaterial(color, scale = 1, kind='ground') {
  const material = flat(color,{side:THREE.DoubleSide});
  const isAsphalt=kind==='asphalt'||kind==='worn-asphalt';
  const key=isAsphalt?'asphalt':kind==='grass'?'grass':'ground';
  material.onBeforeCompile = shader => {
    shader.uniforms.tSurface={value:TX[key+'_diff']||TX.ground_diff};
    shader.uniforms.tSurfaceN={value:TX[key+'_nor']||TX.ground_nor};
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGround;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGround; uniform sampler2D tSurface; uniform sampler2D tSurfaceN;\n'+GLSL_HELPERS).replace('#include <color_fragment>', `#include <color_fragment>
      vec2 surfaceUV=vGround.xz/${(isAsphalt?3.4:2.6).toFixed(2)};
      vec3 scan=texNoTile(tSurface,surfaceUV).rgb;
      float scannedLum=dot(scan,vec3(.3333));
      float macro=fbm2(vGround.xz*.045);
      ${isAsphalt?`
      vec2 repairCell=floor(vGround.xz/vec2(8.,19.)); vec2 repairUV=fract(vGround.xz/vec2(8.,19.));
      float repair=step(.84,h12(repairCell))*step(.12,repairUV.x)*step(repairUV.x,.88)*step(.18,repairUV.y)*step(repairUV.y,.83);
      diffuseColor.rgb=${kind==='worn-asphalt'?'vec3(.245,.245,.232)':'vec3(.135,.132,.126)'}*(0.65+scannedLum*3.8)*(.83+.32*macro)*(1.-.2*repair);`
      :kind==='grass'?`float tufts=fbm2(vGround.xz*1.7); diffuseColor.rgb*= (.50+scannedLum*1.1)*(.85+.32*macro); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.27,.245,.115),smoothstep(.48,.70,tufts)*.30);`
      :`diffuseColor.rgb*= (.65+scannedLum*.95)*(.85+.30*macro);`}
    `).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>\nvec3 scannedNormal=texture2D(tSurfaceN,vGround.xz/2.6).xyz*2.-1.;normal=perturb(-vViewPosition,normal,vGround.xz/2.6,scannedNormal,${isAsphalt?'.5':'.8'});`);
  };
  material.customProgramCacheKey = () => 'megara-photo-surface-v2-' + kind + scale;
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
  route.fixedGantries=[circuit.startS??0];
  const yAt=(x,z)=>heightC?heightC(x,z):map.terrain.height(x,z);
  const asphalt=groundMaterial(0x646563,1,'asphalt'), wornAsphalt=groundMaterial(0x969892,1,'worn-asphalt'), gravel=groundMaterial(0xc1b797,.65), dirt=groundMaterial(0xa79c7a,.4);
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
    if(points.length<2)return;
    const pos=[],idx=[];
    for(let i=0;i<points.length;i++){
      const p=points[i],a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1,nx=-dz/l*width/2,nz=dx/l*width/2;
      for(const sign of [-1,1]){const x=p[0]+nx*sign,z=p[1]+nz*sign;pos.push(x,yAt(x,z)+height,z);}
      if(i<points.length-1){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();const m=new THREE.Mesh(g,mat);m.receiveShadow=true;group.add(m);
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
  // Green spring verges and yellow-green dry crop parcels are visible in both the
  // satellite and onboard sources. Parcel boundaries are traced, not random tiling.
  const grass=groundMaterial(0x778350,.72,'grass'),dryGrass=groundMaterial(0xa9a36a,.62,'grass'),crop=groundMaterial(0x69794c,.66,'grass');
  const fields=[
    [crop,[[171,403],[339,348],[351,458],[341,535],[215,540]]],
    [dryGrass,[[351,351],[439,308],[492,336],[519,433],[488,542],[354,529]]],
    [grass,[[508,408],[574,365],[652,373],[698,478],[691,555],[512,544]]],
    [crop,[[569,198],[644,176],[720,317],[666,379],[607,348]]],
    [dryGrass,[[708,190],[771,171],[849,340],[788,382],[740,326]]],
    [grass,[[725,389],[855,355],[909,381],[915,439],[856,553],[720,558]]],
    [crop,[[925,360],[1039,351],[1062,402],[1038,451],[922,454]]],
    [dryGrass,[[975,190],[1048,214],[1085,327],[956,346],[898,194]]],
    [grass,[[1070,418],[1187,403],[1201,454],[1191,514],[1095,535]]],
    [crop,[[1217,352],[1389,318],[1372,459],[1241,489]]],
    [dryGrass,[[132,1124],[274,1080],[291,1286],[216,1294]]],
    [grass,[[315,1093],[461,1083],[455,1268],[324,1284]]],
    [crop,[[526,1085],[616,1074],[627,1256],[523,1271]]],
    [dryGrass,[[645,1086],[744,1061],[782,1260],[651,1263]]],
    [grass,[[785,1119],[929,1109],[946,1237],[805,1260]]],
    [grass,[[248,608],[373,614],[565,634],[643,646],[623,669],[452,708],[257,754]]],
    [dryGrass,[[389,762],[558,725],[656,704],[759,690],[799,704],[807,724],[743,741],[504,783],[409,839]]],
    [grass,[[514,877],[553,858],[644,844],[660,852],[562,881],[521,945],[497,967],[456,967],[456,938]]],
    [grass,[[757,874],[873,854],[890,870],[875,881],[752,901],[700,938],[687,932],[702,905]]],
    [dryGrass,[[772,796],[853,778],[884,749],[898,705],[905,650],[964,651],[991,711],[984,768]]]
  ];
  // Fine triangles follow the same sampled terrain so plots don't float over DEM relief.
  function fieldPatch(pixels,mat){
    const points=pp(pixels),faces=THREE.ShapeUtils.triangulateShape(points.map(p=>new THREE.Vector2(...p)),[]),pos=[];
    function tri(a,b,c,depth){const ab=Math.hypot(a[0]-b[0],a[1]-b[1]),bc=Math.hypot(c[0]-b[0],c[1]-b[1]),ca=Math.hypot(a[0]-c[0],a[1]-c[1]);if(depth<5&&Math.max(ab,bc,ca)>12){const m=(p,q)=>[(p[0]+q[0])/2,(p[1]+q[1])/2],d=m(a,b),e=m(b,c),f=m(c,a);tri(a,d,f,depth+1);tri(d,b,e,depth+1);tri(f,e,c,depth+1);tri(d,e,f,depth+1);}else for(const p of [a,c,b])pos.push(p[0],yAt(...p)+.031,p[1]);}
    for(const f of faces)tri(points[f[0]],points[f[1]],points[f[2]],0);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();const m=new THREE.Mesh(g,mat);m.receiveShadow=true;group.add(m);
  }
  for(const [mat,pixels]of fields)fieldPatch(pixels,mat);
  // Grass is continuous beside the track; pale gravel only fills satellite-traced islands.
  for(const side of [-1,1])strip(route,0,route.length,s=>side*(route.edge(s)+.98),s=>side*(route.edge(s)+3.3),.018,grass,roadGroup);
  // Worn rubber follows the same racing line as AI, becoming heavier at braking zones.
  const rubber=flat(0x262824,{transparent:true,opacity:.075,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1});
  rubber.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vRubberPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nvRubberPosition=position;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vRubberPosition;\n'+GLSL_HELPERS).replace('#include <alphatest_fragment>','diffuseColor.a *= smoothstep(.20,.70,fbm2(vRubberPosition.xz*.22));\n#include <alphatest_fragment>');
  };
  rubber.customProgramCacheKey=()=> 'megara-worn-rubber-v1';
  for(const d of [-.78,.78])strip(route,0,route.length,s=>route.racingU(s)+d-.25,s=>route.racingU(s)+d+.25,.052,rubber,roadGroup);
  // Satellite traced paddock, pit lane and photographed pale dirt/gravel islands.
  for(const a of circuit.pavedAreas||[]){const p=Array.isArray(a.p[0])?a.p:Array.from({length:a.p.length/2},(_,i)=>[a.p[i*2],a.p[i*2+1]]);polygon(p,a.y!==undefined?a.y+.052:(x,z)=>yAt(x,z)+.052,a.surface==='worn-asphalt'?wornAsphalt:asphalt,group);}
  if(!(circuit.pavedAreas||[]).length)pixelPoly([[117,897],[190,891],[223,902],[337,903],[382,1015],[177,1045]],asphalt);
  worldPath(pp([[341,903],[426,841],[512,769],[583,738],[658,729],[755,719]]),7,asphalt);
  const runoffs=[[[243,608],[385,616],[580,638],[650,644],[633,667],[460,699],[268,750]],[[728,855],[870,833],[915,847],[908,885],[751,909],[702,936]],[[917,639],[986,653],[1008,719],[1009,773],[757,820],[762,793],[858,777],[896,736]],[[1111,631],[1171,634],[1215,680],[1178,746],[1082,780],[1100,747],[1157,710],[1165,676]],[[450,884],[515,843],[608,825],[656,829],[647,842],[553,864],[518,914],[493,964],[464,979],[437,965]],[[699,742],[768,736],[825,718],[824,704],[783,678],[661,689],[575,714]]];
  runoffs.forEach(p=>pixelPoly(p,gravel,.025));
  const tyreWalls = createTyreWalls(group, map, yAt, obstacles);
  // Perimeter is low concrete and mesh fence, as in the paddock/clubhouse photographs.
  function barrierPath(pixels,{tyres=false,wall=false}={}) {
    const pts=pp(pixels);
    if (tyres) { tyreWalls.path(pts); return; }
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(len/3);
      for(let j=0;j<n;j++){
        const t=j/n,t1=Math.min(1,(j+1)/n),x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,xx=a[0]+(b[0]-a[0])*t1,zz=a[1]+(b[1]-a[1])*t1,y=yAt(x,z);
        const midX=(x+xx)/2,midZ=(z+zz)/2,nearest=route.project(midX,midZ);
        if(Math.abs(nearest.u)>route.edge(nearest.s)+2)obstacles.push({x:midX,z:midZ,yaw:Math.atan2(xx-x,zz-z),hl:Math.hypot(xx-x,zz-z)/2,hw:tyres?.55:.18});
        if(wall)batch.beam([x,y+.65,z],[xx,yAt(xx,zz)+.65,zz],.32,1.3,white);
        else {batch.beam([x,y+.62,z],[xx,yAt(xx,zz)+.62,zz],.22,.32,steel);batch.box(x,y+.43,z,.13,.86,.13,steel);}
      }
    }
  }
  barrierPath([[192,874],[158,841],[117,774],[97,708],[153,662],[164,589],[202,549],[1168,610],[1239,664],[1234,731],[1120,803]],{tyres:true});
  barrierPath([[209,1049],[393,1039],[557,1023],[901,1036],[1050,1133]],{wall:true});
  barrierPath([[361,888],[427,827],[504,761],[574,735],[662,721]],{tyres:true});
  barrierPath([[466,858],[564,823],[673,814]],{tyres:true});
  barrierPath([[749,771],[832,754],[860,735]],{tyres:true});
  // Three-stack end caps keep the pit-wall tips conspicuous without narrowing the racing line.
  for (const [x,z] of [[209,1049],[393,1039]]) tyreWalls.path(pp([[x-3,z],[x+3,z]]));
  // Short tyre islands identify the infield chicane, outside the existing kerbs.
  for (const k of route.kerbs.slice(-3)) {
    const points = [k.s0+2,k.s0+4].map(s => { const p=route.point(s,k.side*(route.edge(s)+3)); return [p.x,p.z]; });
    tyreWalls.path(points,{facing:false});
  }
  tyreWalls.finish();
  // Galvanized diamond mesh around the timing booth/paddock is visible in
  // RallyDiaries start-straight.jpg and BIKEIT gallery09/gallery25. It is a low
  // access fence, not an invented grandstand or tall racing catch fence.
  const fenceMaterial=flat(0x7c8981,{transparent:true,opacity:.47,depthWrite:false,side:THREE.DoubleSide,roughness:.67,metalness:.25});
  fenceMaterial.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vFenceUV;').replace('#include <begin_vertex>','#include <begin_vertex>\nvFenceUV=uv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vFenceUV;').replace('#include <alphatest_fragment>',`vec2 diamond=vec2(vFenceUV.x+vFenceUV.y,vFenceUV.x-vFenceUV.y)/.105;
      vec2 fw=max(fwidth(diamond),vec2(.001));vec2 wireDistance=abs(fract(diamond+.5)-.5);
      vec2 wires=1.-smoothstep(vec2(.032)-fw*.5,vec2(.032)+fw*.5,wireDistance);
      diffuseColor.a*=max(wires.x,wires.y)*clamp(1.5/max(fw.x,fw.y),0.,1.);
      if(diffuseColor.a<.018)discard;
      #include <alphatest_fragment>`);
  };
  fenceMaterial.customProgramCacheKey=()=> 'megara-chainlink-v1';
  const fencePositions=[],fenceUV=[],fenceIndices=[];
  function fencePath(points){
    let along=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz),n=Math.max(1,Math.ceil(L/3));
      for(let j=0;j<n;j++){
        const t=j/n,t1=(j+1)/n,x=a[0]+dx*t,z=a[1]+dz*t,xx=a[0]+dx*t1,zz=a[1]+dz*t1,y=yAt(x,z),yy=yAt(xx,zz),base=fencePositions.length/3;
        fencePositions.push(x,y+.12,z,xx,yy+.12,zz,x,y+2.12,z,xx,yy+2.12,zz);
        fenceUV.push(along+L*t,0,along+L*t1,0,along+L*t,2,along+L*t1,2);fenceIndices.push(base,base+2,base+1,base+1,base+2,base+3);
        batch.box(x,y+1.12,z,.055,2.24,.055,steel);
        batch.beam([x,y+2.14,z],[xx,yy+2.14,zz],.035,.035,steel);
        // Small inward returns match the start-area access fence posts.
        batch.beam([x,y+2.16,z],[x-dz/L*.22,y+2.28,z+dx/L*.22],.045,.09,steel);
      }
      along+=L;
    }
  }
  fencePath(pp([[142,894],[166,1037],[209,1049],[393,1039],[557,1023],[901,1036]]));
  const timingFence=[];for(let ds=-38;ds<=82;ds+=4){const p=route.point((circuit.startS??0)+ds,-route.edge(ds)-12);timingFence.push([p.x,p.z]);}fencePath(timingFence);
  const fenceGeometry=new THREE.BufferGeometry();fenceGeometry.setAttribute('position',new THREE.Float32BufferAttribute(fencePositions,3));fenceGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(fenceUV,2));fenceGeometry.setIndex(fenceIndices);fenceGeometry.computeVertexNormals();group.add(new THREE.Mesh(fenceGeometry,fenceMaterial));
  // Extrude the actual OSM building outlines. Footprints remain true to the data.
  for(const b of data.buildings||[]){
    if(!b.p||b.p.length<6||b.id===135265201)continue;
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
  localBox(0,0,3.8,28,7.6,17,white);
  // Northwest/west glazing is visible from the final sector onboard.
  localBox(-14.12,0,2, .22,3.4,16,glass);localBox(-14.12,0,5.7,.22,2.7,16,glass);
  localBox(-15.4,0,3.7,3.2,.22,17,roof);localBox(-15.4,0,7.7,3.2,.22,17,roof);
  for(let z=-7;z<=7;z+=3.5)localBox(-16.5,z,3.8,.13,7.6,.13,steel);
  for(const yy of [4.1,4.6,4.9])localBox(-16.5,0,yy,.06,.06,16,steel);localBox(0,-8.6,2,26,3.4,.2,glass);localBox(0,-8.6,5.7,26,2.7,.2,glass);
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
  // Mapped southeast kart circuit is part of the real paddock complex.
  const kart=circuit.kartRoute||circuit.karting||[];
  if(kart.length>2)worldPath(kart,6.2,asphalt,.055);
  // Long pit/storage sheds: corrugated silver roofs, open dark bays, fascia and ribs.
  function shed(px,pz,w,d,yaw){const [x,z]=pixel(px,pz),y=yAt(x,z);batch.box(x,y+2.15,z,w,4.3,d,white,yaw);batch.box(x,y+4.37,z,w+.5,.2,d+.7,roof,yaw);for(let q=-d/2+2.5;q<d/2;q+=5){const wx=x-w/2*Math.cos(yaw)+q*Math.sin(yaw),wz=z+w/2*Math.sin(yaw)+q*Math.cos(yaw);batch.box(wx,y+1.8,wz,.10,3.4,4.15,glass,yaw);batch.box(wx-.12*Math.cos(yaw),y+3.65,wz+.12*Math.sin(yaw),.2,.16,4.5,steel,yaw);}for(let q=-d/2;q<d/2;q+=1.6){batch.box(x+q*Math.sin(yaw),y+4.51,z+q*Math.cos(yaw),w,.045,.05,steel,yaw);}}
  shed(150,943,18,49,-.20);shed(210,1013,26,15,-.12);shed(191,880,15,15,-.15);
  // Small parked support cars/vans in the apron, visible in the reference track days.
  const paint=[flat(0xc4c9cb,{roughness:.4}),flat(0x9c302a,{roughness:.45}),flat(0x36434d,{roughness:.4})];
  function parked(px,pz,yaw,van=false){const[x,z]=pixel(px,pz),y=yAt(x,z),mat=paint[Math.abs(Math.round(px))%paint.length],width=van?2.05:1.75,len=van?4.9:4.05;batch.box(x,y+.62,z,width,.86,len,mat,yaw);batch.box(x,y+(van?1.53:1.18),z,width*.89,van?1.45:.67,len*.55,van?white:glass,yaw);for(const a of [-1,1])for(const b of [-1,1]){const ox=a*width*.51,oz=b*len*.31;batch.box(x+ox*Math.cos(yaw)+oz*Math.sin(yaw),y+.35,z-ox*Math.sin(yaw)+oz*Math.cos(yaw),.22,.62,.62,black,yaw);}obstacles.push({x,z,yaw,hl:len/2,hw:width/2});}
  for(let i=0;i<9;i++)parked(229+i*10,921,-.10,i===0||i===5);
  for(let i=0;i<5;i++)parked(200+i*20,1028,1.40,i===2);
  // Paddock parking bays and service entrance tarmac use the actual western apron.
  worldPath(pp([[29,1148],[125,1073],[237,1049],[392,1031],[507,1027],[658,1027]]),5,asphalt,.06);
  for(let i=0;i<9;i++){const a=pixel(220+i*10,916),b=pixel(224+i*10,942);worldPath([a,b],.12,white,.077);}
  // A8 lies northwest of the circuit: two carriageways and the visible median.
  // Trace extends the straight segment visible in the georeferenced satellite.
  const motorway=pp([[-100,397],[140,245],[380,85],[650,-85]]);
  worldPath(motorway,25,asphalt,.06);
  worldPath(motorway,2.1,gravel,.079);
  for(let i=1;i<motorway.length;i++){
    const a=motorway[i-1],b=motorway[i],dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz),nx=-dz/L,nz=dx/L;
    for(let d=0;d<L;d+=16){const t=d/L,t1=Math.min(1,(d+5)/L);for(const u of [-6.3,6.3])worldPath([[a[0]+dx*t+nx*u,a[1]+dz*t+nz*u],[a[0]+dx*t1+nx*u,a[1]+dz*t1+nz*u]],.15,white,.085);}
    batch.beam([a[0],yAt(...a)+.8,a[1]],[b[0],yAt(...b)+.8,b[1]],.28,.5,steel);
  }
  // Sparse ambient A8 traffic moves along the two observed carriageways. It is
  // scenery outside the racing enclosure and never participates in lap timing.
  const motorwayDistances=[0];for(let i=1;i<motorway.length;i++)motorwayDistances.push(motorwayDistances[i-1]+Math.hypot(motorway[i][0]-motorway[i-1][0],motorway[i][1]-motorway[i-1][1]));
  const trafficGeo=new THREE.BoxGeometry(1,1,1),trafficCount=8;
  const distantBodies=new THREE.InstancedMesh(trafficGeo,white,trafficCount),distantGlass=new THREE.InstancedMesh(trafficGeo,glass,trafficCount),carPose=new THREE.Object3D();
  distantBodies.name='megara-A8-moving-traffic';distantGlass.name='megara-A8-traffic-glass';
  const highwayLength=motorwayDistances.at(-1),epoch=performance.now();
  function animateMotorway(){
    const time=(performance.now()-epoch)*.001;
    for(let i=0;i<trafficCount;i++){
      const direction=i%2?1:-1,travel=((i*.137*highwayLength+time*(18+i%3*2)*direction)%highwayLength+highwayLength)%highwayLength;
      let k=0;while(k<motorway.length-2&&motorwayDistances[k+1]<travel)k++;
      const a=motorway[k],b=motorway[k+1],L=motorwayDistances[k+1]-motorwayDistances[k],t=(travel-motorwayDistances[k])/L,dx=(b[0]-a[0])/L,dz=(b[1]-a[1])/L,u=direction*6;
      const x=a[0]+(b[0]-a[0])*t-dz*u,z=a[1]+(b[1]-a[1])*t+dx*u,y=yAt(x,z),truck=i===3||i===6;
      carPose.position.set(x,y+(truck?1.2:.65),z);carPose.rotation.set(0,Math.atan2(dx,dz),0);carPose.scale.set(truck?2.4:1.8,truck?2.3:.85,truck?8:4.1);carPose.updateMatrix();distantBodies.setMatrixAt(i,carPose.matrix);
      carPose.position.y=y+(truck?2.3:1.23);carPose.scale.set(truck?2:1.55,.62,truck?1.4:2.1);carPose.updateMatrix();distantGlass.setMatrixAt(i,carPose.matrix);
    }
    distantBodies.instanceMatrix.needsUpdate=true;distantGlass.instanceMatrix.needsUpdate=true;
  }
  animateMotorway();distantBodies.onBeforeRender=animateMotorway;
  // Moving across the strip makes static initial bounds unsuitable.
  distantBodies.frustumCulled=false;distantGlass.frustumCulled=false;group.add(distantBodies,distantGlass);
  // The isolated southeast agricultural warehouse is visible in the satellite.
  shed(1460,1367,47,42,.17);
  // Tall narrow cypresses/scrub mark the orchard boundaries; low bushes fill gaps.
  const cypressMat=flat(0x405439),bushMat=flat(0x6e7548),cypressPoints=[],bushPoints=[];
  for(const line of [[[130,460],[170,572]],[[279,1106],[304,1280]],[[947,1107],[976,1250]],[[931,402],[1170,362]],[[1108,576],[1233,581]],[[143,1054],[111,911]],[[409,294],[536,284]]]){
    const[a,b]=pp(line),L=Math.hypot(a[0]-b[0],a[1]-b[1]);for(let t=0;t<L;t+=8){const f=t/L,x=a[0]+(b[0]-a[0])*f,z=a[1]+(b[1]-a[1])*f;(Math.floor(t/8)%4===0?cypressPoints:bushPoints).push([x,yAt(x,z),z]);}
  }
  function plantInstances(points,geometry,material,cypress){if(!points.length)return;const m=new THREE.InstancedMesh(geometry,material,points.length),d=new THREE.Object3D();points.forEach((p,i)=>{const h=cypress?5.7+(i%4)*.55:1.2+(i%3)*.35;d.position.set(p[0],p[1]+h/2,p[2]);d.scale.set(cypress?1.05:2.2,h/2,cypress?1.05:1.7);d.rotation.y=i*1.61;d.updateMatrix();m.setMatrixAt(i,d.matrix);});m.receiveShadow=true;m.castShadow=true;m.computeBoundingSphere();group.add(m);}
  plantInstances(cypressPoints,new THREE.IcosahedronGeometry(1,1),cypressMat,true);plantInstances(bushPoints,new THREE.IcosahedronGeometry(1,1),bushMat,false);
  batch.flush();
  mergeSurfaces(roadGroup);mergeSurfaces(group);
  group.userData.reference='tools/maps/megara/SOURCES.md';
  // Every material, geometry and label remains below group for map-world disposal.
  return {group,obstacles,assets:{},road:{group:roadGroup,asphalt}};
}
