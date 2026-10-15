// W168 facelift SWB. Original metre-scale surfaces, nose -Z; no photo textures.
// Mercedes dimensions, tyres and facelift photographs: tools/mercedes-model-notes.md.
import * as THREE from 'three';
const mix=THREE.MathUtils.lerp,clamp=THREE.MathUtils.clamp;
export function buildA160(car,d,M,low,plate,H){
  const {surface,patch,box,line,mesh,ring,cabinFittings,makePlateMaterial}=H;
  const p=car.body,F=-d.L/2,R=d.L/2,W=d.W/2,bw=W-.095,rw=W-.19;
  const profile=(a,z)=>{for(let i=1;i<a.length;i++)if(z<=a[i][0]){const u=clamp((z-a[i-1][0])/(a[i][0]-a[i-1][0]),0,1);return mix(a[i-1][1],a[i][1],u*u*(3-2*u));}return a.at(-1)[1];};
  const top=z=>profile([[F,.75],[F+.22,.81],[d.cowl,.96],[.5,.99],[R,.99]],z);
  const width=z=>profile([[F,.75],[F+.28,.82],[-1.10,W],[1.25,W],[R,.77]],z);
  const side=(z,y)=>width(z)-.052*(1-clamp((y-.22)/(top(z)-.22),0,1))**4-.018*clamp((y-.22)/(top(z)-.22),0,1)**6;
  // End corners and high headlamp tips wrap back onto the bonnet, never float above it.
  const faceZ=(x,z,y)=>{let out=z+Math.sign(-z)*(.16*(Math.abs(x)/W)**4+.10*(1-clamp((y-.22)/.32,0,1))**2);if(z<0&&y>deck(x,F)-.004){let lo=F,hi=d.cowl;for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(deck(x,mid)<y-.004)lo=mid;else hi=mid;}out=Math.max(out,hi+z-F);}return out;};
  const deck=(x,z)=>top(z)+.025*(1-(x/width(z))**2);
  const longitudinal=(x,z,y)=>mix(z,faceZ(x,z,y),clamp((Math.abs(z)-(d.L/2-.36))/.36,0,1)**2);
  const sideGlass=M.glass.clone();sideGlass.color.set('#30434c');sideGlass.opacity=.40;sideGlass.userData.playerGlass=true;
  const rearGlass=sideGlass.clone();rearGlass.opacity=.78;
  const rail=z=>profile([[d.header,1.53],[.0,1.55],[1.05,1.55],[d.roofBack,1.51]],z);
  const belt=z=>profile([[d.cowl,.974],[.2,.99],[d.back,1.015]],z);
  const panePoint=(z,v,s)=>[s*mix(bw,rw,v),mix(belt(z),rail(z)-.025,v),z];
  car.mercedesSurface=car.playerSurface={top,side,deck,width,face:faceZ};
  for(const s of [-1,1]){
    const arch=d.r+.048;
    surface(p,M.paint,(u,v)=>{const z=mix(F,R,u);let bottom=.22;for(const a of [-d.wb/2,d.wb/2])if(Math.abs(z-a)<arch)bottom=Math.max(bottom,d.r+Math.sqrt(arch**2-(z-a)**2));const y=mix(bottom,top(z),v);const x=s*side(z,y);return[x,y,longitudinal(x,z,y)];},low?70:120,10,'body-side');
    for(const a of [-d.wb/2,d.wb/2]){
      const pts=Array.from({length:33},(_,i)=>{const t=i*Math.PI/32,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);return[s*(side(z,y)+.002),y,z];});line(p,M.paint,pts,.009);
      surface(p,M.black,(u,v)=>{const t=u*Math.PI,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);return[s*mix(d.track/2-.13,side(z,y),v),y,z];},32,2,'wheel-arch-liner');
    }
    surface(p,M.paint,(u,v)=>{const z=mix(d.cowl,d.back,u);return[s*mix(side(z,top(z)),bw,v),mix(top(z),belt(z),v),z];},32,3,'door-shoulder');
    // Thick sills and rubbing strips make the sandwich floor visible in profile.
    box(p,M.black,[.045,.11,d.wb-.64],[s*(W-.040),.285,0],.012,[0,0,0],'side-sill');
    line(p,M.black,Array.from({length:25},(_,i)=>{const z=mix(-.86,1.40,i/24);return[s*(side(z,.62)+.007),.62,z];}),.028,'side-moulding');
    for(const end of [.20,1.16]){
      line(p,M.seam,Array.from({length:25},(_,i)=>{const y=mix(.98,.34,i/24),z=profile([[.34,end-.1],[.56,end+.025],[.98,end]],y);return[s*(side(z,y)+.003),y,z];}),.0025,'door-seam');
      box(p,M.black,[.025,.032,.14],[s*(side(end-.18,.87)+.01),.87,end-.18],.009,[0,0,0],'door-handle');
    }
    const pane=(lo,hi,name)=>surface(p,sideGlass,(u,v)=>panePoint(mix(mix(...lo,v),mix(...hi,v),u),v,s),16,6,name);
    const A0=[s*bw,belt(d.cowl),d.cowl],A1=[s*rw,rail(d.header),d.header];
    patch(p,M.paint,[A0,A1,[s*rw,rail(d.header)-.025,d.header+.07],[s*bw,belt(d.cowl),d.cowl+.07]],'solid-a-pillar');
    // Long triangular front light, short rear door, small quarter light: SWB proportions.
    pane([d.cowl+.075,d.header+.075],[.16,.16],'front-door-glass');
    pane([.215,.215],[1.00,.93],'rear-door-glass');
    pane([1.035,.965],[1.40,1.22],'rear-quarter-glass');
    patch(p,M.black,[panePoint(.16,0,s),panePoint(.16,1,s),panePoint(.215,1,s),panePoint(.215,0,s)],'solid-b-pillar');
    patch(p,M.black,[panePoint(1.00,0,s),panePoint(.93,1,s),panePoint(.965,1,s),panePoint(1.035,0,s)],'quarter-window-divider');
    patch(p,M.paint,[panePoint(1.40,0,s),panePoint(1.22,1,s),[s*rw,rail(d.roofBack),d.roofBack],[s*bw,1.015,d.back]],'solid-c-pillar');
    line(p,M.black,[A0,A1,[s*rw,rail(d.roofBack),d.roofBack],[s*bw,1.015,d.back],A0],.006);
    surface(p,M.paint,(u,v)=>{const z=mix(d.header,d.roofBack,u);return[s*rw,rail(z)-.025*v,z];},24,2,'roof-side-rail');
    box(p,M.black,[.05,.27,2.20],[s*(W-.16),.84,.25],.02,[0,0,0],'door-card');
    car[s<0?'mirrorL':'mirrorR']=mesh(p,new THREE.PlaneGeometry(.18,.085),M.chrome,[s*(W+.10),1.06,d.cowl+.16]);
  }
  surface(p,M.paint,(u,v)=>{const z=mix(F,d.cowl,u),x=(2*v-1)*side(z,top(z));return[x,deck(x,z),longitudinal(x,z,deck(x,z))];},24,16,'bonnet');
  for(const z of [F,R])surface(p,M.paint,(u,v)=>{const x=(2*u-1)*side(z,mix(.22,top(z),v));return[x,mix(.22,deck(x,z),v),faceZ(x,z,mix(.22,deck(x,z),v))];},24,10,z<0?'front-bumper':'rear-bumper');
  box(p,M.black,[d.W*.81,.10,d.L*.85],[0,.25,0],.018,[0,0,0],'undertray');
  // Bonnet and windscreen form a near-continuous wedge into a tall, almost flat roof.
  car.windscreen=surface(p,M.glass,(u,v)=>{const x=2*u-1;return[x*mix(bw,rw,v),mix(.974,rail(d.header),v)+.025*(1-x*x)*v,mix(d.cowl,d.header,v)];},24,10,'windscreen');
  for(const [m,offset,name]of [[M.paint,0,'roof'],[M.cloth,-.018,'headliner']])surface(p,m,(u,v)=>{const x=2*v-1,z=mix(d.header,d.roofBack,u);return[x*rw,rail(z)+.025*(1-x*x)+offset,z];},24,14,name);
  surface(p,rearGlass,(u,v)=>{const x=2*u-1;return[x*mix(rw,bw,v),mix(rail(d.roofBack)+.025*(1-x*x),1.015,v),mix(d.roofBack,d.back,v)];},22,12,'rear-glass');
  surface(p,M.paint,(u,v)=>{const x=2*u-1;return[x*mix(bw,side(R,.99),v),mix(1.015,deck(x*side(R,.99),R),v),mix(d.back,R,v)];},20,3,'boot-hatch-shoulder');
  cabinFittings(car,d,M,low);
  // Raised passenger floor; rear cushions raised to match the front seats.
  for(const s of [-1,1]){const floor=box(p,M.cloth,[(d.W-.26)/2,.14,2.0],[s*(d.W-.26)/4,.47,.32],.012,[0,0,0],'sandwich-floor');floor.userData.damageInterior=true;floor.userData.damageSide=s<0?'left':'right';}
  for(const o of p.children)if(o.position.z>.70&&o.position.y>.40&&o.position.y<1.25&&!['body-side','door-shoulder'].includes(o.name)&&o.material===M.seat)o.position.y+=.08;
  const face=(m,pts,z,name,damage)=>{const o=surface(p,m,(u,v)=>{const x=mix(mix(pts[0][0],pts[1][0],u),mix(pts[3][0],pts[2][0],u),v),y=mix(mix(pts[0][1],pts[1][1],u),mix(pts[3][1],pts[2][1],u),v);return[x,y,faceZ(x,z,y)];},20,8,name);if(damage)o.userData.damagePart=damage;return o;};
  const star=(x,y,z,r)=>{ring(p,M.chrome,r,.003,[x,y,z]);for(let i=0;i<3;i++){const a=Math.PI/2+i*Math.PI*2/3;line(p,M.chrome,[[x,y,z],[x+Math.cos(a)*r*.94,y+Math.sin(a)*r*.94,z]],.003);}};
  face(M.black,[[-.34,.72],[-.30,.55],[.30,.55],[.34,.72]],F-.015,'mercedes-grille');
  line(p,M.chrome,[[-.34,.72,F-.02],[-.30,.55,F-.02],[.30,.55,F-.02],[.34,.72,F-.02],[-.34,.72,F-.02]],.007);
  for(const y of [.59,.635,.68])line(p,M.chrome,[[-.30,y,F-.022],[.30,y,F-.022]],.006);
  star(0,.635,F-.03,.066);
  for(const s of [-1,1])face(M.black,[[s*.30,.53],[s*.71,.53],[s*.72,.43],[s*.30,.43]],F-.012,'bumper-protective-moulding','bumper_f');
  face(M.black,[[-.52,.35],[.52,.35],[.47,.25],[-.47,.25]],F-.014,'lower-grille','bumper_f');
  for(const s of [-1,1]){
    // Slim swept clear facelift optics; no modern LED light signature.
    face(M.darkAlloy,[[s*.37,.72],[s*.72,.82],[s*.77,.66],[s*.43,.60]],F-.02,'headlamp-housing','light_f'+(s<0?'l':'r'));
    face(M.chrome,[[s*.38,.714],[s*.712,.810],[s*.76,.663],[s*.438,.610]],F-.026,'headlamp-lens','light_f'+(s<0?'l':'r'));
    face(M.alloy,[[s*.43,.699],[s*.70,.776],[s*.70,.768],[s*.43,.691]],F-.031,'headlamp-divider','light_f'+(s<0?'l':'r'));
    for(const [cx,cy]of [[.48,.657],[.64,.704]]){const lamp=surface(p,M.head,(u,v)=>{const a=u*Math.PI*2,x=s*(cx+.027*Math.cos(a)*v),y=cy+.027*Math.sin(a)*v;return[x,y,faceZ(x,F-.034,y)];},16,3,'headlamp-bulb');lamp.userData.damagePart='light_f'+(s<0?'l':'r');}
    face(M.red,[[s*.66,.99],[s*.75,1.00],[s*.77,.61],[s*.58,.61]],R+.012,'rear-lamp-housing','light_r'+(s<0?'l':'r'));
    face(M.chrome,[[s*.645,.87],[s*.755,.88],[s*.76,.82],[s*.63,.82]],R+.018,'clear-tail-lens','light_r'+(s<0?'l':'r'));
    face(M.chrome,[[s*.62,.75],[s*.765,.75],[s*.77,.70],[s*.60,.70]],R+.018,'clear-tail-lens','light_r'+(s<0?'l':'r'));
    line(p,M.tail,[[s*.63,.65,faceZ(s*.63,R+.025,.65)],[s*.745,.65,faceZ(s*.745,R+.025,.65)]],.024).userData.damagePart='light_r'+(s<0?'l':'r');
  }
  face(M.black,[[-.73,.51],[.73,.51],[.74,.38],[-.74,.38]],R+.014,'rear-bumper-moulding','bumper_r');
  line(p,M.black,[[-.28,1.08,d.back-.032],[.22,1.08,d.back-.032]],.008,'rear-wiper');
  line(p,M.tail,[[-.18,1.07,d.back-.005],[.18,1.07,d.back-.005]],.012,'high-brake-light');
  star(0,.90,R+.026,.032);
  box(p,M.black,[.18,.028,.025],[0,.79,R+.025],.005,[0,0,0],'tailgate-handle');
  car.plate=plate;M.plate=makePlateMaterial(plate);
  for(const z of [F,R]){const y=z<0?.435:.635;box(p,M.black,[.535,.124,.016],[0,y,z+Math.sign(z)*.02],.005);mesh(p,new THREE.PlaneGeometry(.51,.108),M.plate,[0,y,z+Math.sign(z)*.032],[0,z<0?Math.PI:0,0],'registration');}
  car.exhaust=[new THREE.Vector3(-.49,.25,R+.03)];
  mesh(p,new THREE.CylinderGeometry(.025,.025,.10,12,1,true),M.darkAlloy,[-.49,.25,R],[Math.PI/2,0,0],'exhaust-outlet');
  // Procedural star also replaces the generic steering-wheel and wheel-centre badge.
  const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#171b20';ctx.fillRect(0,0,128,128);ctx.strokeStyle='#d4dbe0';ctx.lineWidth=5;ctx.beginPath();ctx.arc(64,64,53,0,Math.PI*2);ctx.stroke();for(let i=0;i<3;i++){const a=-Math.PI/2+i*Math.PI*2/3;ctx.beginPath();ctx.moveTo(64,64);ctx.lineTo(64+50*Math.cos(a),64+50*Math.sin(a));ctx.stroke();}const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;M.badge.map?.dispose();M.badge.map=tex;M.badge.needsUpdate=true;
}
