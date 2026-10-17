// Additional Greek-road player cars. Original procedural geometry, metres, nose -Z.
// Reference photographs/specifications: tools/models-more-notes.md.
import * as THREE from './vehicle-primitives.js';
import { buildHuracanShell, buildHuracanCabin } from './player-huracan.js';
import { F348_MODEL, buildF348 } from './player-f348.js';
import { buildP928 } from './player-p928.js';
export const ROAD_MODELS = {
 jazz: {L:4.028,W:1.694,H:1.550,wb:2.530,track:1.477,r:.302,rim:.1905,tyreF:.185,tyreR:.185,belt:1.02,front:.78,rear:1.03,cowl:-1.13,header:-.48,roofBack:1.32,back:1.82,seatZ:.10,eyeY:1.23,leather:'#333a43',doors:4,brand:'HONDA',stations:[[-2.014,.66,.76],[-1.65,.80,.84],[-1.13,.847,1.02],[.3,.83,1.03],[1.26,.847,1.04],[2.014,.73,1.02]]},
 f348: F348_MODEL,
 p928: {L:4.520,W:1.890,H:1.282,wb:2.500,track:1.560,r:.321,rim:.2286,tyreF:.225,tyreR:.265,belt:.855,front:.66,rear:.80,cowl:-.82,header:-.29,roofBack:.48,back:1.98,seatZ:.23,seatBase:.36,eyeY:.97,leather:'#635347',doors:2,rearLow:true,classic:true,brand:'PORSCHE'},
 e36: {L:4.433,W:1.698,H:1.393,wb:2.700,track:1.408,r:.309,rim:.1905,tyreF:.205,tyreR:.205,belt:.91,front:.77,rear:.88,cowl:-.83,header:-.35,roofBack:.81,back:1.37,seatZ:.26,eyeY:1.06,leather:'#43474c',doors:4,brand:'BMW',stations:[[-2.2165,.74,.77],[-1.75,.82,.81],[-1.35,.849,.88],[-.83,.82,.91],[.5,.82,.91],[1.35,.849,.92],[1.80,.82,.89],[2.2165,.76,.88]]},

 yaris: {L:3.615,W:1.660,H:1.500,wb:2.370,track:1.440,r:.282,rim:.165,tyreF:.155,tyreR:.155,belt:.95,front:.76,rear:.98,cowl:-.89,header:-.34,roofBack:1.09,back:1.63,seatZ:.19,eyeY:1.20,leather:'#526779',doors:4,brand:'TOYOTA',stations:[[-1.8075,.66,.76],[-1.40,.80,.85],[-.90,.83,.95],[.4,.80,.97],[1.19,.83,1.0],[1.8075,.72,.98]]},

 panda: {L:3.538,W:1.578,H:1.540,wb:2.299,track:1.366,r:.286,rim:.165,tyreF:.155,tyreR:.155,belt:.97,front:.84,rear:1.0,cowl:-.81,header:-.38,roofBack:1.28,back:1.61,seatZ:.10,eyeY:1.24,leather:'#535d70',doors:4,brand:'FIAT',archTrim:true,stations:[[-1.769,.68,.84],[-1.4,.77,.89],[-.81,.789,.97],[.4,.78,.98],[1.14,.789,1.00],[1.769,.71,1.0]]},

 ibiza: {L:3.813,W:1.640,H:1.414,wb:2.440,track:1.429,r:.289,rim:.165,tyreF:.155,tyreR:.155,belt:.91,front:.76,rear:.95,cowl:-.78,header:-.25,roofBack:1.10,back:1.63,seatZ:.27,eyeY:1.08,leather:'#686665',doors:4,brand:'SEAT',stations:[[-1.9065,.70,.76],[-1.5,.79,.82],[-1.0,.82,.89],[-.78,.80,.91],[.5,.80,.92],[1.23,.82,.96],[1.9065,.73,.95]]},

 huracan: {L:4.520,W:1.933,H:1.165,axleOffset:.13,wb:2.620,track:1.668,r:.338,rim:.254,tyreF:.245,tyreR:.305,belt:.77,front:.39,rear:.80,cowl:-1.02,header:-.46,roofBack:.67,back:1.35,seatZ:-.06,eyeY:.87,leather:'#282b2d',doors:2,seats:2,seatBase:.30,brand:'LAMBORGHINI',stations:[[-2.26,.73,.35],[-2.05,.84,.425],[-1.75,.93,.605],[-1.18,.9665,.765],[-1.02,.936,.775],[-.50,.90,.785],[.25,.91,.82],[.82,.94,.875],[1.44,.9665,.875],[1.80,.91,.835],[2.26,.82,.785]]},

  mini_jcw: {L:3.874,W:1.727,H:1.414,wb:2.495,track:1.485,r:.316,rim:.216,tyreF:.205,tyreR:.205,belt:.96,front:.82,rear:.98,cowl:-.65,header:-.24,roofBack:1.25,back:1.67,seatZ:.34,eyeY:1.10,leather:'#292a2c',doors:2,blackRoof:true,archTrim:true,brand:'MINI',stations:[[-1.937,.76,.82],[-1.55,.85,.92],[-1.0,.864,.97],[-.65,.85,.96],[.55,.85,.96],[1.28,.864,.98],[1.937,.76,.98]]},
};
const mix=(a,b,t)=>a+(b-a)*t;
export function buildRoadCar(car,d,M,low,plate,H){
  if(car.modelKind==='f348')return buildF348(car,d,M,low,plate,H);
  if(car.modelKind==='p928')return buildP928(car,d,M,low,plate,H);
  const {surface,box,line,patch,mesh,ring,disk,cabin,wheels,makePlateMaterial,textMaterial}=H,p=car.body,id=car.modelKind;
  const F=-d.L/2,R=d.L/2,W=d.W/2,ax=d.axleOffset||0;
  let section=z=>{const a=d.stations;for(let i=1;i<a.length;i++)if(z<=a[i][0]){const t=Math.max(0,Math.min(1,(z-a[i-1][0])/(a[i][0]-a[i-1][0]))),q=t*t*(3-2*t);return [mix(a[i-1][1],a[i][1],q),mix(a[i-1][2],a[i][2],q)];}return a.at(-1).slice(1);};
  let side=(z,y)=>{const [w,h]=section(z),v=Math.max(0,Math.min(1,(y-.18)/(h-.18)));return w-.055*(1-v)**4-.024*v**7;};
  let deck=(x,z)=>{const [w,h]=section(z),rise={mini_jcw:.20,ibiza:.062,panda:.12,yaris:.23,e36:.045}[id]||0;return h+.028*(1-(x/(w-.024))**2)+rise*((id==='mini_jcw'?.25:.8)+(id==='mini_jcw'?.75:.2)*Math.exp(-(((Math.abs(x)-.60)/(id==='mini_jcw'?.16:.36))**4)))*Math.exp(-(((z-F)/.46)**2));};
  if(id==='huracan')({section,side,deck}=buildHuracanShell(car,d,M,low,H));
  else {
  car.playerSurface={top:z=>section(z)[1],side,deck};
  for(const s of [-1,1]){
    const arch=d.r+.055;
    surface(p,M.paint,(u,v)=>{const z=mix(F,R,u);let bottom=.18;for(const a of [-d.wb/2+ax,d.wb/2+ax])if(Math.abs(z-a)<arch)bottom=Math.max(bottom,d.r+Math.sqrt(arch*arch-(z-a)**2));const y=mix(bottom,deck(s*side(z,section(z)[1]),z),v);return [s*side(z,y),y,z];},low?90:180,12,'body-side');
    for(const a of [-d.wb/2+ax,d.wb/2+ax]){const points=[];for(let j=0;j<=32;j++){const t=j*Math.PI/32,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);points.push([s*(side(z,y)+.003),y,z]);}line(p,d.archTrim?M.black:M.paint,points,d.archTrim?.020:.009);
      surface(p,M.black,(u,v)=>{const t=u*Math.PI,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);return [s*mix(d.track/2-.12,side(z,y),v),y,z];},24,2,'wheelarch-liner');}
    surface(p,M.paint,(u,v)=>{const z=mix(d.cowl,d.back,u),h=section(z)[1];return[s*mix(side(z,h),W-.115,v),mix(h,d.belt+.014,v)+.012*Math.sin(v*Math.PI),z];},48,5,'door-shoulder');
    const ends=d.doors===4?[.30,1.08]:[.66];
    for(const z of ends){line(p,M.seam,[[s*side(z,d.belt),d.belt,z],[s*side(z,.5),.5,z+.02],[s*side(z-.08,.27),.27,z-.08]],.0028,'door-seam');box(p,M.chrome,[.026,.028,.14],[s*(side(z-.15,d.belt-.11)+.008),d.belt-.11,z-.15],.01,[0,0,0],'door-handle');}
    line(p,M.seam,[[s*side(d.cowl+.06,d.belt),d.belt,d.cowl+.06],[s*side(d.cowl+.13,.32),.32,d.cowl+.13],[s*side(ends.at(-1)-.08,.27),.27,ends.at(-1)-.08]],.0028);
    box(p,d.archTrim?M.black:M.paint,[.045,.072,d.wb-.70],[s*(W-.035),.23,ax],.012,[0,0,0],'side-sill');
  }
  for(const [a,b,name]of [[F,d.cowl,'bonnet'],[d.back,R,'boot']])surface(p,M.paint,(u,v)=>{const z=mix(a,b,u),x=(2*v-1)*(section(z)[0]-.024);return[x,deck(x,z),z];},40,16,name);
  for(const z of [F,R])surface(p,M.paint,(u,v)=>{const y=mix(.18,section(z)[1],v),x=(2*u-1)*side(z,y);return[x,mix(.18,deck(x,z),v),z];},24,10,z<0?'front-bumper':'rear-bumper');
  box(p,M.black,[d.W*.81,.07,d.L*.86],[0,.20,0],.02,[0,0,0],'undertray');
  }
  if(id==='huracan'){buildHuracanCabin(car,d,M,low,H);}else cabin(car,d,M,low);wheels(car,d,M,low);
  // Cabin liners must stay inside a pinched coupe waist.
  for(const o of p.children)if(o.isMesh&&o.material===M.black&&Math.abs(o.position.x)>W-.15&&o.position.y<d.belt&&o.position.y>d.belt-.4)o.position.x=Math.sign(o.position.x)*(W-.24);
  // Broad sheet-metal pillars, unlike the convertible's narrow perimeter rails.
  if(id!=='huracan')for(const s of [-1,1]){
    const bw=W-.115,rw=W-.23;
    patch(p,d.blackRoof?M.black:M.paint,[[s*bw,d.belt+.014,d.cowl],[s*rw,d.H-.045,d.header],[s*rw,d.H-.075,d.header+.065],[s*bw,d.belt+.014,d.cowl+.075]],'solid-a-pillar');
    patch(p,d.blackRoof?M.black:M.paint,[[s*rw,d.H-.045,d.roofBack-.16],[s*rw,d.H-.045,d.roofBack],[s*bw,d.belt+.014,d.back],[s*bw,d.belt+.014,d.back-.23]],'solid-c-pillar');
  }
  if(d.blackRoof){const roof=p.getObjectByName('roof');roof.material=M.black.clone();roof.material.envMapIntensity=.10;roof.material.roughness=.88;roof.material.userData.fleetLivery=true;roof.userData.mirrorSupport=true;}

  // Fascia helpers retain named damage boundaries, optics and a matched Greek plate pair.
  const face=(m,points,z,name,holes=[])=>{const shape=new THREE.Shape();points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();for(const points of holes){const hole=new THREE.Path();points.forEach(([x,y],i)=>i?hole.lineTo(x,y):hole.moveTo(x,y));hole.closePath();shape.holes.push(hole);}const base=new THREE.ShapeGeometry(shape).toNonIndexed(),a=base.attributes.position,vertices=[];const n=2;for(let i=0;i<a.count;i+=3){const A=new THREE.Vector3().fromBufferAttribute(a,i),B=new THREE.Vector3().fromBufferAttribute(a,i+1),C=new THREE.Vector3().fromBufferAttribute(a,i+2);const q=(u,v)=>A.clone().addScaledVector(B.clone().sub(A),u/n).addScaledVector(C.clone().sub(A),v/n).toArray();for(let u=0;u<n;u++)for(let v=0;v<n-u;v++){vertices.push(...q(u,v),...q(u+1,v),...q(u,v+1));if(u+v<n-1)vertices.push(...q(u+1,v),...q(u+1,v+1),...q(u,v+1));}}base.dispose();const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(vertices.length/3*2),2));g.computeVertexNormals();return mesh(p,g,m,[0,0,z],[0,0,0],name);};
  const lamp=(s,points,rear=false)=>face(rear?M.tail:M.head,points.map(([x,y])=>[s*x,y]),rear?R+.004:F-.004,`${rear?'rear':'front'}-lamp-housing`);
  const badge=(text,w,h,y,z)=>{if(!['H','MINI','LAMBORGHINI','S','FIAT','TOYOTA','BMW'].includes(text))return;const size=text==='LAMBORGHINI'?.09:Math.max(w,h,.10);return mesh(p,new THREE.PlaneGeometry(size,size),M.badge,[0,y,z],[0,z<0?Math.PI:0,0],'brand-badge');};
  if(id==='jazz'){
    face(M.black,[[-.58,.84],[-.44,.94],[.44,.94],[.58,.84],[.39,.69],[-.39,.69]],F-.008,'jazz-upper-grille');
    face(M.black,[[-.56,.53],[.56,.53],[.48,.28],[-.48,.28]],F-.009,'jazz-lower-grille');
    for(const s of [-1,1]){
      lamp(s,[[.36,.91],[.72,.91],[.76,.77],[.50,.72]]);
      line(p,M.chrome,[[s*.13,.86,F-.018],[s*.40,.81,F-.018],[s*.68,.81,F-.018]],.014,'jazz-chrome-wing');
      lamp(s,[[.61,1.00],[.76,1.00],[.76,.72],[.60,.72]],true);
      line(p,M.tail,[[s*.74,1.02,R+.013],[s*.68,1.27,R-.12],[s*.61,1.39,R-.23]],.032,'jazz-tall-tail-lamp');
      line(p,M.paint,[[s*(W-.01),.81,-.65],[s*(W-.006),.96,.65],[s*(W-.035),1.02,1.5]],.012,'jazz-side-crease');
    }
    badge('H',.12,.10,.84,F-.021);badge('H',.10,.08,.96,R+.014);badge('JAZZ',.18,.045,.82,R+.015);
  }
  if(id==='mini_jcw'){
    const trim=car.spec.trimLabel || 'JCW',jcw=trim==='JCW',sport=trim!=='COOPER';
    face(M.black,[[-.43,.80],[-.34,.86],[.34,.86],[.43,.80],[.37,.55],[-.37,.55]],F-.006,'jcw-hex-grille');
    line(p,M.chrome,[[-.43,.80,F-.009],[-.34,.86,F-.009],[.34,.86,F-.009],[.43,.80,F-.009],[.37,.55,F-.009],[-.37,.55,F-.009],[-.43,.80,F-.009]],.009);
    if(jcw)box(p,M.red,[.69,.018,.012],[0,.73,F-.013],.003);
    for(const s of [-1,1]){
      const light=new THREE.Group();light.name='front-lamp-housing';light.position.set(s*.60,.86,F-.035);light.rotation.x=-.23;p.add(light);
      const cup=ring(light,M.paint,.151,.016,[0,0,-.022]);cup.scale.y=1.22;
      const lens=disk(light,M.head,.137,[0,0,-.02],[0,Math.PI,0]);lens.scale.y=1.22;
      const rim=ring(light,M.chrome,.142,.012,[0,0,-.023]);rim.scale.y=1.22;
      const led=ring(light,M.led,.119,.007,[0,0,-.026]);led.scale.y=1.22;
      disk(light,M.chrome,.063,[0,-.022,-.03],[0,Math.PI,0]);disk(light,M.led,.042,[0,-.022,-.033],[0,Math.PI,0]);
      if(jcw)face(M.black,[[s*.47,.52],[s*.72,.55],[s*.72,.29],[s*.43,.29]],F-.009,'jcw-brake-intake');
      box(p,M.black,[.26,.045,.09],[s*.58,.285,F+.008],.007);
      lamp(s,[[.53,1.00],[.72,1.00],[.72,.69],[.53,.69]],true);
      line(p,M.chrome,[[s*.52,1.01,R+.012],[s*.73,1.01,R+.012],[s*.73,.68,R+.012],[s*.52,.68,R+.012],[s*.52,1.01,R+.012]],.010);
      line(p,M.tail,[[s*.55,.94,R+.02],[s*.69,.94,R+.02],[s*.69,.75,R+.02],[s*.55,.75,R+.02]],.013);
      if(jcw)surface(p,M.black,(u,v)=>{const z=mix(F+.28,d.cowl-.06,u),x=s*mix(.21,.32,v);return[x,deck(x,z)+.003,z];},24,2,'bonnet-stripe');
    }
    if(sport)box(p,M.black,[1.27,.08,.29],[0,d.H-.01,d.roofBack+.11],.02,[0,0,0],'jcw-roof-spoiler');
    if(sport)box(p,M.black,[.32,.024,.11],[0,deck(0,-1.15)+.01,-1.15],.009,[0,0,0],'bonnet-scoop');
    badge('MINI',.16,.035,.89,F-.008);badge(jcw?'JOHN COOPER WORKS':trim,.30,.034,.91,R+.009);
    car.exhaust=[new THREE.Vector3(-.075,.26,R+.024),new THREE.Vector3(.075,.26,R+.024)];
  }
  if(id==='huracan'){
    for(const s of [-1,1]){
      const hp=(x,z)=>[s*x,deck(s*x,z)+.009,z];
      patch(p,M.head,[hp(.42,F+.24),hp(.78,F+.60),hp(.80,F+.32),hp(.55,F+.17)],'front-lamp-housing');
      line(p,M.led,[hp(.50,F+.26),hp(.65,F+.38),hp(.75,F+.49)],.008);line(p,M.led,[hp(.65,F+.38),hp(.72,F+.31)],.008);
      face(M.black,[[s*.21,.32],[s*.58,.365],[s*.73,.31],[s*.66,.17],[s*.38,.17]],F-.009,'evo-y-intake');
      line(p,M.paint,[[s*.39,.18,F-.02],[s*.54,.27,F-.02],[s*.30,.34,F-.02]],.022);

      // The thin light pocket follows the haunch around the tail corner.
      patch(p,M.black,[[s*.08,.802,R+.012],[s*.75,.803,R+.012],[s*.75,.752,R+.012],[s*.08,.751,R+.012]],'rear-lamp-housing');
      patch(p,M.black,[[s*.75,.803,R+.012],[s*.84,.813,R-.30],[s*.84,.763,R-.30],[s*.75,.752,R+.012]],'rear-lamp-housing');
      line(p,M.tail,[[s*.02,.783,R+.019],[s*.73,.785,R+.019],[s*.84,.795,R-.30]],.004);
      for(const t of [0,.16]){line(p,M.tail,[[s*(.36+t),.765,R+.022],[s*(.43+t),.785,R+.022],[s*(.49+t),.765,R+.022]],.005);}
    }
    // A recessed engine vent with real apertures around the high central outlets.
    const outlets=[-.34,.34],exY=.626,exR=.103;
    const holes=outlets.map(x=>Array.from({length:6},(_,i)=>{const a=Math.PI/6+i*Math.PI/3;return[x+exR*Math.cos(a),exY+exR*Math.sin(a)];}));
    face(M.black,[[-.74,.747],[.74,.747],[.66,.535],[.46,.505],[-.46,.505],[-.66,.535]],R+.012,'evo-rear-mesh',holes);
    const ventWires=[];
    for(let row=0;row<3;row++)for(let col=0;col<13;col++){
      const x=-.70+col*.117+(row%2)*.0195,y=.521+row*.084;
      if(Math.abs(x)>.62+(y-.53)*.48||outlets.some(cx=>Math.hypot(x-cx,y-exY)<exR+.023))continue;
      const pts=[];for(let k=0;k<=6;k++){const a=k*Math.PI/3;pts.push([x+Math.cos(a)*.048,y+Math.sin(a)*.035,R+.018]);}for(let k=0;k<6;k++){const a=pts[k],b=pts[k+1],n=.0014/Math.hypot(b[0]-a[0],b[1]-a[1]),dx=-(b[1]-a[1])*n,dy=(b[0]-a[0])*n;
        const A=[a[0]+dx,a[1]+dy,a[2]],B=[b[0]+dx,b[1]+dy,b[2]],C=[b[0]-dx,b[1]-dy,b[2]],D=[a[0]-dx,a[1]-dy,a[2]];ventWires.push(...A,...B,...C,...A,...C,...D);}

    }
    const ventGeometry=new THREE.BufferGeometry();ventGeometry.setAttribute('position',new THREE.Float32BufferAttribute(ventWires,3));ventGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(ventWires.length/3*2),2));ventGeometry.computeVertexNormals();mesh(p,ventGeometry,M.darkAlloy,[0,0,0],[0,0,0],'evo-grille-hex');
    // The diffuser rolls underneath the bumper; seven deep fins remain vertical.
    surface(p,M.black,(u,v)=>{const x=(2*u-1)*mix(.61,.73,v),y=mix(.18,.49,v),z=R-.12+.15*v-.055*(x/.73)**2;return[x,y,z];},32,8,'evo-diffuser-valance');
    for(let i=-3;i<=3;i++){
      const x=i*.19;
      patch(p,M.darkAlloy,[[x-.008,.16,R-.25],[x+.008,.16,R-.25],[x+.008,.37,R+.025],[x-.008,.37,R+.025]],'diffuser-strake');
      patch(p,M.black,[[x-.008,.16,R-.25],[x-.008,.16,R+.025],[x-.008,.37,R+.025],[x-.008,.30,R-.25]],'diffuser-strake');
    }
    for(const s of [-1,1]){
      // Dark rear-corner exits follow the haunch, instead of ending as a square panel.
      patch(p,M.black,[[s*.70,.50,R+.018],[s*(side(R-.30,.55)+.006),.55,R-.30],[s*(side(R-.30,.27)+.006),.27,R-.30],[s*.62,.23,R-.04]],'evo-rear-corner-vent');
      line(p,M.paint,[[s*.69,.51,R+.022],[s*(side(R-.30,.56)+.008),.56,R-.30]],.009);
    }
    box(p,M.black,[1.50,.025,.22],[0,.15,F+.08],.012,[0,0,0],'front-splitter');
    for(let i=0;i<7;i++){const z=1.40+i*.105;surface(p,M.black,(u,v)=>{const x=(2*u-1)*.55,zz=z+(v-.5)*.035;return[x,deck(x,zz)+.005,zz];},20,2,'engine-cover-louvre');}
    surface(p,M.paint,(u,v)=>{const x=(2*u-1)*.78,z=R-.08+.07*v;return[x,deck(x,z)+.006+.010*v,z];},32,3,'evo-tail-spoiler');
    badge('LAMBORGHINI',.09,.09,.735,R+.035);car.exhaust=[new THREE.Vector3(-.34,.626,R+.095),new THREE.Vector3(.34,.626,R+.095)];
  }
  if(['ibiza','panda','yaris','e36'].includes(id)){
    const amber=new THREE.MeshStandardMaterial({color:'#d87a26',roughness:.25,side:THREE.DoubleSide});
    const optic=M.head;optic.color.set('#c4d1cf');optic.metalness=.35;optic.roughness=.19;
    if(id==='ibiza'){
      face(M.black,[[-.34,.77],[.34,.77],[.29,.64],[-.29,.64]],F-.007,'ibiza-split-grille');
      box(p,M.paint,[.064,.14,.022],[0,.71,F-.014],.004);
      for(const s of [-1,1]){face(optic,[[s*.34,.79],[s*.70,.81],[s*.72,.63],[s*.35,.63]],F-.006,'front-lamp-housing');face(amber,[[s*.64,.78],[s*.72,.79],[s*.73,.63],[s*.64,.63]],F-.012,'indicator-lens');lamp(s,[[.40,.95],[.72,.96],[.72,.77],[.40,.77]],true);}
      badge('S',.056,.045,.72,F-.028);badge('IBIZA  1.4',.24,.035,.87,R+.012);
    }else if(id==='panda'){
      face(M.black,[[-.32,.82],[.32,.82],[.32,.71],[-.32,.71]],F-.008,'panda-upper-grille');
      for(let i=0;i<3;i++)box(p,M.chrome,[.60,.012,.012],[0,.73+i*.035,F-.018],.003);
      for(const s of [-1,1]){face(optic,[[s*.37,.89],[s*.70,.91],[s*.70,.66],[s*.37,.66]],F-.008,'front-lamp-housing');face(amber,[[s*.39,.89],[s*.69,.90],[s*.69,.855],[s*.39,.85]],F-.013,'indicator-lens');
        const x=s*(W-.16),z=(d.back+d.roofBack)/2;box(p,M.tail,[.095,.49,.045],[x,1.22,z+.015],.023,[-.63,0,0],'rear-lamp-housing');
        line(p,M.black,[[s*.51,1.555,-.28],[s*.51,1.575,.92],[s*.51,1.54,1.15]],.023);}
      badge('FIAT',.088,.06,.765,F-.035);badge('PANDA',.20,.037,.92,R+.014);
    }else if(id==='yaris'){
      face(M.black,[[-.24,.79],[.24,.79],[.22,.67],[-.22,.67]],F-.008,'yaris-small-grille');
      for(const s of [-1,1]){face(optic,[[s*.34,.73],[s*.39,.95],[s*.62,.96],[s*.72,.75],[s*.69,.65],[s*.39,.65]],F-.009,'front-lamp-housing');disk(p,M.chrome,.060,[s*.51,.77,F-.014],[0,Math.PI,0]);lamp(s,[[.52,1.06],[.68,1.03],[.70,.79],[.53,.78]],true);}
      badge('TOYOTA',.11,.026,.79,F-.016);badge('YARIS',.19,.035,.91,R+.014);
    }else{
      for(const s of [-1,1]){face(M.chrome,[[s*.025,.79],[s*.17,.79],[s*.17,.61],[s*.025,.61]],F-.009,'e36-kidney-surround');face(M.black,[[s*.04,.775],[s*.152,.775],[s*.152,.625],[s*.04,.625]],F-.014,'e36-kidney-grille');for(let i=0;i<4;i++)box(p,M.chrome,[.006,.135,.006],[s*(.053+i*.028),.70,F-.019],.002);
        face(optic,[[s*.27,.79],[s*.72,.79],[s*.72,.64],[s*.27,.64]],F-.008,'front-lamp-housing');for(const x of [.37,.53]){disk(p,M.chrome,.060,[s*x,.715,F-.015],[0,Math.PI,0]);disk(p,M.led,.037,[s*x,.715,F-.018],[0,Math.PI,0]);}face(amber,[[s*.63,.79],[s*.73,.79],[s*.73,.64],[s*.63,.64]],F-.015,'indicator-lens');lamp(s,[[.36,.89],[.73,.89],[.73,.72],[.36,.72]],true);face(amber,[[s*.36,.89],[s*.73,.89],[s*.73,.835],[s*.36,.835]],R+.010,'rear-amber-lens');}
      badge('BMW',.085,.032,.82,F-.010);badge(car.spec.visual?.m?'M3':'325i',.17,.033,.87,R+.012);
    }
    for(const end of [-1,1]){const z=end<0?F:R,edge=W*(.87+.01*(.48-.43)/(.61-.43));face(M.black,[[-edge,.48],[edge,.48],[W*.87,.43],[-W*.87,.43]],z+end*.01,end<0?'front-bumper-rub-strip':'rear-bumper-rub-strip');face(M.black,[[-W*.88,.61],[W*.88,.61],[edge,.48],[-edge,.48]],z+end*.01,end<0?'attached-front-rub-strip':'attached-rear-rub-strip');}
    face(M.black,[[-.50,.36],[.50,.36],[.48,.25],[-.48,.25]],F-.012,'lower-cooling-slot');
    for(const s of [-1,1])line(p,M.black,[[s*(side(d.cowl+.10,.63)+.006),.63,d.cowl+.10],[s*(side(1.15,.63)+.006),.63,1.15]],.024);
    if(id==='ibiza'){const rust=new THREE.MeshStandardMaterial({color:'#795844',roughness:1,side:THREE.DoubleSide});for(const s of [-1,1])for(let i=0;i<6;i++){const z=.86+i*.044,y=.28+i%2*.012;box(p,rust,[.004,.008+i%3*.003,.023],[s*(side(z,y)+.003),y,z],.001,[0,0,0],'sill-patina');}const bottle=mesh(p,new THREE.CylinderGeometry(.075,.075,.38,16),new THREE.MeshStandardMaterial({color:'#206b98',metalness:.45,roughness:.25}),[.25,.52,1.14],[Math.PI/2,0,0],'nitrous-bottle');box(p,M.chrome,[.06,.04,.07],[.25,.52,.92],.006,[0,0,0],'nitrous-valve');}
  }
  M.plate=makePlateMaterial(plate);car.plate=plate;
  for(const s of [-1,1]){box(p,M.black,[.545,.125,.018],[0,s<0?(id==='huracan'?.255:.465):(id==='huracan'?.465:.53),s<0?F-.01:R+.01],.005,[0,0,0],'plate-carrier');mesh(p,new THREE.PlaneGeometry(.52,.112,12,2),M.plate,[0,s<0?(id==='huracan'?.255:.465):(id==='huracan'?.465:.53),s<0?F-.021:R+.021],[0,s<0?Math.PI:0,0],'registration');}
  if(!car.exhaust)car.exhaust=(car.spec.visual?.m?[-.49,-.40]:[-W*.55]).map(x=>new THREE.Vector3(x,.245,R+.02));
  for(const v of car.exhaust){
    if(id==='huracan'){
      // Closed-thickness hexagonal tubes: outer jacket, dark bore, bevel and a recessed throat.
      const ringAt=(u,r,z)=>{const a=Math.PI/6+u*Math.PI*2;return[v.x+r*Math.cos(a),v.y+r*Math.sin(a),z];};
      surface(p,M.chrome,(u,t)=>ringAt(u,mix(.092,.098,t),mix(v.z-.12,v.z,t)),6,4,'exhaust');
      surface(p,M.darkAlloy,(u,t)=>ringAt(u,mix(.076,.082,t),mix(v.z-.075,v.z-.007,t)),6,4,'exhaust-inner');
      surface(p,M.chrome,(u,t)=>ringAt(u,mix(.082,.098,t),v.z-.007+Math.sin(t*Math.PI/2)*.007),6,3,'hex-exhaust-lip');
      mesh(p,new THREE.CircleGeometry(.077,6),M.black,[v.x,v.y,v.z-.075],[0,0,Math.PI/6],'exhaust-throat');
    }else{
      mesh(p,new THREE.CylinderGeometry(.037,.037,.16,16,1,true),M.chrome,v.toArray(),[Math.PI/2,0,0],'exhaust');disk(p,M.black,.031,[v.x,v.y,v.z+.081]);
    }
  }

  p.updateMatrixWorld(true);
  const world=new THREE.Vector3();
  p.traverse(o=>{if(!o.isMesh||o===car.mirrorL||o===car.mirrorR)return;const a=o.geometry.attributes.position,inv=o.matrixWorld.clone().invert();for(let i=0;i<a.count;i++){world.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);const t=Math.max(0,Math.min(1,(Math.abs(world.z)-d.L*.34)/(d.L*.16)));world.z-=Math.sign(world.z)*(id==='huracan'?.34:.16)*t*t*(Math.abs(world.x)/W)**2;if(id==='huracan'&&world.z>0)world.z-=.07*t*t*((world.y-.56)/.42)**2;world.applyMatrix4(inv);a.setXYZ(i,world.x,world.y,world.z);}a.needsUpdate=true;o.geometry.computeVertexNormals();o.geometry.computeBoundingSphere();});
}
