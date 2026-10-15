// W168 facelift SWB. Original metre-scale surfaces, nose -Z; no photo textures.
// Mercedes dimensions, tyres and facelift photographs: tools/mercedes-model-notes.md.
import * as THREE from 'three';
const mix=THREE.MathUtils.lerp,clamp=THREE.MathUtils.clamp;
export function buildA160(car,d,M,low,plate,H){
  const {surface,patch,box,line,mesh,ring,cabinFittings,makePlateMaterial}=H;
  const p=car.body,F=-d.L/2,R=d.L/2,W=d.W/2,bw=W-.095,rw=W-.19;
  const profile=(a,z)=>{for(let i=1;i<a.length;i++)if(z<=a[i][0]){const u=clamp((z-a[i-1][0])/(a[i][0]-a[i-1][0]),0,1);return mix(a[i-1][1],a[i][1],u*u*(3-2*u));}return a.at(-1)[1];};
  // The short bonnet keeps its rake into the screen instead of levelling at the cowl.
  const top=z=>z<d.cowl?mix(.73,1.055,clamp((z-F)/(d.cowl-F),0,1)):profile([[d.cowl,1.055],[.2,.99],[R,.99]],z);
  const width=z=>profile([[F,.75],[F+.28,.82],[-1.10,W],[1.25,W],[R,.77]],z);
  const side=(z,y)=>width(z)-.052*(1-clamp((y-.22)/(top(z)-.22),0,1))**4-.018*clamp((y-.22)/(top(z)-.22),0,1)**6;
  // End corners and high headlamp tips wrap back onto the bonnet, never float above it.
  const faceZ=(x,z,y)=>{let out=z+Math.sign(-z)*(.22*(Math.abs(x)/W)**4+.14*(1-clamp((y-.22)/.34,0,1))**2);if(z<0&&y>deck(x,F)-.004){let lo=F,hi=d.cowl;for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(deck(x,mid)<y-.004)lo=mid;else hi=mid;}out=Math.max(out,hi+z-F);}return out;};
  const deck=(x,z)=>top(z)+.025*(1-(x/width(z))**2);
  const longitudinal=(x,z,y)=>mix(z,faceZ(x,z,y),clamp((Math.abs(z)-(d.L/2-.36))/.36,0,1)**2);
  M.black.color.set('#202427');M.black.roughness=.78;
  M.head.color.set('#c3cdd1');M.head.metalness=.55;M.head.roughness=.12;
  M.glass.color.set('#30434c');M.glass.opacity=.56;
  const sideGlass=M.glass.clone();sideGlass.opacity=.72;sideGlass.userData.playerGlass=true;
  const rearGlass=sideGlass.clone();rearGlass.opacity=.86;
  const rail=z=>profile([[d.header,1.53],[.0,1.55],[1.05,1.55],[d.roofBack,1.51]],z);
  const belt=z=>profile([[d.cowl,1.055],[.2,.99],[1.0,1.08],[1.58,1.06],[d.back,1.015]],z);
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
      box(p,M.black,[.033,.033,.15],[s*(side(end-.18,.87)+.01),.87,end-.18],.014,[0,0,0],'door-handle');
    }
    const pane=(lo,hi,name)=>surface(p,sideGlass,(u,v)=>panePoint(mix(mix(...lo,v),mix(...hi,v),u),v,s),16,6,name);
    const A0=[s*bw,belt(d.cowl),d.cowl],A1=[s*rw,rail(d.header),d.header];
    patch(p,M.paint,[A0,A1,[s*rw,rail(d.header)-.025,d.header+.07],[s*bw,belt(d.cowl),d.cowl+.07]],'solid-a-pillar');
    // Long triangular front light, short rear door, small quarter light: SWB proportions.
    pane([d.cowl+.075,d.header+.075],[.16,.16],'front-door-glass');
    pane([.215,.215],[1.00,.93],'rear-door-glass');
    pane([1.035,.965],[1.58,1.28],'rear-quarter-glass');
    patch(p,M.black,[panePoint(.16,0,s),panePoint(.16,1,s),panePoint(.215,1,s),panePoint(.215,0,s)],'solid-b-pillar');
    patch(p,M.black,[panePoint(1.00,0,s),panePoint(.93,1,s),panePoint(.965,1,s),panePoint(1.035,0,s)],'quarter-window-divider');
    surface(p,M.paint,(u,v)=>{const inner=panePoint(mix(1.58,1.28,v),v,s),outer=[s*mix(bw,rw,v),mix(1.015,rail(d.roofBack),v),mix(d.back,d.roofBack,v)];return inner.map((q,i)=>mix(q,outer[i],u));},12,8,'solid-c-pillar');
    line(p,M.black,[A0,A1,[s*rw,rail(d.roofBack),d.roofBack],[s*bw,1.015,d.back],...Array.from({length:25},(_,i)=>panePoint(mix(d.back,d.cowl,i/24),0,s))],.005);
    surface(p,M.paint,(u,v)=>{const z=mix(d.header,d.roofBack,u);return[s*rw,rail(z)-.025*v,z];},24,2,'roof-side-rail');
    box(p,M.black,[.05,.27,2.20],[s*(W-.16),.84,.25],.02,[0,0,0],'door-card');
    car[s<0?'mirrorL':'mirrorR']=mesh(p,new THREE.PlaneGeometry(.18,.085),M.chrome,[s*(W+.10),1.06,d.cowl+.16]);
  }
  surface(p,M.paint,(u,v)=>{const z=mix(F,d.cowl,u),x=(2*v-1)*side(z,top(z));return[x,deck(x,z),longitudinal(x,z,deck(x,z))];},24,16,'bonnet');
  for(const z of [F,R])surface(p,M.paint,(u,v)=>{const x=(2*u-1)*side(z,mix(.22,top(z),v));return[x,mix(.22,deck(x,z),v),faceZ(x,z,mix(.22,deck(x,z),v))];},24,10,z<0?'front-bumper':'rear-bumper');
  box(p,M.black,[d.W*.81,.10,d.L*.85],[0,.25,0],.018,[0,0,0],'undertray');
  // Bonnet and windscreen form a near-continuous wedge into a tall, almost flat roof.
  car.windscreen=surface(p,M.glass,(u,v)=>{const x=2*u-1;return[x*mix(bw,rw,v),mix(1.055,rail(d.header),v)+.025*(1-x*x),mix(d.cowl,d.header,v)];},24,10,'windscreen');
  // Narrow black scuttle and two conventional wipers at the base of the screen.
  const screenPoint=(x,v)=>[x*mix(bw,rw,v),mix(1.055,rail(d.header),v)+.025*(1-x*x),mix(d.cowl,d.header,v)-.003];
  surface(p,M.black,(u,v)=>screenPoint(2*u-1,v*.075),24,2,'windscreen-scuttle');
  for(const s of [-1,1])line(p,M.black,[screenPoint(s*.83,.095),screenPoint(s*.29,.125),screenPoint(s*.09,.10)],.006);
  for(const [m,offset,name]of [[M.paint,0,'roof'],[M.cloth,-.018,'headliner']])surface(p,m,(u,v)=>{const x=2*v-1,z=mix(d.header,d.roofBack,u);return[x*rw,rail(z)+.025*(1-x*x)+offset,z];},24,14,name);
  surface(p,rearGlass,(u,v)=>{const x=2*u-1;return[x*mix(rw,bw,v),mix(rail(d.roofBack)+.025*(1-x*x),1.015,v),mix(d.roofBack,d.back,v)];},22,12,'rear-glass');
  surface(p,M.paint,(u,v)=>{const x=2*u-1;return[x*mix(bw,side(R,.99),v),mix(1.015,deck(x*side(R,.99),R),v),mix(d.back,R,v)];},20,3,'boot-hatch-shoulder');
  cabinFittings(car,d,M,low);
  // Raised passenger floor; rear cushions raised to match the front seats.
  for(const s of [-1,1]){const floor=box(p,M.cloth,[(d.W-.26)/2,.14,2.0],[s*(d.W-.26)/4,.47,.32],.012,[0,0,0],'sandwich-floor');floor.userData.damageInterior=true;floor.userData.damageSide=s<0?'left':'right';}
  for(const o of p.children)if(o.position.z>.70&&o.position.y>.40&&o.position.y<1.25&&!['body-side','door-shoulder'].includes(o.name)&&o.material===M.seat)o.position.y+=.08;
  const star=(x,y,z,r)=>{ring(p,M.chrome,r,.003,[x,y,z]);for(let i=0;i<3;i++){const a=Math.PI/2+i*Math.PI*2/3;line(p,M.chrome,[[x,y,z],[x+Math.cos(a)*r*.94,y+Math.sin(a)*r*.94,z]],.003);}};
  // Rounded lenses and trim sample the same end surface as the bumper/bonnet.
  const roundedCurve=(points,round=.22)=>{
    const curve=new THREE.Shape(),n=points.length;
    const toward=(a,b)=>[mix(a[0],b[0],round),mix(a[1],b[1],round)];
    curve.moveTo(...toward(points[0],points[1]));
    for(let i=1;i<=n;i++){
      const corner=points[i%n];curve.lineTo(...toward(corner,points[(i-1)%n]));
      curve.quadraticCurveTo(...corner,...toward(corner,points[(i+1)%n]));
    }
    return curve;
  };
  const outline=(m,points,z,name,damage)=>{
    const curve=roundedCurve(points),center=points.reduce((c,q)=>[c[0]+q[0]/points.length,c[1]+q[1]/points.length],[0,0]);
    const o=surface(p,m,(u,v)=>{const q=curve.getPoint(u),x=mix(center[0],q.x,v),y=mix(center[1],q.y,v);return[x,y,faceZ(x,z,y)];},32,8,name);
    if(damage)o.userData.damagePart=damage;return o;
  };
  const trim=(m,points,z,r,damage)=>{const o=line(p,m,points.map(([x,y])=>[x,y,faceZ(x,z,y)]),r);if(damage)o.userData.damagePart=damage;return o;};
  const grille=[[-.335,.715],[-.29,.565],[.29,.565],[.335,.715]];
  outline(M.black,grille,F-.007,'mercedes-grille');
  trim(M.chrome,Array.from({length:49},(_,i)=>{const q=roundedCurve(grille).getPoint(i/48);return[q.x,q.y];}),F-.011,.004);
  for(const y of [.598,.642,.686])trim(M.chrome,Array.from({length:13},(_,i)=>[mix(-.305,.305,i/12),y+.008*(1-(2*i/12-1)**2)]),F-.013,.005);
  star(0,.64,F-.02,.062);
  for(const s of [-1,1])outline(M.black,[[s*.34,.525],[s*.72,.55],[s*.73,.455],[s*.35,.45]],F-.008,'bumper-protective-moulding','bumper_f');
  outline(M.black,[[-.53,.365],[.53,.365],[.48,.275],[-.48,.275]],F-.007,'lower-grille','bumper_f');
  for(const y of [.30,.335])trim(M.darkAlloy,[[-.46,y],[0,y-.003],[.46,y]],F-.011,.003);
  for(const s of [-1,1]){
    // Facelift teardrop optics: broad reflector bowls behind a swept clear cover.
    const pts=[[s*.355,.64],[s*.45,.775],[s*.705,.925],[s*.775,.845],[s*.765,.665],[s*.62,.605]];
    outline(M.black,pts,F-.007,'headlamp-housing','light_f'+(s<0?'l':'r'));
    const lens=pts.map(([x,y])=>[s*.58+(x-s*.58)*.95,.75+(y-.75)*.94]);
    outline(M.head,lens,F-.012,'headlamp-lens','light_f'+(s<0?'l':'r'));
    trim(M.chrome,Array.from({length:49},(_,i)=>{const q=roundedCurve(lens).getPoint(i/48);return[q.x,q.y];}),F-.016,.003,'light_f'+(s<0?'l':'r'));
    for(const [cx,cy,rx,ry]of [[.49,.67,.070,.043],[.68,.735,.053,.060]]){
      const bowl=Array.from({length:25},(_,i)=>{const a=i*Math.PI/12;return[s*(cx+rx*Math.cos(a)),cy+ry*Math.sin(a)];});
      trim(M.chrome,bowl,F-.019,.003,'light_f'+(s<0?'l':'r'));
    }
    trim(M.chrome,[[s*.43,.737],[s*.59,.78],[s*.727,.845]],F-.020,.003,'light_f'+(s<0?'l':'r'));
    outline(M.darkAlloy,Array.from({length:16},(_,i)=>{const a=i*Math.PI/8;return[s*(.64+.064*Math.cos(a)),.335+.047*Math.sin(a)];}),F-.009,'fog-lamp-recess','light_f'+(s<0?'l':'r'));
    outline(M.head,Array.from({length:16},(_,i)=>{const a=i*Math.PI/8;return[s*(.64+.035*Math.cos(a)),.335+.035*Math.sin(a)];}),F-.013,'fog-lamp','light_f'+(s<0?'l':'r'));
    outline(M.red,[[s*.665,.995],[s*.75,.995],[s*.77,.62],[s*.565,.62]],R+.008,'rear-lamp-housing','light_r'+(s<0?'l':'r'));
    outline(M.chrome,[[s*.645,.875],[s*.752,.875],[s*.757,.825],[s*.63,.825]],R+.014,'clear-tail-lens','light_r'+(s<0?'l':'r'));
    outline(M.chrome,[[s*.615,.755],[s*.762,.755],[s*.766,.705],[s*.60,.705]],R+.014,'clear-tail-lens','light_r'+(s<0?'l':'r'));
    trim(M.tail,[[s*.61,.65],[s*.745,.65]],R+.018,.020).userData.damagePart='light_r'+(s<0?'l':'r');
  }
  const rearTrim=surface(p,M.black,(u,v)=>{const x=(2*u-1)*(.73-.018*(2*v-1)**4),y=mix(.405,.51,v);return[x,y,faceZ(x,R+.012,y)];},48,6,'rear-bumper-moulding');rearTrim.userData.damagePart='bumper_r';
  line(p,M.black,[[-.28,1.08,d.back-.032],[.22,1.08,d.back-.032]],.008,'rear-wiper');
  line(p,M.tail,[[-.18,1.07,d.back-.005],[.18,1.07,d.back-.005]],.012,'high-brake-light');
  star(0,.90,R+.026,.032);
  box(p,M.black,[.075,.045,.025],[0,.54,R+.025],.012,[0,0,0],'tailgate-handle');
  car.plate=plate;M.plate=makePlateMaterial(plate);
  for(const z of [F,R]){const y=z<0?.435:.635;box(p,M.black,[.535,.124,.016],[0,y,z+Math.sign(z)*.02],.005);mesh(p,new THREE.PlaneGeometry(.51,.108),M.plate,[0,y,z+Math.sign(z)*.032],[0,z<0?Math.PI:0,0],'registration');}
  car.exhaust=[new THREE.Vector3(-.49,.25,R+.03)];
  mesh(p,new THREE.CylinderGeometry(.025,.025,.10,12,1,true),M.darkAlloy,[-.49,.25,R],[Math.PI/2,0,0],'exhaust-outlet');
  // Procedural star also replaces the generic steering-wheel and wheel-centre badge.
  const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#171b20';ctx.fillRect(0,0,128,128);ctx.strokeStyle='#d4dbe0';ctx.lineWidth=5;ctx.beginPath();ctx.arc(64,64,53,0,Math.PI*2);ctx.stroke();for(let i=0;i<3;i++){const a=-Math.PI/2+i*Math.PI*2/3;ctx.beginPath();ctx.moveTo(64,64);ctx.lineTo(64+50*Math.cos(a),64+50*Math.sin(a));ctx.stroke();}const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;M.badge.map?.dispose();M.badge.map=tex;M.badge.needsUpdate=true;
}
