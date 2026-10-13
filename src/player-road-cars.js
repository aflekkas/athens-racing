// Additional Greek-road player cars. Original procedural geometry, metres, nose -Z.
// Reference photographs/specifications: tools/models-more-notes.md.
import * as THREE from 'three';
export const ROAD_MODELS = {
 huracan: {L:4.520,W:1.933,H:1.165,wb:2.620,track:1.668,r:.338,rim:.254,tyreF:.245,tyreR:.305,belt:.79,front:.56,rear:.82,cowl:-.99,header:-.28,roofBack:.53,back:1.04,seatZ:.16,eyeY:.91,leather:'#282b2d',doors:2,seats:2,seatBase:.30,brand:'LAMBORGHINI',stations:[[-2.26,.77,.56],[-1.80,.925,.64],[-1.30,.9665,.79],[-.99,.91,.79],[.3,.86,.79],[1.28,.9665,.87],[1.90,.93,.86],[2.26,.83,.82]]},

  mini_jcw: {L:3.874,W:1.727,H:1.414,wb:2.495,track:1.485,r:.316,rim:.216,tyreF:.205,tyreR:.205,belt:.96,front:.82,rear:.98,cowl:-.65,header:-.24,roofBack:1.25,back:1.67,seatZ:.22,eyeY:1.12,leather:'#292a2c',doors:2,blackRoof:true,archTrim:true,brand:'MINI',stations:[[-1.937,.76,.82],[-1.55,.85,.92],[-1.0,.864,.97],[-.65,.85,.96],[.55,.85,.96],[1.28,.864,.98],[1.937,.76,.98]]},
};
const mix=(a,b,t)=>a+(b-a)*t;
export function buildRoadCar(car,d,M,low,plate,H){
  const {surface,box,line,patch,mesh,ring,disk,cabin,wheels,makePlateMaterial,textMaterial}=H,p=car.body,id=car.modelKind;
  const F=-d.L/2,R=d.L/2,W=d.W/2,ax=d.axleOffset||0;
  const section=z=>{const a=d.stations;for(let i=1;i<a.length;i++)if(z<=a[i][0]){const t=Math.max(0,Math.min(1,(z-a[i-1][0])/(a[i][0]-a[i-1][0]))),q=t*t*(3-2*t);return [mix(a[i-1][1],a[i][1],q),mix(a[i-1][2],a[i][2],q)];}return a.at(-1).slice(1);};
  const side=(z,y)=>{const [w,h]=section(z),v=Math.max(0,Math.min(1,(y-.18)/(h-.18)));return w-.055*(1-v)**4-.024*v**7;};
  const deck=(x,z)=>{const [w,h]=section(z);return h+.028*(1-(x/(w-.024))**2);};
  car.playerSurface={top:z=>section(z)[1],side,deck};
  for(const s of [-1,1]){
    const arch=d.r+.055;
    surface(p,M.paint,(u,v)=>{const z=mix(F,R,u);let bottom=.18;for(const a of [-d.wb/2+ax,d.wb/2+ax])if(Math.abs(z-a)<arch)bottom=Math.max(bottom,d.r+Math.sqrt(arch*arch-(z-a)**2));const y=mix(bottom,section(z)[1],v);return [s*side(z,y),y,z];},low?90:180,12,'body-side');
    for(const a of [-d.wb/2+ax,d.wb/2+ax]){const points=[];for(let j=0;j<=32;j++){const t=j*Math.PI/32,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);points.push([s*(side(z,y)+.003),y,z]);}line(p,d.archTrim?M.black:M.paint,points,d.archTrim?.020:.009);
      surface(p,M.black,(u,v)=>{const t=u*Math.PI,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);return [s*mix(d.track/2-.12,side(z,y),v),y,z];},24,2,'wheelarch-liner');}
    surface(p,M.paint,(u,v)=>{const z=mix(d.cowl,d.back,u),h=section(z)[1];return[s*mix(side(z,h),W-.115,v),mix(h,d.belt+.014,v)+.012*Math.sin(v*Math.PI),z];},48,5,'door-shoulder');
    const ends=d.doors===4?[.30,1.08]:[.66];
    for(const z of ends){line(p,M.seam,[[s*side(z,d.belt),d.belt,z],[s*side(z,.5),.5,z+.02],[s*side(z-.08,.27),.27,z-.08]],.0028,'door-seam');box(p,M.chrome,[.026,.028,.14],[s*(side(z-.15,d.belt-.11)+.008),d.belt-.11,z-.15],.01,[0,0,0],'door-handle');}
    line(p,M.seam,[[s*side(d.cowl+.06,d.belt),d.belt,d.cowl+.06],[s*side(d.cowl+.13,.32),.32,d.cowl+.13],[s*side(ends.at(-1)-.08,.27),.27,ends.at(-1)-.08]],.0028);
    box(p,d.archTrim?M.black:M.paint,[.045,.072,d.wb-.70],[s*(W-.035),.23,ax],.012,[0,0,0],'side-sill');
  }
  for(const [a,b,name]of [[F,d.cowl,'bonnet'],[d.back,R,'boot']])surface(p,M.paint,(u,v)=>{const z=mix(a,b,u),x=(2*v-1)*(section(z)[0]-.024);return[x,deck(x,z),z];},40,16,name);
  for(const z of [F,R])surface(p,M.paint,(u,v)=>{const y=mix(.18,section(z)[1],v),x=(2*u-1)*side(z,y);return[x,y+.028*(1-(2*u-1)**2)*v**8,z];},24,10,z<0?'front-bumper':'rear-bumper');
  box(p,M.black,[d.W*.81,.07,d.L*.86],[0,.20,0],.02,[0,0,0],'undertray');
  cabin(car,d,M,low);wheels(car,d,M,low);
  // Cabin liners must stay inside a pinched coupe waist.
  for(const o of p.children)if(o.isMesh&&o.material===M.black&&Math.abs(o.position.x)>W-.15&&o.position.y<d.belt&&o.position.y>d.belt-.4)o.position.x=Math.sign(o.position.x)*(W-.24);
  // Broad sheet-metal pillars, unlike the convertible's narrow perimeter rails.
  for(const s of [-1,1]){
    const bw=W-.115,rw=W-.23;
    patch(p,d.blackRoof?M.black:M.paint,[[s*bw,d.belt+.014,d.cowl],[s*rw,d.H-.045,d.header],[s*rw,d.H-.075,d.header+.065],[s*bw,d.belt+.014,d.cowl+.075]],'solid-a-pillar');
    patch(p,d.blackRoof?M.black:M.paint,[[s*rw,d.H-.045,d.roofBack-.16],[s*rw,d.H-.045,d.roofBack],[s*bw,d.belt+.014,d.back],[s*bw,d.belt+.014,d.back-.23]],'solid-c-pillar');
  }
  if(d.blackRoof){const roof=p.getObjectByName('roof');roof.material=M.black.clone();roof.material.envMapIntensity=.10;roof.material.roughness=.88;roof.material.userData.fleetLivery=true;roof.userData.mirrorSupport=true;}

  // Fascia helpers retain named damage boundaries, optics and a matched Greek plate pair.
  const face=(m,points,z,name)=>{const shape=new THREE.Shape();points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();const base=new THREE.ShapeGeometry(shape).toNonIndexed(),a=base.attributes.position,vertices=[];const n=10;for(let i=0;i<a.count;i+=3){const A=new THREE.Vector3().fromBufferAttribute(a,i),B=new THREE.Vector3().fromBufferAttribute(a,i+1),C=new THREE.Vector3().fromBufferAttribute(a,i+2);const q=(u,v)=>A.clone().addScaledVector(B.clone().sub(A),u/n).addScaledVector(C.clone().sub(A),v/n).toArray();for(let u=0;u<n;u++)for(let v=0;v<n-u;v++){vertices.push(...q(u,v),...q(u+1,v),...q(u,v+1));if(u+v<n-1)vertices.push(...q(u+1,v),...q(u+1,v+1),...q(u,v+1));}}base.dispose();const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(vertices.length/3*2),2));g.computeVertexNormals();return mesh(p,g,m,[0,0,z],[0,0,0],name);};
  const badgeMat=textMaterial(d.brand,'#171b20','#dddddd',256,80);M.badge.map=badgeMat.map;M.badge.needsUpdate=true;
  const lamp=(s,points,rear=false)=>face(rear?M.tail:M.head,points.map(([x,y])=>[s*x,y]),rear?R+.004:F-.004,`${rear?'rear':'front'}-lamp-housing`);
  const badge=(text,w,h,y,z)=>mesh(p,new THREE.PlaneGeometry(w,h),textMaterial(text,null),[0,y,z],[0,z<0?Math.PI:0,0],'badge');
  if(id==='mini_jcw'){
    face(M.black,[[-.43,.80],[-.34,.86],[.34,.86],[.43,.80],[.37,.55],[-.37,.55]],F-.006,'jcw-hex-grille');
    line(p,M.chrome,[[-.43,.80,F-.009],[-.34,.86,F-.009],[.34,.86,F-.009],[.43,.80,F-.009],[.37,.55,F-.009],[-.37,.55,F-.009],[-.43,.80,F-.009]],.009);
    box(p,M.red,[.69,.018,.012],[0,.73,F-.013],.003);
    for(const s of [-1,1]){
      const light=new THREE.Group();light.name='front-lamp-housing';light.position.set(s*.60,.86,F-.035);light.rotation.x=-.23;p.add(light);
      const cup=ring(light,M.paint,.151,.016,[0,0,-.022]);cup.scale.y=1.22;
      const lens=disk(light,M.head,.137,[0,0,-.02],[0,Math.PI,0]);lens.scale.y=1.22;
      const rim=ring(light,M.chrome,.142,.012,[0,0,-.023]);rim.scale.y=1.22;
      const led=ring(light,M.led,.119,.007,[0,0,-.026]);led.scale.y=1.22;
      disk(light,M.chrome,.063,[0,-.022,-.03],[0,Math.PI,0]);disk(light,M.led,.042,[0,-.022,-.033],[0,Math.PI,0]);
      face(M.black,[[s*.47,.52],[s*.72,.55],[s*.72,.29],[s*.43,.29]],F-.009,'jcw-brake-intake');
      box(p,M.black,[.26,.045,.09],[s*.58,.285,F+.008],.007);
      lamp(s,[[.53,1.00],[.72,1.00],[.72,.69],[.53,.69]],true);
      line(p,M.chrome,[[s*.52,1.01,R+.012],[s*.73,1.01,R+.012],[s*.73,.68,R+.012],[s*.52,.68,R+.012],[s*.52,1.01,R+.012]],.010);
      line(p,M.tail,[[s*.55,.94,R+.02],[s*.69,.94,R+.02],[s*.69,.75,R+.02],[s*.55,.75,R+.02]],.013);
      surface(p,M.black,(u,v)=>{const z=mix(F+.28,d.cowl-.06,u),x=s*mix(.21,.32,v);return[x,deck(x,z)+.003,z];},24,2,'bonnet-stripe');
    }
    box(p,M.black,[1.27,.08,.29],[0,d.H-.01,d.roofBack+.11],.02,[0,0,0],'jcw-roof-spoiler');
    box(p,M.black,[.32,.024,.11],[0,deck(0,-1.15)+.01,-1.15],.009,[0,0,0],'bonnet-scoop');
    badge('MINI',.16,.035,.89,F-.008);badge('JOHN COOPER WORKS',.30,.034,.91,R+.009);
    car.exhaust=[new THREE.Vector3(-.075,.26,R+.024),new THREE.Vector3(.075,.26,R+.024)];
  }
  if(id==='huracan'){
    for(const s of [-1,1]){
      const hp=(x,z)=>[s*x,deck(s*x,z)+.009,z];
      patch(p,M.head,[hp(.42,F+.24),hp(.78,F+.60),hp(.80,F+.32),hp(.55,F+.17)],'front-lamp-housing');
      line(p,M.led,[hp(.50,F+.26),hp(.65,F+.38),hp(.75,F+.49)],.008);line(p,M.led,[hp(.65,F+.38),hp(.72,F+.31)],.008);
      face(M.black,[[s*.21,.47],[s*.58,.54],[s*.79,.45],[s*.70,.25],[s*.38,.25]],F-.009,'evo-y-intake');
      line(p,M.paint,[[s*.39,.26,F-.02],[s*.54,.38,F-.02],[s*.30,.49,F-.02]],.022);

      lamp(s,[[.35,.81],[.80,.84],[.78,.74],[.39,.72]],true);
      for(const t of [0,.16])line(p,M.tail,[[s*(.40+t),.76,R+.02],[s*(.47+t),.79,R+.02],[s*(.53+t),.76,R+.02]],.009);
      patch(p,M.black,[[s*side(.50,.70),.70,.50],[s*side(1.04,.82),.82,1.04],[s*side(1.04,.46),.46,1.04],[s*side(.66,.39),.39,.66]],'evo-side-intake');
      box(p,M.black,[.07,.065,1.82],[s*(W-.06),.20,.04],.012,[0,0,0],'evo-sill');
    }
    face(M.black,[[-.76,.70],[.76,.70],[.70,.51],[-.70,.51]],R+.008,'evo-rear-mesh');
    box(p,M.black,[1.50,.07,.22],[0,.20,F+.08],.012,[0,0,0],'front-splitter');
    box(p,M.black,[1.40,.12,.34],[0,.24,R-.10],.01,[0,0,0],'rear-diffuser');
    for(let i=-3;i<=3;i++)box(p,M.black,[.018,.09,.25],[i*.19,.24,R-.17],.005,[0,0,0],'diffuser-strake');
    for(let i=0;i<8;i++){const z=1.09+i*.115;box(p,M.black,[1.13,.025,.055],[0,deck(0,z)+.008,z],.006,[0,0,0],'engine-cover-louvre');}
    box(p,M.paint,[1.67,.045,.17],[0,.925,R-.10],.01,[0,0,0],'evo-tail-spoiler');
    badge('LAMBORGHINI',.33,.027,.855,R+.02);car.exhaust=[new THREE.Vector3(-.25,.62,R+.012),new THREE.Vector3(.25,.62,R+.012)];
  }
  M.plate=makePlateMaterial(plate);car.plate=plate;
  for(const s of [-1,1]){box(p,M.black,[.545,.125,.018],[0,s<0?.465:.53,s<0?F-.01:R+.01],.005,[0,0,0],'plate-carrier');mesh(p,new THREE.PlaneGeometry(.52,.112),M.plate,[0,s<0?.465:.53,s<0?F-.021:R+.021],[0,s<0?Math.PI:0,0],'registration');}
  if(!car.exhaust)car.exhaust=[new THREE.Vector3(-W*.55,.245,R+.02)];
  for(const v of car.exhaust){const pipe=mesh(p,new THREE.CylinderGeometry(id==='huracan'?.070:.037,id==='huracan'?.070:.037,.16,16,1,true),M.chrome,v.toArray(),[Math.PI/2,0,0],'exhaust');disk(p,M.black,id==='huracan'?.060:.031,[v.x,v.y,v.z+.081]);}
  p.updateMatrixWorld(true);
  const world=new THREE.Vector3();
  p.traverse(o=>{if(!o.isMesh||o===car.mirrorL||o===car.mirrorR)return;const a=o.geometry.attributes.position,inv=o.matrixWorld.clone().invert();for(let i=0;i<a.count;i++){world.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);const t=Math.max(0,Math.min(1,(Math.abs(world.z)-d.L*.34)/(d.L*.16)));world.z-=Math.sign(world.z)*.16*t*t*(Math.abs(world.x)/W)**2;world.applyMatrix4(inv);a.setXYZ(i,world.x,world.y,world.z);}a.needsUpdate=true;o.geometry.computeVertexNormals();o.geometry.computeBoundingSphere();});
}
