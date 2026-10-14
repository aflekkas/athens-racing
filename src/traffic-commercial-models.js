// Metres, +Y up, -Z forward. Dedicated OSY Citaro, Ducato and NPR coachwork.
import * as THREE from 'three';
import { tintGlass } from './glass-tint.js';
import { seatMirrors } from './vehicle-mirrors.js';
import { makePlateMaterial, nextRegistration } from './vehicle-models.js';
import { canvasTex } from './util.js';

export const COMMERCIAL_MODELS = {
  bus: {name:'Mercedes-Benz Citaro O530 OSY',L:12,W:2.55,H:3.10,wb:5.845,r:.485,axles:[-3.30,2.545]},
  van: {name:'Fiat Ducato L2H2',L:5.413,W:2.05,H:2.524,wb:3.45,r:.355,axles:[-1.76,1.69]},
  truck: {name:'Isuzu NPR delivery box',L:6.40,W:2.30,H:3.10,wb:3.815,r:.405,axles:[-2.12,1.695]},
};
const standard=(color,roughness=.48,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness,side:THREE.DoubleSide});
function mesh(p,g,m,pos=[0,0,0],name=''){const o=new THREE.Mesh(g,m);o.position.set(...pos);o.name=name;p.add(o);return o;}
function box(p,m,w,h,l,x,y,z,name=''){return mesh(p,new THREE.BoxGeometry(w,h,l),m,[x,y,z],name);}
function quad(p,m,pts,name=''){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pts.flat(),3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,1],2));g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();return mesh(p,g,m,[0,0,0],name);}
function rod(p,m,a,b,r=.015,n=6){const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),v=B.clone().sub(A);const o=mesh(p,new THREE.CylinderGeometry(r,r,v.length(),n),m,A.clone().add(B).multiplyScalar(.5).toArray());o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());return o;}
function label(text,bg,fg,w=512,h=128,emissive=false){const map=canvasTex(w,h,(c,W,H)=>{c.fillStyle=bg;c.fillRect(0,0,W,H);c.fillStyle=fg;c.font=`bold ${H*.59}px Arial`;c.textAlign='center';c.textBaseline='middle';c.fillText(text,W/2,H/2,W*.94);});return new THREE.MeshStandardMaterial({map,roughness:.55,emissive:emissive?'#ffffff':'#000000',emissiveMap:emissive?map:null,emissiveIntensity:emissive?.6:0,side:THREE.DoubleSide});}
function frontPanel(p,m,w,h,x,y,z,name=''){return quad(p,m,[[x+w/2,y-h/2,z],[x-w/2,y-h/2,z],[x-w/2,y+h/2,z],[x+w/2,y+h/2,z]],name);}
function sidePanel(p,m,s,x,y,z,w,h,name=''){return quad(p,m,[[s*x,y-h/2,z+s*w/2],[s*x,y-h/2,z-s*w/2],[s*x,y+h/2,z-s*w/2],[s*x,y+h/2,z+s*w/2]],name);}
function sideArch(p,m,s,x,z0,z1,bottom,top,axles,r,low=false){
 const cuts=[z0,z1];for(const a of axles)for(let i=0;i<=(low?10:22);i++){const z=a+(r+.055)*Math.cos(i*Math.PI/(low?10:22));if(z>z0&&z<z1)cuts.push(z);}cuts.sort((a,b)=>a-b);
 const pts=[],idx=[];for(const z of cuts){let y=bottom;for(const a of axles){const dz=z-a;if(Math.abs(dz)<r+.055)y=Math.max(y,r+Math.sqrt(Math.max(0,(r+.055)**2-dz*dz)));}pts.push(s*x,Math.min(y,top),z,s*x,top,z);}for(let i=0;i<cuts.length-1;i++){const k=i*2;idx.push(k,k+1,k+2,k+1,k+3,k+2);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));g.setIndex(idx);g.computeVertexNormals();mesh(p,g,m,[0,0,0],'open-wheelarch-body');
}
function commercialTyre(r,width){
 // Closed rounded casing, with the shoulder rolling from tread into sidewall.
 const profile=[[.63,-.50],[.82,-.50],[.95,-.43],[1,-.29],[1,.29],[.95,.43],[.82,.50],[.63,.50]].map(([radius,axial])=>new THREE.Vector2(radius*r,axial*width));
 profile.push(profile[0].clone());return new THREE.LatheGeometry(profile,28);
}
function commercialExhaust(c,d,M){
 const R=d.L/2,kind=c.shape,x=kind==='bus'?-.86:kind==='truck'?-.70:-.61;
 const y=kind==='bus'?.34:kind==='truck'?.50:.25,z=R-(kind==='truck'?1.08:.69),r=kind==='bus'?.052:kind==='truck'?.045:.032;
 const mountY=kind==='truck'?.61:kind==='bus'?.44:.31;
 const exhaust=new THREE.Group();exhaust.name='mounted-exhaust';c.body.add(exhaust);
 const muffler=mesh(exhaust,new THREE.CylinderGeometry(r*2,r*2,.48,12),M.alloy,[x,y,z],'rear-silencer');muffler.rotation.x=Math.PI/2;
 for(const q of [-.17,.17]){rod(exhaust,M.black,[x-.065,y,z+q],[x-.065,mountY,z+q],.019);box(exhaust,M.black,.16,.025,.055,x,mountY,z+q,'exhaust-chassis-bracket');}
 const path=[[x,y,z+.21],[x,y,R-.23],[x,y-.015,R-.085],[x,y-.09,R-.035]].map(v=>new THREE.Vector3(...v));
 const curve=new THREE.CatmullRomCurve3(path);mesh(exhaust,new THREE.TubeGeometry(curve,12,r,8,false),M.alloy,[0,0,0],'downturned-tailpipe');
 const end=path.at(-1),axis=end.clone().sub(path.at(-2)).normalize();const outlet=mesh(exhaust,new THREE.CircleGeometry(r*.82,12),M.black,end.clone().addScaledVector(axis,.001).toArray(),'dark-exhaust-exit');outlet.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),axis);
}
function wheels(c,d,M,low){for(let j=0;j<2;j++)for(const side of [-1,1]){const pivot=new THREE.Group(),spin=new THREE.Group();pivot.position.set(side*(d.W/2-(c.shape==='truck'?.19:.13)),d.r,d.axles[j]);pivot.add(spin);c.root.add(pivot);const thickness=c.shape==='bus'?.28:.23;const tyre=mesh(spin,low?new THREE.CylinderGeometry(d.r,d.r,thickness,10):commercialTyre(d.r,thickness),M.black);tyre.rotation.z=Math.PI/2;const hub=mesh(spin,new THREE.CylinderGeometry(d.r*.66,d.r*.66,.035,low?10:24),M.alloy,[side*(thickness/2+.009),0,0]);hub.rotation.z=Math.PI/2;
 if(!low){const disc=mesh(spin,new THREE.CylinderGeometry(d.r*.55,d.r*.55,.018,24),M.alloy,[-side*.045,0,0],'rotating-brake-disc');disc.rotation.z=Math.PI/2;box(pivot,M.black,.075,d.r*.34,.115,-side*.052,d.r*.13,-d.r*.43,'fixed-brake-caliper');const cap=mesh(spin,new THREE.CylinderGeometry(d.r*.25,d.r*.25,.055,16),M.alloy,[side*(thickness/2+.04),0,0]);cap.rotation.z=Math.PI/2;for(let i=0;i<8;i++){const a=i*Math.PI/4;const hole=mesh(spin,new THREE.CircleGeometry(d.r*.092,8),M.black,[side*(thickness/2+.03),Math.cos(a)*d.r*.48,Math.sin(a)*d.r*.48]);hole.rotation.y=side*Math.PI/2;}const arch=[];for(let i=0;i<=20;i++){const a=i*Math.PI/20;arch.push([side*(d.W/2+.005),d.r+Math.sin(a)*(d.r+.059),d.axles[j]+Math.cos(a)*(d.r+.059)]);}if(c.shape!=='truck'||j===0)for(let i=1;i<arch.length;i++)rod(c.body,M.black,arch[i-1],arch[i],.013,5);}
 c.wheels.push({pivot,spin,front:j===0,r:d.r,side});}}
function plates(c,d,M,low,frontY=.43,rearY=.45){if(low)return;frontPanel(c.body,M.plate,.52,.112,0,frontY,-d.L/2-.085,'registration-front');const rear=frontPanel(c.body,M.plate,.52,.112,0,rearY,d.L/2+.085,'registration-rear');rear.rotation.y=Math.PI;rear.position.z=d.L+.17;}
function seats(p,M,x,z,y=.7){box(p,M.seat,.42,.12,.43,x,y,z);const b=box(p,M.seat,.43,.48,.085,x,y+.25,z+.19);b.rotation.x=-.1;box(p,M.black,.12,.28,.24,x,y-.18,z);}
function cabInterior(c,M,low,z,y,w){if(low)return;box(c.body,M.black,w,.22,.36,0,y,z-.5,'dashboard');seats(c.body,M,-w*.27,z,y-.24);seats(c.body,M,w*.27,z,y-.24);const wheel=mesh(c.body,new THREE.TorusGeometry(.17,.018,6,20),M.black,[-w*.27,y+.04,z-.24]);wheel.rotation.x=-.55;rod(c.body,M.black,[-w*.27,y-.2,z-.35],[-w*.27,y+.04,z-.24],.027);}
function mirrors(p,M,W,y,z,low,tall=false){for(const s of [-1,1]){const g=new THREE.Group();g.name=s<0?'mirror_l':'mirror_r';if(!low)g.userData.damagePart=g.name;p.add(g);rod(g,M.black,[s*(W/2-.04),y+.16,z],[s*(W/2+.25),y+.16,z-.1],.024);box(g,tall?M.paint:M.black,.16,tall?.48:.25,.16,s*(W/2+.27),y,z-.1,'mirror-housing');if(!low)frontPanel(g,M.alloy,.12,tall?.41:.18,s*(W/2+.27),y,z-.011,'mirror-face');}}

function bus(c,d,M,low){const p=c.body,W=d.W/2,F=-d.L/2,R=d.L/2;
 // Separate lower panels and window band leave the saloon genuinely hollow.
 box(p,M.black,d.W-.12,.14,d.L-.18,0,.44,0,'low-floor');box(p,M.paint,d.W-.06,.16,d.L-.06,0,2.88,0,'roof');
 for(const s of [-1,1]){sideArch(p,M.paint,s,W,F+.035,R-.035,.30,1.22,d.axles,d.r,low);sideArch(p,M.blue,s,W+.01,F+.08,R-.08,.575,.845,d.axles,d.r,low);box(p,M.yellow,.016,.12,d.L-.16,s*(W+.012),1.15,0);box(p,M.black,.035,.09,d.L-.14,s*(W-.006),1.31,0);box(p,M.black,.04,.10,d.L-.14,s*(W-.012),2.70,0);
 const doors=s===1?[-5.06,-.48,4.11]:[];
 const edges=[F+.09,-4.34,-2.6,-.98,.72,2.48,4.77,R-.09];for(let i=0;i<edges.length-1;i++){const a=edges[i],b=edges[i+1];sidePanel(p,M.glass,s,W-.01,2.01,(a+b)/2,b-a-.055,1.30,'saloon-glass');box(p,M.black,.07,1.43,.055,s*(W-.025),2.005,b);}
 for(const z of doors){const doorStart=p.children.length;box(p,M.black,.047,2.25,1.13,s*(W+.026),1.48,z,'door-frame');for(const q of [-1,1]){sidePanel(p,M.glass,s,W+.055,1.64,z+q*.273,.515,1.87,'entry-door-glass');box(p,M.paint,.022,.20,.51,W+.06,.48,z+q*.273);box(p,M.black,.025,2.11,.028,W+.07,1.54,z);}if(!low){box(p,M.alloy,.18,.04,1.06,W-.06,.34,z,'boarding-step');for(const q of [-1,1])rod(p,M.yellow,[W-.18,.72,z+q*.35],[W-.18,2.28,z+q*.35],.016);}const door=new THREE.Group();door.name=`door_bus_${doors.indexOf(z)}`;door.userData.damagePart=door.name;const parts=p.children.slice(doorStart);p.add(door);for(const part of parts)door.add(part);}
 if(!low){sidePanel(p,M.osy,s,W+.023,.95,-2.0,1.13,.23,'OSY-side-mark');sidePanel(p,M.destination,s,W+.024,2.40,-3.3,1.53,.27,'side-destination');for(let i=0;i<8;i++)box(p,M.black,.012,.025,1.1,s*(W+.014),.57+i*.061,R-.83,'engine-louvre');}
 }
 box(p,M.paint,d.W,.78,.10,0,.72,F+.015,'front-apron');box(p,M.paint,d.W,.91,.1,0,.765,R-.015,'rear-apron');frontPanel(p,M.glass,d.W-.15,1.35,0,1.95,F-.006,'panoramic-front-glass');frontPanel(p,M.glass,d.W-.16,1.38,0,1.96,R+.006,'rear-glass');box(p,M.black,d.W-.10,.39,.065,0,2.66,F,'destination-housing');frontPanel(p,low?M.yellow:M.destination,d.W-.25,.30,0,2.67,F-.04,'front-destination');
 for(const x of [-W+.035,W-.035])box(p,M.paint,.075,1.78,.09,x,2.02,F+.02,'front-corner-pillar');
 // OSY's angular blue, yellow and cyan front treatment, on solid fascia.
 quad(p,M.blue,[[-.75,.47,F-.042],[.02,.47,F-.042],[-.42,1.1,F-.042],[-.92,1.1,F-.042]],'OSY-blue-front');quad(p,M.yellow,[[-.03,.47,F-.044],[.75,.47,F-.044],[.31,1.1,F-.044],[-.45,1.1,F-.044]],'OSY-yellow-front');quad(p,low?M.blue:M.cyan,[[.77,.48,F-.045],[1.17,1.05,F-.045],[.30,1.10,F-.045],[.48,.81,F-.045]],'OSY-cyan-front');
 for(const s of [-1,1]){box(p,M.black,.51,.20,.035,s*.91,.60,F-.054);frontPanel(p,M.head,.43,.145,s*.91,.60,F-.076);box(p,M.tail,.15,.45,.03,s*1.09,.71,R+.055);if(!low){frontPanel(p,M.led,.15,.10,s*.83,.60,F-.079);rod(p,M.black,[s*.15,1.29,F-.024],[s*.64,1.38,F-.036],.013);rod(p,M.black,[s*.40,1.31,F-.026],[s*.99,1.30,F-.033],.014);}}
 mirrors(p,M,d.W,2.32,F+.22,low,true);box(p,M.paint,1.75,.17,3.3,0,3.015,.9,'roof-air-conditioning');box(p,M.black,1.45,.023,.8,0,3.105,1.85,'ac-grille');
 if(!low){frontPanel(p,M.osy,.52,.15,-.86,.99,F-.051,'OSY-front-mark');mesh(p,new THREE.TorusGeometry(.098,.006,5,24),M.alloy,[0,.75,F-.055],'Mercedes-ring');for(let i=0;i<3;i++){const a=Math.PI/2+i*Math.PI*2/3;rod(p,M.alloy,[0,.75,F-.058],[Math.cos(a)*.095,.75+Math.sin(a)*.095,F-.058],.007,5);}for(const s of [-1,1]){for(const z of [-3.8,-2.85,-1.9,1.55,2.5,3.45,4.5]){seats(p,M,s*.85,z,.81);rod(p,M.yellow,[s*.53,.55,z],[s*.53,2.54,z],.018);}rod(p,M.yellow,[s*.53,2.54,-4.3],[s*.53,2.54,5.15],.021);}box(p,M.black,1.25,.3,.55,-.5,1.20,F+.53,'driver-console');seats(p,M,-.66,F+1.12,.80);const steering=mesh(p,new THREE.TorusGeometry(.2,.019,6,20),M.black,[-.66,1.35,F+.72]);steering.rotation.x=-1;}
 plates(c,d,M,low,.38,.45);
}
function gridSurface(p,m,fn,name,nu=24,nv=5){const vertices=[],indices=[],uv=[];for(let i=0;i<=nu;i++)for(let j=0;j<=nv;j++){vertices.push(...fn(i/nu,j/nv));uv.push(i/nu,j/nv);}for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const k=i*(nv+1)+j;indices.push(k,k+1,k+nv+1,k+1,k+nv+2,k+nv+1);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return mesh(p,g,m,[0,0,0],name);}
function ducatoNose(p,d,M){const F=-d.L/2,W=d.W/2;
 // The moulded front wraps back at both corners; its upper lip follows the short bonnet.
 const fascia=(a,b,material,name)=>gridSurface(p,material,(u,v)=>{const q=2*u-1,y=a+(b-a)*v;return[q*W*(.965+.015*Math.sin(v*Math.PI)),y,F-.032+.19*Math.pow(Math.abs(q),6)+.025*Math.pow(1-v,3)];},name);
 fascia(.29,.75,M.black,'deep-plastic-bumper');fascia(.75,1.12,M.paint,'rounded-front-fascia');
 gridSurface(p,M.paint,(u,v)=>{const q=2*u-1,w=W*(.965+.005*v),front=F-.032+.19*Math.abs(q)**6;return[q*w,1.12+.18*v+.045*(1-q*q)*Math.sin((.25+.75*v)*Math.PI),front+(-1.94-front)*v];},'short-sloping-bonnet',24,8);
 frontPanel(p,M.black,1.14,.28,0,.72,F-.035,'lower-radiator-intake');for(let i=0;i<4;i++)box(p,M.black,1.20,.018,.016,0,.88+i*.049,F-.038,'upper-grille-slot');
 for(const side of [-1,1]){const fog=mesh(p,new THREE.CircleGeometry(.052,16),M.head,[side*.79,.45,F+.002],'front-foglamp');fog.rotation.y=Math.PI;rod(p,M.black,[side*.79,.41,F+.003],[side*.94,.43,F+.115],.027);}
 // Round the leading corner of each fender while preserving the wheel cutout.
 p.traverse(o=>{if(o.isMesh&&o.name==='open-wheelarch-body'){const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++){const z=a.getZ(i),t=Math.max(0,Math.min(1,(-2.12-z)/.59));if(t){a.setX(i,a.getX(i)*(1-.03*t));if(a.getY(i)>.99)a.setY(i,a.getY(i)-.10*t);}}a.needsUpdate=true;o.geometry.computeVertexNormals();}});
}
function ducatoLamps(p,d,M,side){
 const F=-d.L/2;
 // Sample the wrapped nose at every vertex, with an explicit offset ahead of
 // both fascia and bonnet. A dark gasket makes the clear lamp boundary legible.
 const point=(u,v,offset)=>{const x=.57+.405*u,y=1.015+.035*u+v*(.12+.025*u);return[side*x,y,F-.090+.175*Math.pow(x/.99,6)-offset];};
 gridSurface(p,M.black,(u,v)=>point(u,v,0),'swept-lamp-gasket',12,4);
 gridSurface(p,M.head,(u,v)=>point(.06+.88*u,.16+.68*v,.006),'swept-headlamp',12,4);
 for(const u of [.36,.66]){const a=point(u,.18,.009),b=point(u,.80,.009);rod(p,M.black,a,b,.004,5);}
}
function van(c,d,M,low){const p=c.body,W=d.W/2,F=-d.L/2,R=d.L/2;
 box(p,M.black,d.W-.18,.1,d.L-.24,0,.27,0,'underbody');
 // High roof cargo body ends behind the separate sloping Ducato cab.
 box(p,M.paint,d.W-.045,1.24,R+.62,0,1.84,(R-.62)/2,'high-roof-cargo');
 for(const s of [-1,1]){const door=new THREE.Group();door.name=s<0?'door_lf':'door_rf';if(!low)door.userData.damagePart=door.name;p.add(door);sideArch(p,M.paint,s,W,F+.06,-1.92,.28,1.24,d.axles,d.r,low);sideArch(door,M.paint,s,W,-1.92,-.63,.28,1.24,d.axles,d.r,low);sideArch(p,M.paint,s,W,-.63,R-.03,.28,1.24,d.axles,d.r,low);sideArch(p,M.black,s,W+.013,-.7,R,.395,.565,d.axles,d.r,low);quad(p,M.paint,[[s*(W-.028),1.28,-1.92],[s*(W-.10),1.31,-1.94],[s*(W-.14),2.16,-1.31],[s*(W-.09),2.15,-1.31]],'cab-shoulder');quad(door,M.glass,[[s*(W-.027),1.27,-1.92],[s*(W-.09),2.14,-1.31],[s*(W-.045),2.19,-.69],[s*W,1.24,-.69]],'cab-door-glass');rod(p,M.paint,[s*(W-.028),1.27,-1.92],[s*(W-.09),2.15,-1.31],.045);rod(p,M.paint,[s*(W-.09),2.15,-1.31],[s*(W-.045),2.22,-.64],.05);box(p,M.paint,.075,1.16,.10,s*(W-.025),1.77,-.635,'cab-b-pillar');quad(p,M.paint,[[s*(W-.09),2.15,-1.31],[s*(W-.04),2.51,-.62],[s*(W-.025),2.20,-.62],[s*(W-.045),2.19,-.69]],'raised-cab-roof-side');box(door,M.black,.032,.11,.13,s*(W+.022),1.12,-.85,'door-handle');
 if(!low){rod(p,M.black,[s*(W+.012),.56,-.64],[s*(W+.012),2.32,-.64],.004);rod(p,M.black,[s*(W+.029),.53,-.5],[s*(W+.029),2.31,-.5],.003);rod(p,M.black,[s*(W+.029),2.31,-.5],[s*(W+.029),2.31,1.08],.003);rod(p,M.black,[s*(W+.029),2.31,1.08],[s*(W+.029),.57,1.08],.003);box(p,M.black,.029,.035,2.47,s*(W+.026),1.19,1.34,'sliding-door-runner');box(p,M.black,.035,.14,.07,s*(W+.027),1.02,-.40);box(p,M.paint,.035,.025,2.95,s*(W+.022),1.39,.95,'side-pressed-rib');}}
 if(low)quad(p,M.paint,[[-W+.04,1.20,F+.07],[W-.04,1.20,F+.07],[W-.03,1.30,-1.94],[-W+.03,1.30,-1.94]],'short-sloping-bonnet');quad(p,M.glass,[[W-.10,1.31,-1.94],[-W+.10,1.31,-1.94],[-W+.14,2.16,-1.31],[W-.14,2.16,-1.31]],'windscreen-glass');quad(p,M.paint,[[W-.14,2.16,-1.31],[-W+.14,2.16,-1.31],[-W+.04,2.51,-.62],[W-.04,2.51,-.62]],'high-roof-cab-ramp');box(p,M.paint,d.W-.05,.10,R+.62,0,2.474,(R-.62)/2,'cargo-roof');if(low){box(p,M.black,d.W-.025,.38,.16,0,.49,F+.02,'deep-plastic-bumper');box(p,M.paint,d.W-.04,.39,.08,0,.86,F+.017);frontPanel(p,M.black,1.02,.26,0,.79,F-.029,'radiator-grille');}else ducatoNose(p,d,M);
 for(const s of [-1,1]){if(low)quad(p,M.head,[[s*.52,.97,F-.033],[s*.98,1.07,F+.07],[s*.96,1.22,F+.20],[s*.59,1.10,F-.034]],'swept-headlamp');else ducatoLamps(p,d,M,s);box(p,M.tail,.13,.68,.065,s*(W-.075),1.49,R+.008,'vertical-rear-lamp');}
 box(p,M.paint,d.W-.08,2.15,.055,0,1.40,R-.01,'rear-doors');box(p,M.black,.009,2.02,.012,0,1.39,R+.024);box(p,M.black,d.W-.02,.17,.15,0,.32,R-.01);if(!low){frontPanel(p,M.badge,.18,.13,0,.95,F-.033,'FIAT-badge');box(p,M.black,.14,.05,.018,-.15,1.23,R+.028);for(const s of [-1,1]){box(p,M.paint,.025,.025,1.15,s*.64,2.53,.7,'roof-pressed-rib');rod(p,M.black,[s*.13,1.33,-1.951],[s*.68,1.35,-1.94],.011);}}
 mirrors(p,M,d.W,1.55,-1.52,low);cabInterior(c,M,low,-1.02,1.30,1.72);plates(c,d,M,low,.42,.56);
}
function truck(c,d,M,low){const p=c.body,F=-d.L/2,R=d.L/2,cw=2.03;
 box(p,M.black,1.68,.19,d.L-.2,0,.54,0,'ladder-chassis');box(p,M.paint,d.W,2.12,4.35,0,2.02,.98,'separate-delivery-box');box(p,M.alloy,d.W+.014,.075,4.37,0,3.075,.98,'box-roof-cap');box(p,M.alloy,d.W+.025,.085,4.38,0,.98,.98,'box-base-rail');
 // Flat cab-over face, wheel cutouts, upright side glass and a separate box.
 for(const s of [-1,1]){const door=new THREE.Group();door.name=s<0?'door_lf':'door_rf';if(!low)door.userData.damagePart=door.name;p.add(door);sideArch(p,M.paint,s,cw/2,F+.05,F+.2,.32,1.34,[d.axles[0]],d.r,low);sideArch(door,M.paint,s,cw/2,F+.2,-1.27,.32,1.34,[d.axles[0]],d.r,low);quad(door,M.glass,[[s*cw/2,1.36,F+.20],[s*(cw/2-.06),2.17,F+.39],[s*(cw/2-.04),2.19,-1.35],[s*cw/2,1.34,-1.35]],'cab-side-glass');rod(p,M.paint,[s*cw/2,1.34,F+.19],[s*(cw/2-.06),2.19,F+.38],.043);box(p,M.paint,.1,1.94,.10,s*(cw/2-.02),1.30,-1.30,'cab-rear-pillar');box(door,M.black,.025,.07,.17,s*(cw/2+.02),1.24,-1.56);box(p,M.alloy,.23,.055,.57,s*.90,.39,-1.39,'cab-step');box(p,M.black,.05,.4,.5,s*.91,.55,2.21,'rear-mudflap');if(!low){box(p,M.alloy,.02,2.12,.04,s*(d.W/2+.012),2.02,-1.18);for(let i=0;i<5;i++)box(p,M.alloy,.007,1.95,.012,s*(d.W/2+.005),2.02,-.67+i*.8,'box-panel-joint');sidePanel(p,M.company,s,d.W/2+.015,2.14,.86,2.9,.54,'delivery-sign');box(p,M.black,.22,.42,1.2,s*.86,.64,-.1,'fuel-tank');}}
 box(p,M.paint,cw-.09,.09,1.56,0,2.235,-2.08,'cab-roof');box(p,M.paint,cw-.07,.38,.09,0,1.13,F+.04,'cab-front');quad(p,M.glass,[[cw/2-.10,1.36,F-.003],[-cw/2+.10,1.36,F-.003],[-cw/2+.11,2.19,F+.36],[cw/2-.11,2.19,F+.36]],'cab-windscreen-glass');box(p,M.black,cw-.09,.17,.04,0,1.31,F-.004,'windscreen-lower-trim');box(p,M.paint,cw,.24,.17,0,.43,F+.025,'cab-bumper');frontPanel(p,M.black,1.04,.23,0,.79,F-.012,'cab-grille');for(const s of [-1,1]){frontPanel(p,M.head,.34,.21,s*.78,.82,F-.015);frontPanel(p,M.yellow,.12,.16,s*.95,1.015,F-.01);box(p,M.tail,.30,.14,.04,s*.78,.64,R+.027);box(p,M.yellow,.10,.055,.03,s*1.07,3.02,R+.02);}
 if(!low){frontPanel(p,M.badge,.60,.14,0,1.32,F-.032,'ISUZU-badge');for(const y of [.74,.82,.90])box(p,M.alloy,1.04,.026,.022,0,y,F-.031);for(const s of [-1,1])rod(p,M.black,[s*.1,1.4,F+.003],[s*.66,1.43,F+.015],.010);box(p,M.black,.014,1.98,.02,0,2.0,R+.007,'rear-door-seam');for(const s of [-1,1]){rod(p,M.alloy,[s*.59,1.19,R+.023],[s*.59,2.94,R+.023],.018);for(const y of [1.36,2.02,2.72])box(p,M.alloy,.16,.045,.032,s*1.04,y,R+.027,'box-hinge');}box(p,M.alloy,1.90,.075,.15,0,.40,R-.08,'rear-underrun-guard');}
 mirrors(p,M,cw,1.84,F+.63,low,true);cabInterior(c,M,low,-1.80,1.44,1.69);plates(c,d,M,low,.45,.75);
}
export function buildCommercialModel(type,color,rng,opts={}){
 const kind=typeof type==='string'?type:type.id,d=COMMERCIAL_MODELS[kind];if(!d)throw new Error(`Unknown commercial vehicle: ${kind}`);const low=!!opts.low,root=new THREE.Group(),body=new THREE.Group();root.name=d.name;root.add(body);
 const paint=standard(kind==='bus'?'#edf0eb':color||'#e5e8e5',.34,.15),black=standard('#172024',.85),alloy=standard('#a3acb0',.32,.65),glass=tintGlass(new THREE.MeshStandardMaterial({roughness:.14,metalness:0,transparent:!low,side:THREE.DoubleSide,depthWrite:low}),low?'far':'cabin');
 const led=new THREE.MeshStandardMaterial({color:'#dce6df',emissive:'#d9ebff',emissiveIntensity:.4,side:THREE.DoubleSide}),tail=new THREE.MeshStandardMaterial({color:'#841815',emissive:'#ed221a',emissiveIntensity:.2});
 const M={paint,black,alloy,glass,led,head:led,tail,blue:standard('#126ba8'),yellow:standard('#f6c818'),seat:low?black:standard('#38647d'),cyan:low?paint:standard('#46c3db')};const plate=nextRegistration();M.plate=low?black:makePlateMaterial(plate);
 if(!low){M.destination=label('A2  ΑΚΑΔΗΜΙΑ • ΒΟΥΛΑ','#121812','#ffb938',1024,128,true);M.osy=label('ΟΣΥ  ΟΔΙΚΕΣ ΣΥΓΚΟΙΝΩΝΙΕΣ','#eef0e9','#1261a5');M.company=label('ΑΤΤΙΚΗ  •  ΔΙΑΝΟΜΕΣ','#edf0eb','#315f82',1024,192);M.badge=label(kind==='van'?'FIAT':kind==='truck'?'ISUZU':'✳',kind==='van'?'#972424':'#1b272d','#e5e9ea',256,128);}
 const c={root,body,paint,tail,wheels:[],plate,materials:M,dims:{L:d.L,W:d.W,H:d.H},shape:kind,modelKind:kind,spec:{color:kind==='bus'?'#edf0eb':color}};
 ({bus,van,truck}[kind])(c,d,M,low);wheels(c,d,M,low);if(!low)commercialExhaust(c,d,M);root.traverse(o=>{if(o.isMesh){if(!low){const named={'mirror_l':'mirror_l','mirror_r':'mirror_r','front-apron':'bumper_f','rear-apron':'bumper_r','short-sloping-bonnet':'bonnet','deep-plastic-bumper':'bumper_f','cab-bumper':'bumper_f','rear-doors':'boot'};if(named[o.name])o.userData.damagePart=named[o.name];if(o.material===M.led||o.material===M.tail){o.geometry.computeBoundingBox();const center=o.geometry.boundingBox.getCenter(new THREE.Vector3()).add(o.position);const front=center.z<0;o.name=`light_${front?'f':'r'}${center.x<0?'l':'r'}`;o.userData.damagePart=o.name;o.material=o.material.clone();}}o.castShadow=!o.name.includes('glass');o.receiveShadow=true;}});seatMirrors(c);return c;
}
