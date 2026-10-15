// Original procedural 1992–95 Porsche 928 GTS, metres, nose -Z.
// Porsche Classic silhouette / Cup wheels / GTS rear panel references: tools/models-more-notes.md.
import * as THREE from 'three';
const mix=(a,b,t)=>a+(b-a)*t;
const clamp=t=>Math.max(0,Math.min(1,t));
function at(stations,z,column){
  for(let i=1;i<stations.length;i++)if(z<=stations[i][0]){const a=stations[i-1],b=stations[i],prev=stations[Math.max(0,i-2)],next=stations[Math.min(stations.length-1,i+1)],h=b[0]-a[0],t=clamp((z-a[0])/h);
    const m0=(b[column]-prev[column])/(b[0]-prev[0]),m1=(next[column]-a[column])/(next[0]-a[0]);
    return (2*t**3-3*t*t+1)*a[column]+(t**3-2*t*t+t)*h*m0+(-2*t**3+3*t*t)*b[column]+(t**3-t*t)*h*m1;}
  return stations.at(-1)[column];
}
export function buildP928(car,d,M,low,plate,H){
  const {surface,box,line,patch,mesh,ring,disk,cabinFittings,wheels,makePlateMaterial,textMaterial}=H;
  const p=car.body,F=-d.L/2,R=d.L/2,W=d.W/2;
  // Long, low bonnet; a pinched door waist swells into the wider GTS rear quarters.
  const stations=[[F,.73,.585],[-2.04,.835,.68],[-1.65,.90,.79],[-1.25,.905,.85],[d.cowl,.865,.855],[.35,.87,.855],[1.10,.945,.90],[1.55,.94,.91],[1.95,.87,.86],[R,.78,.80]];
  const top=z=>at(stations,z,2);
  const side=(z,y)=>{const v=clamp((y-.18)/(top(z)-.18));return at(stations,z,1)-.105*(1-v)**3-.022*v**7+.014*Math.sin(v*Math.PI);};
  const deck=(x,z)=>{const q=x/side(z,top(z));return top(z)+.025*(1-q*q)-.035*(1-q*q)*clamp((d.cowl-z)/.7);};
  car.playerSurface={top,side,deck};
  for(const s of [-1,1]){
    const arch=d.r+.052;
    surface(p,M.paint,(u,v)=>{const z=mix(F,R,u);let bottom=.18;for(const a of [-d.wb/2,d.wb/2])if(Math.abs(z-a)<arch)bottom=Math.max(bottom,d.r+Math.sqrt(arch*arch-(z-a)**2));const y=mix(bottom,top(z),v);return[s*side(z,y),y,z];},low?80:160,12,'body-side');
    for(const a of [-d.wb/2,d.wb/2]){
      const pts=[];for(let i=0;i<=36;i++){const t=i*Math.PI/36,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);pts.push([s*(side(z,y)+.002),y,z]);}line(p,M.paint,pts,.008);
      surface(p,M.black,(u,v)=>{const t=u*Math.PI,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);return[s*mix(d.track/2-.15,side(z,y)-.006,v),y,z];},32,3,'wheelarch-liner');
    }
    surface(p,M.paint,(u,v)=>{const z=mix(d.cowl,d.back,u);return[s*mix(side(z,top(z)),W-.115,v),mix(top(z),d.belt+.014,v)+.016*Math.sin(v*Math.PI),z];},56,8,'door-shoulder');
    const shut=[[d.cowl+.025,d.belt],[d.cowl+.10,.39],[d.cowl+.22,.27],[.69,.27],[.81,.46],[.79,d.belt]];
    const curve=new THREE.CatmullRomCurve3(shut.map(([z,y])=>new THREE.Vector3(0,y,z)));
    line(p,M.seam,curve.getPoints(64).map(({y,z})=>[s*(side(z,y)+.003),y,z]),.0025,'door-seam');
    box(p,M.black,[.025,.035,.13],[s*(side(.62,.78)+.008),.78,.62],.01,[0,0,0],'door-handle');
    // Keep the rub strip on steel, clear of both open wheel arches.
    for(const [a,b] of [[-2.09,-1.58],[-.92,.92],[1.58,2.06]]){const strip=[];for(let i=0;i<=16;i++){const z=mix(a,b,i/16);strip.push([s*(side(z,.56)+.005),.56,z]);}line(p,M.black,strip,.012,'side-protection-strip');}
    line(p,M.paint,[[s*.835,.235,-.83],[s*.84,.235,.82]],.031,'side-sill');
  }
  for(const [a,b,name]of [[F,d.cowl,'bonnet'],[d.back,R,'boot']])surface(p,M.paint,(u,v)=>{const z=mix(a,b,u),x=(2*v-1)*side(z,top(z));return[x,deck(x,z),z];},48,24,name);
  for(const z of [F,R])surface(p,M.paint,(u,v)=>{const y=mix(.18,top(z),v),x=(2*u-1)*side(z,y);return[x,mix(.18,deck(x,z),v),z];},32,12,z<0?'front-bumper':'rear-bumper');
  box(p,M.black,[1.45,.07,3.95],[0,.19,0],.03,[0,0,0],'undertray');
  for(const s of [-1,1]){const pts=[];for(let i=0;i<=24;i++){const z=mix(-2.05,d.cowl-.02,i/24),x=s*mix(.43,.67,i/24);pts.push([x,deck(x,z)+.003,z]);}line(p,M.seam,pts,.0022,'bonnet-seam');}

  // Low rounded roof and large wraparound hatch; the quarter pane ends in a curved painted pillar.
  const bw=W-.115,rw=W-.23,roofEdge=d.H-.045;
  car.windscreen=surface(p,M.glass,(u,v)=>{const x=2*u-1;return[x*mix(bw,rw,v),mix(d.belt+.014,roofEdge,v)+.018*(1-x*x),mix(d.cowl,d.header,v)-.045*(1-x*x)];},28,12,'windscreen');
  surface(p,M.paint,(u,v)=>{const x=2*v-1;return[x*rw,roofEdge+(.018+.039*Math.sin(u*Math.PI))*(1-x*x),mix(d.header,d.roofBack,u)-.045*(1-x*x)*(1-u)];},30,20,'roof');
  const hatch=(u,v)=>{const x=2*u-1;return[x*mix(rw,bw,v),mix(roofEdge,d.belt+.014,v)+(.012+.065*Math.sin(v*Math.PI))*(1-x*x),mix(d.roofBack,d.back,v)];};
  surface(p,M.glass,hatch,32,24,'rear-glass');
  for(const s of [-1,1]){
    const A=[s*bw,d.belt+.014,d.cowl],B=[s*rw,roofEdge,d.header],C=[s*rw,roofEdge,d.roofBack],D=[s*bw,d.belt+.014,d.back];
    const B0=[s*bw,d.belt+.014,.73],B1=[s*rw,roofEdge,.54];
    patch(p,M.glass,[A,B,B1,B0],'front-door-glass');line(p,M.black,[A,B,B1,B0,A],.008);
    patch(p,M.glass,[[s*bw,d.belt+.014,.79],[s*rw,roofEdge,.60],C,[s*(bw-.01),d.belt+.014,1.66]],'rear-door-glass');
    patch(p,M.black,[B0,B1,[s*rw,roofEdge,.60],[s*bw,d.belt+.014,.79]],'b-pillar');
    patch(p,M.paint,[A,B,[s*rw,roofEdge,d.header+.055],[s*bw,d.belt+.014,d.cowl+.055]],'solid-a-pillar');
    patch(p,M.paint,[C,[s*(rw-.04),roofEdge,d.roofBack-.025],[s*(bw-.015),d.belt+.014,1.66],D],'solid-c-pillar');
    line(p,M.paint,[B,[s*rw,roofEdge+.005,.28],C],.019,'roof-rail');
    line(p,M.black,[C,D],.009,'hatch-seal');
    line(p,M.black,[[s*.08,d.belt+.04,d.cowl-.02],[s*.26,d.belt+.055,d.cowl-.05],[s*.56,d.belt+.045,d.cowl-.05]],.006,'wiper');
    box(p,M.black,[.14,.035,.06],[s*(W-.025),d.belt+.06,d.cowl+.17],.012);
    box(p,M.paint,[.225,.105,.13],[s*(W+.065),d.belt+.10,d.cowl+.17],.042,[0,0,0],'cup-mirror-housing');
    car[s<0?'mirrorL':'mirrorR']=mesh(p,new THREE.PlaneGeometry(.185,.073),M.chrome,[s*(W+.065),d.belt+.10,d.cowl+.238],[0,0,0],'mirror-face');
    box(p,M.black,[.045,.27,1.28],[s*(W-.22),d.belt-.17,.17],.025,[0,0,0],'interior-door-liner');
  }
  for(let i=0;i<8;i++){const v=(i+1)/10,pts=[];for(let j=0;j<=24;j++){const q=hatch(.08+.84*j/24,v);q[1]-=.003;pts.push(q);}line(p,M.alloy,pts,.0012,'hatch-demister');}
  cabinFittings(car,d,M,low);
  const badge=textMaterial('PORSCHE','#171b20','#d6b779',256,80);M.badge.map=badge.map;M.badge.needsUpdate=true;
  wheels(car,d,M,low);

  const popups=[];
  const amber=new THREE.MeshStandardMaterial({color:'#cf802a',roughness:.24,side:THREE.DoubleSide});
  M.head.color.set('#b8c5c8');M.head.metalness=.45;M.head.roughness=.18;
  for(const s of [-1,1]){
    // Flip-forward lamps pivot at the front of the recess; closed lenses lie along the bonnet.
    const x=s*.625,z=-1.76,y=deck(x,z)+.012,rotation=[-1.78,0,0];
    const start=p.children.length;
    disk(p,M.black,.154,[x,y,z],rotation).name='front-lamp-housing';
    ring(p,M.paint,.151,.012,[x,y+.003,z],rotation);
    disk(p,M.head,.137,[x,y+.006,z],rotation).name='headlamp-lens';
    ring(p,M.chrome,.137,.003,[x,y+.009,z],rotation);
    if(!low)for(let i=-3;i<=3;i++){const xx=i*.028,h=Math.sqrt(.127**2-xx**2);line(p,M.chrome,[[x+xx,y+.012-h*.20,z-h],[x+xx,y+.012+h*.20,z+h]],.0012,'headlamp-fluting');}
    const nodes=p.children.slice(start);for(const o of nodes)o.userData.damagePart=s<0?'light_fl':'light_fr';
    popups.push({nodes,x,y,z,side:s});
    box(p,M.head,[.24,.073,.015],[s*.565,.445,F-.011],.013,[0,0,0],'bumper-driving-lamp');
    box(p,amber,[.13,.073,.018],[s*.748,.445,F-.012],.013,[0,0,0],'indicator-lens');
    box(p,M.tail,[.27,.115,.024],[s*.644,.755,R+.011],.018,[0,0,0],'rear-lamp-housing');
    box(p,amber,[.20,.036,.027],[s*.67,.787,R+.014],.008,[0,0,0],'rear-amber-lens');
  }
  box(p,M.black,[1.02,.075,.018],[0,.31,F-.008],.012,[0,0,0],'lower-cooling-slot');
  for(const end of [-1,1])line(p,M.seam,[[-.68,.56,end<0?F-.005:R+.005],[0,.56,end<0?F-.005:R+.005],[.68,.56,end<0?F-.005:R+.005]],.004,'bumper-joint');
  surface(p,M.red,(u,v)=>[mix(-.52,.52,u),mix(.697,.813,v),R+.024],32,4,'gts-red-reflector-panel');
  mesh(p,new THREE.PlaneGeometry(.77,.045,32,2),textMaterial('P O R S C H E',null,'#bca6a5'),[0,.756,R+.029],[0,0,0],'rear-badge');
  mesh(p,new THREE.PlaneGeometry(.24,.035,16,2),textMaterial('928 GTS',null),[.45,.632,R+.017],[0,0,0],'model-badge');
  // Body-coloured GTS bridge spoiler sits across the foot of the glass hatch.
  for(const s of [-1,1])box(p,M.paint,[.09,.075,.17],[s*.73,.91,1.95],.025,[0,0,0],'spoiler-support');
  surface(p,M.paint,(u,v)=>{const x=(2*u-1)*.83,z=mix(1.88,2.12,v);return[x,.968-.038*(x/.83)**2+.014*Math.sin(v*Math.PI),z];},32,8,'gts-rear-spoiler');
  line(p,M.paint,[[-.82,.93,2.12],[0,.966,2.12],[.82,.93,2.12]],.018,'spoiler-trailing-edge');
  mesh(p,new THREE.PlaneGeometry(.06,.065),M.badge,[0,deck(0,-2.04)+.008,-2.04],[-Math.PI/2,0,0],'bonnet-badge');
  M.plate=makePlateMaterial(plate);car.plate=plate;
  for(const end of [-1,1]){const z=end<0?F:R,y=end<0?.45:.47;box(p,M.black,[.545,.125,.018],[0,y,z+end*.012],.005,[0,0,0],'plate-carrier');mesh(p,new THREE.PlaneGeometry(.52,.112,16,3),M.plate,[0,y,z+end*.024],[0,end<0?Math.PI:0,0],'registration');}
  car.exhaust=[new THREE.Vector3(-.55,.255,R+.03),new THREE.Vector3(-.46,.255,R+.03)];
  for(const v of car.exhaust){mesh(p,new THREE.CylinderGeometry(.035,.035,.15,16,1,true),M.chrome,v.toArray(),[Math.PI/2,0,0],'exhaust');disk(p,M.black,.029,[v.x,v.y,v.z+.076]);}

  // Grouping/damage must see the real moving assembly's transforms. Only this model opts in.
  car.finishModel=keep=>{
    if(!car.playerParts)return;
    p.updateMatrixWorld(true);
    for(const lamp of popups){
      const parent=car.playerParts[lamp.side<0?'light_fl':'light_fr'];
      const hinge=lamp.hinge=new THREE.Group();hinge.name='popup-headlamp';
      hinge.position.set(lamp.x,lamp.y-.025,lamp.z-.15);parent.add(hinge);hinge.updateMatrixWorld(true);
      for(const node of lamp.nodes){hinge.attach(node);keep.add(node);}
    }
  };
  let opening=0;
  car.updateHeadlamps=dt=>{
    const target=car.lightsOn?1:0;opening+=Math.max(-dt*2.5,Math.min(dt*2.5,target-opening));
    for(const lamp of popups)if(lamp.hinge)lamp.hinge.rotation.x=-(Math.PI-1.78)*opening;
  };

  // Round both bumper corners with the same mapping for lamps, plates, shut lines and body panels.
  p.updateMatrixWorld(true);const world=new THREE.Vector3();
  p.traverse(o=>{if(!o.isMesh||o===car.mirrorL||o===car.mirrorR)return;const a=o.geometry.attributes.position,inv=o.matrixWorld.clone().invert();for(let i=0;i<a.count;i++){world.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);const t=clamp((Math.abs(world.z)-d.L*.34)/(d.L*.16));world.z-=Math.sign(world.z)*t*t*(.16*(Math.abs(world.x)/W)**2+.14*clamp((.43-world.y)/.25)**2);world.applyMatrix4(inv);a.setXYZ(i,world.x,world.y,world.z);}a.needsUpdate=true;o.geometry.computeVertexNormals();o.geometry.computeBoundingSphere();});
}
