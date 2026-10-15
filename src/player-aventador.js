// Original procedural SVJ shell. Metres, nose -Z; no Huracán mesh reuse.
import * as THREE from 'three';
export const AVENTADOR = {L:4.943,W:2.098,H:1.136,wb:2.70,track:1.72,r:.355,rim:.254,tyreF:.255,tyreR:.355,belt:.77,front:.48,rear:.84,cowl:-1.10,header:-.44,roofBack:.48,back:1.10,seatZ:-.03,eyeY:.89,seatBase:.29,seats:2,doors:2,leather:'#202322',axleOffset:.14};
export function buildAventador(car,d,M,low,H){
 const {surface,patch,box,line,mesh,cabinFittings,wheels,makePlateMaterial}=H,p=car.body,F=-d.L/2,R=d.L/2;
 M.tail.color.set('#8d0009');M.tail.emissive.set('#650002');M.tail.toneMapped=false;
 const polygon=(points,mat,name)=>{const a=[];for(let i=1;i<points.length-1;i++)a.push(...points[0],...points[i],...points[i+1]);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(a,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(a.length/3*2),2));g.computeVertexNormals();return mesh(p,g,mat,[0,0,0],[0,0,0],name);};
 const stations=[[F,.78,.43],[-2.12,.96,.58],[-1.21,1.049,.80],[-.7,.97,.78],[.25,.97,.80],[1.1,1.049,.88],[1.6,1.02,.88],[R,.88,.80]];
 const at=(z,k)=>{for(let i=1;i<stations.length;i++)if(z<=stations[i][0]){const a=stations[i-1],b=stations[i],t=(z-a[0])/(b[0]-a[0]);return a[k]+(b[k]-a[k])*t;}return stations.at(-1)[k];};
 for(const s of [-1,1]){
  surface(p,M.paint,(u,v)=>{const z=F+d.L*u;let base=.15;for(const a of [-1.21,1.49])if(Math.abs(z-a)<.39)base=Math.max(base,.355+Math.sqrt(.39**2-(z-a)**2));const y=base+(at(z,2)-base)*v;return[s*(at(z,1)-.10*(1-v)-.06*Math.sin(v*Math.PI)),y,z];},180,5,'body-side');
  polygon([[s*.99,.25,.20],[s*1.055,.78,.67],[s*1.053,.85,1.12],[s*.99,.32,.89]],M.black,'svj-deep-side-intake');
  line(p,M.paint,[[s*.99,.25,.20],[s*1.055,.78,.67],[s*1.053,.85,1.12]],.018);
  line(p,M.seam,[[s*.96,.78,-1.04],[s*.94,.24,-.86],[s*.94,.20,.17],[s*.99,.73,.46]],.003);
  box(p,M.black,[.08,.045,2.0],[s*.98,.14,.05],.008,[0,0,0],'svj-carbon-sill');
 }
 for(const [a,b,name]of [[F,d.cowl,'bonnet'],[d.back,R,'engine-cover']])surface(p,M.paint,(u,v)=>{const z=a+(b-a)*u,x=(v*2-1)*at(z,1);return[x,at(z,2)-.05*(1-(v*2-1)**2),z];},36,12,name);
 for(const z of [F,R])patch(p,M.paint,[[-at(z,1),.20,z],[at(z,1),.20,z],[at(z,1),at(z,2),z],[-at(z,1),at(z,2),z]],z<0?'front-bumper':'rear-bumper');
 car.windscreen=patch(p,M.glass,[[-.84,.78,-1.10],[.84,.78,-1.10],[.70,1.116,-.44],[-.70,1.116,-.44]],'windscreen');
 patch(p,M.paint,[[-.70,1.116,-.44],[.70,1.116,-.44],[.69,1.10,.48],[-.69,1.10,.48]],'roof');
 patch(p,M.cloth,[[-.69,1.10,-.43],[.69,1.10,-.43],[.68,1.084,.47],[-.68,1.084,.47]],'headliner');
 patch(p,M.glass,[[-.69,1.10,.48],[.69,1.10,.48],[.75,.83,1.10],[-.75,.83,1.10]],'rear-glass');
 for(const s of [-1,1]){
  polygon([[s*.84,.78,-1.10],[s*.70,1.116,-.44],[s*.69,1.10,.48],[s*.83,.81,.76]],M.glass,'front-door-glass');
  line(p,M.paint,[[s*.84,.78,-1.10],[s*.70,1.116,-.44],[s*.69,1.10,.48],[s*.83,.81,.76]],.025);
  polygon([[s*.69,1.10,.48],[s*.75,.83,1.1],[s*1.03,.86,1.32],[s*.83,.81,.76]],M.paint,'svj-flying-buttress');
  box(p,M.black,[.21,.025,.05],[s*.95,.84,-.83],.005);
  box(p,M.paint,[.25,.085,.14],[s*1.10,.87,-.83],.015,[0,s*.15,0],'mirror-housing');
  car[s<0?'mirrorL':'mirrorR']=mesh(p,new THREE.PlaneGeometry(.22,.063),M.chrome,[s*1.10,.87,-.754]);
  polygon([[s*.36,.53,-2.32],[s*.85,.60,-2.15],[s*.91,.69,-1.94],[s*.52,.65,-2.02]],M.head,'svj-headlamp');
  const y=[[s*.46,.568,-2.25],[s*.65,.625,-2.10],[s*.82,.65,-2.04]];line(p,M.led,y,.010);line(p,M.led,[y[1],[s*.62,.66,-1.99]],.010);
  polygon([[s*.28,.22,F-.008],[s*.81,.23,F-.008],[s*.76,.43,F-.008],[s*.48,.44,F-.008]],M.black,'svj-front-hex-intake');
  // Three Ypsilon elements per rear light, beneath the fixed wing.
  for(let j=0;j<3;j++){const x=s*(.48+j*.16);line(p,M.tail,[[x-s*.06,.75,R+.012],[x,.70,R+.012],[x+s*.06,.75,R+.012]],.012);line(p,M.tail,[[x,.70,R+.012],[x,.66,R+.012]],.012);}
  box(p,M.black,[.055,.31,.15],[s*.54,1.01,1.96],.005,[.12,0,0],'svj-wing-upright');
  box(p,M.black,[.025,.19,.48],[s*.97,1.22,2.03],.005,[0,0,0],'svj-wing-endplate');
 }
 box(p,M.black,[1.94,.06,.47],[0,1.17,2.03],.01,[.08,0,0],'svj-fixed-wing');
 box(p,M.black,[1.75,.045,.28],[0,.17,F+.04],.005,[0,0,0],'svj-ala-splitter');
 box(p,M.black,[1.76,.28,.08],[0,.42,R+.015],.005,[0,0,0],'svj-ypsilon-rear');
 for(const x of [-.72,-.42,0,.42,.72])box(p,M.black,[.025,.16,.40],[x,.22,R-.12],.003,[0,0,0],'svj-diffuser-fin');
 for(let j=0;j<7;j++)box(p,M.black,[.98,.028,.055],[0,.86,1.2+j*.105],.003,[.1,0,0],'svj-engine-louvre');
 car.exhaust=[];
 for(const x of [-.155,.155]){mesh(p,new THREE.CylinderGeometry(.09,.09,.20,6,true),M.chrome,[x,.72,R+.045],[Math.PI/2,0,0],'svj-exhaust-tip');mesh(p,new THREE.CircleGeometry(.075,6),M.black,[x,.72,R+.148]);car.exhaust.push(new THREE.Vector3(x,.72,R+.15));}
 mesh(p,new THREE.PlaneGeometry(.10,.12),M.badge,[0,.485,-2.32],[-Math.PI/2+.35,0,Math.PI],'brand-badge');
 const plate=makePlateMaterial('SVJ 0770');car.plate=plate;mesh(p,new THREE.PlaneGeometry(.52,.112),plate,[0,.39,R+.066],[0,0,0],'registration');
 box(p,M.black,[1.7,.04,4.5],[0,.15,0],.005,[0,0,0],'undertray');
 cabinFittings(car,d,M,low);wheels(car,d,M,low);
}
