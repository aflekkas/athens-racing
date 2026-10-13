// Original procedural Mercedes surfaces, in metres, nose -Z. No photo textures.
// Dimensions: Mercedes C236 technical data, 2024 CLE 300 4MATIC European coupe.
// https://media.mercedes-benz.fr/decouvrez-la-nouvelle-mercedes-benz-cle/
// https://nd-mediagallery2-public-production.s3.amazonaws.com/215df8a0a2f426ec8e82796a0eaca795/techdata_cle_c236_806_056.pdf
import * as THREE from 'three';

export const MERCEDES_MODELS = {
  // H247 dimensions: Mercedes-Benz Philippines February 2024 brochure (refs/gla.pdf).
  gla: { mercedes:true,suv:true,L:4.410,W:1.834,H:1.611,wb:2.729,track:1.605,axleOffset:-.065,r:.346,rim:.229,tyreF:.235,tyreR:.235,belt:1.065,front:.94,rear:1.08,cowl:-.94,header:-.47,roofBack:1.15,back:1.94,seatZ:.18,eyeY:1.245,doors:4,leather:'#343434' },
  // H247 AMG-specific width/track; manufacturer 2020 press kit and MY24 drawings.
  gla45: { mercedes:true,suv:true,amg:true,L:4.443,W:1.849,H:1.590,wb:2.729,track:1.615,axleOffset:-.065,r:.346,rim:.254,tyreF:.255,tyreR:.255,belt:1.065,front:.94,rear:1.08,cowl:-.94,header:-.47,roofBack:1.15,back:1.94,seatZ:.18,eyeY:1.224,doors:4,leather:'#292b2d' },
  cle: { mercedes:true,L:4.850,W:1.861,H:1.428,wb:2.865,track:1.605,axleOffset:-.12,r:.337,rim:.241,tyreF:.245,tyreR:.275,belt:.98,front:.78,rear:.95,cowl:-.76,header:-.12,roofBack:.86,back:1.72,seatZ:.32,eyeY:1.135,doors:2,leather:'#875b43' },
};
const mix=THREE.MathUtils.lerp,clamp=THREE.MathUtils.clamp;
const V=p=>new THREE.Vector3(...p);
function sample(points,z){for(let i=1;i<points.length;i++)if(z<=points[i][0]){const a=points[i-1],b=points[i],u=clamp((z-a[0])/(b[0]-a[0]),0,1);return mix(a[1],b[1],u*u*(3-2*u));}return points.at(-1)[1];}

// All deck, seam, arch and fascia points sample the same shell functions.
export function mercedesSurface(d){
  const F=-d.L/2,R=d.L/2,W=d.W/2;
  const top=z=>sample([[F,d.front],[F+.35,d.front+.085],[d.cowl,d.belt],[.35,d.belt+.015],[d.wb/2,d.belt+.055],[R,d.rear]],z);
  const width=z=>sample([[F,W*.86],[F+.38,W*.97],[-d.wb/2+(d.axleOffset||0),W],[0,W*.975],[d.wb/2,W],[R-.25,W*.96],[R,W*.88]],z);
  const side=(z,y)=>{const t=clamp((y-.19)/(top(z)-.19),0,1);return width(z)-.060*(1-t)**4-.018*t**6-.021*Math.sin(t*Math.PI*2);};
  const deck=(x,z)=>{const t=x/width(z),bulge=z<d.cowl?.012*Math.exp(-(((Math.abs(t)-.58)/.10)**2)):0;return top(z)+.036*(1-t*t)+bulge;};
  const face=(x,z,y)=>z+Math.sign(-z)*(.13*(Math.abs(x)/(W*.88))**3+.025*(1-clamp((y-.18)/.5,0,1)));
  const longitudinal=(x,z,y)=>mix(z,face(x,z,y),clamp((Math.abs(z)-(d.L/2-.36))/.36,0,1)**2);
  return {top,width,side,deck,face,longitudinal};
}

export function buildMercedes(car,d,M,low,plate,H){
  const {mesh,box,line,surface,patch,ring,cabinFittings,makePlateMaterial}=H;
  const p=car.body,F=-d.L/2,R=d.L/2,W=d.W/2,ax=d.axleOffset||0,S=mercedesSurface(d),arch=d.r+.055;
  const suv=!!d.suv,amg=!!d.amg,cla=!!d.cla;
  car.mercedesSurface=S;
  for(const s of [-1,1]){
    surface(p,M.paint,(u,v)=>{const z=mix(F,R,u);let bottom=.19;for(const a of [-d.wb/2+ax,d.wb/2+ax])if(Math.abs(z-a)<arch)bottom=Math.max(bottom,d.r+Math.sqrt(arch*arch-(z-a)**2));const y=mix(bottom,S.top(z),v);const x=s*S.side(z,y);return[x,y,S.longitudinal(x,z,y)];},160,12,'body-side');
    for(const a of [-d.wb/2+ax,d.wb/2+ax]){
      const points=[];for(let i=0;i<=40;i++){const t=i*Math.PI/40,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);points.push([s*(S.side(z,y)+.002),y,z]);}
      line(p,suv&&!amg?M.black:M.paint,points,suv?.027:.012);
      if(amg)surface(p,M.paint,(u,v)=>{const t=u*Math.PI,z=a+(arch+.040*v)*Math.cos(t),y=d.r+(arch+.040*v)*Math.sin(t);return[s*(S.side(z,y)+.025*Math.sin(v*Math.PI)),y,z];},32,3,'amg-wide-arch');
      surface(p,M.black,(u,v)=>{const t=u*Math.PI,z=a+(arch-.006)*Math.cos(t),y=d.r+(arch-.006)*Math.sin(t);return[s*mix(d.track/2-.14,S.side(z,y)-.012,v),y,z];},32,4,'wheel-arch-liner');
    }
    surface(p,M.paint,(u,v)=>{const z=mix(d.cowl,d.back,u);return[s*mix(S.side(z,S.top(z)),W-.135,v),mix(S.top(z),d.belt+.014,v)+.012*Math.sin(v*Math.PI),z];},56,8,'door-shoulder');
    const ends=d.doors===2?[.79]:[.36,1.27];
    for(const end of ends){
      const curve=new THREE.CatmullRomCurve3([[end,d.belt-.01],[end+.025,.66],[end-.035,.31],[end-.19,.285]].map(([z,y])=>new THREE.Vector3(0,y,z)));
      line(p,M.seam,curve.getPoints(32).map(q=>[s*(S.side(q.z,q.y)+.002),q.y,q.z]),.0022);
      box(p,cla?M.paint:M.chrome,[.023,.030,.16],[s*(S.side(end-.17,d.belt-.12)+.008),d.belt-.12,end-.17],.009,[0,0,0],'door-handle');
    }
    const sill=[];for(let i=0;i<=24;i++){const z=mix(-d.wb/2+ax+.40,d.wb/2+ax-.40,i/24);sill.push([s*(S.side(z,.25)+.004),.25,z]);}line(p,M.black,sill,suv?.039:.024);
    // Taut upper character line dissolves into the long coupe door.
    const crease=[];for(let i=0;i<=32;i++){const z=mix(F+.34,R-.26,i/32),y=S.top(z)-.065;crease.push([s*(S.side(z,y)+.0015),y,z]);}line(p,M.paint,crease,.004);
  }
  for(const [a,b,name]of [[F,d.cowl,'bonnet'],[d.back,R,'boot']])surface(p,M.paint,(u,v)=>{const z=mix(a,b,u),x=(2*v-1)*S.side(z,S.top(z));return[x,S.deck(x,z),S.longitudinal(x,z,S.top(z))];},48,24,name);
  // Rounded end surfaces, shared with the lamp/grille attachment projection.
  for(const z of [F,R])surface(p,M.paint,(u,v)=>{const y=mix(.19,S.top(z),v),x=(2*u-1)*S.side(z,y);return[x,y+.036*(1-(2*u-1)**2)*v**8,S.face(x,z,y)];},40,12,z<0?'front-bumper':'rear-bumper');
  box(p,M.black,[d.W*.81,.07,d.L*.88],[0,.19,0],.015,[0,0,0],'undertray');
  for(const s of [-1,1]){const pts=[];for(let i=0;i<=24;i++){const z=mix(F+.13,d.cowl-.02,i/24),x=s*S.width(z)*.69;pts.push([x,S.deck(x,z)+.002,z]);}line(p,M.seam,pts,.002);}

  // Shared roof/glass perimeter. Solid painted A/C pillars and a recessed B pillar.
  const rw=W-(suv?.21:.245),bw=W-.135;
  const roof=(u,x)=>d.H-.075+.04*Math.sin(Math.PI*u)+(mix(.018,.012,u)+.023*Math.sin(Math.PI*u))*(1-x*x);
  const railY=z=>d.H-.075+.04*Math.sin(Math.PI*clamp((z-d.header)/(d.roofBack-d.header),0,1));
  car.windscreen=surface(p,M.glass,(u,v)=>{const x=2*u-1;return[x*mix(bw,rw,v),mix(d.belt+.014,d.H-.075,v)+.018*(1-x*x),mix(d.cowl,d.header,v)-.045*(1-x*x)];},24,10,'windscreen');
  surface(p,M.glass,(u,v)=>{const x=2*u-1;return[x*mix(rw,bw,v),mix(d.H-.075,d.belt+.014,v)+.012*(1-x*x),mix(d.roofBack,d.back,v)];},22,12,'rear-glass');
  surface(p,cla?M.black:M.paint,(u,v)=>{const x=2*v-1;return[x*rw,roof(u,x),mix(d.header,d.roofBack,u)-.045*(1-x*x)*(1-u)];},30,20,'roof');
  surface(p,M.cloth,(u,v)=>{const x=2*v-1;return[x*(rw-.008),roof(u,x)-.018,mix(d.header,d.roofBack,u)-.045*(1-x*x)*(1-u)];},30,20,'headliner');
  for(const s of [-1,1]){
    const a0=[s*bw,d.belt+.014,d.cowl],a1=[s*rw,d.H-.075,d.header];
    const c0=[s*bw,d.belt+.014,d.back],c1=[s*rw,d.H-.075,d.roofBack];
    const ai0=[s*bw,d.belt+.02,d.cowl+.065],ai1=[s*rw,railY(d.header+.065)-.038,d.header+.065];
    const ci0=[s*bw,d.belt+.022,d.back-(suv?.27:.31)],ci1=[s*rw,railY(d.roofBack-.055)-.038,d.roofBack-.055];
    patch(p,M.paint,[a0,a1,ai1,ai0],'solid-a-pillar');patch(p,M.paint,[ci0,ci1,c1,c0],'solid-c-pillar');
    const bz=d.doors===2?.68:.32,b0=[s*bw,d.belt+.024,bz],b1=[s*rw,railY(bz)-.038,bz],half=.023;
    const pane=(lo,hi,name)=>surface(p,M.glass,(u,v)=>{const z=mix(mix(lo[0],lo[1],v),mix(hi[0],hi[1],v),u);return[s*mix(bw,rw,v),mix(d.belt+.024,railY(z)-.038,v),z];},20,10,name);
    pane([ai0[2],ai1[2]],[bz-half,bz-half],'front-door-glass');
    pane([bz+half,bz+half],[ci0[2],ci1[2]],'rear-door-glass');
    patch(p,M.black,[[b0[0],b0[1],bz-half],[b1[0],b1[1],bz-half],[b1[0],b1[1],bz+half],[b0[0],b0[1],bz+half]],'solid-b-pillar');
    surface(p,M.paint,(u,v)=>{const z=mix(d.header,d.roofBack,u);return[s*rw,railY(z)-.038*v,z];},30,2,'roof-side-rail');
    const trimPoints=[ai0,ai1];for(let i=1;i<20;i++){const z=mix(ai1[2],ci1[2],i/20);trimPoints.push([s*rw,railY(z)-.038,z]);}trimPoints.push(ci1,ci0,ai0);line(p,amg?M.black:M.chrome,trimPoints,.005);
    box(p,M.black,[.05,.27,d.back-d.cowl-.35],[s*(W-.15),d.belt-.15,(d.cowl+d.back)/2],.022,[0,0,0],'door-card');
    box(p,M.seat,[.035,.10,.70],[s*(W-.18),d.belt-.20,.22],.016,[0,0,0],'door-armrest');
    box(p,M.chrome,[.016,.022,.12],[s*(W-.205),d.belt-.1,d.cowl+.45],.005,[0,0,0],'door-interior-handle');
    const z=d.cowl+.10;
    car[s<0?'mirrorL':'mirrorR']=mesh(p,new THREE.PlaneGeometry(.205,.078),M.chrome,[s*(W+.10),d.belt+.12,z+.06]);
    if(suv){const z0=d.header+.18,z1=d.roofBack-.12;line(p,M.chrome,Array.from({length:20},(_,i)=>{const z=mix(z0,z1,i/19);return[s*(rw-.035),railY(z)+.046,z];}),.016);for(const z of [z0,z1])box(p,M.black,[.035,.036,.075],[s*(rw-.035),railY(z)+.02,z],.008);}
  }
  for(const s of [-1,1])line(p,M.black,[[s*.04,d.belt+.045,d.cowl-.017],[s*.23,d.belt+.06,d.cowl-.05],[s*.58,d.belt+.05,d.cowl-.055]],.006);
  cabinFittings(car,d,M,low);
  if(suv){
    box(p,amg?M.black:M.paint,[d.W*.76,.045,.23],[0,d.H-.036,d.roofBack+.06],.015,[.08,0,0],'hatch-roof-spoiler');
    line(p,M.black,[[-.35,d.belt+.045,d.back+.007],[.23,d.belt+.062,d.back+.015]],.009);
  }
  if(amg){M.red.color.set('#ba2029');for(const s of [-1,1])box(p,M.chrome,[.009,.027,.15],[s*(W+.003),d.belt-.11,-d.wb/2+.40],.002,[0,0,0],'amg-wing-badge');}
  // Tessellate before projecting: a large flat polygon intersects a curved bumper.
  const front=(m,pts,name,part,z=F)=>{
    const g0=new THREE.ShapeGeometry(new THREE.Shape(pts.map(q=>new THREE.Vector2(...q))));
    const raw=g0.toNonIndexed(),a=raw.attributes.position,points=[];
    const triangle=(a,b,c,n)=>{if(n){const ab=a.clone().lerp(b,.5),bc=b.clone().lerp(c,.5),ca=c.clone().lerp(a,.5);triangle(a,ab,ca,n-1);triangle(ab,b,bc,n-1);triangle(ca,bc,c,n-1);triangle(ab,bc,ca,n-1);}else for(const q of [a,b,c])points.push(q.x,q.y,S.face(q.x,z,q.y)+Math.sign(z)*.012);};
    for(let i=0;i<a.count;i+=3)triangle(new THREE.Vector3().fromBufferAttribute(a,i),new THREE.Vector3().fromBufferAttribute(a,i+1),new THREE.Vector3().fromBufferAttribute(a,i+2),2);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(points.length/3*2),2));g.computeVertexNormals();g0.dispose();raw.dispose();
    const o=mesh(p,g,m,[0,0,0],[0,0,0],name);if(part)o.userData.damagePart=part;return o;
  };
  const stroke=(m,pts,z,r=.006,part)=>{const o=line(p,m,pts.map(([x,y])=>[x,y,S.face(x,z,y)+Math.sign(z)*.014]),r);if(part)o.userData.damagePart=part;return o;};
  const star=(x,y,z,r,m=M.chrome,part)=>{
    const o=mesh(p,new THREE.TorusGeometry(r,.004,4,24),m,[x,y,z]);if(part)o.userData.damagePart=part;
    for(let i=0;i<3;i++){const a=Math.PI/2+i*Math.PI*2/3;const q=line(p,m,[[x,y,z],[x+Math.cos(a)*r*.91,y+Math.sin(a)*r*.91,z]],r*.075);if(part)q.userData.damagePart=part;}
  };
  const gy=d.front-.18,gw=cla?.55:suv?.51:.48;
  const grille=Array.from({length:32},(_,i)=>{const a=i*Math.PI*2/32,t=Math.sin(a);return[gw*Math.sign(Math.cos(a))*Math.abs(Math.cos(a))**.55*(1+.07*t),gy+.01+.15*Math.sign(t)*Math.abs(t)**.58];});
  front(M.black,grille,'mercedes-grille');stroke(M.chrome,[...grille,grille[0]],F,.008);
  if(amg){for(let i=-6;i<=6;i++)stroke(M.chrome,[[i*.066,gy-.11],[i*.060,gy+.145]],F,.009);}
  else if(suv){stroke(M.chrome,[[-gw*.92,gy],[gw*.92,gy]],F,.018);for(const y of [gy-.075,gy+.075])stroke(M.darkAlloy,[[-gw*.80,y],[gw*.80,y]],F,.008);}
  else{
    for(let j=0;j<5;j++)for(let i=-7;i<=7;i++){const x=(i+(j%2)*.5)*.058,y=gy-.105+j*.050;if(Math.abs(x)>gw*.84||Math.hypot(x,y-gy)<.106)continue;const z=S.face(x,F,y)-.015;for(let k=0;k<3;k++){const a=Math.PI/2+k*2*Math.PI/3;line(p,M.chrome,[[x,y,z],[x+.009*Math.cos(a),y+.009*Math.sin(a),z]],.0017);}}
    stroke(M.chrome,[[-gw*.91,gy],[gw*.91,gy]],F,.007);
  }
  star(0,gy,F-.023,.101);
  if(cla)stroke(M.led,[[-.78,d.front+.005],[0,d.front+.018],[.78,d.front+.005]],F,.006,'light_fl');
  front(M.black,[[-.52,.36],[.52,.36],[.63,.235],[-.63,.235]],'lower-grille','bumper_f');
  for(const s of [-1,1]){
    const side=s<0?'l':'r',fy=d.front-.11;
    const pts=cla?[[.39,fy+.045],[.82,fy+.12],[.79,fy-.04],[.58,fy-.10]]:suv?[[.48,fy+.12],[.80,fy+.13],[.80,fy-.03],[.50,fy-.06]]:[[.48,fy+.02],[.82,fy+.115],[.79,fy-.025],[.55,fy-.095]];
    front(M.head,pts.map(([x,y])=>[s*x,y]),'headlamp-housing','light_f'+side);
    stroke(M.led,[[s*pts[0][0],pts[0][1]-.014],[s*.76,pts[1][1]-.025],[s*.80,pts[1][1]-.045]],F,.009,'light_f'+side);
    if(cla)star(s*.65,fy-.005,S.face(s*.65,F,fy)-.022,.050,M.led,'light_f'+side);
    else for(const x of [.60,.72]){const q=mesh(p,new THREE.CircleGeometry(.026,16),M.chrome,[s*x,fy-.025,S.face(s*x,F,fy)-.017]);q.userData.damagePart='light_f'+side;}
    front(M.black,[[s*.56,suv?.60:.43],[s*.73,suv?.63:.46],[s*.80,suv?.56:.40],[s*.80,.29],[s*.62,.26]],'outer-intake',suv?'structure':'bumper_f');
    if(suv&&!amg){const y=.46;mesh(p,new THREE.CircleGeometry(.043,20),M.chrome,[s*.68,y,S.face(s*.68,F,y)-.022]);}
    for(const y of [.30,.36])stroke(M.darkAlloy,[[s*.63,y],[s*.77,y+.005]],F,.008,'bumper_f');
    const ry=d.rear-.12,tail=cla?[[.32,ry+.06],[.80,ry+.09],[.78,ry-.08],[.34,ry-.07]]:[[.24,ry+.035],[.80,ry+.095],[.77,ry-.06],[.43,ry-.09]];
    front(M.red,tail.map(([x,y])=>[s*x,y]),'rear-lamp-housing','light_r'+side,R);
    stroke(M.tail,[...tail,tail[0]].map(([x,y])=>[s*x,y]),R,.013,'light_r'+side);
    if(cla)for(const x of [.44,.65])star(s*x,ry,S.face(s*x,R,ry)+.023,.049,M.tail,'light_r'+side);
    else stroke(M.tail,[[s*.39,ry+.005],[s*.68,ry+.037],[s*.70,ry-.025],[s*.48,ry-.042]],R,.009,'light_r'+side);
  }
  stroke(cla?M.tail:M.black,[[-.30,d.rear-.08],[.30,d.rear-.08]],R,cla?.013:.025);
  star(0,d.rear-.22,R+.025,.035);
  box(p,M.black,[d.W*.80,.10,.10],[0,.245,R-.055],.025,[0,0,0],'rear-diffuser');
  car.exhaust=[];
  for(const s of [-1,1])for(const dx of amg?[-.060,.060]:[0]){
    const x=s*.62+dx,z=R-.018;const outlet=mesh(p,new THREE.CylinderGeometry(.039,.039,.11,20,1,true),M.chrome,[x,.24,z],[Math.PI/2,0,0],'exhaust-outlet');outlet.userData.damagePart='bumper_r';mesh(p,new THREE.CircleGeometry(.031,16),M.black,[x,.24,z+.057]);car.exhaust.push(new THREE.Vector3(x,.24,z+.06));
  }
  if(!suv&&!cla)for(const s of [-1,1]){const o=ring(p,M.chrome,.055,.009,[s*.62,.245,R+.043]);o.scale.set(1.65,.65,1);}
  car.plate=plate;M.plate=makePlateMaterial(plate);
  for(const z of [F,R]){const y=z<0?.44:.64;box(p,M.black,[.535,.124,.019],[0,y,z+Math.sign(z)*.012],.006);mesh(p,new THREE.PlaneGeometry(.51,.108),M.plate,[0,y,z+Math.sign(z)*.025],[0,z<0?Math.PI:0,0],'registration');}
  // Procedural badge reused on the steering wheel; not a downloaded logo texture.
  const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#111419';ctx.fillRect(0,0,128,128);ctx.strokeStyle='#d4dbe0';ctx.lineWidth=5;ctx.beginPath();ctx.arc(64,64,54,0,Math.PI*2);ctx.stroke();for(let i=0;i<3;i++){const a=-Math.PI/2+i*Math.PI*2/3;ctx.beginPath();ctx.moveTo(64,64);ctx.lineTo(64+50*Math.cos(a),64+50*Math.sin(a));ctx.stroke();}const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;M.badge.map?.dispose();M.badge.map=tex;M.badge.needsUpdate=true;
}
