// Ferrari 348 tb: original procedural geometry, metres, nose -Z.
// Dimensions/design references: https://www.ferrari.com/en-EN/auto/348-tb
// Tyres: https://www.michelinman.com/auto/manufacturers/ferrari/348-tb
// See tools/models-more-notes.md for estimates and period colour caveats.
import * as THREE from './vehicle-primitives.js';
import { RoundedBoxGeometry } from './vehicle-primitives.js';
import { canvasTex } from './util.js';

export const F348_MODEL = {
  L:4.230,W:1.894,H:1.170,wb:2.450,track:1.540,r:.331,rim:.2159,tyreF:.215,tyreR:.255,
  belt:.79,front:.50,rear:.80,cowl:-.96,header:-.39,roofBack:.49,back:.73,
  seatZ:.04,eyeY:.91,seatBase:.32,seats:2,doors:2,leather:'#b38858',brand:'FERRARI',
  stations:[[-2.115,.79,.50],[-1.90,.88,.56],[-1.45,.925,.70],[-.96,.927,.79],[-.35,.90,.79],[.45,.929,.80],[1.225,.947,.825],[1.77,.92,.81],[2.115,.85,.80]],
};
const mix=(a,b,t)=>a+(b-a)*t;
const clamp=t=>Math.max(0,Math.min(1,t));

export function buildF348(car,d,M,low,plate,H){
  const {surface,box,line,patch,mesh,disk,cabinFittings,wheels,makePlateMaterial,textMaterial}=H;
  const p=car.body,F=-d.L/2,R=d.L/2;
  M.paint.metalness=.20;M.paint.roughness=.21;
  M.head.color.set('#c4ccd0');M.head.metalness=.25; // Clear rectangular lenses remain visible with lights off.
  const section=z=>{
    const a=d.stations;
    for(let i=1;i<a.length;i++)if(z<=a[i][0]){
      // Hermite sections preserve the wedge without a crease at every station.
      const A=a[i-1],B=a[i],P=a[Math.max(0,i-2)],N=a[Math.min(a.length-1,i+1)];
      const span=B[0]-A[0],t=clamp((z-A[0])/span);
      return [1,2].map(k=>(2*t**3-3*t*t+1)*A[k]+(t**3-2*t*t+t)*span*(B[k]-P[k])/(B[0]-P[0])+(-2*t**3+3*t*t)*B[k]+(t**3-t*t)*span*(N[k]-A[k])/(N[0]-A[0]));
    }
    return a.at(-1).slice(1);
  };
  const edge=z=>section(z)[1]-.045;
  const side=(z,y)=>{const [w]=section(z),t=clamp((y-.18)/(edge(z)-.18));return w-.075*(1-t)**3-.014*t**6+.012*Math.sin(t*Math.PI);};
  const deck=(x,z)=>{
    const [w,h]=section(z),q=x/(w-.014),roll=clamp((Math.abs(q)-.80)/.20);
    // Crown the bonnet, then roll the last 18 cm into the wing rather than a slab edge.
    return h+.023*(1-q*q)-.045*(1-Math.sqrt(1-roll*roll));
  };
  car.playerSurface={top:edge,side,deck};
  const endPanel=(material,x0,x1,y0,y1,z,name)=>surface(p,material,(u,v)=>[mix(Math.min(x0,x1),Math.max(x0,x1),u),mix(y0,y1,v),z],32,2,name);
  const intakeBounds=z=>{const t=clamp((z+.72)/1.52);return [.305+.035*(1-t)**4+.02*t**8,.645-.018*(1-t)**4-.01*t**8];};
  const amber=new THREE.MeshStandardMaterial({color:'#e49632',roughness:.25,side:THREE.DoubleSide});

  for(const s of [-1,1]){
    const arch=d.r+.037;
    const floor=z=>{let y=.18;for(const a of [-d.wb/2,d.wb/2])if(Math.abs(z-a)<arch)y=Math.max(y,d.r+Math.sqrt(arch*arch-(z-a)**2));return y;};
    // Leave a real opening behind the strakes between the wheel arches.
    for(const lower of [false,true])surface(p,M.paint,(u,v)=>{
      const z=mix(F,R,u),b=floor(z),cut=z>-.72&&z<.80,[bottom,top]=intakeBounds(z);
      const y=lower?mix(b,cut?Math.max(b,bottom):b,v):mix(cut?Math.max(b,top):b,edge(z),v);
      return[s*side(z,y),y,z];
    },low?100:200,8,lower?'348-lower-flank':'body-side');
    for(const a of [-d.wb/2,d.wb/2]){
      const pts=[];for(let j=0;j<=36;j++){const t=j*Math.PI/36,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);pts.push([s*(side(z,y)+.002),y,z]);}
      line(p,M.paint,pts,.008,'348-wheelarch-lip');
      surface(p,M.black,(u,v)=>{const t=u*Math.PI,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);return[s*mix(d.track/2-.13,side(z,y),v),y,z];},28,2,'wheelarch-liner');
    }
    surface(p,M.black,(u,v)=>{const z=mix(-.72,.80,u),[bottom,top]=intakeBounds(z),y=mix(bottom,top,v);return[s*(side(z,y)-mix(.035,.11,u)),y,z];},32,5,'348-side-intake');
    for(let j=0;j<5;j++){
      const f=j/4,start=-.72+.025*(1-f)**2,end=.80-.030*(1-f)**2;
      const blade=(u,v,upper)=>{
        const z=mix(start,end,u),y=.333+j*.070+.006*u;
        return[s*(side(z,y)+.004-(upper?v*mix(.035,.10,u):0)),y+(upper?.020:v*.020),z];
      };
      surface(p,M.paint,(u,v)=>blade(u,v,false),28,2,'348-side-strake');
      surface(p,M.paint,(u,v)=>blade(u,v,true),28,2,'348-strake-depth');
    }
    // Period tb black lower body wraps around the wheel openings into both valances.
    for(const [a,b]of [[F,-.84],[.84,R]])surface(p,M.black,(u,v)=>{
      const z=mix(a,b,u),bottom=floor(z),y=mix(bottom,Math.max(bottom,.285),v);
      return[s*(side(z,y)+.005),y,z];
    },32,2,'348-black-lower-quarter');
    line(p,M.seam,[[s*side(-.85,.79),.79,-.85],[s*side(-.77,.3),.3,-.77],[s*side(.47,.3),.3,.47],[s*side(.62,.79),.79,.62]],.0025,'door-seam');
    box(p,M.black,[.022,.025,.13],[s*(side(.43,.765)+.008),.765,.43],.004,[0,0,0],'door-handle');
    box(p,M.black,[.065,.105,1.70],[s*.88,.22,0],.009,[0,0,0],'348-black-sill');
    surface(p,M.paint,(u,v)=>{const z=mix(d.cowl,.73,u),h=edge(z);return[s*mix(side(z,h),.79,v),mix(h,.805,v),z];},36,3,'door-shoulder');
  }
  for(const [a,b,name] of [[F,d.cowl,'bonnet'],[d.back,R,'boot']])surface(p,M.paint,(u,v)=>{
    const z=mix(a,b,u),x=(2*v-1)*side(z,edge(z));return[x,deck(x,z),z];
  },40,22,name);
  for(const z of [F,R])surface(p,M.paint,(u,v)=>{const y=mix(.20,edge(z),v),x=(2*u-1)*side(z,y);return[x,y+(deck(x,z)-edge(z))*v**6,z];},28,8,z<0?'front-bumper':'rear-bumper');
  box(p,M.black,[1.56,.06,3.85],[0,.18,0],.012,[0,0,0],'undertray');

  // Short closed berlinetta cabin; vertical recessed rear window between two sail panels.
  const roofY=(u,x)=>1.145+.025*Math.sin(u*Math.PI)-.025*x*x;
  car.windscreen=surface(p,M.glass,(u,v)=>{const x=2*u-1;return[x*mix(.79,.685,v),mix(.805,roofY(0,x),v)+.012*(1-x*x)*Math.sin(v*Math.PI),mix(d.cowl,d.header,v)-(.025+.018*Math.sin(v*Math.PI))*(1-x*x)];},24,10,'windscreen');
  if(!d.open){
  surface(p,M.paint,(u,v)=>{const x=2*v-1;return[x*.685,roofY(u,x),mix(d.header-.025*(1-x*x),d.roofBack,u)];},26,18,'roof');
  }
  if(!d.spider){
  surface(p,M.paint,(u,v)=>{const x=2*u-1;return[x*mix(.685,.635,v),mix(roofY(1,x),1.11,v),mix(d.roofBack,.515,v)];},22,2,'348-rear-window-header');
  surface(p,M.glass,(u,v)=>[(2*u-1)*.635,mix(1.11,.83,v),mix(.515,.73,v)],22,12,'rear-glass');
  }
  box(p,M.black,[1.32,.08,.06],[0,.81,.70],.008,[0,0,0],'348-rear-bulkhead');
  for(const s of [-1,1]){
    const A=[s*.79,.805,d.cowl],B=[s*.685,1.12,d.header],C=[s*.685,1.12,.48],D=[s*.79,.805,.62];
    if(!d.spider){
    patch(p,M.glass,[A,B,C,D],'front-door-glass');line(p,M.black,[A,B,C,D,A],.009,'348-window-seal');
    line(p,M.paint,[A,B],.023,'solid-a-pillar');if(!d.open)line(p,M.paint,[B,C],.019,'solid-roof-rail');
    patch(p,M.black,[[s*.79,.805,.30],[s*.685,1.12,.30],[s*.685,1.12,.325],[s*.79,.805,.325]],'348-window-divider');
    surface(p,M.paint,(u,v)=>{
      const top=[mix(.685,.855,u),mix(1.12,.823,u)+.012*Math.sin(u*Math.PI),mix(.48,1.44,u)];
      const bottom=[mix(.79,.855,u),mix(.805,.823,u),mix(.62,1.44,u)];
      return[s*(mix(top[0],bottom[0],v)+.008*Math.sin(u*Math.PI)*Math.sin(v*Math.PI)),mix(top[1],bottom[1],v),mix(top[2],bottom[2],v)];
    },24,6,'348-flying-buttress');
    patch(p,M.paint,[[s*.685,1.12,.48],[s*.635,1.11,.515],[s*.66,.83,1.40],[s*.855,.823,1.44]],'348-buttress-inner');
    }else{line(p,M.paint,[A,B],.023,'solid-a-pillar');if(s<0)box(p,M.cloth,[1.45,.08,.35],[0,.83,.79],.02,[0,0,0],'folded-roof-cover');}
    box(p,M.black,[.12,.025,.06],[s*.93,.825,-.72],.008,[0,0,0],'mirror-stalk');
    const mirrorShell=new RoundedBoxGeometry(.23,.105,.14,2,.022);
    const mp=mirrorShell.attributes.position;for(let i=0;i<mp.count;i++)mp.setY(i,mp.getY(i)-mp.getZ(i)*.10);mirrorShell.computeVertexNormals();
    mesh(p,mirrorShell,M.paint,[s*1.025,.86,-.72],[0,0,0],'mirror-housing');
    box(p,M.black,[.204,.084,.009],[s*1.025,.86,-.646],.01);
    car[s<0?'mirrorL':'mirrorR']=mesh(p,new THREE.PlaneGeometry(.185,.069),M.chrome,[s*1.025,.86,-.639],[0,0,0]);
    box(p,M.black,[.035,.23,1.27],[s*.77,.665,-.08],.015,[0,0,0],'interior-door-liner');
    line(p,M.black,[[s*.07,.824,d.cowl],[s*.48,.817,d.cowl-.02]],.006,'348-wiper');
  }
  cabinFittings(car,d,M,low);wheels(car,d,M,low);
  // Exterior view of the exposed aluminium dogleg gate (the driving cockpit matches it).
  box(p,M.chrome,[.12,.008,.13],[0,.59,-.10],.003,[0,0,0],'348-open-shift-gate');
  for(const x of [-.035,0,.035])box(p,M.black,[.008,.002,.10],[x,.595,-.10],.001);
  box(p,M.black,[.08,.002,.008],[0,.596,-.10],.001);
  box(p,M.chrome,[.01,.12,.01],[0,.655,-.10],.002);
  mesh(p,new THREE.SphereGeometry(.025,12,8),M.black,[0,.724,-.10],[0,0,0],'348-shift-knob');

  // Daylight position: the two painted lids sit flush on the crowned bonnet.
  // Keep the rectangular shut lines; no permanent boxes above the bodywork.
  for(const s of [-1,1]){
    const hp=(x,z)=>[s*x,deck(s*x,z)+.003,z],outline=[];
    for(const [A,B]of [[[.43,-1.91],[.75,-1.91]],[[.75,-1.91],[.75,-1.55]],[[.75,-1.55],[.43,-1.55]],[[.43,-1.55],[.43,-1.91]]])
      for(let j=0;j<8;j++)outline.push(hp(mix(A[0],B[0],j/8),mix(A[1],B[1],j/8)));
    outline.push(outline[0]);
    const shut=line(p,M.seam,outline,.0018);shut.name='348-popup-lid';shut.userData.damagePart='bonnet';
    // Bumper fog lamps and amber parking/indicator blocks are separate from the pop-ups.
    box(p,M.black,[.39,.10,.014],[s*.61,.395,F-.012],.012,[0,0,0],'348-bumper-lamp-recess');
    box(p,M.head,[.25,.075,.017],[s*.56,.395,F-.024],.008,[0,0,0],'348-fog-lamp');
    box(p,amber,[.105,.075,.019],[s*.747,.395,F-.025],.004,[0,0,0],'348-amber-lens');
    endPanel(M.tail,s*.25,s*.76,.618,.770,R+.024,'rear-lamp-housing');
    endPanel(amber,s*.62,s*.76,.624,.666,R+.027,'348-rear-indicator');
  }
  box(p,M.black,[.76,.090,.018],[0,.395,F-.016],.008,[0,0,0],'348-front-grille');
  for(let j=-4;j<=4;j++)box(p,M.darkAlloy,[.006,.075,.009],[j*.073,.395,F-.028],.001);
  endPanel(M.black,-.80,.80,.20,.277,F-.014,'348-front-grille-lip');
  const silverHorse=M.badge;
  mesh(p,new THREE.PlaneGeometry(.034,.046),silverHorse,[0,.403,F-.038],[0,Math.PI,0],'348-front-grille-horse');
  mesh(p,new THREE.PlaneGeometry(.043,.058),silverHorse,[0,.705,R+.043],[0,0,0],'348-tail-grille-horse');
  // Closely sampled strips follow the rounded tail instead of vanishing into its centre.
  // The dark backing is inset behind the rectangular coloured lenses.
  endPanel(M.black,-.805,.805,.605,.790,R+.009,'348-tail-grille-backing');
  for(let j=0;j<6;j++){
    const y=.611+j*.033;
    endPanel(M.black,-.795,.795,y,y+.013,R+.036,'348-tail-grille-louvre');
    surface(p,M.darkAlloy,(u,v)=>[mix(-.795,.795,u),y+.013,mix(R+.019,R+.036,v)],32,1,'348-tail-louvre-top');
  }
  mesh(p,new THREE.PlaneGeometry(.12,.042),textMaterial(car.spec.short,null,'#b9bdc0'),[.58,.845,R+.017],[0,0,0],'348-rear-script');
  mesh(p,new THREE.PlaneGeometry(.19,.034),textMaterial('Ferrari',null,'#b9bdc0'),[0,.833,1.58],[-Math.PI/2,0,0],'348-deck-script');
  for(let j=0;j<18;j++){
    const z=.86+j*.047;
    surface(p,M.black,(u,v)=>{const x=mix(-.56,.56,u),zz=z+v*.017;return[x,deck(x,zz)+.004,zz];},20,1,'348-engine-cover-louvre');
  }
  // Bonnet perimeter follows the lid/wing crown and rounds off ahead of the headlamps.
  for(const side of [-1,1]){
    const pts=[];for(let j=0;j<=24;j++){const t=j/24,z=mix(d.cowl-.035,F+.075,t),x=side*(.70+.085*Math.sin(t*Math.PI/2));pts.push([x,deck(x,z)+.003,z]);}
    line(p,M.seam,pts,.0017).userData.damagePart='bonnet';
  }
  const noseJoint=[];for(let j=0;j<=32;j++){const x=mix(-.785,.785,j/32),z=F+.075-.025*(1-(x/.785)**2);noseJoint.push([x,deck(x,z)+.003,z]);}
  line(p,M.seam,noseJoint,.0017).userData.damagePart='bonnet';
  endPanel(M.black,-.83,.83,.195,.325,R+.018,'348-rear-grille-valance');
  car.exhaust=[];
  for(const s of [-1,1])for(const dx of [-.055,.055]){
    const x=s*.60+dx,z=R+.025;
    mesh(p,new THREE.CylinderGeometry(.035,.035,.15,14,1,true),M.chrome,[x,.25,z],[Math.PI/2,0,0],'exhaust');
    disk(p,M.black,.029,[x,.25,z+.076]);car.exhaust.push(new THREE.Vector3(x,.25,z+.076));
  }
  M.plate=makePlateMaterial(plate);car.plate=plate;
  for(const s of [-1,1]){
    const z=s<0?F-.03:R+.05,y=s<0?.335:.465;
    box(p,M.black,[.545,.125,.018],[0,y,z],.004,[0,0,0],'plate-carrier');
    mesh(p,new THREE.PlaneGeometry(.52,.112,12,2),M.plate,[0,y,z+s*.011],[0,s<0?Math.PI:0,0],'registration');
  }

  // Pull the bumper corners back in plan and roll the lower valances under.
  // Apply the same deformation to trim, lenses and plates so none float off the skin.
  const roundEnd=point=>{
    const t=clamp((Math.abs(point.z)-d.L*.34)/(d.L*.16));
    point.z-=Math.sign(point.z)*t*t*(.16*(Math.abs(point.x)/(d.W/2))**2+.075*clamp((.40-point.y)/.22)**2);
    return point;
  };
  for(const outlet of car.exhaust)roundEnd(outlet);
  p.updateMatrixWorld(true);const point=new THREE.Vector3();
  p.traverse(o=>{if(!o.isMesh||o===car.mirrorL||o===car.mirrorR)return;
    const a=o.geometry.attributes.position,inv=o.matrixWorld.clone().invert();
    for(let i=0;i<a.count;i++){
      roundEnd(point.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld));
      point.applyMatrix4(inv);a.setXYZ(i,point.x,point.y,point.z);
    }
    a.needsUpdate=true;o.geometry.computeVertexNormals();o.geometry.computeBoundingSphere();
  });
}
