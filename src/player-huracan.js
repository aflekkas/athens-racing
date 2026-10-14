// Huracan EVO: continuous cab-forward canopy and folded wedge surfaces.
// References and measured projection: tools/huracan-model-notes.md. Nose is -Z, metres.
import * as THREE from 'three';
const mix=(a,b,t)=>a+(b-a)*t;
// The shared patch helper is a four-corner bilinear patch. These outlines have 5+ corners.
function polygon(p,m,points,name){
  const vertices=[];for(let i=1;i<points.length-1;i++)vertices.push(...points[0],...points[i],...points[i+1]);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(vertices.length/3*2),2));g.computeVertexNormals();
  const o=new THREE.Mesh(g,m);o.name=name;p.add(o);return o;
}
export function huracanRoof(z,x=0){
  return 1.165-.095*((z-.10)/.72)**2-.036*x*x;
}
export function buildHuracanShell(car,d,M,low,H){
  const {surface,line,patch,box}=H,p=car.body,F=-d.L/2,R=d.L/2;
  const section=z=>{const a=d.stations;for(let i=1;i<a.length;i++)if(z<=a[i][0]){const t=Math.max(0,(z-a[i-1][0])/(a[i][0]-a[i-1][0]));return[mix(a[i-1][1],a[i][1],t),mix(a[i-1][2],a[i][2],t)];}return a.at(-1).slice(1);};
  const bottom=z=>z<-1.75?mix(.13,.22,(-z-1.75)/.51):z>1.35?mix(.13,.40,(z-1.35)/.91):.13;
  const side=(z,y)=>{const [w,h]=section(z);const v=Math.max(0,Math.min(1,(y-bottom(z))/(h-bottom(z))));return w-.06*(1-v)-.055*Math.sin(v*Math.PI);};
  const deck=(x,z)=>{const [w,h]=section(z);return h-.105*(1-Math.min(1,Math.abs(x)/w)**2)*(z<d.cowl?Math.sin(Math.PI*(z-F)/(d.cowl-F)):0);};
  const intake=[[.20,.19],[.30,.30],[.66,.43],[.87,.28],[.83,.17],[.33,.16]];
  const cut=z=>{const hits=[];for(let i=0;i<intake.length;i++){const a=intake[i],b=intake[(i+1)%intake.length];if(z>=Math.min(a[0],b[0])&&z<Math.max(a[0],b[0]))hits.push(mix(a[1],b[1],(z-a[0])/(b[0]-a[0])));}return hits.length>1?[Math.min(...hits),Math.max(...hits)]:[bottom(z),bottom(z)];};
  car.playerSurface={top:z=>section(z)[1],side,deck};
  for(const s of [-1,1]){
    const arch=d.r+.027;
    const floor=z=>{let y=bottom(z);for(const a of [-d.wb/2+d.axleOffset,d.wb/2+d.axleOffset])if(Math.abs(z-a)<arch)y=Math.max(y,d.r+Math.sqrt(arch*arch-(z-a)**2));return y;};
    for(const lower of [false,true])surface(p,M.paint,(u,v)=>{const z=mix(F,R,u),b=floor(z),[lo,hi]=cut(z);const y=lower?mix(b,Math.max(b,lo),v):mix(Math.max(b,hi),section(z)[1],v);return[s*side(z,y),y,z];},low?140:260,8,lower?'evo-lower-fold':'body-side');
    for(const a of [-d.wb/2+d.axleOffset,d.wb/2+d.axleOffset]){
      const pts=[];for(let i=0;i<=48;i++){const t=i*Math.PI/48,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);pts.push([s*(side(z,y)+.002),y,z]);}line(p,M.paint,pts,.009,'evo-arch-lip');
      surface(p,M.black,(u,v)=>{const t=u*Math.PI,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);return[s*mix(d.track/2-.13,side(z,y),v),y,z];},32,2,'wheelarch-liner');
    }
    const lip=intake.map(([z,y])=>[s*side(z,y),y,z]);
    const inset=intake.map(([z,y])=>[s*(side(z,y)-.085),y,z]);
    polygon(p,M.black,inset,'evo-side-intake');
    for(let i=0;i<6;i++)patch(p,i===2?M.paint:M.darkAlloy,[lip[i],lip[(i+1)%6],inset[(i+1)%6],inset[i]],'evo-intake-depth');
    line(p,M.paint,[...lip,lip[0]],.012,'evo-intake-hex-rim');
    const seam=[[-1.00,.80],[-.93,.67],[-.91,.17],[.28,.17],[.52,.28],[.64,.66],[.52,.82]];
    line(p,M.seam,seam.map(([z,y])=>[s*(side(z,y)+.002),y,z]),.0025,'door-seam');
    box(p,M.paint,[.018,.022,.17],[s*(side(.36,.76)+.006),.76,.36],.004,[0,0,0],'flush-door-handle');
    for(const [a,b,y0,y1] of [[-1.01,.80,.80,.90],[-.89,.23,.20,.17]]){const pts=[];for(let i=0;i<=30;i++){const z=mix(a,b,i/30),y=mix(y0,y1,i/30);pts.push([s*(side(z,y)+.004),y,z]);}line(p,M.paint,pts,.007,'evo-shoulder-crease');}
    surface(p,M.paint,(u,v)=>{const z=mix(d.cowl,d.back,u),h=section(z)[1];return[s*mix(side(z,h),.80,v),mix(h,.805,v),z];},42,3,'door-shoulder');
    box(p,M.black,[.095,.028,1.95],[s*.88,.125,.02],.006,[0,0,0],'evo-sill');
  }
  for(const [a,b,name]of [[F,d.cowl,'bonnet'],[d.back,R,'boot']])surface(p,M.paint,(u,v)=>{const z=mix(a,b,u),x=(2*v-1)*section(z)[0];return[x,deck(x,z),z];},48,28,name);
  for(const z of [F,R])surface(p,M.paint,(u,v)=>{const x=(2*u-1)*section(z)[0],y=mix(bottom(z),deck(x,z),v);return[x,y,z];},30,8,z<0?'front-bumper':'rear-bumper');
  box(p,M.black,[1.60,.04,3.9],[0,.15,0],.009,[0,0,0],'undertray');
  for(const s of [-1,1]){const pts=[];for(let i=0;i<=30;i++){const z=mix(F+.15,d.cowl,i/30),x=s*mix(.28,.55,i/30);pts.push([x,deck(x,z)+.003,z]);}line(p,M.seam,pts,.002,'evo-bonnet-crease');}
  return {section,side,deck};
}
export function buildHuracanCabin(car,d,M,low,H){
  const {surface,patch,line,box,mesh,cabinFittings}=H,p=car.body;
  const edge=(z,s)=>[s*.71,huracanRoof(z,1),z];
  const glass=surface(p,M.glass,(u,v)=>{const x=2*u-1;const z=mix(d.cowl,d.header,v)-.035*(1-x*x)*(1-v);return[x*mix(.80,.71,v),mix(.805,huracanRoof(d.header,x),v),z];},24,10,'windscreen');car.windscreen=glass;
  surface(p,M.paint,(u,v)=>{const x=2*v-1,z=mix(d.header,d.roofBack,u);return[x*.71,huracanRoof(z,x),z];},36,24,'roof');
  surface(p,M.black,(u,v)=>{const x=2*v-1,z=mix(d.header,d.roofBack,u);return[x*.707,huracanRoof(z,x)-.019,z];},20,12,'evo-roof-lining');
  surface(p,M.glass,(u,v)=>{const x=2*u-1,z=mix(d.roofBack,d.back,v);return[x*mix(.71,.69,v),mix(huracanRoof(d.roofBack,x),.98,v),z];},22,12,'rear-glass');
  for(const s of [-1,1]){
    const A=[s*.80,.805,d.cowl],B=edge(d.header,s),D=[s*.82,.85,1.03];
    const top=[];for(let i=0;i<=20;i++)top.push(edge(mix(d.header,d.roofBack,i/20),s));
    const outline=[A,...top,D,[s*.82,.84,.67]];
    polygon(p,M.glass,outline,'front-door-glass');line(p,M.black,[...outline,A],.012,'evo-window-seal');
    line(p,M.paint,[A,B],.022,'solid-a-pillar');line(p,M.paint,top,.020,'evo-roof-rail');
    polygon(p,M.paint,[edge(d.roofBack,s),[s*.60,huracanRoof(d.roofBack,.85),d.roofBack-.02],[s*.69,.98,d.back],[s*.88,.98,1.38],D],'solid-c-pillar');
    line(p,M.black,[[s*.79,.838,.59],[s*.71,huracanRoof(.48,1)-.008,.48]],.016,'evo-window-divider');
    line(p,M.black,[[s*.06,.831,d.cowl],[s*.46,.825,d.cowl-.022]],.007,'wiper');
    box(p,M.black,[.18,.027,.05],[s*.91,.83,-.86],.008,[0,0,s*-.18],'mirror-stalk');
    box(p,M.paint,[.25,.09,.13],[s*1.055,.88,-.86],.027,[0,s*.1,0],'mirror-housing');
    box(p,M.black,[.228,.074,.008],[s*1.055,.88,-.792],.015);
    car[s<0?'mirrorL':'mirrorR']=mesh(p,new THREE.PlaneGeometry(.21,.064),M.chrome,[s*1.055,.88,-.784],[0,0,0]);
    box(p,M.black,[.045,.24,1.53],[s*.74,.65,-.07],.02);
  }
  cabinFittings(car,d,M,low);
}
