// Ferrari 348 tb: original procedural geometry, metres, nose -Z.
// Dimensions/design references: https://www.ferrari.com/en-EN/auto/348-tb
// Tyres: https://www.michelinman.com/auto/manufacturers/ferrari/348-tb
// See tools/models-more-notes.md for estimates and period colour caveats.
import * as THREE from 'three';
import { canvasTex } from './util.js';

export const F348_MODEL = {
  L:4.230,W:1.894,H:1.170,wb:2.450,track:1.540,r:.331,rim:.2159,tyreF:.215,tyreR:.255,
  belt:.79,front:.50,rear:.80,cowl:-.96,header:-.39,roofBack:.49,back:.73,
  seatZ:.04,eyeY:.91,seatBase:.32,seats:2,doors:2,leather:'#b38858',brand:'FERRARI',
  stations:[[-2.115,.79,.50],[-1.90,.88,.56],[-1.45,.925,.70],[-.96,.927,.79],[-.35,.90,.79],[.45,.929,.80],[1.225,.947,.825],[1.77,.92,.81],[2.115,.85,.80]],
};
const mix=(a,b,t)=>a+(b-a)*t;

export function buildF348(car,d,M,low,plate,H){
  const {surface,box,line,patch,mesh,disk,cabinFittings,wheels,makePlateMaterial,textMaterial}=H;
  const p=car.body,F=-d.L/2,R=d.L/2;
  M.head.color.set('#c4ccd0');M.head.metalness=.25; // Clear rectangular lenses remain visible with lights off.
  const section=z=>{
    const a=d.stations;
    for(let i=1;i<a.length;i++)if(z<=a[i][0]){
      const t=Math.max(0,(z-a[i-1][0])/(a[i][0]-a[i-1][0]));
      return [mix(a[i-1][1],a[i][1],t),mix(a[i-1][2],a[i][2],t)];
    }
    return a.at(-1).slice(1);
  };
  const side=(z,y)=>{const [w,h]=section(z),t=Math.max(0,Math.min(1,(y-.18)/(h-.18)));return w-.065*(1-t)-.022*t**8;};
  const deck=(x,z)=>{const [w,h]=section(z);return h+.012*(1-(x/w)**2);};
  car.playerSurface={top:z=>section(z)[1],side,deck};
  const amber=new THREE.MeshStandardMaterial({color:'#e49632',roughness:.25,side:THREE.DoubleSide});
  // Original tiny rearing-horse silhouette, rather than a chess-piece glyph.
  const horse=new THREE.MeshStandardMaterial({map:canvasTex(128,160,c=>{
    c.fillStyle='#f0cd2c';c.fillRect(0,0,128,160);c.strokeStyle='#17191b';c.lineWidth=5;c.strokeRect(3,3,122,154);
    c.fillStyle='#17191b';const path=new Path2D('M 47 117 L 58 91 C 40 81 43 62 59 55 L 70 32 L 66 20 L 76 25 L 88 23 L 92 34 L 84 43 L 75 42 L 72 65 L 91 54 L 105 61 L 103 70 L 88 66 L 76 80 L 73 92 L 89 105 L 85 126 L 76 131 L 78 111 L 63 103 L 55 126 L 40 135 L 32 133 Z');c.fill(path);
    c.lineWidth=6;c.beginPath();c.moveTo(48,81);c.bezierCurveTo(24,66,39,46,24,42);c.bezierCurveTo(44,42,31,65,52,65);c.stroke();
  }),roughness:.4});
  M.badge.map=horse.map;M.badge.color.set('#ffffff');M.badge.needsUpdate=true;

  for(const s of [-1,1]){
    const arch=d.r+.037;
    const floor=z=>{let y=.18;for(const a of [-d.wb/2,d.wb/2])if(Math.abs(z-a)<arch)y=Math.max(y,d.r+Math.sqrt(arch*arch-(z-a)**2));return y;};
    // Leave a real opening behind the strakes between the wheel arches.
    for(const lower of [false,true])surface(p,M.paint,(u,v)=>{
      const z=mix(F,R,u),b=floor(z),cut=z>-.64&&z<.82;
      const y=lower?mix(b,cut?Math.max(b,.39):b,v):mix(cut?Math.max(b,.735):b,section(z)[1],v);
      return[s*side(z,y),y,z];
    },low?100:200,8,lower?'348-lower-flank':'body-side');
    for(const a of [-d.wb/2,d.wb/2]){
      const pts=[];for(let j=0;j<=36;j++){const t=j*Math.PI/36,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);pts.push([s*(side(z,y)+.002),y,z]);}
      line(p,M.paint,pts,.008,'348-wheelarch-lip');
      surface(p,M.black,(u,v)=>{const t=u*Math.PI,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);return[s*mix(d.track/2-.13,side(z,y),v),y,z];},28,2,'wheelarch-liner');
    }
    surface(p,M.black,(u,v)=>{const z=mix(-.64,.82,u),y=mix(.39,.735,v);return[s*(side(z,y)-.065),y,z];},32,4,'348-side-intake');
    for(let j=0;j<6;j++){
      const y=.415+j*.058;
      surface(p,M.paint,(u,v)=>{const z=mix(-.64,.82,u);return[s*(side(z,y)+.006),y+v*.021,z];},28,2,'348-side-strake');
      surface(p,M.paint,(u,v)=>{const z=mix(-.64,.82,u);return[s*(side(z,y)+.006-v*.06),y+.021,z];},28,2,'348-strake-depth');
    }
    line(p,M.seam,[[s*side(-.85,.79),.79,-.85],[s*side(-.77,.3),.3,-.77],[s*side(.47,.3),.3,.47],[s*side(.62,.79),.79,.62]],.0025,'door-seam');
    box(p,M.black,[.022,.025,.13],[s*(side(.43,.765)+.008),.765,.43],.004,[0,0,0],'door-handle');
    box(p,M.black,[.065,.105,1.70],[s*.88,.22,0],.009,[0,0,0],'348-black-sill');
    surface(p,M.paint,(u,v)=>{const z=mix(d.cowl,.73,u),h=section(z)[1];return[s*mix(side(z,h),.79,v),mix(h,.805,v),z];},36,3,'door-shoulder');
  }
  for(const [a,b,name] of [[F,d.cowl,'bonnet'],[d.back,R,'boot']])surface(p,M.paint,(u,v)=>{
    const z=mix(a,b,u),x=(2*v-1)*side(z,section(z)[1]);return[x,deck(x,z),z];
  },40,22,name);
  for(const z of [F,R])surface(p,M.paint,(u,v)=>{const x=(2*u-1)*side(z,.6);return[x,mix(.22,deck(x,z),v),z];},28,8,z<0?'front-bumper':'rear-bumper');
  box(p,M.black,[1.56,.06,3.85],[0,.18,0],.012,[0,0,0],'undertray');

  // Short closed berlinetta cabin; vertical recessed rear window between two sail panels.
  const roofY=(u,x)=>1.145+.025*Math.sin(u*Math.PI)-.025*x*x;
  car.windscreen=surface(p,M.glass,(u,v)=>{const x=2*u-1;return[x*mix(.79,.685,v),mix(.805,roofY(0,x),v),mix(d.cowl,d.header,v)-.025*(1-x*x)];},24,10,'windscreen');
  surface(p,M.paint,(u,v)=>{const x=2*v-1;return[x*.685,roofY(u,x),mix(d.header-.025*(1-x*x),d.roofBack,u)];},26,18,'roof');
  surface(p,M.black,(u,v)=>{const x=2*v-1;return[x*.68,roofY(u,x)-.02,mix(d.header-.025*(1-x*x),d.roofBack,u)];},18,12,'348-headliner');
  surface(p,M.paint,(u,v)=>{const x=2*u-1;return[x*mix(.685,.635,v),mix(roofY(1,x),1.11,v),mix(d.roofBack,.515,v)];},22,2,'348-rear-window-header');
  surface(p,M.glass,(u,v)=>[(2*u-1)*.635,mix(1.11,.83,v),mix(.515,.73,v)],22,12,'rear-glass');
  box(p,M.black,[1.32,.08,.06],[0,.81,.70],.008,[0,0,0],'348-rear-bulkhead');
  for(const s of [-1,1]){
    const A=[s*.79,.805,d.cowl],B=[s*.685,1.12,d.header],C=[s*.685,1.12,.48],D=[s*.79,.805,.62];
    patch(p,M.glass,[A,B,C,D],'front-door-glass');line(p,M.black,[A,B,C,D,A],.009,'348-window-seal');
    line(p,M.paint,[A,B],.023,'solid-a-pillar');line(p,M.paint,[B,C],.019,'solid-roof-rail');
    patch(p,M.black,[[s*.79,.805,.30],[s*.685,1.12,.30],[s*.685,1.12,.325],[s*.79,.805,.325]],'348-window-divider');
    patch(p,M.paint,[[s*.685,1.12,.48],[s*.79,.805,.62],[s*.855,.823,1.44],[s*.74,.93,.95]],'348-flying-buttress');
    patch(p,M.paint,[[s*.685,1.12,.48],[s*.635,1.11,.515],[s*.66,.83,1.40],[s*.855,.823,1.44]],'348-buttress-inner');
    box(p,M.black,[.12,.025,.06],[s*.93,.825,-.72],.008,[0,0,0],'mirror-stalk');
    box(p,M.paint,[.23,.105,.14],[s*1.025,.86,-.72],.025,[0,0,0],'mirror-housing');
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

  // Retracted lids remain visible below the raised pop-up headlamp pods.
  for(const s of [-1,1]){
    const hp=(x,z)=>[s*x,deck(s*x,z)+.007,z];
    line(p,M.seam,[hp(.44,-1.86),hp(.75,-1.86),hp(.75,-1.50),hp(.44,-1.50),hp(.44,-1.86)],.0025,'348-popup-lid');
    const pod=new THREE.Group();pod.name='front-lamp-housing';p.add(pod);
    box(pod,M.paint,[.32,.145,.27],[s*.60,.69,-1.66],.009,[0,0,0],'348-popup-pod');
    box(pod,M.black,[.294,.12,.012],[s*.60,.686,-1.803],.004);
    for(const dx of [-.072,.072]){
      box(pod,M.head,[.124,.082,.01],[s*.60+dx,.69,-1.812],.006);
      line(pod,M.chrome,[[s*.60+dx-.058,.728,-1.819],[s*.60+dx+.058,.728,-1.819]],.0025);
    }
    // Bumper fog lamps and amber parking/indicator blocks are separate from the pop-ups.
    box(p,M.head,[.23,.075,.012],[s*.58,.445,F-.012],.006,[0,0,0],'348-fog-lamp');
    box(p,amber,[.105,.075,.014],[s*.75,.445,F-.012],.004,[0,0,0],'348-amber-lens');
    box(p,M.tail,[.48,.16,.018],[s*.50,.70,R+.012],.006,[0,0,0],'rear-lamp-housing');
  }
  box(p,M.black,[.75,.115,.018],[0,.34,F-.012],.008,[0,0,0],'348-front-grille');
  for(let j=-4;j<=4;j++)box(p,M.darkAlloy,[.006,.095,.009],[j*.073,.34,F-.025],.001);
  box(p,M.black,[1.65,.065,.065],[0,.235,F+.018],.009,[0,0,0],'348-black-front-lip');
  mesh(p,new THREE.PlaneGeometry(.044,.058),horse,[0,.531,F+.095],[-Math.PI/2,0,0],'348-prancing-horse-badge');
  // Signature black horizontal tail grille spans both rectangular lenses.
  for(let j=0;j<6;j++)box(p,M.black,[1.58,.018,.026],[0,.62+j*.033,R+.03],.003,[0,0,0],'348-tail-louvre');
  for(const x of [-.81,.81])box(p,M.black,[.028,.19,.03],[x,.706,R+.026],.003);
  mesh(p,new THREE.PlaneGeometry(.12,.042),textMaterial('348 tb',null,'#b9bdc0'),[.58,.845,R+.017],[0,0,0],'348-rear-script');
  mesh(p,new THREE.PlaneGeometry(.19,.034),textMaterial('Ferrari',null,'#b9bdc0'),[0,.833,1.58],[-Math.PI/2,0,0],'348-deck-script');
  for(let j=0;j<11;j++){
    const z=.86+j*.077;
    box(p,M.black,[1.12,.008,.039],[0,deck(0,z)+.006,z],.002,[0,0,0],'348-engine-cover-louvre');
  }
  box(p,M.black,[1.64,.13,.045],[0,.285,R+.005],.007,[0,0,0],'348-black-rear-valance');
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
}
