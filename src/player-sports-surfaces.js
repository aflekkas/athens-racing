// Close-view refinements for the 991.1 Carrera, facelift GR Yaris and Bertone 2000 GTV.
// Original procedural geometry; source photographs are recorded in the vehicle notes.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const v = p => new THREE.Vector3(...p);
const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
const smooth = x => (x=clamp(x))*x*(3-2*x);
const material = (color,roughness=.4,metalness=0) => new THREE.MeshStandardMaterial({color,roughness,metalness,side:THREE.DoubleSide});
function add(p,g,m,name,pos=[0,0,0],rot=[0,0,0]) {const o=new THREE.Mesh(g,m);o.name=name;o.position.set(...pos);o.rotation.set(...rot);p.add(o);return o;}
function box(p,m,size,pos,name,rad=.01){const fine=Math.min(...size)<.012;return add(p,fine?new THREE.BoxGeometry(...size):new RoundedBoxGeometry(...size,1,Math.min(rad,...size.map(x=>x/2))),m,name,pos);}
function tube(p,m,points,r,name,closed=false){const c=new THREE.CatmullRomCurve3(points.map(v),closed,'centripetal');return add(p,new THREE.TubeGeometry(c,(points.length===2?1:Math.min(32,Math.max(8,points.length*2))),r,4,closed),m,name);}
function surface(p,m,fn,nu,nv,name){const a=[],uv=[],ix=[];for(let i=0;i<=nu;i++)for(let j=0;j<=nv;j++){a.push(...fn(i/nu,j/nv));uv.push(i/nu,j/nv);}for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const k=i*(nv+1)+j;ix.push(k,k+nv+1,k+1,k+1,k+nv+1,k+nv+2);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(a,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return add(p,g,m,name);}
function polygon(p,m,points,name){const shape=new THREE.Shape();points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();return add(p,new THREE.ShapeGeometry(shape,16),m,name,[0,0,points[0][2]]);}
function ellipse(p,m,rx,ry,pos,name){const o=add(p,new THREE.CircleGeometry(1,24),m,name,pos);o.scale.set(rx,ry,1);return o;}
function textMat(label,fg='#d1d5d6',bg=null){const c=document.createElement('canvas');c.width=512;c.height=96;const g=c.getContext('2d');if(bg){g.fillStyle=bg;g.fillRect(0,0,512,96);}g.fillStyle=fg;g.font='italic 52px serif';g.textAlign='center';g.textBaseline='middle';g.fillText(label,256,52);const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshStandardMaterial({map,transparent:true,depthWrite:false,roughness:.3,metalness:.4,side:THREE.DoubleSide});}
function label(p,label,size,pos,name){return add(p,new THREE.PlaneGeometry(...size),textMat(label),name,pos);}
function crestMaterial(){const c=document.createElement('canvas');c.width=96;c.height=128;const g=c.getContext('2d');g.fillStyle='#b99a59';g.beginPath();g.moveTo(8,5);g.lineTo(88,5);g.lineTo(84,81);g.quadraticCurveTo(76,110,48,123);g.quadraticCurveTo(20,110,12,81);g.closePath();g.fill();g.fillStyle='#211914';g.font='bold 12px Arial';g.textAlign='center';g.fillText('PORSCHE',48,22);for(let y=32;y<100;y+=21){g.fillStyle='#942b24';g.fillRect(15,y,28,9);g.fillRect(53,y,28,9);}g.fillStyle='#242019';g.fillRect(39,41,18,58);const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshStandardMaterial({map,transparent:true,roughness:.29,metalness:.55,side:THREE.DoubleSide});}
function group(p,name){const g=new THREE.Group();g.name=name;p.add(g);return g;}
function bounds(o){o.geometry.computeBoundingBox();return o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);}
function removeOldFascia(car,d){
  car.body.updateMatrixWorld(true);
  for(const o of [...car.body.children]){
    if(!o.isMesh||o.userData.damagePart?.startsWith('light_')||o.name==='registration'||['bonnet','boot','body-side','front-bumper','rear-bumper','undertray'].includes(o.name))continue;
    const b=bounds(o),depth=b.max.z-b.min.z;
    // Retain registration planes, the shell and exhaust assemblies; replace flat decorative face pieces.
    if(depth<.19&&(b.min.z>d.L/2-.04||b.max.z< -d.L/2+.04)&&b.max.y>.29)o.removeFromParent();
    // The Carrera's previous flat rings on the wings are replaced by actual recessed optical modules.
    if(car.modelKind==='carrera'&&b.max.z< -1.65&&b.min.y>.54&&b.max.y<.89&&o.material!==car.paint&&o.material!==car.materials.seam)o.removeFromParent();
  }
}
function projector(p,M,pos,r,name,tilt=0){
  const g=group(p,name);g.position.set(...pos);g.rotation.x=tilt;
  surface(g,M.chrome,(u,v)=>{const a=u*Math.PI*2;return[Math.cos(a)*r*v,Math.sin(a)*r*v,.015*(1-v*v)];},18,3,'reflector-bowl');
  const rim=add(g,new THREE.TorusGeometry(r*.91,r*.075,4,20),M.chrome,'projector-bezel');rim.position.z=-.008;
  const lens=add(g,new THREE.SphereGeometry(r*.72,12,8),M.optical,'projector-lens',[0,0,-.016]);lens.scale.z=.29;
  return g;
}
function louvres(p,M,x,y,z,w,h,count,name){box(p,M.black,[w,h,.016],[x,y,z],name+'-recess');for(let i=0;i<count;i++)box(p,M.darkAlloy,[w-.016,.006,.025],[x,y-h*.41+i*h*.82/(count-1),z-.014],name+'-louvre');}
function carrera(car,d,M,low){
  const p=car.body,F=-d.L/2-.012,R=d.L/2+.014;
  const front=group(p,'sports-carrera-front-lights');
  const lampBowl=material('#7e8a91',.24,.35);
  // 991.1 halogen/bi-xenon architecture: one main projector and a separate lower reflector.
  // The lens is inclined with the front wing, with a fine polished rim, not an upright circle.
  for(const s of [-1,1]){
    const cx=s*.603,cz=-1.91;
    const at=(pts,z)=>{for(let i=1;i<pts.length;i++)if(z<=pts[i][0]){const [a,b]=[pts[i-1],pts[i]],t=smooth((z-a[0])/(b[0]-a[0]));return a[1]+(b[1]-a[1])*t;}return pts.at(-1)[1];};
    const wing=(x,z)=>{const h=at([[-d.L/2,.62],[-1.82,.78],[-1.25,.86],[d.cowl,d.belt]],z),w=at([[-d.L/2,d.W/2*.78],[-1.72,d.W/2*.95],[-1.1,d.W/2*.95]],z)-.014,q=x/w;return h+.028*(1-q*q)-.11*Math.exp(-(((z+1.55)/.58)**2))*(1-Math.exp(-(((Math.abs(q)-.72)/.22)**2)))*clamp((d.cowl-z)/.5);};
    if(s===1){const crest=add(front,new THREE.PlaneGeometry(.042,.056),crestMaterial(),'carrera-bonnet-crest',[0,wing(0,-2.09)+.015,-2.09],[-Math.PI/2,0,Math.PI]);}
    const outline=[];for(let i=0;i<32;i++){const t=i*Math.PI/16,x=cx+.150*Math.cos(t),z=cz+.225*Math.sin(t);outline.push([x,wing(x,z)+.006,z]);}
    const lamp=surface(front,lampBowl,(u,t)=>{const a=u*Math.PI*2,rad=t;const x=cx+.150*Math.cos(a)*rad,z=cz+.225*Math.sin(a)*rad;return[x,wing(x,z)+.008,z];},28,4,'carrera-headlamp-housing');
    tube(front,M.chrome,outline,.004,'carrera-headlamp-rim',true);
    for(const [r,mat,dy]of [[.063,M.chrome,.011],[.050,M.optical,.013],[.029,M.head,.015]])surface(front,mat,(u,t)=>{const a=u*Math.PI*2,x=cx+r*Math.cos(a)*t,z=cz+.035+r*1.12*Math.sin(a)*t;return[x,wing(x,z)+dy,z];},20,3,'carrera-recessed-projector');
    const reflector=add(front,new THREE.SphereGeometry(1,12,8),M.chrome,'carrera-secondary-reflector',[cx,wing(cx,cz-.088)+.013,cz-.088]);reflector.scale.set(.066,.019,.037);
    surface(front,M.lens,(u,t)=>{const a=u*Math.PI*2,x=cx+.147*Math.cos(a)*t,z=cz+.222*Math.sin(a)*t;return[x,wing(x,z)+.026+.013*(1-t*t),z];},28,4,'carrera-headlamp-glass');
    const intake=polygon(p,M.black,[[s*.33,.39,F],[s*.73,.41,F],[s*.75,.26,F],[s*.37,.24,F]],'carrera-radiator-inlet');
    for(let j=0;j<3;j++)tube(p,M.darkAlloy,[[s*.365,.275+j*.04,F-.009],[s*.70,.288+j*.04,F-.009]],.007,'carrera-intake-louvre');
    tube(front,M.led,[[s*.35,.414,F-.013],[s*.56,.43,F-.013],[s*.73,.42,F-.013]],.007,'carrera-drl');
    // Clear side repeater perched at the trailing edge of the headlamp wing.
    polygon(p,M.chrome,[[s*.801,.66,-1.70],[s*.835,.65,-1.56],[s*.842,.624,-1.57],[s*.805,.631,-1.69]],'carrera-wing-repeater');
    // A continuous lens turns the corner; separate flat panels left a visible seam.
    surface(p,M.red,(u,v)=>{const turn=smooth((u-.76)/.24);return[s*(.29+.55*u),.792+.078*turn-(.086-.050*turn)*v,R-.24*turn];},32,4,'carrera-tail-housing');
    tube(p,M.tail,[[s*.32,.778,R+.012],[s*.70,.786,R+.012],[s*.705,.735,R+.012],[s*.39,.725,R+.012]],.007,'carrera-tail-signature');
    box(p,M.chrome,[.27,.022,.006],[s*.52,.747,R+.014],'carrera-clear-tail-divider',.006);
    box(p,M.red,[.16,.017,.01],[s*.56,.36,R+.012],'carrera-rear-reflector',.006);
    tube(p,M.tail,Array.from({length:13},(_,i)=>{const u=.7+.3*i/12,turn=smooth((u-.76)/.24);return[s*(.29+.55*u),.778+.078*turn,R+.006-.24*turn];}),.006,'carrera-tail-wrap-guide');
  }
  polygon(p,M.black,[[-.29,.345,F],[.29,.345,F],[.27,.235,F],[-.27,.235,F]],'carrera-central-radiator');
  if(!low)for(let i=0;i<7;i++)tube(p,M.darkAlloy,[[-.25,.245+i*.013,F-.009],[.25,.245+i*.013,F-.009]],.002,'carrera-radiator-fins');
  label(p,'P O R S C H E',[.57,.047],[0,.738,R+.02],'carrera-rear-lettering');label(p,'911 Carrera',[.32,.038],[0,.681,R+.021],'carrera-script');
  box(p,M.black,[1.30,.10,.035],[0,.255,R],'carrera-rear-valance');
  polygon(p,M.black,[[-.285,.458,R+.020],[.285,.458,R+.020],[.355,.294,R+.020],[-.355,.294,R+.020]],'carrera-registration-recess');
  // Three broad horizontal engine-cover slats, as on 991.1 (not the vertical 991.2 grille).
  car.body.updateMatrixWorld(true);for(const o of [...p.children]){if(!o.isMesh||o.material!==M.black||o.name)continue;const b=bounds(o);if(b.min.z>1.58&&b.max.z<1.94&&b.min.y>.8)o.removeFromParent();}
  const deck=(x,z)=>{const t=smooth((z-1.47)/(d.L/2-1.47));return .97+(.79-.97)*t+.028*(1-(x/.84)**2);};
  for(let i=0;i<3;i++){const z=1.645+i*.085;surface(p,M.black,(u,t)=>{const x=(u-.5)*.99,zz=z+t*.049;return[x,deck(x,zz)+.007,zz];},24,2,'carrera-engine-grille-slot');surface(p,M.paint,(u,t)=>{const x=(u-.5)*1.01,zz=z-.017+t*.021;return[x,deck(x,zz)+.013,zz];},24,2,'carrera-engine-cover-slat');}
  // Fuel filler on the front right wing.
  tube(p,M.seam,[[.847,.73,-1.20],[.851,.81,-1.20],[.852,.813,-1.02],[.850,.731,-1.02]],.0018,'carrera-fuel-flap',true);
  // Modern inset pull handles replace the old bright rectangular strips.
  for(const s of [-1,1]){
    const old=p.children.find(o=>o.isMesh&&!o.name&&Math.abs(o.position.z-.55)<.005&&Math.abs(o.position.y-(d.belt-.1))<.005&&Math.sign(o.position.x)===s);
    if(old){const pos=old.position.clone();old.removeFromParent();const cup=add(p,new THREE.SphereGeometry(1,16,8),M.seam,'carrera-handle-recess',pos.toArray());cup.scale.set(.009,.024,.085);const handle=add(p,new THREE.SphereGeometry(1,16,8),M.paint,'carrera-door-handle',[pos.x+s*.008,pos.y+.003,pos.z]);handle.scale.set(.012,.012,.070);}
  }
}
function yaris(car,d,M,low){
  const p=car.body,F=-d.L/2-.012,R=d.L/2+.015;
  // 2024 bumper splits the cooling openings into a replaceable central section and side ducts.
  polygon(p,M.black,[[-.70,.61,F],[-.59,.68,F],[.59,.68,F],[.70,.61,F],[.73,.23,F],[-.73,.23,F]],'yaris-facelift-intake');
  box(p,M.black,[1.45,.037,.075],[0,.235,F],'yaris-front-splitter');
  box(p,M.paint,[1.43,.065,.045],[0,.465,F-.018],'yaris-removable-bumper-beam');
  for(const s of [-1,1]){
    const lamps=group(p,'sports-yaris-front-light-'+s);lamps.userData.damagePart=s<0?'light_fl':'light_fr';
    polygon(lamps,M.head,[[s*.29,.752,F],[s*.755,.823,F],[s*.79,.739,F],[s*.66,.66,F],[s*.40,.671,F]],'yaris-swept-headlamp');
    for(let i=0;i<3;i++)projector(lamps,M,[s*(.43+i*.10),.711+i*.018,F-.018],.032,'yaris-led-projector');
    tube(lamps,M.led,[[s*.35,.703,F-.023],[s*.59,.706,F-.023],[s*.70,.746,F-.023],[s*.745,.79,F-.023]],.006,'yaris-drl');
    polygon(p,M.black,[[s*.55,.43,F-.04],[s*.72,.435,F-.04],[s*.745,.255,F-.04],[s*.555,.255,F-.04]],'yaris-side-cooling-duct');
    for(let i=0;i<4;i++)tube(p,M.darkAlloy,[[s*.573,.28+i*.037,F-.05],[s*.719,.28+i*.037,F-.05]],.007,'yaris-side-duct-louvre');
    // Facelift rear lamps connect across the hatch; the central stop lamp moved to this strip.
    polygon(p,M.head,[[s*.47,.969,R],[s*.78,.984,R],[s*.80,.81,R],[s*.58,.77,R]],'yaris-rear-lamp-housing');
    tube(p,M.tail,[[s*.49,.944,R+.018],[s*.74,.961,R+.018],[s*.742,.83,R+.018],[s*.60,.809,R+.018]],.008,'yaris-rear-light-signature');
    box(p,car.signalMaterials?.reverse||M.chrome,[.13,.025,.008],[s*.633,.859,R+.023],'yaris-reverse-lens');
    box(p,M.red,[.10,.025,.012],[s*.69,.42,R+.017],'yaris-bumper-reflector');
    tube(p,M.black,[[s*.735,.30,-.85],[s*.768,.285,.02],[s*.86,.30,.86]],.022,'yaris-sculpted-sill');
    label(p,'GR',[.052,.036],[s*.857,.834,-.71],'yaris-front-wing-gr');
  }
  if(!low){for(let i=0;i<10;i++)box(p,M.alloy,[.84,.009,.012],[0,.269+i*.016,F-.011],'yaris-intercooler-fin',.001);for(let i=-8;i<=8;i++)box(p,M.black,[.003,.185,.014],[i*.049,.348,F-.023],'yaris-grille-mesh',.001);}
  box(p,M.head,[.65,.032,.024],[0,.736,F],'yaris-upper-intake');
  const toyota=add(p,new THREE.TorusGeometry(.034,.005,6,32),M.chrome,'toyota-ellipse',[0,.756,F-.027]);toyota.scale.x=1.3;
  for(const sx of [1,-1]){const r=add(p,new THREE.TorusGeometry(.021,.0028,5,24),M.chrome,'toyota-inner-ellipse',[0,.756,F-.033]);r.scale.set(sx===1?.55:1.35,sx===1?1.1:.55,1);}
  box(p,M.head,[1.03,.068,.016],[0,.946,R],'yaris-rear-black-bridge');
  box(p,M.tail,[1.02,.014,.009],[0,.963,R+.014],'yaris-continuous-rear-led',.003);
  box(p,M.black,[1.35,.145,.07],[0,.29,R],'yaris-rear-diffuser',.02);
  for(const x of [-.4,-.2,.2,.4])box(p,M.black,[.021,.065,.12],[x,.22,R+.014],'yaris-diffuser-fin');
  label(p,'GR YARIS',[.22,.035],[-.42,.717,R+.019],'yaris-rear-lettering');
  // Dark woven roof remains bodywork rather than a glass panoramic roof.
  const roof=p.getObjectByName('roof');if(roof){roof.material=M.black;M.black.roughness=.64;M.black.envMapIntensity=.18;}
}
function gtv(car,d,M,low){
  const p=car.body,F=-d.L/2-.014,R=d.L/2+.018;
  box(p,M.black,[1.43,.251,.03],[0,.656,F],'gtv-full-width-grille',.018);
  for(let i=0;i<6;i++)tube(p,M.chrome,[[-.70,.566+i*.034,F-.019],[0,.566+i*.034,F-.019],[.70,.566+i*.034,F-.019]],.0032,'gtv-horizontal-grille-bar');
  for(const s of [-1,1]){
    const lamps=group(p,'sports-gtv-front-lights-'+s);lamps.userData.damagePart=s<0?'light_fl':'light_fr';
    for(const [x,r]of [[.535,.101],[.325,.085]]){
      const pos=[s*x,.662,F-.029];ellipse(lamps,M.black,r+.012,r+.012,pos,'gtv-headlamp-rubber');
      projector(lamps,M,[s*x,.662,F-.036],r,'gtv-halogen-reflector');
      const lens=add(lamps,new THREE.SphereGeometry(r*.93,16,10),M.lens,'gtv-fluted-glass',[s*x,.662,F-.052]);lens.scale.z=.20;
      if(!low)for(let i=-4;i<=4;i++){const xx=i*r/5,hh=Math.sqrt(r*r*.83-xx*xx);tube(lamps,M.optical,[[s*x+xx,.662-hh,F-.069],[s*x+xx,.662+hh,F-.069]],.0012,'gtv-glass-prism');}
    }
    box(p,M.chrome,[.20,.064,.042],[s*.56,.505,F+.001],'gtv-indicator-chrome',.011);
    box(p,car.signalMaterials?.[s<0?'left':'right']||M.amber,[.177,.044,.013],[s*.56,.505,F-.024],'gtv-front-indicator',.007);
    box(p,M.chrome,[.329,.143,.026],[s*.49,.743,R],'gtv-rear-lamp-bezel',.015);
    box(p,M.red,[.298,.119,.024],[s*.49,.743,R+.018],'gtv-tail-lens',.010);
    box(p,M.tail,[.18,.093,.009],[s*.457,.743,R+.034],'gtv-tail-brake');
    box(p,car.signalMaterials?.[s<0?'left':'right']||M.amber,[.076,.093,.01],[s*.590,.743,R+.035],'gtv-tail-indicator');
    box(p,car.signalMaterials?.reverse||M.optical,[.052,.044,.012],[s*.38,.748,R+.035],'gtv-reverse');
    // GTV's slim bright beltline and C-pillar cloverleaf badge.
    tube(p,M.chrome,[[s*.652,.907,-.73],[s*.652,.907,.59],[s*.646,.910,1.20]],.004,'gtv-window-belt');
    const trim=[[s*.65,.907,-.73],[s*.586,1.216,-.36],[s*.582,1.258,.20],[s*.582,1.246,.67],[s*.65,.910,1.19]];
    tube(p,M.chrome,trim,.005,'gtv-chrome-window-surround');
    tube(p,M.chrome,[[s*.65,.91,-.41],[s*.590,1.207,-.13]],.0035,'gtv-quarterlight-frame');
    // Round chromed stalk mirror replaces the modern painted housing.
    for(const o of [...p.children])if(o.isMesh&&o!==car.mirrorL&&o!==car.mirrorR){const b=bounds(o);if(b.min.y>.9&&b.max.y<1.08&&Math.abs(o.position.x)>.76&&o.position.z<-.5&&o.position.z>-.8)o.removeFromParent();}
    tube(p,M.chrome,[[s*.75,.90,-.62],[s*.827,.956,-.59],[s*.86,1.015,-.58]],.007,'gtv-mirror-stalk');
    const housing=add(p,new THREE.SphereGeometry(.063,16,10),M.chrome,'gtv-round-mirror-housing',[s*.864,1.014,-.58]);housing.scale.z=.37;
    const mirror=car[s<0?'mirrorL':'mirrorR'];if(mirror){mirror.geometry.dispose();mirror.geometry=new THREE.CircleGeometry(.056,32);mirror.position.set(s*.864,1.014,-.553);}
    const marker=add(p,new THREE.SphereGeometry(.016,14,10),M.amber,'gtv-wing-repeater',[s*.777,.711,-1.5]);marker.scale.x=.18;
  }
  ellipse(p,M.badge,.026,.026,[0,.779,F-.048],'gtv-round-alfa-emblem');
  const shield=[[-.073,.771,F-.026],[.073,.771,F-.026],[.047,.585,F-.028],[0,.555,F-.028],[-.047,.585,F-.028]];
  polygon(p,M.black,shield,'gtv-scudetto');tube(p,M.chrome,shield,.006,'gtv-scudetto-border',true);
  for(let i=0;i<5;i++)tube(p,M.chrome,[[-.055+i*.006,.74-i*.032,F-.035],[.055-i*.006,.74-i*.032,F-.035]],.003,'gtv-scudetto-bar');
  for(const end of [-1,1]){
    const z=end<0?F:R;
    tube(p,M.chrome,[[-.72,.441,z-.012*end],[-.64,.447,z+.025*end],[0,.454,z+.028*end],[.64,.447,z+.025*end],[.72,.441,z-.012*end]],.028,'gtv-chrome-bumper');
    for(const s of [-1,1]){box(p,M.chrome,[.06,.145,.079],[s*.448,.472,z+end*.044],'gtv-bumper-overrider',.015);box(p,M.black,[.032,.119,.016],[s*.448,.474,z+end*.09],'gtv-overrider-rubber',.006);}
  }
  label(p,'2000',[.17,.043],[.43,.889,R+.020],'gtv-2000-script');label(p,'Alfa Romeo',[.27,.045],[-.40,.889,R+.020],'gtv-alfa-script');
}
function carreraGlasshouse(car,d,M){
  // 991 quarter lights close with a rounded point ahead of the rear glass; the
  // broad, compound-curved C-pillar is painted steel, never transparent glazing.
  for(const o of [...car.body.children])if(['rear-door-glass','solid-c-pillar'].includes(o.name))o.removeFromParent();
  const rw=d.W/2-.27,bw=d.W/2-.14,top=d.H-.045-.065;
  for(const s of [-1,1]){
    const inner=v=>[s*(rw+(bw-rw)*v),top-.054+(.902-(top-.054))*v+.016*Math.sin(v*Math.PI),.515+(.99-.515)*v+.11*Math.sin(v*Math.PI)];
    const outer=v=>[s*(rw+(bw-rw)*v),top+(.894-top)*v,.54+(1.57-.54)*v];
    surface(car.body,M.paint,(u,v)=>{const a=inner(v),b=outer(v);return[a[0]+s*.035*Math.sin(u*Math.PI)*Math.sin(v*Math.PI),a[1]+(b[1]-a[1])*u,a[2]+(b[2]-a[2])*u];},10,10,'solid-c-pillar');
    surface(car.body,M.glass,(u,v)=>{const end=inner(1-v),startZ=.567;const startY=.909+(top-.055-.909)*v;return[s*(bw+(rw-bw)*v),startY+(end[1]-startY)*u,startZ+(end[2]-startZ)*u];},18,10,'rear-door-glass');
  }
}
function windowSeals(car,M){
  const panes=[];car.body.traverse(o=>{if(o.isMesh&&['windscreen','rear-glass','front-door-glass','rear-door-glass'].includes(o.name))panes.push(o);});
  for(const o of panes){const a=o.geometry.attributes.position,nv=o.name==='windscreen'?10:o.name==='rear-glass'?12:10,nu=(a.count/(nv+1))-1,pts=[];
    const point=i=>[a.getX(i),a.getY(i)+.0015,a.getZ(i)];
    for(let i=0;i<=nu;i+=2)pts.push(point(i*(nv+1)));
    pts.push(point(nu*(nv+1)));for(let j=1;j<=nv;j+=2)pts.push(point(nu*(nv+1)+j));pts.push(point(a.count-1));
    for(let i=nu-1;i>=0;i-=2)pts.push(point(i*(nv+1)+nv));pts.push(point(nv));for(let j=nv-1;j>0;j-=2)pts.push(point(j));
    const name=o.name+'-rubber-seal';tube(car.body,M.black,pts,car.modelKind==='gtv'?.007:.009,name,true);
    if(car.modelKind==='gtv')tube(car.body,M.chrome,pts.map(([x,y,z])=>[x,y+.003,z]),.0035,o.name+'-chrome-inlay',true);
  }
}
function subdivideEndTrim(car,d){
  // A curved cap cannot be overlaid by a two-triangle grille: its straight
  // chords disappear inside the crown. Tessellate only coarse end attachments.
  car.body.updateMatrixWorld(true);
  car.body.traverse(o=>{if(!o.isMesh)return;const b=bounds(o);if((b.min.z>-d.L/2+.24&&b.max.z<d.L/2-.24)||b.max.z-b.min.z>.25||b.min.y>1.1)return;
    const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry,a=g.attributes.position,uv=g.attributes.uv,out=[],tex=[];let changed=false;
    for(let i=0;i<a.count;i+=3){const p=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(a,i+j)),t=uv?[0,1,2].map(j=>new THREE.Vector2().fromBufferAttribute(uv,i+j)):null;
      const emit=(p,t)=>{out.push(p.x,p.y,p.z);if(t)tex.push(t.x,t.y);};
      const split=(p,t,depth=0)=>{const edge=[p[0].distanceToSquared(p[1]),p[1].distanceToSquared(p[2]),p[2].distanceToSquared(p[0])],max=Math.max(...edge);if(max<.18*.18||depth===8){p.forEach((q,j)=>emit(q,t?.[j]));return;}changed=true;const i=edge.indexOf(max),j=(i+1)%3,k=(i+2)%3,m=p[i].clone().lerp(p[j],.5),mt=t?t[i].clone().lerp(t[j],.5):null;split([p[i],m,p[k]],t?[t[i],mt,t[k]]:null,depth+1);split([m,p[j],p[k]],t?[mt,t[j],t[k]]:null,depth+1);};
      split(p,t);
    }
    if(changed){const outG=new THREE.BufferGeometry();outG.setAttribute('position',new THREE.Float32BufferAttribute(out,3));if(uv)outG.setAttribute('uv',new THREE.Float32BufferAttribute(tex,2));const welded=mergeVertices(outG,.00001);welded.computeVertexNormals();outG.dispose();o.geometry.dispose();o.geometry=welded;}
    if(g!==o.geometry)g.dispose();
  });
}
function curvedTrimSupport(car,d){
  // Subdivide plates before a nonlinear end-cap bend, otherwise the coarse
  // quadrilateral chords cut through the newly crowned bumper centre.
  car.body.traverse(o=>{if(!o.isMesh)return;
    if(o.name==='registration'){if(o.position.z>0&&car.modelKind==='gr_yaris')o.position.y=.715;else if(o.position.z>0&&car.modelKind==='gtv')o.position.y=.613;const g=o.geometry.parameters;if(g?.width&&g?.height){o.geometry.dispose();o.geometry=new THREE.PlaneGeometry(g.width,g.height,20,6);}o.position.z+=Math.sign(o.position.z)*.035;}
    if(/(rear-valance|rear-diffuser)/.test(o.name))o.position.z+=.055;
  });
}
function modernMirrors(car,d,M){
  if(car.modelKind==='gtv')return;
  const W=d.W/2;
  car.body.updateMatrixWorld(true);
  for(const s of [-1,1]){
    for(const o of [...car.body.children])if(o.isMesh&&o!==car.mirrorL&&o!==car.mirrorR&&o.material===M.paint&&Math.abs(o.position.x-s*(W+.08))<.015&&Math.abs(o.position.y-(d.belt+.10))<.015)o.removeFromParent();
    const shell=add(car.body,new THREE.SphereGeometry(1,16,10),car.modelKind==='gr_yaris'?M.black:M.paint,'aerodynamic-mirror-housing',[s*(W+.072),d.belt+.10,d.cowl+.105]);shell.scale.set(.115,.057,.068);shell.rotation.y=s*.18;
    const face=car[s<0?'mirrorL':'mirrorR'];if(face){face.geometry.dispose();face.geometry=new THREE.CircleGeometry(1,32).scale(.098,.043,1);face.scale.set(1,1,1);face.position.set(s*(W+.075),d.belt+.097,d.cowl+.189);}
  }
}
function tagOptics(car){
  car.body.updateMatrixWorld(true);const inverse=car.body.matrixWorld.clone().invert();
  car.body.traverse(o=>{if(!o.isMesh||o.userData.damagePart)return;let light=/(headlamp|projector|reflector-bowl|projector-bezel|drl|tail-|reverse|indicator|continuous-rear-led)/.test(o.name);for(let p=o.parent;p&&p!==car.body;p=p.parent)if(p.name.includes('front-light'))light=true;if(!light)return;const q=bounds(o).getCenter(new THREE.Vector3()).applyMatrix4(inverse);o.userData.damagePart='light_'+(q.z<0?'f':'r')+(q.x<0?'l':'r');});
}
// The same continuous map is applied to skin, lenses, shut lines and attachments. This keeps
// coincident roof/glass vertices coincident and avoids trim floating off the rounded end panels.
function roundEnds(car,d){
  const is911=car.modelKind==='carrera',isYaris=car.modelKind==='gr_yaris',classic=car.modelKind==='gtv',half=d.L/2,w=d.W/2;
  car.body.updateMatrixWorld(true);const inv=car.body.matrixWorld.clone().invert();
  car.body.traverse(o=>{if(!o.isMesh||!o.geometry.attributes.position)return;
    // Bake the same body map into mirror faces and shells; transform hooks remain intact.
    const toBody=inv.clone().multiply(o.matrixWorld),toLocal=toBody.clone().invert(),a=o.geometry.attributes.position;
    for(let i=0;i<a.count;i++){
      const q=new THREE.Vector3(a.getX(i),a.getY(i),a.getZ(i)).applyMatrix4(toBody),z=q.z,sourceY=q.y,ax=Math.abs(q.x)/w;
      const t=smooth((Math.abs(z)-(half-.60))/.60),sign=Math.sign(z);
      if(isYaris)q.z-=.25*smooth((z-.25)/1.18)*smooth((q.y-.96)/.22);
      if(is911){
        q.y-=.105*smooth((-z-1.82)/.425)*smooth((q.y-.35)/.28);
        // Press-photo 991.1 wing crests rise above the low bonnet; carry the
        // same map through lenses and skin so the larger ovals remain seated.
        q.y+=.092*Math.exp(-(((z+1.74)/.38)**2))*Math.exp(-(((ax-.70)/.23)**2))*smooth((q.y-.53)/.19);
        const cabinFront=smooth((z+1.13)/.40)*(1-smooth((z+.30)/.86));q.z-=.16*cabinFront*smooth((q.y-.73)/.15);
        // Soften the roof crown and fastback rather than leave planar-looking rails.
        q.y+=.020*Math.sin(clamp((z+.1)/1.0)*Math.PI)*smooth((q.y-1.06)/.15);
      }
      if(t){const corner=(classic?.070:is911?(sign<0?.29:.24):.16)*ax**4;const capHeight=sign<0?d.front:d.rear;const belly=(classic?.035:.10)*Math.sin(clamp((q.y-.18)/(capHeight-.18))*Math.PI);q.z+=sign*t*(belly-corner);q.y+=t*.024*ax**4*(1-smooth((q.y-.18)/.38));}
      // Convex side surfaces and rounded shoulders produce a softer light roll on the front/rear wings.
      if(classic&&z<0)q.y+=.095*smooth((-z-(half-.76))/.6)*(1-smooth((q.y-.20)/.32));
      if(z>0)q.y+=(classic?.085:is911?.145:.080)*smooth((z-(half-.88))/.72)*(1-smooth((q.y-.20)/.37));
      const outer=smooth((ax-.70)/.24),height=smooth((q.y-.22)/.23)*(1-smooth((q.y-.77)/.16));
      q.x-=Math.sign(q.x)*outer*(classic?.047:.050)*(1-smooth((q.y-.21)/.38));
      q.x+=Math.sign(q.x)*outer*height*(classic?.007:.016)*Math.exp(-(((Math.abs(z)-1.25)/.55)**2));
      if(o.name==='registration')q.y=sourceY+(z>0&&is911?.055:0);
      q.applyMatrix4(toLocal);a.setXYZ(i,q.x,q.y,q.z);
    }
    a.needsUpdate=true;o.geometry.computeVertexNormals();o.geometry.computeBoundingBox();o.geometry.computeBoundingSphere();
  });
}
export function refineSportsPlayer(car,d,M,low=false){
  if(!['carrera','gr_yaris','gtv'].includes(car.modelKind))return;
  M.optical=material('#c4d9df',.12,.34);M.optical.emissive.set('#c2def4');M.optical.emissiveIntensity=.10;
  M.lens=new THREE.MeshPhysicalMaterial({color:'#c6dde4',roughness:.08,metalness:.05,transparent:true,opacity:.22,clearcoat:1,depthWrite:false,side:THREE.DoubleSide});
  M.amber=material('#d98616',.21,.12);
  removeOldFascia(car,d);
  if(car.modelKind==='carrera'){carrera(car,d,M,low);carreraGlasshouse(car,d,M);}
  else if(car.modelKind==='gr_yaris')yaris(car,d,M,low);
  else gtv(car,d,M,low);
  M.glass.color.set(car.modelKind==='gtv'?'#91a29e':'#46626c');M.glass.opacity=car.modelKind==='gtv'?.48:.66;M.glass.metalness=.22;M.glass.roughness=.07;
  modernMirrors(car,d,M);windowSeals(car,M);tagOptics(car);curvedTrimSupport(car,d);subdivideEndTrim(car,d);roundEnds(car,d);
}
