// Athens passenger fleet. Metres, nose -Z. Each section is [z, half width, shoulder height].
// Production dimensions from manufacturer press kits; independently drawn body/greenhouse stations.
import * as THREE from 'three';
import { seatMirrors } from './vehicle-mirrors.js';
import { nextRegistration, makePlateMaterial } from './vehicle-models.js';
export const PASSENGER_MODELS = {
 city:{name:'Toyota Aygo II (2014)',windowRise:.10,roofDrop:.025,L:3.455,W:1.615,H:1.460,wb:2.34,r:.285,track:1.425,ax:-.03,belt:.93,cowl:-.89,header:-.39,roofBack:1.16,back:1.60,rw:.585,b:.25,sections:[[-1.7275,.70,.805],[-1.40,.77,.83],[-.94,.80,.92],[-.4,.795,.93],[.55,.80,.97],[1.16,.80,1.01],[1.7275,.70,.96]]},
 hatch:{name:'Volkswagen Golf VII',windowRise:.045,roofDrop:.050,L:4.255,W:1.799,H:1.452,wb:2.637,r:.315,track:1.549,ax:-.055,belt:.97,cowl:-.89,header:-.37,roofBack:1.60,back:1.99,rw:.66,b:.30,sections:[[-2.1275,.795,.89],[-1.75,.875,.89],[-1.23,.8995,.95],[-.65,.88,.97],[.5,.88,.99],[1.34,.8995,1.02],[2.1275,.80,1.01]]},
 sedan:{name:'Toyota Corolla E210 sedan',windowRise:.045,roofDrop:.075,L:4.630,W:1.780,H:1.435,wb:2.70,r:.318,track:1.53,ax:-.10,belt:.96,cowl:-.93,header:-.36,roofBack:.78,back:1.63,rw:.635,b:.25,sections:[[-2.315,.765,.79],[-1.93,.85,.82],[-1.4,.89,.90],[-.85,.87,.96],[.4,.855,.98],[1.32,.885,1.00],[1.88,.855,.92],[2.315,.785,.95]]},
 suv:{name:'Nissan Qashqai J11',windowRise:.105,roofDrop:.095,L:4.377,W:1.806,H:1.590,wb:2.646,r:.345,track:1.565,ax:-.075,belt:1.07,cowl:-.92,header:-.40,roofBack:1.49,back:1.94,rw:.66,b:.32,cladding:true,sections:[[-2.1885,.795,.98],[-1.8,.865,.98],[-1.38,.903,1.04],[-.75,.87,1.07],[.4,.88,1.10],[1.34,.903,1.15],[2.1885,.79,1.17]]},
 taxi:{name:'Skoda Octavia IV liftback',windowRise:.045,roofDrop:.075,L:4.689,W:1.829,H:1.470,wb:2.686,r:.323,track:1.543,ax:-.092,belt:.985,cowl:-.99,header:-.39,roofBack:.88,back:1.87,rw:.66,b:.26,sections:[[-2.3445,.81,.90],[-1.94,.88,.88],[-1.44,.9145,.96],[-.92,.885,.985],[.5,.882,1.01],[1.38,.909,1.05],[2.05,.865,.95],[2.3445,.81,1.01]]},
 taxi_superb:{name:'Skoda Superb III liftback',windowRise:.035,roofDrop:.060,L:4.861,W:1.864,H:1.468,wb:2.841,r:.33,track:1.584,ax:-.085,belt:.98,cowl:-1.07,header:-.47,roofBack:.96,back:1.93,rw:.685,b:.27,sections:[[-2.4305,.82,.92],[-2.02,.90,.86],[-1.48,.932,.95],[-.97,.905,.98],[.5,.90,1.01],[1.48,.928,1.03],[2.05,.885,.96],[2.4305,.83,1.02]]},
 byd_dolphin:{name:'BYD Dolphin European specification',windowRise:.14,roofDrop:.085,L:4.290,W:1.770,H:1.570,wb:2.70,r:.326,track:1.53,ax:-.045,belt:1.04,cowl:-1.09,header:-.61,roofBack:1.49,back:1.93,rw:.645,b:.23,sections:[[-2.145,.74,.89],[-1.80,.815,.91],[-1.37,.885,1.01],[-.9,.86,1.04],[.25,.855,1.07],[1.26,.885,1.15],[1.85,.82,1.08],[2.145,.75,1.05]]},
 byd_atto3:{name:'BYD Atto 3',windowRise:.10,roofDrop:.075,L:4.455,W:1.875,H:1.615,wb:2.720,r:.347,track:1.575,ax:-.05,belt:1.10,cowl:-1.00,header:-.43,roofBack:1.53,back:2.00,rw:.69,b:.28,cladding:true,sections:[[-2.2275,.81,.97],[-1.87,.88,.99],[-1.4,.9375,1.07],[-.8,.902,1.10],[.35,.905,1.12],[1.34,.9375,1.18],[1.96,.875,1.10],[2.2275,.82,1.10]]}
};
const mix=(a,b,t)=>a+(b-a)*t;
const beltY=(d,z)=>d.belt+(d.windowRise||0)*Math.max(0,Math.min(1,(z-d.cowl)/(d.back-d.cowl)))**1.6;
// Corner retreat ends at least 15mm before either arch. Max derivative reduction is 2*.38.
const endLengths=d=>[Math.min(.35,d.L/2-d.wb/2+d.ax-d.r-.045-.015),Math.min(.35,d.L/2-d.wb/2-d.ax-d.r-.045-.015)];
const endBlend=(d,z)=>{const [a,b]=endLengths(d);return[Math.max(0,1-(z+d.L/2)/a)**2,Math.max(0,1-(d.L/2-z)/b)**2];};
const sideZ=(d,z)=>{const [f,r]=endBlend(d,z),[a,b]=endLengths(d);return z+.38*(a*f-b*r);};
const deckZ=(d,z,x)=>{const [f,r]=endBlend(d,z),[a,b]=endLengths(d);return z+.38*(a*f-b*r)*(.35*x*x+.65*x**4);};
function section(d,z){let i=1;while(i<d.sections.length-1&&z>d.sections[i][0])i++;const a=d.sections[i-1],b=d.sections[i],t=Math.max(0,Math.min(1,(z-a[0])/(b[0]-a[0])));const q=t*t*(3-2*t);return [mix(a[1],b[1],q),mix(a[2],b[2],q)];}
function mesh(p,g,m,name,part){const o=new THREE.Mesh(g,m);o.name=name||part||'';if(part)o.userData.damagePart=part;p.add(o);return o;}
function surface(p,m,fn,nu,nv,name,part){const a=[],idx=[];for(let i=0;i<=nu;i++)for(let j=0;j<=nv;j++)a.push(...fn(i/nu,j/nv));for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const k=i*(nv+1)+j;idx.push(k,k+1,k+nv+1,k+1,k+nv+2,k+nv+1);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(a,3));g.setIndex(idx);g.computeVertexNormals();return mesh(p,g,m,name,part);}
function poly(p,m,pts,name,part){const a=pts.flat(),idx=[];for(let i=1;i<pts.length-1;i++)idx.push(0,i,i+1);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(a,3));g.setIndex(idx);g.computeVertexNormals();return mesh(p,g,m,name,part);}
function box(p,m,size,pos,name,part){const o=mesh(p,new THREE.BoxGeometry(...size),m,name,part);o.position.set(...pos);return o;}
function rod(p,m,a,b,r=.007,part){const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),o=mesh(p,new THREE.CylinderGeometry(r,r,A.distanceTo(B),5),m,'trim',part);o.position.copy(A).add(B).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),B.sub(A).normalize());return o;}
function chain(p,m,pts,r,part){for(let i=1;i<pts.length;i++)rod(p,m,pts[i-1],pts[i],r,part);}
function palette(color,low){const mat=(c,r=.5,metalness=0)=>new THREE.MeshStandardMaterial({color:c,roughness:r,metalness,side:THREE.DoubleSide});const paint=mat(color,.30,.38),black=mat('#161a1e',.85),chrome=mat('#a9b4bf',.27,.8),head=mat('#344652',.19,.6),tail=mat('#a10e1a',.26),led=low?head:mat('#edf9ff',.18);tail.emissive.set('#600609');led.emissive.set('#a1b5c3');return {paint,black,chrome,head,tail,led,glass:new THREE.MeshStandardMaterial({color:'#536873',roughness:.16,metalness:.28,transparent:!low,opacity:low?1:.58,depthWrite:low,side:THREE.DoubleSide})};}
export function passengerSideX(d,z,y){const [w,h]=section(d,z),t=Math.max(0,Math.min(1,(y-.19)/(h-.19)));return w-.105*(1-t)**3-.055*t**8-.024*Math.sin(t*Math.PI*2);}
function skin(car,d,M,low){const p=car.body,F=-d.L/2,R=d.L/2,arch=d.r+.045;
 const edge=(z,y)=>{const [w,h]=section(d,z),t=Math.max(0,Math.min(1,(y-.19)/(h-.19)));return w-.105*(1-t)**3-.055*t**8-.024*Math.sin(t*Math.PI*2);};
 for(const s of [-1,1]){const cuts=[F,d.cowl,d.b,d.wb/2+d.ax-.10,R];for(let q=0;q<4;q++){const a=cuts[q],b=cuts[q+1],zs=[a,b,...d.sections.map(v=>v[0]).filter(z=>z>a&&z<b)];for(const ax of [-d.wb/2+d.ax,d.wb/2+d.ax])for(let i=0;i<=(low?8:24);i++){const z=ax+Math.cos(Math.PI*i/(low?8:24))*arch;if(z>a&&z<b)zs.push(z);}zs.sort((a,b)=>a-b);const part=q===1?`door_${s<0?'l':'r'}f`:q===2?`door_${s<0?'l':'r'}r`:undefined;
 surface(p,M.paint,(u,v)=>{const n=u*(zs.length-1),i=Math.min(zs.length-2,Math.floor(n)),z=mix(zs[i],zs[i+1],n-i);let bottom=.19;for(const ax of [-d.wb/2+d.ax,d.wb/2+d.ax])if(Math.abs(z-ax)<arch)bottom=Math.max(bottom,d.r+Math.sqrt(Math.max(0,arch*arch-(z-ax)**2)));const y=mix(bottom,section(d,z)[1],v);return[s*edge(z,y),y,sideZ(d,z)];},zs.length-1,low?4:10,'painted-side',part);}
 for(const ax of [-d.wb/2+d.ax,d.wb/2+d.ax]){surface(p,M.black,(u,v)=>{const t=u*Math.PI,z=ax+arch*Math.cos(t),y=d.r+arch*Math.sin(t);return[s*mix(d.track/2-.11,edge(z,y),v),y,z];},low?8:24,1,'open-wheelarch-liner');if(!low){const pts=[];for(let i=0;i<=24;i++){const t=i*Math.PI/24,z=ax+arch*Math.cos(t),y=d.r+arch*Math.sin(t);pts.push([s*(edge(z,y)+.003),y,z]);}chain(p,d.cladding?M.black:M.paint,pts,d.cladding?.022:.009);}}
 surface(p,M.paint,(u,v)=>{const z=mix(d.cowl,d.back,u),[w,h]=section(d,z);return[s*mix(w-.055,d.W/2-.12,v),mix(h,beltY(d,z),v)+.023*Math.sin(v*Math.PI),z];},low?10:28,4,'shoulder');
 if(!low){for(const [a,b,part]of [[d.cowl,d.b,`door_${s<0?'l':'r'}f`],[d.b,d.wb/2+d.ax-.10,`door_${s<0?'l':'r'}r`]]){const rear=part.endsWith('r');const pts=[[a+.025,beltY(d,a)-.005],[a+.035,.46],[a+.065,.285],[b-(rear?.31:.055),.285],[b-(rear?.21:0),.49],[b,beltY(d,b)-.004]].map(([z,y])=>[s*(edge(z,y)+.003),y,z]);chain(p,M.black,pts,.0025,part);box(p,M.paint,[.026,.033,.14],[s*(edge(b-.15,d.belt-.10)+.009),d.belt-.10,b-.15],'handle',part);}}
 box(p,d.cladding?M.black:M.paint,[.045,.065,d.wb-.67],[s*(d.W/2-.045),.22,d.ax],'sill');}
 for(const [a,b,part]of [[F,d.cowl,'bonnet'],[d.back,R,'boot']])surface(p,M.paint,(u,v)=>{const z=mix(a,b,u),[w,h]=section(d,z),x=2*v-1;return[x*(w-.055),h+.064*(1-x*x),deckZ(d,z,x)];},low?4:18,low?4:10,part,part);
 for(const end of [-1,1])surface(p,M.paint,(u,v)=>{const x=2*u-1,z=end*d.L/2,[w,h]=section(d,z);const side=w-.105*(1-v)**3-.055*v**8-.024*Math.sin(v*Math.PI*2);const bottom=.19+.07*(1-x*x);return[x*side,mix(bottom,h,v)+.064*(1-x*x)*v,deckZ(d,z,x)];},low?10:24,low?4:10,end<0?'bumper_f':'bumper_r',end<0?'bumper_f':'bumper_r');
 box(p,M.black,[d.W*.82,.06,d.L*.85],[0,.23,0],'underfloor');
}
function cabin(car,d,M,low,parked,player=false){const p=car.body,bw=d.W/2-.12,rw=d.rw,roof=(z)=>{const u=Math.max(0,Math.min(1,(z-d.header)/(d.roofBack-d.header)));return d.H-(player?.040:.067)+(player?.018:.040)*Math.sin(u*Math.PI)-(d.roofDrop||.06)*u*u;};
 const A=[d.cowl,d.belt],B=[d.header,roof(d.header)],C=[d.roofBack,roof(d.roofBack)],D=[d.back,beltY(d,d.back)];
 surface(p,M.paint,(u,v)=>{const z=mix(d.header,d.roofBack,u),x=2*v-1;return[x*rw,roof(z)+(player?.025:.035)*(1-x*x),z];},low?3:12,low?4:12,'solid-roof');
 for(const [a,b,name]of [[A,B,'windscreen-glass'],[D,C,'rear-glass']]){
 const baseZ=a[0]+(name==='windscreen-glass'?.025:-.025);
 surface(p,M.glass,(u,v)=>{const x=2*u-1;return[x*mix(bw-.035,rw-.035,v),mix(a[1]+.035,b[1]-(player?.018:.025),v)+(player?.020:.012)*(1-x*x),mix(baseZ,b[0],v)];},low?4:12,low?1:5,name,'glass');
 for(const side of [-1,1])surface(p,M.paint,(u,v)=>{const frameW=mix(bw,rw,u),frameY=mix(a[1],b[1],u),glassY=mix(a[1]+.035,b[1]-.025,u);return[side*mix(frameW,frameW-.035,v),mix(frameY,glassY,v),mix(mix(a[0],b[0],u),mix(baseZ,b[0],u),v)];},low?2:8,1,name+'-solid-edge');
 // Continuous painted headers exactly bridge the two different glass/roof crowns.
 surface(p,M.paint,(u,v)=>{const x=2*u-1,q=1-x*x;return[x*mix(rw-.035,rw,v),mix(b[1]-(player?.018:.025)+(player?.020:.012)*q,b[1]+(player?.025:.035)*q,v),b[0]];},low?4:12,1,name+'-solid-header');
 // Glazing base lands on the crowned bonnet/hatch deck rather than leaving a cowl slot.
 surface(p,M.paint,(u,v)=>{const x=2*u-1,[w,h]=section(d,a[0]),xx=x*bw,deck=h+.064*(1-(xx/(w-.055))**2);return[x*mix(bw,bw-.035,v),mix(deck,a[1]+.035+.012*(1-x*x),v),mix(a[0],baseZ,v)];},low?4:12,1,name+'-solid-cowl');
 }
 for(const s of [-1,1]){const P=([z,y],x)=>[s*x,y,z];poly(p,M.paint,[P(A,bw),P(B,rw),P([B[0]+.07,B[1]-.04],rw),P([A[0]+.09,A[1]],bw)],'solid-a-pillar');poly(p,M.paint,[P(C,rw),P(D,bw),P([D[0]-.26,D[1]],bw),P([C[0]-.12,C[1]-.05],rw)],'solid-c-pillar');
 const b=d.b,top=roof(b)-.055;
 const window=(bz0,tz0,bz1,tz1,name)=>{
 surface(p,M.glass,(u,v)=>{const bz=mix(bz0,bz1,u),tz=mix(tz0,tz1,u);return[s*mix(bw-.006,rw-.006,v),mix(beltY(d,bz)+.020,roof(tz)-.055,v),mix(bz,tz,v)];},low?4:12,low?1:4,name,'glass');
 surface(p,M.black,(u,v)=>{const z=mix(bz0,bz1,u);return[s*mix(bw,bw-.006,v),beltY(d,z)+.020*v,z];},low?4:12,1,name+'-belt-gasket');
 surface(p,M.black,(u,v)=>{const z=mix(tz0,tz1,u);return[s*mix(rw-.006,rw,v),roof(z)-.055,z];},low?4:12,1,name+'-upper-gasket');
 };
 window(A[0]+.09,B[0]+.08,b-.04,b-.04,'front-door-glass');window(b+.04,b+.04,D[0]-.26,C[0]-.12,'rear-door-glass');
 if(d.roofBack>1.3){const z=d.wb/2+d.ax-.06;surface(p,M.paint,(u,v)=>{const zz=z+(u-.5)*.035;return[s*mix(bw-.003,rw-.003,v),mix(beltY(d,zz)+.018,roof(zz)-.052,v),zz];},1,1,'quarter-window-divider');}
 poly(p,M.paint,[P([b-.04,beltY(d,b)],bw),P([b-.04,top+.025],rw),P([b+.04,top+.025],rw),P([b+.04,beltY(d,b)],bw)],'solid-b-pillar');
 surface(p,M.paint,(u,v)=>{const z=mix(B[0],C[0],u);return[s*rw,roof(z)-.055*v,z];},low?6:18,1,'solid-roof-rail');
 const mp=new THREE.Group();mp.name=`mirror_${s<0?'l':'r'}`;mp.userData.damagePart=mp.name;mp.position.set(s*(d.W/2+.055),d.belt+.085,d.cowl+.14);p.add(mp);box(mp,M.black,[.13,.025,.055],[-s*.07,-.035,0]);if(low)box(mp,M.paint,[.18,.09,.12],[0,0,0]);else{const housing=mesh(mp,new THREE.SphereGeometry(1,12,7),M.paint,'mirror-housing');housing.scale.set(.105,.053,.078);const mirror=mesh(mp,new THREE.CircleGeometry(1,12),M.chrome,'mirror-face');mirror.scale.set(.086,.038,1);mirror.position.z=.067;}
 if(!low){rod(p,M.black,[-.50,d.belt+.032,d.cowl],[-.12,d.belt+.053,d.cowl-.025],.005);}
 }
 if(!low){box(p,M.black,[d.W-.36,.15,.32],[0,d.belt-.085,d.cowl+.16],'dashboard');box(p,M.black,[.20,.12,1.20],[0,.52,.35],'centre-console');{for(const s of [-1,1]){box(p,M.black,[.43,.15,.47],[s*.37,.48,.12],'front-seat-base');const seat=box(p,M.black,[.43,.52,.13],[s*.37,.79,.38],'front-seat-back');seat.rotation.x=-.1;box(p,M.black,[.23,.18,.12],[s*.37,1.10,.39],'headrest');}box(p,M.black,[1.22,.35,.32],[0,.68,1.04],'rear-bench');}const wheel=mesh(p,new THREE.TorusGeometry(.155,.018,5,16),M.black,'steering-wheel');wheel.position.set(-.36,d.belt-.01,d.cowl+.38);wheel.rotation.x=-.4;box(p,M.chrome,[.15,.04,.025],[-.36,d.belt-.01,d.cowl+.40]);}
}
function fascia(car,d,M,low,id){const p=car.body,F=-d.L/2-.07,R=d.L/2+.07,W=d.W/2;
 const faceZ=(x,z,y=.75)=>{const end=z<0?-1:1,[w,h]=section(d,end*d.L/2);let v=Math.max(0,Math.min(1,(y-.23)/(h-.23))),q=0;for(let i=0;i<6;i++){const width=w-.105*(1-v)**3-.055*v**8-.024*Math.sin(v*Math.PI*2);q=x/width;const bottom=.19+.07*(1-q*q);v=Math.max(0,Math.min(1,(y-bottom)/(h+.064*(1-q*q)-bottom)));}return deckZ(d,end*d.L/2,q)+end*.008+z-end*(d.L/2+.07);};
 const face=(m,pts,z,name,part)=>{const vertices=[],n=low?3:5;const point=(a,b,c,u,v)=>{const x=a[0]+(b[0]-a[0])*u+(c[0]-a[0])*v,y=a[1]+(b[1]-a[1])*u+(c[1]-a[1])*v;return[x,y,faceZ(x,z,y)];};for(let k=1;k<pts.length-1;k++){const a=pts[0],b=pts[k],c=pts[k+1];for(let i=0;i<n;i++)for(let j=0;j<n-i;j++){vertices.push(...point(a,b,c,i/n,j/n),...point(a,b,c,(i+1)/n,j/n),...point(a,b,c,i/n,(j+1)/n));if(i+j<n-1)vertices.push(...point(a,b,c,(i+1)/n,j/n),...point(a,b,c,(i+1)/n,(j+1)/n),...point(a,b,c,i/n,(j+1)/n));}}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();return mesh(p,g,m,name,part);};
 const front=(m,pts,name)=>face(m,pts,F,name,'bumper_f');
 const line=(m,pts,z,r=.008,part)=>chain(p,m,pts.map(([x,y])=>[x,y,faceZ(x,z,y)]),r,part);
 const lamp=(s,pts,rear=false)=>{const part=`light_${rear?'r':'f'}${s<0?'l':'r'}`;face(rear?M.tail:M.head,pts.map(([x,y])=>[s*x,y]),rear?R:F-.006,part,part);if(!low&&!rear){const a=pts[0],b=pts[1];line(M.led,[[s*a[0],a[1]-.017],[s*b[0],b[1]-.017]],F-.012,.008,part);const cy=pts.reduce((v,p)=>v+p[1],0)/pts.length;for(const t of [.42,.73]){const x=s*mix(a[0],b[0],t),o=mesh(p,new THREE.CircleGeometry(.025,12),M.chrome,'projector',part);o.position.set(x,cy,faceZ(x,F-.012,cy));o.rotation.y=Math.PI;}}};
 const h=section(d,-d.L/2)[1];
 if(id==='city'){
  // Aygo's full-height gloss-black X, with high almond lamps and low vertical DRLs.
  front(M.black,[[-.69,.79],[-.49,.81],[.63,.26],[.42,.24]],'aygo-x-left');front(M.black,[[.69,.79],[.49,.81],[-.63,.26],[-.42,.24]],'aygo-x-right');
  front(M.black,[[-.34,.50],[.34,.50],[.40,.31],[-.40,.31]],'aygo-lower-mouth');
  for(const s of [-1,1]){lamp(s,[[.20,.73],[.64,.80],[.67,.65],[.34,.64]]);const part=`light_r${s<0?'l':'r'}`;const hatchY=d.H-.067-(d.roofDrop||.06),hatchBase=beltY(d,d.back),bw=d.W/2-.12;
 const hatchPoint=(t,lateral,outset=0)=>[s*(mix(d.rw,bw,t)+lateral),mix(hatchY,hatchBase,t)+outset*.8,mix(d.roofBack,d.back,t)+outset*.6];
 poly(p,M.paint,[hatchPoint(.06,-.085,.001),hatchPoint(.06,.006,.001),hatchPoint(.95,.006,.001),hatchPoint(.95,-.085,.001)],'aygo-hatch-corner');
 poly(p,M.tail,[hatchPoint(.13,-.071,.004),hatchPoint(.13,-.008,.004),hatchPoint(.91,-.008,.004),hatchPoint(.91,-.071,.004)],part,part);box(p,M.led,[.022,.14,.013],[s*.57,.36,faceZ(s*.57,F-.01,.36)],'daylight',`light_f${s<0?'l':'r'}`);}
 }else if(id==='hatch'){
  front(M.black,[[-.46,.81],[.46,.81],[.42,.70],[-.42,.70]],'golf-thin-grille');front(M.black,[[-.58,.48],[.58,.48],[.48,.28],[-.48,.28]],'golf-lower-intake');
  for(const s of [-1,1]){lamp(s,[[.39,.81],[.77,.88],[.77,.70],[.47,.70]]);lamp(s,[[.35,.94],[.76,1.00],[.76,.80],[.41,.82]],true);front(M.black,[[s*.60,.48],[s*.76,.47],[s*.74,.30],[s*.58,.30]],'golf-fog-recess');}line(M.chrome,[[-.42,.727],[.42,.727]],F-.008,.009);
 }else if(id==='sedan'){
  front(M.black,[[-.61,.53],[.61,.53],[.69,.25],[-.69,.25]],'corolla-trapezoid-grille');line(M.chrome,[[-.71,.73],[-.28,.68],[0,.71],[.28,.68],[.71,.73]],F-.008,.012);
  for(const s of [-1,1]){lamp(s,[[.28,.73],[.74,.78],[.70,.66],[.36,.64]]);lamp(s,[[.25,.87],[.73,.94],[.71,.79],[.42,.79],[.34,.73],[.27,.74]],true);}
 }else if(id==='suv'){
  front(M.black,[[-.46,.91],[.46,.91],[.27,.65],[-.27,.65]],'qashqai-v-grille');line(M.chrome,[[-.32,.91],[-.18,.68],[.18,.68],[.32,.91]],F-.008,.025);front(M.black,[[-.52,.53],[.52,.53],[.64,.30],[-.64,.30]],'qashqai-lower-intake');
  for(const s of [-1,1]){lamp(s,[[.38,.91],[.77,.97],[.76,.78],[.54,.72]]);lamp(s,[[.32,1.04],[.77,1.16],[.72,.94],[.51,.86]],true);if(!low){const fog=mesh(p,new THREE.CircleGeometry(.05,12),M.head,'fog',`light_f${s<0?'l':'r'}`);fog.position.set(s*.68,.39,faceZ(s*.68,F-.012,.39));fog.rotation.y=Math.PI;}}
 }else if(id==='taxi'||id==='taxi_superb'){
  const sup=id==='taxi_superb';front(M.black,[[-.38,.84],[-.27,.89],[.27,.89],[.38,.84],[.30,.64],[-.30,.64]],'skoda-shield-grille');line(M.chrome,[[-.38,.84],[-.27,.89],[.27,.89],[.38,.84],[.30,.64],[-.30,.64],[-.38,.84]],F-.007,.010);front(M.black,[[-.69,.44],[.69,.44],[.63,.29],[-.63,.29]],'skoda-lower-intake');
  if(!low)for(let i=-6;i<=6;i++)line(M.chrome,[[i*.046,.68],[i*.048,.835]],F-.01,.005);
  for(const s of [-1,1]){lamp(s,sup?[[.41,.86],[.79,.91],[.77,.73],[.40,.71]]:[[.42,.83],[.78,.88],[.76,.73],[.47,.69]]);lamp(s,sup?[[.35,.94],[.80,1.01],[.76,.80],[.44,.79],[.37,.84]]:[[.28,.93],[.78,1.00],[.76,.85],[.46,.83],[.34,.78]],true);}
 }else if(id==='byd_dolphin'){
  front(M.black,[[-.62,.56],[.62,.56],[.52,.30],[-.52,.30]],'dolphin-smile-intake');line(M.chrome,[[-.63,.83],[0,.85],[.63,.83]],F-.006,.012);
  for(const s of [-1,1]){lamp(s,[[.28,.83],[.70,.88],[.71,.72],[.47,.68],[.34,.72]]);lamp(s,[[.39,1.02],[.70,1.04],[.69,.89],[.40,.90]],true);}line(M.tail,[[-.67,.98],[0,.97],[.67,.98]],R+.008,.025,'light_rl');
 }else{
  front(M.chrome,[[-.66,.90],[.66,.90],[.53,.84],[-.53,.84]],'atto-dragon-face');front(M.black,[[-.55,.49],[.55,.49],[.67,.27],[-.67,.27]],'atto-lower-intake');
  for(const s of [-1,1]){lamp(s,[[.35,.91],[.78,.96],[.77,.83],[.43,.83]]);lamp(s,[[.38,1.07],[.79,1.09],[.76,.95],[.42,.96]],true);}line(M.tail,[[-.74,1.04],[0,1.04],[.74,1.04]],R+.008,.022,'light_rl');
 }
 // Small physical emblem, plate recess, separate reflective plate faces.
 const badge=mesh(p,new THREE.CircleGeometry(id==='city'?.034:.045,low?8:20),M.chrome,'manufacturer-emblem');badge.position.set(0,Math.min(h+.025,.86),-d.L/2-.017);badge.rotation.y=Math.PI;
 for(const s of [-1,1]){const z=s<0?-d.L/2-.008:d.L/2+.008;box(p,M.black,[.55,.135,.022],[0,s<0?.555:.58,z],'plate-recess',s<0?'bumper_f':'bumper_r');const o=mesh(p,new THREE.PlaneGeometry(.50,.108),M.plate,'registration',s<0?'bumper_f':'bumper_r');o.position.set(0,s<0?.555:.58,z+s*.013);if(s<0)o.rotation.y=Math.PI;}
 if(!low){for(let i=0;i<3;i++)line(M.black,[[-.48,.31+i*.041],[.48,.31+i*.041]],F-.005,.007);line(M.chrome,[[-.28,.82],[.28,.82]],R+.01,.005);}
}
function wheels(car,d,M,low){for(const s of [-1,1])for(const front of [true,false]){const pivot=new THREE.Group(),spin=new THREE.Group();pivot.position.set(s*d.track/2,d.r,(front?-1:1)*d.wb/2+d.ax);pivot.add(spin);car.root.add(pivot);const seg=low?10:24,w=.19;const tyreProfile=[[d.r*.64,-w*.5],[d.r-.025,-w*.5],[d.r-.006,-w*.36],[d.r,-w*.22],[d.r,w*.22],[d.r-.006,w*.36],[d.r-.025,w*.5],[d.r*.64,w*.5]];
 const tire=mesh(spin,low?new THREE.CylinderGeometry(d.r,d.r,w,seg,1):new THREE.LatheGeometry(tyreProfile.map(([x,y])=>new THREE.Vector2(x,y)),seg),M.black,'tyre');tire.rotation.z=Math.PI/2;
 let caliper=null,brakeDisc=null;
 if(low){const rim=mesh(spin,new THREE.CylinderGeometry(d.r*.66,d.r*.66,w+.007,seg,1),M.chrome,'alloy');rim.rotation.z=Math.PI/2;}
 else{const rim=mesh(spin,new THREE.TorusGeometry(d.r*.64,.015,5,24),M.chrome,'alloy-rim');rim.rotation.y=Math.PI/2;rim.position.x=s*(w/2+.004);
 brakeDisc=mesh(spin,new THREE.CylinderGeometry(d.r*.51,d.r*.51,.014,24),M.chrome,'rotating-brake-disc');brakeDisc.rotation.z=Math.PI/2;brakeDisc.position.x=s*.055;
 caliper=box(pivot,M.black,[.054,.112,.064],[s*.066,.018,-d.r*.43],'fixed-brake-caliper');
for(let i=0;i<5;i++){const a=i*Math.PI*2/5;rod(spin,M.chrome,[s*(w/2+.009),Math.sin(a)*.045,Math.cos(a)*.045],[s*(w/2+.009),Math.sin(a)*d.r*.61,Math.cos(a)*d.r*.61],.021);}const hub=mesh(spin,new THREE.SphereGeometry(.041,8,4),M.chrome,'hub');hub.position.x=s*(w/2+.014);}
 car.wheels.push({pivot,spin,front,r:d.r,side:s,caliper,brakeDisc});}}
export function buildPassengerModel(type,color,rng,opts={}){const id=type.id in PASSENGER_MODELS?type.id:'hatch',d=PASSENGER_MODELS[id],low=!!opts.low,M=palette(color,low),root=new THREE.Group(),body=new THREE.Group();root.add(body);const plate=nextRegistration(!!type.taxi);M.plate=makePlateMaterial(plate);const car={root,body,paint:M.paint,tail:M.tail,wheels:[],plate,materials:M,dims:{L:d.L,W:d.W,H:d.H},shape:d,modelKind:id,spec:{color}};root.name=d.name;skin(car,d,M,low);cabin(car,d,M,low,!!opts.parked,!!opts.playerCabin);fascia(car,d,M,low,id);wheels(car,d,M,low);
 if(!low){const electric=id.startsWith('byd_'),z=(electric?-1:1)*d.wb/2+d.ax+(electric?-.02:.11),y=d.belt-.115;const flap=[[z-.082,y-.071],[z-.082,y+.071],[z+.082,y+.071],[z+.082,y-.071],[z-.082,y-.071]].map(([zz,yy])=>[passengerSideX(d,zz,yy)+.003,yy,zz]);chain(body,M.black,flap,.0025);if(!electric){const rear=d.L/2,x=-d.W*.28;box(body,M.black,[.115,.045,.17],[x,.206,rear-.17],'exhaust-recess','bumper_r');const pipe=mesh(body,new THREE.CylinderGeometry(.035,.035,.22,12,1,true),M.chrome,'exhaust-pipe','bumper_r');pipe.rotation.x=Math.PI/2;pipe.position.set(x,.167,rear-.16);const exit=mesh(body,new THREE.CircleGeometry(.030,12),M.black,'exhaust-outlet','bumper_r');exit.position.set(x,.167,rear-.047);const lip=mesh(body,new THREE.TorusGeometry(.0325,.0035,5,12),M.chrome,'exhaust-lip','bumper_r');lip.position.copy(exit.position);}}

 if(type.taxi){box(body,M.black,[.43,.035,.19],[0,d.H+.005,.12],'taxi-sign-mount');box(body,M.led,[.38,.11,.15],[0,d.H+.075,.12],'taxi-sign');if(!low){const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const c=canvas.getContext('2d');c.fillStyle='#fff4ba';c.fillRect(0,0,256,64);c.fillStyle='#181812';c.font='bold 48px Arial';c.textAlign='center';c.fillText('TAXI',128,50);const t=new THREE.CanvasTexture(canvas),mat=new THREE.MeshStandardMaterial({map:t});const o=mesh(body,new THREE.PlaneGeometry(.35,.088),mat,'taxi-label');o.position.set(0,d.H+.075,.043);o.rotation.y=Math.PI;}}
 root.traverse(o=>{if(o.isMesh){o.castShadow=!low;o.receiveShadow=true;}});seatMirrors(car);return car;}
