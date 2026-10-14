// Local OSM axes leave saved race stations and logical lane coordinates intact.
// The same C1 surface supplies the road sweep, inverse projection, wheel contacts and rock shells.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,s)=>{const t=clamp((s-a)/(b-a),0,1);return t*t*t*(10+t*(-15+6*t));};
function hermite(a,b,ma,mb,t,span){const t2=t*t,t3=t2*t;return (2*t3-3*t2+1)*a+(t3-2*t2+t)*ma*span+(-2*t3+3*t2)*b+(t3-t2)*mb*span;}
export class LocalCarriageways {
 constructor(route,metadata){this.route=route;this.bores=metadata.map(meta=>this.corridor(meta));this.min=Math.min(...this.bores.map(b=>b.transitionS[0]));this.max=Math.max(...this.bores.map(b=>b.transitionS[1]));}
 contains(s){return s>this.min&&s<this.max;}
 portal(s){return this.bores.some(b=>s>=b.portalS[0]&&s<=b.portalS[1]);}
 base(s,u,out={}){const f=this.route.frame(s,{});out.x=f.x+f.rx*u;out.z=f.z+f.rz*u;out.y=this.route.surfaceY(s,u);return out;}
 centreU(s,dir){return dir*(this.route.medHalf(s)+this.route.edge(s))/2;}
 weight(b,s){return smooth(b.transitionS[0],b.portalS[0],s)*(1-smooth(b.portalS[1],b.transitionS[1],s));}
 scale(b,s){return 1+(b.width/(this.route.edge(s)-this.route.medHalf(s))-1)*this.weight(b,s);}
 corridor(meta){
  const route=this.route,dir=meta.direction,stations=meta.axis.map(([x,z],i)=>i===0?meta.portalS[0]:i===meta.axis.length-1?meta.portalS[1]:route._projectBase(x,z,null).s);
  const points=meta.axis.map(([x,z],i)=>({s:stations[i],x,z}));
  const lo=meta.transitionS[0],hi=meta.transitionS[1];
  const a=this.base(lo,this.centreU(lo,dir)),b=this.base(hi,this.centreU(hi,dir));
  points.unshift({s:lo,x:a.x,z:a.z});points.push({s:hi,x:b.x,z:b.z});
  for(let i=0;i<points.length;i++){
   const p=points[i];let l=points[Math.max(0,i-1)],r=points[Math.min(points.length-1,i+1)];
   // At portals retain the real axis tangent; transitions join it without a corner.
   if(i===1)l=p;if(i===points.length-2)r=p;
   if(i===0||i===points.length-1){const L=this.base(p.s-.25,this.centreU(p.s-.25,dir)),R=this.base(p.s+.25,this.centreU(p.s+.25,dir));p.mx=(R.x-L.x)/.5;p.mz=(R.z-L.z)/.5;}
   else {p.mx=(r.x-l.x)/(r.s-l.s);p.mz=(r.z-l.z)/(r.s-l.s);}
  }
  const axis=(s,out={})=>{if(s<=lo||s>=hi)return this.base(s,this.centreU(s,dir),out);
   if(s<stations[0]){const A=points[0],B=points[1],span=B.s-A.s,t=(s-A.s)/span;out.x=hermite(A.x,B.x,A.mx,B.mx,t,span);out.z=hermite(A.z,B.z,A.mz,B.mz,t,span);out.y=route.surfaceY(s,this.centreU(s,dir));return out;}
   if(s>stations[stations.length-1]){const entry=s<stations[0],P=points[entry?1:points.length-2],span=entry?P.s-lo:hi-P.s,dt=s-P.s,t=entry?(s-lo)/span:(hi-s)/span,w=smooth(0,1,t),base=this.base(s,this.centreU(s,dir),out),anchor=this.base(P.s,this.centreU(P.s,dir),{}),L=this.base(P.s-.25,this.centreU(P.s-.25,dir),{}),R=this.base(P.s+.25,this.centreU(P.s+.25,dir),{}),f=route.frame(P.s,{}),fl=route.frame(P.s-.25,{}),fr=route.frame(P.s+.25,{}),now=route.frame(s,{}),dx=P.x-anchor.x,dz=P.z-anchor.z,mx=P.mx-(R.x-L.x)/.5,mz=P.mz-(R.z-L.z)/.5;
    const U=dx*f.rx+dz*f.rz,T=dx*f.tx+dz*f.tz,mu=mx*f.rx+mz*f.rz+dx*(fr.rx-fl.rx)/.5+dz*(fr.rz-fl.rz)/.5,mt=mx*f.tx+mz*f.tz+dx*(fr.tx-fl.tx)/.5+dz*(fr.tz-fl.tz)/.5;
    // Match the portal tangent locally; bounded decay prevents a long Hermite join from crossing the other bore.
    const du=w*(U+mu*dt*Math.exp(-Math.abs(dt)/24)),dtan=w*(T+mt*dt*Math.exp(-Math.abs(dt)/24));base.x+=du*now.rx+dtan*now.tx;base.z+=du*now.rz+dtan*now.tz;return base;
   }let i=0;while(i+1<points.length-1&&s>points[i+1].s)i++;const A=points[i],B=points[i+1],span=B.s-A.s,t=clamp((s-A.s)/span,0,1);out.x=hermite(A.x,B.x,A.mx,B.mx,t,span);out.z=hermite(A.z,B.z,A.mz,B.mz,t,span);out.y=route.surfaceY(s,this.centreU(s,dir));return out;};
  // The exit join costs ~16 route frames per axis call (a point needs three), and every wheel, car, pedestrian and
  // inverse projection past the bores queries it each frame: that froze the game right after the tunnel. Sample that
  // span once on a 5 cm table (error far under a millimetre); the knots and the rest stay exact.
  const exact=axis,t0=stations[stations.length-1],count=Math.ceil((hi-t0)/.05)+1,step=(hi-t0)/(count-1),AX=new Float64Array(count),AZ=new Float64Array(count);
  for(let i=0;i<count;i++){const q=exact(i===0?t0+1e-9:i===count-1?hi-1e-9:t0+i*step,{});AX[i]=q.x;AZ[i]=q.z;}
  const table=(s,out={})=>{if(s<=t0||s>=hi)return exact(s,out);const f=(s-t0)/step,i=Math.min(count-2,Math.floor(f)),t=f-i;out.x=AX[i]+(AX[i+1]-AX[i])*t;out.z=AZ[i]+(AZ[i+1]-AZ[i])*t;out.y=route.surfaceY(s,this.centreU(s,dir));return out;};
  const point=(s,lateral=0,out={})=>{const p=table(s,out),L=table(s-.1,{}),R=table(s+.1,{}),dx=R.x-L.x,dz=R.z-L.z,len=Math.hypot(dx,dz)||1;const f=route.frame(s,{}),w=this.weight(meta,s),nx=f.rx*(1-w)-dz/len*w,nz=f.rz*(1-w)+dx/len*w,N=Math.hypot(nx,nz)||1;p.x+=nx/N*lateral;p.z+=nz/N*lateral;p.y=route.surfaceY(s,this.centreU(s,dir)+lateral/this.scale(meta,s));return p;};
  const frame=(s,out={})=>{const p=point(s,0,{}),L=point(s-.25,0,{}),R=point(s+.25,0,{}),dx=R.x-L.x,dz=R.z-L.z,len=Math.hypot(dx,dz)||1;Object.assign(out,p,{tx:dx/len,tz:dz/len,rx:-dz/len,rz:dx/len,grade:(R.y-L.y)/len});return out;};
  return {...meta,stations,axis3D:meta.axis.map(([x,z],i)=>[x,route.surfaceY(stations[i],this.centreU(stations[i],dir)),z]),point,frame,floorY:(s,lateral=0)=>point(s,lateral,{}).y};
 }
 bore(s,dir){return this.bores.find(b=>b.direction===dir&&s>b.transitionS[0]&&s<b.transitionS[1]);}
 map(s,u,out={}){
  const mh=this.route.medHalf(s);
  if(Math.abs(u)<mh){const L=this.map(s,-mh,{}),R=this.map(s,mh,{}),t=(u+mh)/(2*mh);out.x=L.x+(R.x-L.x)*t;out.z=L.z+(R.z-L.z)*t;out.y=this.route.surfaceY(s,u);return out;}
  const dir=u>=0?1:-1,b=this.bore(s,dir);if(!b)return this.base(s,u,out);
  return b.point(s,(u-this.centreU(s,dir))*this.scale(b,s),out);
 }
 inverse(x,z,guess,hint=null){
  const seeds=[guess.s];if(hint!==null&&this.contains(hint))seeds.unshift(hint);let result=guess,bestError=Infinity;
  for(const start of seeds)for(const dir of [-1,1]){let s=start;const centre=this.centreU(s,dir),f=this.map(s,centre,{}),normal=this.map(s,centre+1,{}),nx=normal.x-f.x,nz=normal.z-f.z;
   let u=centre+((x-f.x)*nx+(z-f.z)*nz)/(nx*nx+nz*nz);
   for(let i=0;i<20;i++){
    const mh=this.route.medHalf(s);u=dir>0?Math.max(mh,u):Math.min(-mh,u);
    const p=this.map(s,u,{}),dx=x-p.x,dz=z-p.z;if(dx*dx+dz*dz<1e-16)break;
    const S0=this.map(s-.01,u,{}),S1=this.map(s+.01,u,{}),U0=this.map(s,u-.001,{}),U1=this.map(s,u+.001,{}),sx=(S1.x-S0.x)/.02,sz=(S1.z-S0.z)/.02,ux=(U1.x-U0.x)/.002,uz=(U1.z-U0.z)/.002,det=sx*uz-sz*ux;
    if(Math.abs(det)<1e-9)break;s=clamp(s+clamp((dx*uz-dz*ux)/det,-8,8),this.min-.1,this.max+.1);u+=clamp((sx*dz-sz*dx)/det,-8,8);
   }
   const p=this.map(s,u,{}),error=(p.x-x)**2+(p.z-z)**2;
   if(error<bestError){result={s,u};bestError=error;}if(error<1e-16)return result;
  }
  return result;
 }
 frame(s,u,out={}){const p=this.map(s,u,{}),L=this.map(s-.25,u,{}),R=this.map(s+.25,u,{}),dx=R.x-L.x,dz=R.z-L.z,len=Math.hypot(dx,dz)||1,A=this.map(s,u-.1,{}),B=this.map(s,u+.1,{});Object.assign(out,p,{tx:dx/len,tz:dz/len,rx:-dz/len,rz:dx/len,grade:(R.y-L.y)/len,bank:(B.y-A.y)/(Math.hypot(B.x-A.x,B.z-A.z)||.2),mapped:true});return out;}
 carveTerrain(terrain,H,stamp){const {GX,GZ,T,minX,minZ}=terrain;
  for(const bore of this.bores){const R=bore.width/2+T*1.5;for(let s=bore.transitionS[0];s<=bore.transitionS[1];s+=4){const p=bore.point(s,0,{});stamp(p.x,p.z,R+T*2);const f=bore.frame(s,{});
   for(let j=Math.max(0,Math.floor((p.z-R-minZ)/T));j<=Math.min(GZ-1,Math.ceil((p.z+R-minZ)/T));j++)for(let i=Math.max(0,Math.floor((p.x-R-minX)/T));i<=Math.min(GX-1,Math.ceil((p.x+R-minX)/T));i++){
    const x=minX+i*T,z=minZ+j*T,along=(x-p.x)*f.tx+(z-p.z)*f.tz,u=(x-p.x)*f.rx+(z-p.z)*f.rz;if(Math.abs(along)>T*.75||Math.abs(u)>R)continue;
    H[j*GX+i]=Math.min(H[j*GX+i],bore.floorY(s,clamp(u,-bore.width/2,bore.width/2))-.32);
   }
  }}
 }
}
