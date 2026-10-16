// Player-only F57 / G29 / Octavia IV coachwork. Metres, nose -Z.
// Separate body fields keep every arch, panel seam and shoulder on the same surface.
import * as THREE from './vehicle-primitives.js';
import { tintGlass } from './glass-tint.js';
import { RoundedBoxGeometry } from './vehicle-primitives.js';
const mix=(a,b,t)=>a+(b-a)*t;
const clamp=t=>Math.max(0,Math.min(1,t));
const V=p=>new THREE.Vector3(...p);
function profile(points,z){for(let i=1;i<points.length;i++)if(z<=points[i][0]){const a=points[i-1],b=points[i],t=clamp((z-a[0])/(b[0]-a[0]));return mix(a[1],b[1],t*t*(3-2*t));}return points.at(-1)[1];}
function mesh(p,g,m,name){const o=new THREE.Mesh(g,m);o.name=name;p.add(o);return o;}
function surface(p,m,fn,nu,nv,name){
  nu=Math.min(nu, /body-side|painted-side/.test(name||" ")?24:4); nv=Math.min(nv,/body-side|painted-side/.test(name||" ")?2:1);const pos=[],uv=[],idx=[];for(let i=0;i<=nu;i++)for(let j=0;j<=nv;j++){pos.push(...fn(i/nu,j/nv));uv.push(i/nu,j/nv);}for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const k=i*(nv+1)+j;idx.push(k,k+nv+1,k+1,k+1,k+nv+1,k+nv+2);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.userData.vehicleGrid={nu,nv};g.computeVertexNormals();return mesh(p,g,m,name);}
function line(p,m,pts,r=.003,name='panel-gap'){return mesh(p,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(V)),name==='grille-mesh'?6:Math.min(48,Math.max(12,pts.length)),r,name==='grille-mesh'?3:4,false),m,name);}
function box(p,m,size,pos,r=.02,name=''){const o=mesh(p,new RoundedBoxGeometry(...size,1,Math.min(r,...size.map(x=>x/2))),m,name);o.position.set(...pos);return o;}
function patch(p,m,pts,name){return surface(p,m,(u,v)=>V(pts[0]).lerp(V(pts[1]),u).lerp(V(pts[3]).lerp(V(pts[2]),u),v).toArray(),8,5,name);}
function fields(kind,d){
  const F=-d.L/2,R=d.L/2,W=d.W/2;
  const shoulder=kind==='mini'?[[F,.85],[-1.67,.90],[-1.24,.975],[d.cowl,.96],[.5,.96],[1.24,.965],[R,.89]]:kind==='z4'?[[F,.65],[-1.78,.755],[-1.22,.835],[d.cowl,.87],[.4,.90],[1.08,.964],[1.36,.962],[1.75,.903],[R-.14,.885],[R-.055,.897],[R,.910]]:[[F,.77],[-1.72,.87],[d.cowl,.98],[.4,.994],[1.30,1.025],[1.86,1.005],[R,.97]];
  const width=kind==='mini'?[[F,W*.905],[-1.55,W*.987],[-1.1,W],[d.cowl,W*.97],[.5,W*.976],[1.27,W],[R,W*.906]]:kind==='z4'?[[F,W*.905],[-1.63,W*.967],[-1.22,W*.99],[-.6,W*.952],[.18,W*.94],[.85,W*.99],[1.26,W],[1.60,W*.975],[1.90,W*.927],[R,W*.865]]:[[F,W*.905],[-1.7,W*.968],[-1.28,W*.987],[-.45,W*.987],[.6,W*.996],[1.35,W],[1.94,W*.965],[R,W*.905]];
  const top=z=>profile(shoulder,z);
  const side=(z,y)=>{const t=clamp((y-.18)/(top(z)-.18)),waist=kind==='z4'?.036:kind==='mini'?.007:.012;const haunch=kind==='z4'?clamp((z-.55)/.55):0;return profile(width,z)-(.054+.080*haunch)*(1-t)**(kind==='z4'?4:5)-(.024+.065*haunch)*t**(kind==='z4'?5:6)-waist*Math.sin(Math.PI*t)**2+.008*Math.exp(-(((t-.83)/.055)**2));};
  const deck=(x,z)=>{const q=x/side(z,top(z));let y=top(z)+(kind==='z4'&&z>=d.back-.05?-.042*Math.sin(Math.PI*clamp((z-d.back)/(R-.12-d.back))):.036)*(1-q*q);if(z<d.cowl){const k=Math.sin(Math.PI*clamp((z-F)/(d.cowl-F)));if(kind==='mini')y+=.037*Math.exp(-(((Math.abs(q)-.73)/.23)**2))*k;if(kind==='z4')y+=.038*Math.exp(-(((Math.abs(q)-.69)/.19)**2))*k-.017*(1-q*q)*k;}
    return y;};
  return {top,side,deck};
}
export function buildOriginalPlayerSkin(car,d,M,low=false){
  const kind=car.modelKind;if(!['mini','z4','octavia'].includes(kind))return false;
  const p=car.body,F=-d.L/2,R=d.L/2,W=d.W/2,{top,side,deck}=fields(kind,d),arch=d.r+(kind==='mini'?.046:.054);
  car.playerSurface={top,side,deck};
  for(const s of [-1,1]){
    // The dense longitudinal sampling resolves the arch edge without faking a black disc.
    surface(p,M.paint,(u,v)=>{const z=mix(F,R,u);let y0=.18;for(const a of [-d.wb/2,d.wb/2])if(Math.abs(z-a)<arch)y0=Math.max(y0,d.r+Math.sqrt(arch*arch-(z-a)**2));const y=mix(y0,top(z),v);return[s*side(z,y),y,z];},low?72:128,10,'body-side');
    for(const axle of [-d.wb/2,d.wb/2]){
      const pts=[];for(let i=0;i<=48;i++){const a=i*Math.PI/48,z=axle+Math.cos(a)*arch,y=d.r+Math.sin(a)*arch;pts.push([s*(side(z,y)+.004),y,z]);}
      line(p,kind==='mini'?M.black:M.paint,pts,kind==='mini'?.022:.008,'wheel-arch-lip');
      surface(p,M.black,(u,v)=>{const a=u*Math.PI,z=axle+Math.cos(a)*(arch-.005),y=d.r+Math.sin(a)*(arch-.005);return[s*mix(d.track/2-.12,side(z,y)-.005,v),y,z];},low?16:24,2,'wheel-arch-liner');
      surface(p,M.black,(u,v)=>{const a=u*Math.PI;return[s*(d.track/2-.13),d.r+Math.sin(a)*(arch-.007)*v,axle+Math.cos(a)*(arch-.007)*v];},16,2,'inner-wheel-housing');
    }
    surface(p,M.paint,(u,v)=>{const z=mix(d.cowl,d.back,u),y=mix(top(z),d.belt+.014,v);return[s*mix(side(z,top(z)),W-.115,v),y+.017*Math.sin(v*Math.PI),z];},40,6,'door-shoulder');
    const sill=[];for(let i=0;i<=24;i++){const z=mix(-d.wb/2+.36,d.wb/2-.36,i/24);sill.push([s*(side(z,.24)+.001),.235,z]);}line(p,kind==='mini'?M.black:M.paint,sill,kind==='mini'?.027:.025,'rocker-panel');
    const ends=kind==='octavia'?[.31,1.18]:[kind==='mini'?.57:.70];
    const start=d.cowl+.035;
    const door=(a,b)=>{const pts=[[a,d.belt-.022],[a+.025,.56],[a+.13,.285],[b-.10,.285],[b+.015,.5],[b,Math.min(d.belt,top(b))-.015]].map(([z,y])=>[s*(side(z,y)+.002),y,z]);line(p,M.seam,pts,.0023,'door-shut-line');};
    door(start,ends[0]);if(ends.length>1)door(ends[0]+.006,ends[1]);
    for(const end of ends){const z=end-.14,y=d.belt-.10;box(p,kind==='mini'?M.chrome:M.paint,[.026,.033,.15],[s*(side(z,y)+.006),y,z],.013,'door-handle');box(p,M.seam,[.009,.017,.12],[s*(side(z,y)+.002),y-.010,z],.006,'handle-recess');}
    const belt=[];for(let i=0;i<=30;i++){const z=mix(d.cowl,d.back,i/30);belt.push([s*(W-.114),d.belt+.018,z]);}line(p,kind==='mini'?M.chrome:M.black,belt,.006,'window-belt-seal');
    // A crease is a change in the panel surface, with only a subtle highlight at its ridge.
    if(kind!=='mini'){const ridge=[];for(let i=0;i<=50;i++){const z=mix(-d.wb/2+.40,R-.24,i/50),y=top(z)-.12;ridge.push([s*(side(z,y)+.001),y,z]);}line(p,M.paint,ridge,.002,'shoulder-crease');}
    if(!low){const z=d.wb/2+.08,y=top(z)-.17,pts=[];for(let i=0;i<=32;i++){const a=i/32*Math.PI*2,zz=z+.073*Math.cos(a),yy=y+.073*Math.sin(a);pts.push([s*(side(zz,yy)+.002),yy,zz]);}if((kind==='mini'&&s===1)||(kind!=='mini'&&s===1))line(p,M.seam,pts,.0018,'fuel-flap');}
    if(kind==='z4'){
      const points=[[-.83,.74],[-.70,.72],[-.49,.48],[-.61,.50]];surface(p,M.black,(u,v)=>{const z=mix(mix(points[0][0],points[1][0],u),mix(points[3][0],points[2][0],u),v),y=mix(mix(points[0][1],points[1][1],u),mix(points[3][1],points[2][1],u),v);return[s*(side(z,y)+.003),y,z];},8,6,'front-wing-air-breather');
      line(p,M.darkAlloy,[[-.81,.723],[-.71,.707],[-.51,.497]].map(([z,y])=>[s*(side(z,y)+.012),y,z]),.007,'air-breather-trim');
      const crease=[];for(let i=0;i<=40;i++){const z=mix(-.45,.88,i/40),y=.52+.17*(i/40)**1.4;crease.push([s*(side(z,y)+.002),y,z]);}line(p,M.paint,crease,.005,'lower-door-sculpture');
    }
  }
  for(const [a,b,name]of [[F,d.cowl,'bonnet'],[d.back,R,'boot']])surface(p,M.paint,(u,v)=>{const z=mix(a,b,u),x=(2*v-1)*side(z,top(z));return[x,deck(x,z),z];},low?20:36,18,name);
  for(const z of [F,R])surface(p,M.paint,(u,v)=>{const q=2*u-1,y=mix(.18,top(z),v),x=q*side(z,y);return[x,y+(kind==='z4'&&z>0?.012:.036)*(1-q*q)*v**8,z];},24,10,z<0?'front-bumper':'rear-bumper');
  for(const s of [-1,1]){const pts=[];for(let i=0;i<=32;i++){const z=mix(F+.12,d.cowl-.025,i/32),t=(z-F)/(d.cowl-F),x=s*side(z,top(z))*(kind==='mini'?.86:mix(.48,.74,t));pts.push([x,deck(x,z)+.002,z]);}line(p,M.seam,pts,.0022,'bonnet-shut-line');}
  if(kind==='mini'){
    const stripe=new THREE.MeshStandardMaterial({color:'#eeeae1',metalness:.25,roughness:.3,side:THREE.DoubleSide});
    for(const s of [-1,1])surface(p,stripe,(u,v)=>{const z=mix(F+.11,d.cowl-.065,u),x=s*mix(.19,.33,v);return[x,deck(x,z)+.002,z];},28,2,'bonnet-stripe');
  }
  box(p,M.black,[d.W*.81,.075,d.L*.88],[0,.19,0],.025,'undertray');
  return true;
}
export function refineOriginalPlayer(car,d,M,low=false){
  if(!['mini','z4','octavia'].includes(car.modelKind))return;
  const p=car.body,W=d.W/2,kind=car.modelKind;
  const lensMaterial=new THREE.MeshPhysicalMaterial({color:'#627f99',metalness:.28,roughness:.055,clearcoat:1,clearcoatRoughness:.03});
  const projector=(parent,pos,scale)=>{const q=mesh(parent,new THREE.SphereGeometry(1,12,8),lensMaterial,'headlamp-projector-lens');q.position.set(...pos);q.scale.set(...scale);return q;};
  if(kind==='mini'){
    const F=-d.L/2,R=d.L/2;
    for(const o of [...p.children])if(o.isMesh&&o.position.z<F&&Math.abs(o.position.x)<.02&&o.position.y>.48&&o.position.y<.76&&[M.chrome,M.black,M.darkAlloy].includes(o.material))o.removeFromParent();
    const outline=[[-.40,.06],[-.33,.15],[.33,.15],[.43,.045],[.40,-.135],[.32,-.18],[-.32,-.18],[-.42,-.095]];
    const shape=new THREE.Shape();shape.moveTo(...outline[0]);for(let i=1;i<=outline.length;i++){const a=outline[i%outline.length],b=outline[(i+1)%outline.length];shape.quadraticCurveTo(a[0],a[1],mix(a[0],b[0],.17),mix(a[1],b[1],.17));}shape.closePath();
    const grille=mesh(p,new THREE.ExtrudeGeometry(shape,{depth:.014,bevelEnabled:true,bevelSegments:1,curveSegments:6,steps:1,bevelSize:.007,bevelThickness:.006}),M.black,'mini-hex-grille');grille.position.set(0,.595,F-.038);grille.rotation.y=Math.PI;
    const rim=shape.getPoints(56).map(v=>[v.x,v.y+.595,F-.061]);line(p,M.chrome,rim,.009,'mini-grille-surround');
    if(!low)for(let row=0;row<3;row++)for(let col=0;col<8;col++){const x=-.33+col*.094+(row%2)*.0235,y=.51+row*.078;if(Math.abs(x)>.36)continue;const pts=[];for(let i=0;i<=6;i++){const a=i*Math.PI/3;pts.push([x+Math.cos(a)*.040,y+Math.sin(a)*.032,F-.063]);}line(p,M.darkAlloy,pts,.0014,'grille-mesh');}
    for(const o of p.children)if(o.isMesh){if(o.name==='registration'&&o.position.z<0)o.position.z=F-.087;if(o.material===M.black&&Math.abs(o.position.x)<.01&&Math.abs(o.position.y-.40)<.01&&o.position.z<F)o.position.z=F-.068;if((o.name==='registration'||o.material===M.black)&&Math.abs(o.position.x)<.01&&Math.abs(o.position.y-.50)<.01&&o.position.z>R)o.position.y=.62;}
    line(p,M.seam,[[-.49,.855,R+.002],[-.49,.60,R+.002],[-.43,.52,R+.002],[.43,.52,R+.002],[.49,.60,R+.002],[.49,.855,R+.002]],.0025,'boot-shut-line');
    // Convex red lens and chrome surround replace the flat, square rear light boxes.
    for(const o of [...p.children])if(o.isMesh&&[M.chrome,M.red].includes(o.material)&&Math.abs(Math.abs(o.position.x)-.64)<.01&&Math.abs(o.position.y-.77)<.01&&o.position.z>R-.025)o.removeFromParent();
    for(const sign of [-1,1]){const lens=mesh(p,new THREE.SphereGeometry(1,16,10),M.red,'mini-tail-lens');lens.position.set(sign*.64,.77,R+.007);lens.scale.set(.094,.145,.025);const pts=[];for(let i=0;i<=64;i++){const a=i/64*Math.PI*2;const x=Math.sign(Math.cos(a))*Math.abs(Math.cos(a))**.62*.101,y=Math.sign(Math.sin(a))*Math.abs(Math.sin(a))**.62*.153;pts.push([sign*.64+x,.77+y,R+.005]);}line(p,M.chrome,pts,.008,'rear-lamp-housing-chrome');}
    // The F57 has concealed pop-up rollover protection, unlike the exposed G29 hoops.
    for(const o of [...p.children])if(o.isMesh&&o.material===M.alloy&&o.geometry.type==='TubeGeometry'){o.geometry.computeBoundingBox();const b=o.geometry.boundingBox;if(b.min.z>d.back-.2&&b.max.z<d.back+.1&&b.max.y>d.belt+.28)o.removeFromParent();}
    // F57's oval lenses lean into the clamshell wings, above the upper grille.
    for(const o of p.children)if(o.isGroup&&Math.abs(o.position.x)>.5&&o.position.z<-d.L/2&&o.children.some(m=>m.material===M.head)){o.position.y+=.12;o.position.z-=.006;o.rotation.x=.32;o.name='headlamp-housing';for(const child of [...o.children])if(child.geometry?.type==='CircleGeometry'&&child.material===M.chrome&&child.geometry.parameters.radius<.07)child.removeFromParent();projector(o,[0,-.007,-.023],[.048,.048,.022]);for(const sign of [-1,1])line(o,M.chrome,[[sign*.077,-.085,-.008],[sign*.100,-.027,-.009],[sign*.093,.059,-.008]],.005,'headlamp-reflector');}
  }
  if(kind==='z4'){
    // The narrowed G29 waist needs its inner door card inboard of the skin.
    for(const o of p.children)if(o.isMesh&&o.material===M.black&&Math.abs(Math.abs(o.position.x)-(W-.125))<.01&&Math.abs(o.position.y-(d.belt-.20))<.02)o.position.x-=Math.sign(o.position.x)*.065;
    const F=-d.L/2,{side,top,deck}=car.playerSurface;
    const R=d.L/2;
    // G29: low concave boot between rounded haunches, short lip, tapered tail.
    // BMW press rear/side/top: P90340094 / P90340065 / P90340068.
    // https://www.press.bmwgroup.com/united-kingdom/article/detail/T0285137EN_GB/the-all-new-bmw-z4
    for(const o of [...p.children])if(o.isMesh){
      o.geometry.computeBoundingBox();const b=o.geometry.boundingBox.clone().applyMatrix4(o.matrix);
      if([M.red,M.tail].includes(o.material)&&b.min.z>R-.06&&b.max.y>.65)o.removeFromParent();
      if(o.userData.damagePart?.startsWith('light_r')&&/indicator|reverse/.test(o.name))o.position.y+=.10;
      if(o.name==='registration'&&o.position.z>0)o.position.y=.56;
    }
    for(const o of [...p.children])if(o.isMesh&&o.material===M.black&&Math.abs(o.position.x)<.01&&o.position.z>R&&Math.abs(o.position.y-.50)<.01)o.removeFromParent();
    patch(p,M.darkAlloy,[[-.34,.657,R+.010],[.34,.657,R+.010],[.27,.485,R+.010],[-.27,.485,R+.010]],'z4-numberplate-recess');
    // Raise the valance visually and sweep it into the rear corners.
    patch(p,M.black,[[-.75,.43,R+.008],[.75,.43,R+.008],[.66,.23,R+.008],[-.66,.23,R+.008]],'z4-rear-diffuser');
    for(const sign of [-1,1])patch(p,M.black,[[sign*.65,.65,R+.009],[sign*.755,.67,R+.009],[sign*.70,.43,R+.009],[sign*.64,.44,R+.009]],'z4-rear-quarter-vent');
    line(p,M.red,[[-.26,.874,R+.005],[0,.880,R+.012],[.26,.874,R+.005]],.005,'z4-high-brake-strip');
    // M40i outlets are squat trapezoids, tucked into the valance rather than oval tips.
    for(const o of [...p.children])if(o.name==='exhaust-outlet')o.removeFromParent();
    for(const sign of [-1,1]){
      const pts=[[-.080,.036],[.079,.032],[.068,-.034],[-.062,-.034],[-.080,.036]].map(([x,y])=>[sign*.64+x,.29+y,R+.027]);
      line(p,M.darkAlloy,pts,.009,'z4-trapezoid-exhaust');
      line(p,M.chrome,pts.map(([x,y,z])=>[x,y,z+.009]),.004,'z4-exhaust-rim');
      patch(p,M.black,pts.slice(0,4).map(([x,y,z])=>[x,y,z-.009]),'z4-exhaust-cavity');
    }

    const bumperCrease=[];for(let i=0;i<=32;i++){const x=mix(-.81,.81,i/32);bumperCrease.push([x,.455+.06*(Math.abs(x)/.81)**2,R+.009]);}line(p,M.paint,bumperCrease,.003,'z4-rear-bumper-crease');
    const shut=[];for(let i=0;i<=32;i++){const x=mix(-.73,.73,i/32),z=R-.23;shut.push([x,deck(x,z)+.002,z]);}line(p,M.seam,shut,.0025,'boot-trailing-shut-line');
    for(const sign of [-1,1]){
      const z=R+.006,pts=[[.29,.838],[.746,.865],[.756,.813],[.65,.810],[.64,.827],[.31,.819]].map(([x,y])=>[sign*x,y,z]);
      patch(p,M.head,[[sign*.28,.845,z-.001],[sign*.755,.873,z-.001],[sign*.765,.806,z-.001],[sign*.30,.812,z-.001]],'rear-lamp-housing');
      const shape=new THREE.Shape();pts.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
      const lamp=mesh(p,new THREE.ShapeGeometry(shape),M.red,'z4-tail-lens');lamp.position.z=z;
      line(p,M.tail,[[sign*.32,.830,z+.003],[sign*.735,.853,z+.003],[sign*.745,.821,z+.003],[sign*.65,.819,z+.003]],.006,'z4-L-tail-signature');
      surface(p,M.red,(u,v)=>{const zz=mix(R-.39,R,u),y=mix(.826,.854,v)+.040*(1-u);return[sign*(side(zz,y)+.003),y,zz];},18,3,'z4-wraparound-tail-lens');
      const flank=[];for(let i=0;i<=24;i++){const zz=mix(R-.38,R,i/24),y=.848+.040*(1-i/24);flank.push([sign*(side(zz,y)+.005),y,zz]);}line(p,M.tail,flank,.004,'z4-wraparound-tail-guide');
      const seam=[];for(let i=0;i<=24;i++){const zz=mix(d.back+.08,R-.23,i/24),x=sign*.73;seam.push([x,deck(x,zz)+.002,zz]);}line(p,M.seam,seam,.0022,'boot-side-shut-line');
    }

    for(const o of [...p.children])if(o.isMesh&&(o.material===M.head||o.material===M.led)){o.geometry.computeBoundingBox();const b=o.geometry.boundingBox;if(b.max.z+o.position.z<F+.05&&b.max.y+o.position.y>.5)o.removeFromParent();}
    for(const s of [-1,1]){
      const at=(u,v)=>{const z=mix(F+.02,F+.38,v),x=s*mix(mix(.46,.68,v),mix(.78,.82,v),u);return[x,deck(x,z)+.007,z];};
      surface(p,M.head,at,12,8,'z4-headlamp-lens');
      for(const t of [.27,.62]){
        const pts=[[.14,t+.09],[.14,t],[.45,t],[.50,t+.08]].map(([u,v])=>{const q=at(u,v);q[1]+=.008;return q;});line(p,M.led,pts,.005,'z4-projector-light-guide');
      }
      line(p,M.led,[at(.05,.94),at(.5,.94),at(.92,.94)].map(q=>[q[0],q[1]+.005,q[2]]),.005,'z4-headlamp-brow');
      for(const t of [.26,.59]){const q=at(.34,t);box(p,M.chrome,[.055,.011,.035],[q[0],q[1]+.009,q[2]],.005,'headlamp-projector');}
    }
  }
  if(kind==='octavia'){
    for(const sign of [-1,1])for(const x of [.54,.68])projector(p,[sign*x,d.front-.075,-d.L/2-.017],[.035,.023,.012]);
    tintGlass(M.glass);
    for(const o of [...p.children])if(o.isMesh&&o.material===M.black&&o.position.z>d.L/2-.3&&o.position.y<.3&&Math.abs(o.position.x)<.4&&Math.abs(o.position.y-.195)<.01)o.removeFromParent();
    // Preserve the exact shared roof/windscreen/rear-glass endpoints. The old side
    // windows extended into the painted C-pillar and made the liftback look glass-roofed.
    const remove=[];p.traverse(o=>{if(['front-door-glass','rear-door-glass','b-pillar','c-pillar'].includes(o.name))remove.push(o);});for(const o of remove)o.removeFromParent();
    const bw=W-.115,rw=W-.23,b=.34;
    for(const s of [-1,1]){
      const P=(x,y,z)=>[s*x,y,z],A0=P(bw,d.belt+.014,d.cowl),A1=P(rw,d.H-.045,d.header),C0=P(bw,d.belt+.014,d.back),C1=P(rw,d.H-.045,d.roofBack);
      const a0=P(bw,d.belt+.025,d.cowl+.065),a1=P(rw,d.H-.095,d.header+.07),c0=P(bw,d.belt+.025,d.back-.27),c1=P(rw,d.H-.095,d.roofBack-.13);
      const B0=P(bw,d.belt+.025,b-.033),B1=P(rw,d.H-.095,b-.033),B2=P(rw,d.H-.095,b+.033),B3=P(bw,d.belt+.025,b+.033);
      patch(p,M.paint,[A0,A1,a1,a0],'solid-a-pillar');patch(p,M.glass,[a0,a1,B1,B0],'front-door-glass');
      patch(p,M.glass,[B3,B2,c1,c0],'rear-door-glass');patch(p,M.black,[B0,B1,B2,B3],'solid-b-pillar');
      surface(p,M.paint,(u,v)=>{const q=V(c1).lerp(V(c0),v).lerp(V(C1).lerp(V(C0),v),u);q.x+=s*.018*Math.sin(u*Math.PI)*Math.sin(v*Math.PI);return q.toArray();},12,8,'solid-c-pillar');
      surface(p,M.paint,(u,v)=>{const z=mix(d.header,d.roofBack,u);return[s*rw,mix(d.H-.045,d.H-.095,v),z];},20,2,'solid-roof-rail');
      line(p,M.black,[a0,a1,B1],.006,'front-window-rubber');line(p,M.black,[B2,c1,c0,B3],.006,'rear-window-rubber');
      const divider0=P(bw+.001,d.belt+.025,1.14),divider1=P(rw+.001,d.H-.095,.77);line(p,M.black,[divider0,divider1],.009,'quarter-window-divider');
    }
  } else {
    // F57's folded fabric stack; G29's smooth painted tonneau and individual rollover covers.
    if(kind==='mini')for(let i=0;i<4;i++)box(p,M.cloth,[d.W*.72,.045,.085],[0,d.belt+.115-i*.012,d.back+.045+i*.073],.02,'folded-soft-top');
    if(kind==='z4'){
      surface(p,M.paint,(u,v)=>{const x=mix(-W+.13,W-.13,u),z=mix(d.back-.01,d.back+.38,v);return[x,car.playerSurface.deck(x,z)+.004,z];},20,6,'tonneau-cover');
      for(const s of [-1,1])box(p,M.black,[.33,.17,.095],[s*.37,d.belt+.24,d.back-.095],.035,'rollover-cover');
    }
  }
  // Wrap the complete assembled fascia and its lights around the corners together.
  // Working in body space keeps local lamp groups, badges and plates seated on the shell.
  p.updateMatrixWorld(true);
  const bodyInverse=p.matrixWorld.clone().invert(),point=new THREE.Vector3();
  p.traverse(o=>{if(!o.isMesh)return;const toBody=bodyInverse.clone().multiply(o.matrixWorld),fromBody=toBody.clone().invert(),a=o.geometry.attributes.position;let changed=false;
    for(let i=0;i<a.count;i++){point.fromBufferAttribute(a,i).applyMatrix4(toBody);const distance=d.L/2-Math.abs(point.z);if(distance<.43){const weight=clamp((.43-distance)/.43),q=Math.min(1.12,Math.abs(point.x)/W),wrap=(kind==='mini'?.145:kind==='z4'?(point.z>0?.20:.18):.135)*q**3+.035*(1-clamp((point.y-.18)/.30))**2+(point.z<0?.075*clamp((point.y-.63)/.30)**2:.09*clamp((.55-point.y)/.35)**2+(kind==='z4'?.070:.065)*clamp((point.y-.65)/.30)**2);point.z-=Math.sign(point.z)*wrap*weight;point.applyMatrix4(fromBody);a.setXYZ(i,point.x,point.y,point.z);changed=true;}}
    if(changed){a.needsUpdate=true;o.geometry.computeVertexNormals();o.geometry.computeBoundingSphere();}
  });
}
