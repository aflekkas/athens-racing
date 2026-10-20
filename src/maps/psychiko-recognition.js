// Survey landmarks share the streetscape's vertex-colour cells and fade policy. No extra objects/lights per asset.
import * as THREE from 'three';
import { blockFootprint } from '../buildings.js';

/** Small repeatable rubble pattern authored here, independent of reference photographs. Shared by all stone walls. */
export function stoneTexture() {
  const size=128,bytes=new Uint8Array(size*size*4),seeds=[];
  let state=71;const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  for(let i=0;i<42;i++)seeds.push([rand()*size,rand()*size,.66+rand()*.3]);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    let a=Infinity,b=Infinity,t=.8;
    for(const [sx,sy,c] of seeds){const dx=Math.min(Math.abs(x-sx),size-Math.abs(x-sx)),dy=Math.min(Math.abs(y-sy),size-Math.abs(y-sy)),d=dx*dx+dy*dy;if(d<a){b=a;a=d;t=c;}else if(d<b)b=d;}
    const v=Math.round((Math.sqrt(b)-Math.sqrt(a)<.7?.43:t)*255),k=(y*size+x)*4;bytes[k]=bytes[k+1]=bytes[k+2]=v;bytes[k+3]=255;
  }
  const tex=new THREE.DataTexture(bytes,size,size);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearMipmapLinearFilter;tex.generateMipmaps=true;tex.needsUpdate=true;tex.name='psychiko-authored-rubble';return tex;
}

export function recognitionAssets(template,box,lathe) {
 const kiosk=(color,canopy)=>template(m=>{
  box(m,0,0,0,2.4,.2,2.5,'#a9a89c');box(m,0,.2,0,2.2,2.15,2.2,color);
  for(const x of [-1.11,1.11])box(m,x,.7,-.25,.04,1.3,1.3,'#32483d');
  box(m,0,.65,1.12,1.6,1.35,.04,'#344c43');box(m,0,.6,1.2,2,.16,.6,'#c0c4ba');
  box(m,0,2.38,0,4.7,.18,4.3,canopy);box(m,0,2.56,0,2.7,.24,2.6,'#eee7d1');
  for(const x of [-1.55,1.55])box(m,x,.18,1.3,.55,1.8,.5,'#497666');
 },'streetProp');
 const gate=template(m=>{
  for(const x of [-2.8,2.8]){box(m,x,0,0,.7,2.8,.85,'#d4c8af');box(m,x,2.8,0,.85,.14,1,'#e0d6bf');}
  box(m,0,.12,0,5.1,.18,.07,'#324a40');box(m,0,2.35,0,5.1,.08,.06,'#324a40');
  for(let x=-2.4;x<=2.4;x+=.8)box(m,x,.3,0,.045,2.1,.05,'#324a40');
 },'streetProp');
 const scooter=template(m=>{
  for(const z of [-.65,.65])box(m,0,.05,z,.17,.42,.42,'#292d2c');
  box(m,0,.3,0,.55,.2,1.25,'#586b70');box(m,0,.55,-.2,.48,.3,.6,'#272f30');box(m,0,.45,.5,.5,.75,.18,'#c1c7bf');box(m,0,1.25,.54,.7,.07,.08,'#424949');
 },'streetProp');
 const bollard=template(m=>{box(m,0,0,0,.1,.9,.1,'#303f39');box(m,0,.7,0,.13,.08,.13,'#ded7bd');},'streetProp');
 return {kiosk:kiosk('#e5e1cc','#ded8bf'),kioskGreen:kiosk('#35493d','#c8c6ab'),schoolGate:gate,scooter,bollard};
}

export function indexRecognition(street,put) {
 const group=street.map.data.psychiko?.recognition,route=street.route;
 for(const r of group?.landmarks||[]){
  const p={...r};
  // A kiosk node marks its counter, not its footprint. Set the body back onto the pavement, clear of racing width.
  if(r.kind==='kiosk')for(let k=0;k<5;k++){const q=route.project(p.x,p.z);if(Math.abs(q.u)>=route.edge(q.s)+2.15)break;const b=route.point(q.s,Math.sign(q.u||1)*(route.edge(q.s)+2.3));p.x=b.x;p.z=b.z;p.setback=Math.hypot(p.x-r.x,p.z-r.z);}
  if(r.kind==='frontage'){const b=street.map.data.buildings.find(b=>b.id===r.id);if(!b)continue;p.building=b;}
  put(street.props,200,p.x,p.z,{...p,kind:'recognition',asset:r.kind});
 }
 const queue=street.map.data.psychiko.arterial?.faros?.queue;
 if(queue){const road=street.network.roads.find(r=>r.id===queue.way);if(road){
  const segs=[];let length=0;for(let i=0;i+3<road.p.length;i+=2){const [x,z,bx,bz]=road.p.slice(i,i+4),L=Math.hypot(bx-x,bz-z);segs.push({x,z,tx:(bx-x)/L,tz:(bz-z)/L,L,s:length});length+=L;}
  queue.fromEnd.forEach((back,i)=>{const d=length-back,g=segs.findLast(g=>g.s<=d);if(!g)return;const t=d-g.s,x=g.x+g.tx*t-g.tz*queue.lateral,z=g.z+g.tz*t+g.tx*queue.lateral,yaw=Math.atan2(g.tx,g.tz);
   if(street.network.mainInside(x,z)||street.network.islandAt(x,z))return;
   put(street.props,200,x,z,{kind:'car',x,z,yaw,color:i===1?10:i%8});street.obstacles.push({x,z,yaw,hl:2.08,hw:.87});
  });
 }}
 const add=(s,u,asset,extra={})=>{const p=route.point(s,u),f=route.frame(s,{});put(street.props,200,p.x,p.z,{kind:'recognition',asset,x:p.x,z:p.z,yaw:Math.atan2(f.tx,f.tz),s,...extra});};
 // Kerb poles/bollards and climbing flowers are individual observations, not a new random Mediterranean filler layer.
 for(const [s,side] of [[2745,1],[3240,-1],[3285,-1],[3330,-1],[3375,-1],[3645,1],[3780,1],[4074,1]])
  for(let d=-4;d<=4;d+=4)add(s+d,side*(route.edge(s+d)+1.25),'bollard');
 for(const [s,side] of [[2745,1],[3915,1],[4005,1],[4455,1],[4950,-1]])add(s,side*(route.edge(s)+2.65),'flowers');
 for(const [s,side] of [[2745,1],[1620,1],[4680,1]])add(s,side*(route.edge(s)+1.9),'scooter');
 // Trolley contact/suspension wires on the actual arterial; a shallow two-span sag uses 8 triangles per span.
 for(let s=5085;s<5730;s+=38){add(s,0,'crosswire',{span:21});add(s,0,'trolleySpan',{length:38});}
 for(const s of [-24,0,26]){add(s,0,'crosswire',{span:32});add(s,0,'trolleySpan',{length:38});}
 for(const s of [5215,5310])add(s,0,'roadSign');
 // The surface slip is separated from the main Kifisias corridor by a steel safety rail, visible from the grid.
 for(let s=5420;s<5725;s+=8)add(s,-(route.edge(s)+.8),'separator',{length:8});
}

export function drawRecognition(street,m,r,box,lathe) {
 const y=street.groundY(r.x,r.z),yaw=r.yaw||0,assets=street.recognitionAssets;
 if(assets[r.asset]){m.add(r.asset==='kiosk'&&r.color!=='#e9e7da'?assets.kioskGreen:assets[r.asset],r.x,y,r.z,yaw);return;}
 const local=(build)=>{const old=m.v;build();const cs=Math.cos(yaw),sn=Math.sin(yaw);for(let i=old;i<m.v;i++){const j=i*3,x=m.p[j],z=m.p[j+2],nx=m.n[j],nz=m.n[j+2];m.p[j]=r.x+x*cs+z*sn;m.p[j+1]+=y;m.p[j+2]=r.z-x*sn+z*cs;m.n[j]=nx*cs+nz*sn;m.n[j+2]=-nx*sn+nz*cs;}};
 if(r.asset==='flowers')local(()=>{for(let k=0;k<4;k++){box(m,k*.65-1,1.8,0,.95,.55,.55,'#4d6940');for(let j=0;j<3;j++)box(m,k*.65-1+j*.18,2.1+j*.08,-.32,.3,.22,.18,'#a94a77');}});
 if(r.asset==='separator')local(()=>{box(m,0,.65,0,.08,.17,r.length,'#a7aaa3');for(const z of [-3,1])box(m,0,0,z,.08,.8,.1,'#7f8b86');});
 if(r.asset==='crosswire')local(()=>{for(const z of [-.45,.45])for(let k=0;k<2;k++){const x0=-r.span/2+k*r.span/2,x1=x0+r.span/2,h0=k?6.3:6.8,h1=k?6.8:6.3;m.quad([x0,h0,z],[x1,h1,z],[x1,h1+.035,z],[x0,h0+.035,z],'#3b4441');m.quad([x1,h1,z],[x0,h0,z],[x0,h0+.035,z],[x1,h1+.035,z],'#3b4441');}});
 if(r.asset==='trolleySpan')local(()=>{for(const x of [-1.4,1.4]){m.quad([x,6.3,-19],[x,6.3,19],[x,6.335,19],[x,6.335,-19],'#3b4441');m.quad([x,6.3,19],[x,6.3,-19],[x,6.335,-19],[x,6.335,19],'#3b4441');}});
 if(r.asset==='roadSign')local(()=>{box(m,0,6.8,0,23,.14,.14,'#949d99');for(const x of [-10,10])box(m,x,0,0,.15,7,.15,'#949d99');for(const x of [-5,0,5]){box(m,x,5.7,0,3.3,1.1,.12,'#376281');box(m,x,6.1,-.08,1.6,.06,.02,'#e0e3d7');}});
 if(r.asset==='frontage'){
  const b=r.building,p=blockFootprint(b.p),n=p.length/2,shell=street.shells.get(b.id);
  // Decorate the two sides closest to public roads, preserving the source footprint and all its concavities.
  const edges=[];for(let i=0;i<n;i++){const j=(i+1)%n,ax=p[i*2],az=p[i*2+1],bx=p[j*2],bz=p[j*2+1],L=Math.hypot(bx-ax,bz-az);if(L<5)continue;const mx=(ax+bx)/2,mz=(az+bz)/2,q=street.network.project(mx,mz);let d=Math.max(0,Math.abs(q.u)-street.route.edge(q.s));for(const seg of street.network.candidates(mx,mz))d=Math.min(d,Math.max(0,street.network.distance(seg,mx,mz)-seg.hw));edges.push({ax,az,bx,bz,L,d});}
  edges.sort((a,b)=>a.d-b.d);
  const heights=p.filter((_,i)=>i%2===0).map((x,i)=>street.height(x,p[i*2+1]));
  const base=(shell?.gmin??Math.min(...heights))-.6,top=shell?.top??Math.max(...heights)+b.h,storey=(top-base)/(b.lv||3);
  for(const e of edges.slice(0,r.commercial?2:1)){
   const dx=(e.bx-e.ax)/e.L,dz=(e.bz-e.az)/e.L,midX=(e.ax+e.bx)/2,midZ=(e.az+e.bz)/2;
   const outward=Math.sign((midX-r.x)*-dz+(midZ-r.z)*dx)||1,nx=-dz*outward,nz=dx*outward;
   const quad=(h0,h1,a0,a1,color,depth=.04)=>{const P=(a,h)=>[e.ax+dx*a+nx*depth,base+h,e.az+dz*a+nz*depth],a=P(a0,h0),bb=P(a1,h0),c=P(a1,h1),d=P(a0,h1);m.quad(a,bb,c,d,color,[midX-nx,base+(h0+h1)/2,midZ-nz]);};
   for(let lv=1;lv<(b.lv||3);lv++){
    const h=lv*storey,projection=r.balcony??1.1;quad(h,h+.25,0,e.L,'#eee9dc',r.commercial?.08:projection);
    if(r.commercial){for(let a=.9;a<e.L-1;a+=3.2){quad(h+.55,h+Math.min(2.3,storey-.3),a,Math.min(a+2.2,e.L-.5),'#64818a',.09);quad(h+.55,h+Math.min(2.3,storey-.3),a+1,a+1.07,'#ddd9ce',.11);}}
    else{
     quad(h+.25,h+1.1,0,e.L,r.accent||'#b6b3a5',projection);quad(h+1.1,h+1.17,0,e.L,'#e9e6db',projection+.05);
     // A visible deck and end returns give the surveyed stacked balconies depth.
     const P=(a,d,y)=>[e.ax+dx*a+nx*d,base+y,e.az+dz*a+nz*d];
     m.quad(P(0,0,h+.25),P(0,projection,h+.25),P(e.L,projection,h+.25),P(e.L,0,h+.25),'#ddd9ca');
     for(const a of [0,e.L])m.quad(P(a,0,h),P(a,projection,h),P(a,projection,h+1.1),P(a,0,h+1.1),r.accent||'#b6b3a5');
    }
   }
   if(r.commercial){
    quad(.25,2.8,.3,e.L-.3,'#3c555a',.12);
    quad(2.85,3.65,.2,e.L-.2,r.accent||'#396b87',.15);
    for(let a=1.7;a<e.L-1;a+=3.1){quad(.2,2.85,a,a+.12,'#e4dfd0',.17);quad(3.1,3.23,a-.7,a+.65,'#ede8d9',.18);}
    // Projecting cream shop awning and dark valance, on the real frontage edge.
    const P=(a,d,h)=>[e.ax+dx*a+nx*d,base+h,e.az+dz*a+nz*d];
    m.quad(P(.3,.1,2.85),P(e.L-.3,.1,2.85),P(e.L-.3,1.3,2.55),P(.3,1.3,2.55),'#d9d1b8');
    quad(2.4,2.58,.3,e.L-.3,r.accent||'#486777',1.3);
   }else if(r.residential){
    // Terrace parapet follows the unchanged footprint; shallow coping reads at street height.
    const h=top-base;quad(h,h+.55,.1,e.L-.1,'#ddd9cd',.08);quad(h+.55,h+.64,0,e.L,'#f0ece1',.12);
    if(r.pergola&&e.L>8){const P=(a,d,h)=>[e.ax+dx*a+nx*d,base+h,e.az+dz*a+nz*d];
      for(let a=1;a<Math.min(e.L-1,10);a+=1.2)m.quad(P(a,0,h+2.1),P(a+.12,0,h+2.1),P(a+.12,-2.3,h+2.1),P(a,-2.3,h+2.1),'#89765b');
      for(const a of [1,Math.min(e.L-1,9)])quad(h,h+2.1,a,a+.1,'#89765b',.12);
    }
   }
  }
 }
}
