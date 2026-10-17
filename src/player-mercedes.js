// Original procedural Mercedes surfaces, in metres, nose -Z. No photo textures.
// Dimensions: Mercedes C236 technical data, 2024 CLE 300 4MATIC European coupe.
// https://media.mercedes-benz.fr/decouvrez-la-nouvelle-mercedes-benz-cle/
// https://nd-mediagallery2-public-production.s3.amazonaws.com/215df8a0a2f426ec8e82796a0eaca795/techdata_cle_c236_806_056.pdf
import * as THREE from './vehicle-primitives.js';
import { tintGlass } from './glass-tint.js';
import { buildA160 } from './player-a160.js';

export const MERCEDES_MODELS = {
  // R231 launch roadster, vario-roof stowed; Mercedes brochure dimensions / 19-inch tyres.
  // https://www.baaf-ks.com/upload/models/slclass/brosure/slclassr231_brosur.pdf
  sl65: { mercedes:true,sl:true,amg:true,sculpted:true,open:true,seats:2,mirrorSetback:.10,L:4.631,W:1.877,H:1.314,wb:2.585,track:1.610,trackRear:1.604,axleOffset:-.09,r:.330,rim:.2413,tyreF:.255,tyreR:.285,belt:.89,front:.75,rear:.91,cowl:-.49,header:.06,roofBack:.70,back:1.04,seatZ:.44,seatBase:.37,eyeY:1.04,doors:2,leather:'#80523d' },
  // W168 facelift SWB: Mercedes archive 194914949; 195/50 R15, high sandwich floor.
  a160: { mercedes:true,a160:true,L:3.606,W:1.719,H:1.575,wb:2.423,track:1.503,trackRear:1.452,r:.288,rim:.1905,tyreF:.195,tyreR:.195,belt:.96,front:.69,rear:.99,cowl:-1.22,header:-.39,roofBack:1.34,back:1.68,seatZ:.10,seatBase:.56,eyeY:1.28,doors:4,leather:'#50545c' },
  // H247 dimensions and 19-inch Progressive wheels: Mercedes-Benz PH brochure (refs/gla.pdf).
  // 235/50 R19: https://nd-mediagallery2-public-production.s3.amazonaws.com/2925aea29951c2de6bd34196724709f8/2024_10_h247_15.10.2024_gla_ee.pdf
  gla: { mercedes:true,suv:true,L:4.410,W:1.834,H:1.611,wb:2.729,track:1.605,trackRear:1.606,axleOffset:-.065,r:.358,rim:.241,tyreF:.235,tyreR:.235,belt:1.065,front:.94,rear:1.08,cowl:-.94,header:-.47,roofBack:1.65,back:2.035,hatchGlassY:1.17,seatZ:.18,eyeY:1.245,doors:4,leather:'#343434' },
  // H247 AMG-specific width/track; manufacturer 2020 press kit and MY24 drawings.
  gla45: { mercedes:true,suv:true,amg:true,sculpted:true,L:4.443,W:1.849,H:1.590,wb:2.729,track:1.615,trackRear:1.590,axleOffset:-.065,r:.356,rim:.254,tyreF:.255,tyreR:.255,belt:1.065,front:.88,rear:1.06,cowl:-.94,header:-.37,roofBack:1.52,back:2.035,hatchGlassY:1.17,seatZ:.18,eyeY:1.165,doors:4,leather:'#292b2d' },
  // New 2025 CLA hybrid is C178, sister to electric C174. Mercedes UK technical data.
  cla: { mercedes:true,cla:true,cla118:true,sculpted:true,blackRoof:true,L:4.688,W:1.830,H:1.439,wb:2.729,track:1.605,axleOffset:-.045,r:.334,rim:.241,tyreF:.225,tyreR:.255,belt:1.00,front:.74,rear:1.00,cowl:-.97,header:-.48,roofBack:1.08,back:1.84,seatZ:.21,eyeY:1.065,doors:4,leather:'#c4b5a0' },
  cle: { mercedes:true,sculpted:true,mirrorSetback:.18,L:4.850,W:1.861,H:1.428,wb:2.865,track:1.605,axleOffset:-.12,r:.337,rim:.241,tyreF:.245,tyreR:.275,belt:.98,front:.75,rear:.95,cowl:-.94,header:-.32,roofBack:1.04,back:1.98,seatZ:.20,eyeY:1.080,doors:2,leather:'#875b43' },
};
const mix=THREE.MathUtils.lerp,clamp=THREE.MathUtils.clamp;
const V=p=>new THREE.Vector3(...p);
function sample(points,z){for(let i=1;i<points.length;i++)if(z<=points[i][0]){const a=points[i-1],b=points[i],u=clamp((z-a[0])/(b[0]-a[0]),0,1);return mix(a[1],b[1],u*u*(3-2*u));}return points.at(-1)[1];}


// Monotone cubic longitudinal curves avoid the flat stations / sharp roof corners of
// a box cabin. Coordinates fitted to manufacturer side photographs at wheelbase scale.
function contour(points,z){
  let i=0;while(i<points.length-2&&z>points[i+1][0])i++;
  const a=points[i],b=points[i+1],h=b[0]-a[0],u=clamp((z-a[0])/h,0,1);
  const slope=j=>(points[j+1][1]-points[j][1])/(points[j+1][0]-points[j][0]);
  const tangent=j=>{if(j===0)return slope(0);if(j===points.length-1)return slope(j-1);const l=slope(j-1),r=slope(j);return l*r<=0?0:2*l*r/(l+r);};
  return (2*u**3-3*u*u+1)*a[1]+(u**3-2*u*u+u)*h*tangent(i)+(-2*u**3+3*u*u)*b[1]+(u**3-u*u)*h*tangent(i+1);
}
function sculptedContour(d){
  if(!d.sculpted)return null;
  const F=-d.L/2,R=d.L/2,W=d.W/2;
  if(d.sl){
    // Long power-dome bonnet, rearward two-seat cockpit and short folding-roof deck.
    return {
      belt:z=>contour([[d.cowl,.905],[.35,.92],[d.back,.946]],z),
      rail:()=>d.H-.045,
      top:z=>contour([[F,.75],[F+.33,.82],[-1.30,.875],[d.cowl,.89],[.45,.91],[1.24,.96],[R-.30,.94],[R,.91]],z),
      width:z=>contour([[F,W*.88],[F+.46,W*.99],[-d.wb/2,W],[0,W*.965],[d.wb/2,W],[R-.28,W*.97],[R,W*.88]],z),
      rw:W-.23,bw:W-.115,archGap:.025,grilleY:.615,grilleWidth:.505,grilleHeight:.125,
    };
  }
  if(d.cla){
    // C118 arched glasshouse; shared contour is a procedural approximation.
    // https://media.mercedes-benz.fr/download/a39ec976-adb6-4310-a492-951866f5b9e5/brochure-cla-c174-29-04-2025.pdf
    return {
      belt:z=>contour([[d.cowl,1.012],[.15,1.060],[1.38,1.095],[d.back,1.014]],z),
      rail:z=>contour([[d.header,1.355],[-.02,1.390],[.42,1.408],[.76,1.388],[d.roofBack,1.336]],z),
      top:z=>contour([[F,.74],[F+.30,.82],[d.cowl,.996],[.10,1.035],[d.wb/2,1.065],[R,1.00]],z),
      width:z=>contour([[F,W*.85],[F+.48,W*.985],[-d.wb/2,W],[0,W*.969],[d.wb/2,W],[R-.26,W*.96],[R,W*.85]],z),
      rw:W-.25,bw:W-.072,archGap:.022,grilleY:.64,grilleWidth:.555,grilleHeight:.127,
    };
  }
  if(d.doors===2){
    // C236 Mercedes press side view 23C0191_005: continuous coupe arch and long C-pillar.
    // https://content.presspage.com/uploads/1896/58340d17-a98d-40ae-ad00-f75247a9d9e3/23c0191-005.jpg
    return {
      belt:z=>contour([[d.cowl,.985],[.30,1.025],[1.28,1.060],[d.back,.994]],z),
      rail:z=>contour([[d.header,1.325],[.06,1.369],[.43,1.384],[.75,1.354],[d.roofBack,1.301]],z),
      top:z=>contour([[F,.75],[F+.32,.83],[d.cowl,.973],[.10,1.001],[d.wb/2,1.044],[R,.95]],z),
      width:z=>contour([[F,W*.85],[F+.50,W*.985],[-d.wb/2,W],[0,W*.970],[d.wb/2,W],[R-.3,W*.97],[R,W*.855]],z),
      rw:W-.25,bw:W-.078,archGap:.020,grilleY:.594,grilleWidth:.53,grilleHeight:.121,
    };
  }
  const belt=z=>contour([[d.cowl,1.055],[0,1.140],[1.15,1.240],[1.55,1.290],[d.back,d.hatchGlassY]],z);
  const rail=z=>contour([[d.header,1.435],[.12,1.545],[.65,1.545],[1.1,1.505],[d.roofBack,1.43]],z);
  const top=z=>contour([[F,d.front],[F+.28,.955],[d.cowl,1.04],[.15,1.075],[d.wb/2,1.15],[R,d.rear]],z);
  const width=z=>contour([[F,W*.91],[F+.44,W*.985],[-d.wb/2,W],[0,W*.975],[d.wb/2,W],[R-.30,W*.985],[R,W*.88]],z);
  return {belt,rail,top,width,rw:W-.255,bw:W-.095,archGap:.030,grilleY:.67,grilleWidth:.555,grilleHeight:.112};
}

// All deck, seam, arch and fascia points sample the same shell functions.
export function mercedesSurface(d){
  const F=-d.L/2,R=d.L/2,W=d.W/2,C=sculptedContour(d);
  const top=C?.top||(z=>sample([[F,d.front],[F+.35,d.front+.085],[d.cowl,d.belt],[.35,d.belt+.015],[d.wb/2,d.belt+.055],[R,d.rear]],z));
  const width=C?.width||(z=>sample([[F,W*.86],[F+.38,W*.97],[-d.wb/2+(d.axleOffset||0),W],[0,W*.975],[d.wb/2,W],[R-.25,W*.96],[R,W*.88]],z));
  // H247 press side/rear views: full hatch quarter and pronounced AMG fender shoulders.
  // https://content.presspage.com/uploads/1896/20c0325-008.jpg (side)
  // https://content.presspage.com/uploads/1896/20c0325-002.jpg (rear)
  const flare=(z,y)=>d.amg?(d.sl?.018:.052)*Math.max(...[-d.wb/2+(d.axleOffset||0),d.wb/2+(d.axleOffset||0)].map(a=>Math.exp(-(((Math.hypot(z-a,y-d.r)-(d.r+.085))/.12)**2)))):0;
  const side=(z,y)=>{const t=clamp((y-.19)/(top(z)-.19),0,1);if(C)return width(z)-.075*(1-t)**3-.062*t**5-.065*Math.exp(-(((t-.42)/.19)**2))+.027*Math.exp(-(((z-(d.wb/2+ (d.axleOffset||0)))/.5)**2))*Math.sin(Math.PI*t)+flare(z,y)*.64;return width(z)-.060*(1-t)**4-.018*t**6-.021*Math.sin(t*Math.PI*2)-(d.amg?.036:0)+flare(z,y);};
  const deck=(x,z)=>{const t=x/width(z),bulge=z<d.cowl?(d.sculpted&&d.doors===2?(d.sl?.055:.032)*Math.sin(Math.PI*clamp((z-F)/(d.cowl-F),0,1))**.5*Math.exp(-(((Math.abs(t)-.45)/.13)**2)):.012*Math.exp(-(((Math.abs(t)-.58)/.10)**2))):0;return top(z)+.036*(1-t*t)+bulge;};
  const face=(x,z,y)=>z+Math.sign(-z)*((C?.22:.13)*(Math.abs(x)/(W*.88))**3+((d.suv||C)?
    sample([[.19,C&&!d.suv?.30:.18],[.36,C&&!d.suv?.10:.045],[.63,0],[.83,.025],[top(z),.105]],y):.025*(1-clamp((y-.18)/.5,0,1))));
  const longitudinal=(x,z,y)=>mix(z,face(x,z,y),clamp((Math.abs(z)-(d.L/2-.36))/.36,0,1)**2);
  // Upper lamp lenses sweep back onto the curved bonnet instead of floating over its edge.
  const lightFace=(x,z,y)=>{
    if(!C||z>0||y<deck(x,F)-.006)return face(x,z,y);
    let a=F,b=d.cowl;for(let i=0;i<14;i++){const m=(a+b)/2;if(deck(x,m)<y-.006)a=m;else b=m;}
    return Math.max(face(x,z,y),b);
  };
  return {top,width,side,deck,face,lightFace,longitudinal,contour:C};
}

export function buildMercedes(car,d,M,low,plate,H){
  if(d.a160)return buildA160(car,d,M,low,plate,H);
  const {mesh,box,line,surface,patch,ring,cabinFittings,makePlateMaterial}=H;
  const p=car.body,F=-d.L/2,R=d.L/2,W=d.W/2,ax=d.axleOffset||0,S=mercedesSurface(d),C=S.contour,arch=d.r+(C?.archGap||.055);
  const suv=!!d.suv,amg=!!d.amg,cla=!!d.cla;
  car.mercedesSurface=S;
  const rearGlass=(suv||C)?M.glass.clone():M.glass;if(suv||C){tintGlass(rearGlass,'privacy');rearGlass.envMapIntensity=.5;rearGlass.userData.playerGlass=true;}
  const screenGlass=M.glass;
  const windowBelt=C?.belt||(z=>suv?sample([[d.cowl,d.belt+.024],[.35,d.belt+.038],[1.5,d.hatchGlassY-.016],[d.back,d.hatchGlassY]],z):d.belt+.024);
  for(const s of [-1,1]){
    surface(p,M.paint,(u,v)=>{const z=mix(F,R,u);let bottom=.19;for(const a of [-d.wb/2+ax,d.wb/2+ax])if(Math.abs(z-a)<arch)bottom=Math.max(bottom,d.r+Math.sqrt(arch*arch-(z-a)**2));const y=mix(bottom,S.top(z),v);const x=s*S.side(z,y);return[x,y,S.longitudinal(x,z,y)];},C?128:suv?128:160,(suv||C)?10:12,'body-side');
    for(const a of [-d.wb/2+ax,d.wb/2+ax]){
      const points=[];for(let i=0;i<=40;i++){const t=i*Math.PI/40,z=a+arch*Math.cos(t),y=d.r+arch*Math.sin(t);points.push([s*(S.side(z,y)+.002),y,z]);}
      line(p,suv?M.black:M.paint,points,suv?(amg?.020:.027):.012);
      if(amg&&!d.sl)surface(p,M.paint,(u,v)=>{const t=u*Math.PI,z=a+(arch+.095*v)*Math.cos(t),y=d.r+(arch+.095*v)*Math.sin(t);return[s*(S.side(z,y)+.012*Math.sin(v*Math.PI)),y,z];},40,4,'amg-wide-arch');
      surface(p,M.black,(u,v)=>{const t=u*Math.PI,z=a+(arch-.006)*Math.cos(t),y=d.r+(arch-.006)*Math.sin(t);return[s*mix(d.track/2-.14,S.side(z,y)-.012,v),y,z];},32,4,'wheel-arch-liner');
    }
    surface(p,M.paint,(u,v)=>{const z=mix(d.cowl,d.back,u);return[s*mix(S.side(z,S.top(z)),C?.bw??W-.135,v),mix(S.top(z),(suv||C)?windowBelt(z):d.belt+.014,v)+.012*Math.sin(v*Math.PI),z];},C?40:56,C?6:8,'door-shoulder');
    const ends=d.doors===2?[.79]:[.36,1.27];
    for(const end of ends){
      const curve=new THREE.CatmullRomCurve3([[end,d.belt-.01],[end+.025,.66],[end-.035,.31],[end-.19,.285]].map(([z,y])=>new THREE.Vector3(0,y,z)));
      line(p,M.seam,curve.getPoints(32).map(q=>[s*(S.side(q.z,q.y)+.002),q.y,q.z]),.0022);
      const handleY=C?windowBelt(end-.17)-.12:d.belt-.12;box(p,cla?M.paint:M.chrome,[.023,.030,.16],[s*(S.side(end-.17,handleY)+.008),handleY,end-.17],.009,[0,0,0],'door-handle');
    }
    const sill=[];for(let i=0;i<=24;i++){const z=mix(-d.wb/2+ax+.40,d.wb/2+ax-.40,i/24);sill.push([s*(S.side(z,.25)+.004),.25,z]);}line(p,M.black,sill,suv?.039:.024);
    // Taut upper character line dissolves into the long coupe door.
    const crease=[];for(let i=0;i<=32;i++){const z=mix(F+.34,R-.26,i/32),y=S.top(z)-.065;crease.push([s*(S.side(z,y)+(suv?.007:.0015)),y,z]);}line(p,M.paint,crease,suv?.002:.004);
  }
  for(const [a,b,name]of (suv?[[F,d.cowl,'bonnet']]:[[F,d.cowl,'bonnet'],[d.back,R,'boot']]))surface(p,M.paint,(u,v)=>{const z=mix(a,b,u),x=(2*v-1)*S.side(z,S.top(z));return[x,S.deck(x,z),S.longitudinal(x,z,S.top(z))];},C?36:48,C?20:24,name);
  // Rounded end surfaces, shared with the lamp/grille attachment projection.
  for(const z of [F,R])surface(p,M.paint,(u,v)=>{const y=mix(.19,S.top(z),v),x=(2*u-1)*S.side(z,y);return[x,y+.036*(1-(2*u-1)**2)*v**8,S.face(x,z,y)];},40,suv?20:12,z<0?'front-bumper':'rear-bumper');
  box(p,M.black,[d.W*.81,.07,d.L*.88],[0,.19,0],.015,[0,0,0],'undertray');
  for(const s of [-1,1]){const pts=[];for(let i=0;i<=24;i++){const z=mix(F+.13,d.cowl-.02,i/24),x=s*S.width(z)*.69;pts.push([x,S.deck(x,z)+.002,z]);}line(p,M.seam,pts,.002);}

  // Shared roof/glass perimeter. Solid painted A/C pillars and a recessed B pillar.
  const rw=C?.rw??W-(suv?.21:.245),bw=C?.bw??W-.135;
  const oldRoof=(u,x)=>d.H-.075+.04*Math.sin(Math.PI*u)-(suv?.050*u**3:0)+(mix(.018,.012,u)+.023*Math.sin(Math.PI*u))*(1-x*x);
  const railY=C?.rail||(z=>{const u=clamp((z-d.header)/(d.roofBack-d.header),0,1);return d.H-.075+.04*Math.sin(Math.PI*u)-(suv?.050*u**3:0);});
  const roof=(u,x)=>C?railY(mix(d.header,d.roofBack,u))+(mix(.018,.012,u)+.028*Math.sin(Math.PI*u))*(1-x*x):oldRoof(u,x);
  const glassX=(v)=>mix(bw,rw,v)+(C?.016*Math.sin(Math.PI*v):0);
  car.windscreen=surface(p,screenGlass,(u,v)=>{const x=2*u-1;return[x*glassX(v),mix(C?windowBelt(d.cowl):d.belt+.014,railY(d.header),v)+.018*(1-x*x),mix(d.cowl,d.header,v)-.045*(1-x*x)];},24,10,'windscreen');
  if(!d.open){
  surface(p,rearGlass,(u,v)=>{const x=2*u-1;return[x*mix(rw,bw,v),mix(railY(d.roofBack),suv?d.hatchGlassY:C?windowBelt(d.back):d.belt+.014,v)+.012*(1-x*x),mix(d.roofBack,d.back,v)];},22,12,'rear-glass');
  if(suv)surface(p,M.paint,(u,v)=>{const x=2*u-1,y=mix(d.hatchGlassY+.012*(1-x*x),S.top(R)+.036*(1-x*x),v);return[x*mix(bw,S.side(R,S.top(R)),v),y,mix(d.back,S.face(x*S.side(R,S.top(R)),R,S.top(R)),v)];},24,8,'boot-hatch-shoulder');
  surface(p,cla&&!C?M.black:M.paint,(u,v)=>{const x=2*v-1;return[x*rw,roof(u,x),mix(d.header,d.roofBack,u)-.045*(1-x*x)*(1-u)];},30,20,'roof');
  }else{
    if(d.sl){
      surface(p,M.paint,(u,v)=>{const x=2*u-1;return[x*rw,railY(d.header)+.018*(1-x*x)+.008*Math.sin(v*Math.PI),d.header-.045*(1-x*x)+mix(-.018,.065,v)];},24,3,'sl-header-rail');
      surface(p,M.paint,(u,t)=>{const x=2*u-1,v=mix(.90,1,t);return[x*glassX(v),mix(windowBelt(d.cowl),railY(d.header),v)+.018*(1-x*x),mix(d.cowl,d.header,v)-.045*(1-x*x)-.003];},24,2,'sl-header-brow');
      line(p,M.black,Array.from({length:25},(_,i)=>{const x=2*i/24-1;return[x*rw,railY(d.header)-.014+.018*(1-x*x),d.header-.045*(1-x*x)+.058];}),.013);
    }else line(p,M.black,[[-rw,railY(d.header),d.header],[0,railY(d.header)+.018,d.header-.045],[rw,railY(d.header),d.header]],.019);
    box(p,M.cloth,[d.W*.77,.12,.22],[0,d.belt+.065,d.back+.06],.035,[0,0,0],'folded-roof-cover');
    for(const s of [-1,1])line(p,M.alloy,[[s*.40-.12,d.belt+.04,d.back-.10],[s*.40-.12,d.belt+.27,d.back-.10],[s*.40,d.belt+.30,d.back-.10],[s*.40+.12,d.belt+.27,d.back-.10],[s*.40+.12,d.belt+.04,d.back-.10]],.022);
  }
  for(const s of [-1,1]){
    if(!d.open){
    const a0=[s*bw,C?windowBelt(d.cowl):d.belt+.014,d.cowl],a1=[s*rw,railY(d.header),d.header];
    const c0=[s*bw,suv?d.hatchGlassY:C?windowBelt(d.back):d.belt+.014,d.back],c1=[s*rw,railY(d.roofBack),d.roofBack];
    const ai0=[s*bw,C?windowBelt(d.cowl+.065):d.belt+.02,d.cowl+.065],ai1=[s*rw,railY(d.header+.065)-.038,d.header+.065];
    const cz0=d.back-(suv?.49:C&&d.doors===2?.70:.31),cz1=d.roofBack-(suv?.32:.055);
    const ci0=[s*bw,(suv||C)?windowBelt(cz0):d.belt+.022,cz0],ci1=[s*rw,railY(cz1)-.038,cz1];
    if(C)surface(p,M.paint,(u,v)=>[s*glassX(v),mix(mix(a0[1],a1[1],v),mix(ai0[1],ai1[1],v),u),mix(mix(a0[2],a1[2],v),mix(ai0[2],ai1[2],v),u)],8,12,'solid-a-pillar');else patch(p,M.paint,[a0,a1,ai1,ai0],'solid-a-pillar');
    const quarterZ=v=>mix(cz0,cz1,v)+(suv?.075*Math.sin(Math.PI*v):0);
    if(suv||C)surface(p,M.paint,(u,v)=>{const z=mix(quarterZ(v),mix(d.back,d.roofBack,v),u);return[s*glassX(v),mix(windowBelt(z),railY(z)-.038*(1-u),v),z];},16,12,'solid-c-pillar');
    else patch(p,M.paint,[ci0,ci1,c1,c0],'solid-c-pillar');
    const bz=d.doors===2?.68:.32,b0=[s*bw,windowBelt(bz),bz],b1=[s*rw,railY(bz)-.038,bz],half=C&&d.doors===2?0:C&&!suv?.009:.023;
    const pane=(lo,hi,name)=>surface(p,name==='front-door-glass'?M.glass:rearGlass,(u,v)=>{const z=mix(mix(lo[0],lo[1],v),(name==='rear-quarter-glass'?quarterZ(v):mix(hi[0],hi[1],v)),u);return[s*glassX(v),mix(windowBelt(z),railY(z)-.038,v),z];},20,10,name);
    pane([ai0[2],ai1[2]],[bz-half,bz-half],'front-door-glass');
    if(suv){
      pane([bz+half,bz+half],[1.10,1.01],'rear-door-glass');
      pane([1.13,1.04],[ci0[2],ci1[2]],'rear-quarter-glass');
      patch(p,M.black,[[s*bw,windowBelt(1.10),1.10],[s*rw,railY(1.01)-.038,1.01],[s*rw,railY(1.04)-.038,1.04],[s*bw,windowBelt(1.13),1.13]],'quarter-window-divider');
    }else pane([bz+half,bz+half],[ci0[2],ci1[2]],'rear-door-glass');
    if(!(C&&d.doors===2))patch(p,M.black,[[b0[0],b0[1],bz-half],[b1[0],b1[1],bz-half],[b1[0],b1[1],bz+half],[b0[0],b0[1],bz+half]],'solid-b-pillar');
    surface(p,M.paint,(u,v)=>{const z=mix(d.header,d.roofBack,u);return[s*rw,railY(z)-.038*v,z];},30,2,'roof-side-rail');
    const trimPoints=C?Array.from({length:13},(_,i)=>{const v=i/12;return[s*glassX(v),mix(ai0[1],ai1[1],v),mix(ai0[2],ai1[2],v)];}):[ai0,ai1];for(let i=1;i<20;i++){const z=mix(ai1[2],ci1[2],i/20);trimPoints.push([s*rw,railY(z)-.038,z]);}trimPoints.push(ci1);if(suv||C)for(let i=1;i<=12;i++){const v=1-i/12,z=quarterZ(v);trimPoints.push([s*glassX(v),mix(windowBelt(z),railY(z)-.038,v),z]);}else trimPoints.push(ci0);trimPoints.push(ai0);line(p,amg?M.black:M.chrome,trimPoints,.005);
    }else{
      if(d.sl){
        // Broad painted pillar returns meet both the cowl and the header; black
        // inner seals follow the actual glass edge rather than a floating rod.
        surface(p,M.paint,(u,v)=>[s*(glassX(v)+.008*Math.sin(u*Math.PI)),mix(windowBelt(d.cowl)-.012,railY(d.header),v)+.008*Math.sin(u*Math.PI),mix(d.cowl,d.header,v)+mix(-.018,.075,u)],4,12,'sl-a-pillar');
        line(p,M.black,Array.from({length:13},(_,i)=>{const v=i/12;return[s*(glassX(v)-.009),mix(windowBelt(d.cowl),railY(d.header),v),mix(d.cowl,d.header,v)-.007];}),.009);
      }else line(p,M.paint,[[s*bw,windowBelt(d.cowl),d.cowl],[s*glassX(.5),mix(windowBelt(d.cowl),railY(d.header),.5),mix(d.cowl,d.header,.5)],[s*rw,railY(d.header),d.header]],.027);
      line(p,M.chrome,Array.from({length:25},(_,i)=>{const z=mix(d.cowl,d.back,i/24);return[s*bw,windowBelt(z)+.008,z];}),.005);
    }
    const z=d.cowl+.10;
    car[s<0?'mirrorL':'mirrorR']=mesh(p,new THREE.PlaneGeometry(.205,.078),M.chrome,[s*(W+.10),d.belt+.12,z+.06]);
    if(suv){const z0=d.header+.18,z1=d.roofBack-.12;line(p,M.chrome,Array.from({length:20},(_,i)=>{const z=mix(z0,z1,i/19);return[s*(rw-.035),railY(z)+.046,z];}),.016);for(const z of [z0,z1])box(p,M.black,[.035,.036,.075],[s*(rw-.035),railY(z)+.02,z],.008);}
  }
  for(const s of [-1,1])line(p,M.black,[[s*.04,d.belt+.045,d.cowl-.017],[s*.23,d.belt+.06,d.cowl-.05],[s*.58,d.belt+.05,d.cowl-.055]],.006);
  cabinFittings(car,d,M,low);
  if(d.sl){
    const badgeCanvas=document.createElement('canvas');badgeCanvas.width=256;badgeCanvas.height=128;
    const badgeContext=badgeCanvas.getContext('2d');badgeContext.fillStyle='#dce1e4';badgeContext.textAlign='center';badgeContext.font='italic bold 52px Arial';badgeContext.fillText('V'+car.spec.cyl,128,55);badgeContext.font='bold 28px Arial';badgeContext.fillText('BITURBO',128,98);
    const badgeTexture=new THREE.CanvasTexture(badgeCanvas);badgeTexture.colorSpace=THREE.SRGBColorSpace;
    const wingBadge=new THREE.MeshStandardMaterial({map:badgeTexture,transparent:true,alphaTest:.3,roughness:.28,metalness:.65,side:THREE.DoubleSide});
    for(const s of [-1,1]){
      // Bonnet vents beside the two power domes; side gills behind the front wheels.
      surface(p,M.black,(u,v)=>{const z=mix(-1.26,-.71,u),x=s*mix(.58,.69,v);return[x,S.deck(x,z)+.003,z];},12,3,'sl-bonnet-vent');
      for(const x of [.60,.665])line(p,M.chrome,Array.from({length:16},(_,i)=>{const z=mix(-1.29,-.68,i/15);return[s*x,S.deck(s*x,z)+.012,z];}),.005);
      surface(p,M.black,(u,v)=>{const y=mix(.49,.76,v),z=mix(-.86-.09*v,-.74-.09*v,u);return[s*(S.side(z,y)+.006),y,z];},4,8,'sl-wing-gill');
      line(p,M.chrome,Array.from({length:13},(_,i)=>{const v=i/12,y=mix(.49,.76,v),z=-.86-.09*v;return[s*(S.side(z,y)+.010),y,z];}),.009);
      for(const y of [.565,.715])line(p,M.chrome,Array.from({length:12},(_,i)=>{const z=mix(-.94,-.57,i/11);return[s*(S.side(z,y)+.012),y,z];}),.006);
      surface(p,wingBadge,(u,v)=>{const z=mix(-.76,-.55,s>0?1-u:u),y=mix(.585,.685,v);return[s*(S.side(z,y)+.014),y,z];},4,2,'sl-v12-biturbo-badge');
      // Polished sill highlight and lower door scallop follow the curved skin.
      for(const [m,y,r]of [[M.chrome,.265,.007],[M.paint,.36,.008]])line(p,m,Array.from({length:25},(_,i)=>{const z=mix(-.94,.82,i/24),h=y+.035*Math.sin(Math.PI*i/24);return[s*(S.side(z,h)+.004),h,z];}),r);
    }
    surface(p,M.paint,(u,v)=>{const x=mix(-.72,.72,u),z=mix(R-.22,R-.12,v);return[x,S.deck(x,z)+.027*Math.sin(v*Math.PI/2)*(1-.18*(x/.72)**4),z];},24,3,'boot-lip-spoiler');
  }
  if(suv){
    box(p,amg?M.black:M.paint,[d.W*.76,.045,.23],[0,railY(d.roofBack)+.035,d.roofBack+.06],.015,[.08,0,0],'hatch-roof-spoiler');
    line(p,M.black,[[-.35,d.hatchGlassY+.035,d.back-.016],[.23,d.hatchGlassY+.043,d.back-.020]],.009);
  }
  if(amg){M.red.color.set('#ba2029');if(!d.sl)for(const s of [-1,1])box(p,M.chrome,[.009,.027,.15],[s*(W+.003),d.belt-.11,-d.wb/2+.40],.002,[0,0,0],'amg-wing-badge');}
  // Tessellate before projecting: a large flat polygon intersects a curved bumper.
  const front=(m,pts,name,part,z=F)=>{
    const g0=new THREE.ShapeGeometry(new THREE.Shape(pts.map(q=>new THREE.Vector2(...q))));
    const raw=g0.toNonIndexed(),a=raw.attributes.position,points=[];
    const triangle=(a,b,c,n)=>{if((suv||C)&&n){const edges=[[a,b,c],[b,c,a],[c,a,b]].sort((x,y)=>y[0].distanceToSquared(y[1])-x[0].distanceToSquared(x[1]));if(edges[0][0].distanceToSquared(edges[0][1])>.0081){const [a,b,c]=edges[0],m=a.clone().lerp(b,.5);triangle(a,m,c,n-1);triangle(m,b,c,n-1);return;}n=0;}if(n){const ab=a.clone().lerp(b,.5),bc=b.clone().lerp(c,.5),ca=c.clone().lerp(a,.5);triangle(a,ab,ca,n-1);triangle(ab,b,bc,n-1);triangle(ca,bc,c,n-1);triangle(ab,bc,ca,n-1);}else for(const q of [a,b,c])points.push(q.x,q.y,(part?.startsWith('light_f')?S.lightFace:S.face)(q.x,z,q.y)+Math.sign(z)*(suv?.019:.012));};
    for(let i=0;i<a.count;i+=3)triangle(new THREE.Vector3().fromBufferAttribute(a,i),new THREE.Vector3().fromBufferAttribute(a,i+1),new THREE.Vector3().fromBufferAttribute(a,i+2),(suv||C)?3:1);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(points.length/3*2),2));g.computeVertexNormals();g0.dispose();raw.dispose();
    const o=mesh(p,g,m,[0,0,0],[0,0,0],name);if(part)o.userData.damagePart=part;return o;
  };
  const stroke=(m,pts,z,r=.006,part)=>{if(suv||C){const dense=[pts[0]];for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.045);for(let j=1;j<=n;j++)dense.push([mix(a[0],b[0],j/n),mix(a[1],b[1],j/n)]);}pts=dense;}const o=line(p,m,pts.map(([x,y])=>[x,y,(part?.startsWith('light_f')?S.lightFace:S.face)(x,z,y)+Math.sign(z)*(suv?.024:.014)]),r);if(part)o.userData.damagePart=part;return o;};
  const star=(x,y,z,r,m=M.chrome,part)=>{
    if(m===M.chrome){const face=z+(z<0?-.035:.005),rotation=[0,z<0?Math.PI:0,0];mesh(p,new THREE.CircleGeometry(r,32),M.black,[x,y,face+(z<0?.001:-.001)],rotation,'brand-badge-mount');mesh(p,new THREE.PlaneGeometry(r*2.8,r*2.8),M.badge,[x,y,face],rotation,'brand-badge');return;}
    const o=mesh(p,new THREE.TorusGeometry(r,.004,4,24),m,[x,y,z]);if(part)o.userData.damagePart=part;
    for(let i=0;i<3;i++){const a=Math.PI/2+i*Math.PI*2/3;const q=line(p,m,[[x,y,z],[x+Math.cos(a)*r*.91,y+Math.sin(a)*r*.91,z]],r*.075);if(part)q.userData.damagePart=part;}
  };
  const gy=C?.grilleY??d.front-.18,gw=C?.grilleWidth??(cla?.55:suv?.51:.48),gh=C?.grilleHeight??.15;
  const grille=Array.from({length:32},(_,i)=>{const a=i*Math.PI*2/32,t=Math.sin(a);return[gw*Math.sign(Math.cos(a))*Math.abs(Math.cos(a))**.55*(1+.07*t),gy+.01+gh*Math.sign(t)*Math.abs(t)**.58];});
  front(M.black,grille,'mercedes-grille');stroke(M.chrome,[...grille,grille[0]],F,.008);
  if(d.sl){
    front(M.chrome,[[-gw*.95,gy-.022],[gw*.95,gy-.022],[gw*.95,gy+.022],[-gw*.95,gy+.022]],'sl-grille-blade');
    stroke(M.darkAlloy,[[-gw*.94,gy],[gw*.94,gy]],F,.004);
  }
  else if(amg){for(let i=-6;i<=6;i++)stroke(M.chrome,[[i*(C?.073:.066),gy-(C?.088:.11)],[i*(C?.069:.060),gy+(C?.113:.145)]],F,.009);}
  else if(suv){stroke(M.chrome,[[-gw*.92,gy],[gw*.92,gy]],F,.018);for(const y of [gy-.075,gy+.075])stroke(M.darkAlloy,[[-gw*.80,y],[gw*.80,y]],F,.008);}
  else{
    for(let j=0;j<5;j++)for(let i=-7;i<=7;i++){const x=(i+(j%2)*.5)*.058,y=gy-.105+j*.050;if(Math.abs(x)>gw*.84||Math.hypot(x,y-gy)<.106)continue;const z=S.face(x,F,y)-.015;for(let k=0;k<3;k++){const a=Math.PI/2+k*2*Math.PI/3;line(p,M.chrome,[[x,y,z],[x+.009*Math.cos(a),y+.009*Math.sin(a),z]],.0017);}}
    stroke(M.chrome,[[-gw*.91,gy],[gw*.91,gy]],F,.007);
  }
  if(C)mesh(p,new THREE.CircleGeometry(d.sl?.130:.094,24),M.black,[0,gy,S.face(0,F,gy)-.047]);
  star(0,gy,C?S.face(0,F,gy)-.052:suv?S.face(0,F,gy)-.023:F-.023,d.sl?.125:C?.089:.101);
  if(cla&&!d.cla118)stroke(M.led,[[-.78,.797],[0,.790],[.78,.797]],F,.006,'light_fl');
  front(M.black,[[-.52,d.sl?.45:.36],[.52,d.sl?.45:.36],[.63,.235],[-.63,.235]],'lower-grille','bumper_f');
  if(d.sl){stroke(M.chrome,[[-.78,.235],[-.55,.22],[0,.215],[.55,.22],[.78,.235]],F,.010,'bumper_f');}
  for(const s of [-1,1]){
    const side=s<0?'l':'r',fy=d.front-.11;
    const pts=d.sl?[[.49,.755],[.64,.79],[.82,.825],[.81,.67],[.68,.62],[.51,.64]]:C&&d.doors===2?[[.46,.728],[.65,.774],[.83,.826],[.81,.714],[.59,.660],[.49,.676]]:C&&cla?[[.40,.783],[.69,.804],[.83,.835],[.80,.722],[.56,.713],[.42,.730]]:C?[[.50,.825],[.70,.846],[.84,.901],[.83,.809],[.62,.767],[.51,.783]]:cla?[[.39,fy+.045],[.82,fy+.12],[.79,fy-.04],[.58,fy-.10]]:suv?[[.48,fy+.12],[.80,fy+.13],[.80,fy-.03],[.50,fy-.06]]:[[.48,fy+.02],[.82,fy+.115],[.79,fy-.025],[.55,fy-.095]];
    front(M.head,pts.map(([x,y])=>[s*x,y]),'headlamp-housing','light_f'+side);
    stroke(M.led,d.sl?[[s*.51,.754],[s*.65,.785],[s*.80,.810],[s*.80,.756]]:C&&d.doors===2?[[s*.49,.731],[s*.64,.770],[s*.81,.808]]:C&&cla?[[s*.42,.784],[s*.68,.810],[s*.81,.820]]:C?[[s*.52,.832],[s*.69,.850],[s*.81,.882]]:[[s*pts[0][0],pts[0][1]-.014],[s*.76,pts[1][1]-.025],[s*.80,pts[1][1]-.045]],F,.009,'light_f'+side);
    if(cla&&!d.cla118)star(s*.65,(C?.763:fy-.005),S.lightFace(s*.65,F,C?.763:fy)-.033,C?.038:.050,M.led,'light_f'+side);
    else for(const x of [.60,.72]){const y=d.sl?(x===.60?.706:.73):C?(suv?.803:.720):fy-.025;const q=mesh(p,new THREE.CircleGeometry(d.sl?.044:.022,16),M.chrome,[s*x,y,S.lightFace(s*x,F,y)-.026]);q.userData.damagePart='light_f'+side;if(d.sl){const pupil=mesh(p,new THREE.CircleGeometry(.029,16),M.head,[s*x,y,S.lightFace(s*x,F,y)-.028]);pupil.userData.damagePart='light_f'+side;}}
    front(M.black,[[s*.56,suv?.60:d.sl?.485:.43],[s*.73,suv?.63:d.sl?.51:.46],[s*.80,suv?.56:d.sl?.48:.40],[s*.80,.29],[s*.62,.26]],'outer-intake',suv?'structure':'bumper_f');
    if(suv&&!amg){const y=.46;mesh(p,new THREE.CircleGeometry(.043,20),M.chrome,[s*.68,y,S.face(s*.68,F,y)-.022]);}
    for(const y of [.30,.36])stroke(M.darkAlloy,[[s*.63,y],[s*.77,y+.005]],F,.008,'bumper_f');
    if(d.sl)stroke(M.led,[[s*.59,.465],[s*.76,.485]],F,.008,'light_f'+side);
    const ry=d.rear-.12,tail=d.sl?[[.29,.715],[.54,.82],[.82,.90],[.81,.755],[.66,.715]]:C?[[.24,ry+.028],[.65,ry+.049],[.83,ry+.065],[.80,ry-.025],[.43,ry-.047],[.27,ry-.020]]:cla?[[.32,ry+.06],[.80,ry+.09],[.78,ry-.08],[.34,ry-.07]]:[[.24,ry+.035],[.80,ry+.095],[.77,ry-.06],[.43,ry-.09]];
    front(M.red,tail.map(([x,y])=>[s*x,y]),'rear-lamp-housing','light_r'+side,R);
    stroke(M.tail,[...tail,tail[0]].map(([x,y])=>[s*x,y]),R,d.sl?.006:.013,'light_r'+side);
    if(cla&&!d.cla118)for(const x of [.44,.65])star(s*x,ry+.007,S.face(s*x,R,ry)+.035,C?.036:.049,M.tail,'light_r'+side);
    else stroke(M.tail,d.sl?[[s*.37,.736],[s*.62,.74],[s*.78,.77]]:[[s*.39,ry+.005],[s*.68,ry+.037],[s*.70,ry-.025],[s*.48,ry-.042]],R,d.sl?.010:C?.006:.009,'light_r'+side);
    if(d.sl){stroke(M.tail,[[s*.48,.78],[s*.65,.79],[s*.79,.82]],R,.009,'light_r'+side);stroke(M.chrome,[[s*.56,.828],[s*.68,.85],[s*.80,.875]],R,.009,'light_r'+side);}
    if(C){stroke(M.seam,[[s*.61,ry+.052],[s*.59,ry-.040]],R,.003);const wrap=[];for(let i=0;i<=12;i++){const z=mix(R-.24,R-.035,i/12),y=ry+.012;wrap.push([s*(S.side(z,y)+.004),y,S.longitudinal(s*S.side(z,y),z,y)]);}line(p,M.tail,wrap,.018).userData.damagePart='light_r'+side;}
  }
  stroke(d.sl||cla?M.tail:M.black,[[-.30,d.rear-(C&&cla?.10:.08)],[.30,d.rear-(C&&cla?.10:.08)]],R,d.sl?.006:cla?.013:.025);
  star(0,d.rear-(d.sl?.14:.22),(suv||d.sl)?S.face(0,R,d.rear-(d.sl?.14:.22))+.025:R+.025,.035);
  if(suv){
    front(M.black,[[-.73,.40],[.73,.40],[.80,.27],[.63,.19],[-.63,.19],[-.80,.27]],'rear-diffuser','bumper_r',R);
    // Tailgate cutline encloses the plate pocket; the shoulder above it meets the short rear glass.
    stroke(M.seam,[[-.73,1.035],[-.70,.90],[-.67,.58],[-.58,.50],[.58,.50],[.67,.58],[.70,.90],[.73,1.035]],R,.003);
    front(M.black,[[-.30,.735],[.30,.735],[.31,.585],[-.31,.585]],'rear-registration-recess',null,R);
    for(const s of [-1,1])stroke(M.tail,[[s*.63,.455],[s*.77,.48]],R,.012,'bumper_r');
  }else if(C)front(M.black,d.sl?[[-.78,.35],[-.60,.40],[.60,.40],[.78,.35],[.72,.20],[-.72,.20]]:[[-.72,.35],[.72,.35],[.69,.20],[-.69,.20]],'rear-diffuser','bumper_r',R);else box(p,M.black,[d.W*.80,.10,.10],[0,.245,R-.055],.025,[0,0,0],'rear-diffuser');
  car.exhaust=[];
  for(const s of [-1,1])for(const dx of amg?[-.060,.060]:[0]){
    if(d.sl){
      const x=s*.62+dx,z=S.face(x,R,.275)+.025;
      const outline=[[-.055,-.031],[.037,-.031],[.058,.031],[-.034,.031]];
      surface(p,M.chrome,(u,v)=>{const i=Math.min(3,Math.floor(u*4)),t=u*4-i,a=outline[i],b=outline[(i+1)%4];return[x+mix(a[0],b[0],t),.275+mix(a[1],b[1],t),z+mix(-.055,.032,v)];},16,1,'exhaust-outlet').userData.damagePart='bumper_r';
      patch(p,M.black,outline.map(([a,b])=>[x+a,.275+b,z+.020]),'sl-exhaust-throat').userData.damagePart='bumper_r';
      line(p,M.chrome,[...outline,outline[0]].map(([a,b])=>[x+a,.275+b,z+.034]),.004).userData.damagePart='bumper_r';
      car.exhaust.push(new THREE.Vector3(x,.275,z+.040));continue;
    }
    const x=s*.62+dx,z=(suv||C)?S.face(x,R,.24)-.018:R-.018;const outlet=mesh(p,new THREE.CylinderGeometry(.039,.039,.11,20,1,true),M.chrome,[x,.24,z],[Math.PI/2,0,0],'exhaust-outlet');outlet.userData.damagePart='bumper_r';mesh(p,new THREE.CircleGeometry(.031,16),M.black,[x,.24,z+.057]);car.exhaust.push(new THREE.Vector3(x,.24,z+.06));
  }
  if(!amg&&!suv&&!cla&&!d.sl)for(const s of [-1,1]){const o=ring(p,M.chrome,.055,.009,[s*.62,.245,C?S.face(s*.62,R,.245)+.04:R+.043]);o.scale.set(1.65,.65,1);}
  car.plate=plate;M.plate=makePlateMaterial(plate);
  for(const end of [F,R]){const y=end<0?.44:.64,z=(suv||C)?S.face(0,end,y):end;box(p,M.black,[.535,.124,.019],[0,y,z+Math.sign(z)*.012],.006);mesh(p,new THREE.PlaneGeometry(.51,.108),M.plate,[0,y,z+Math.sign(z)*.025],[0,z<0?Math.PI:0,0],'registration');}
}
