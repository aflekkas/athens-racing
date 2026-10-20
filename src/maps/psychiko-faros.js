// Paved commercial forecourts and small junction furniture. Authored from numeric survey notes;
// reference imagery is never loaded here. All surfaces/furniture join the existing streetscape cells.
export function indexFaros(street,put) {
  const F=street.map.data.psychiko?.arterial?.faros;if(!F)return;
  const P=street.map.data.proj,cx=(F.openApron.lon-P.lon0)*P.mlon,cz=-(F.openApron.lat-P.lat0)*P.mlat;
  // Tile the open commercial apron, excluding the residential gardens northwest of the junction.
  // Clipping uses the actual route and OSM carriageways/footways at runtime, including junction mouths.
  for(let dx=-98;dx<118;dx+=5)for(let dz=-88;dz<128;dz+=5){
    if(Math.hypot(dx,dz)>130||dx<18&&dz<5&&Math.hypot(dx,dz)>78)continue;
    put(street.props,200,cx+dx,cz+dz,{kind:'farosPaving',x:cx+dx,z:cz+dz,size:5});
  }
  const inside=(x,z,p)=>{let hit=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)if((p[i+1]>z)!==(p[j+1]>z)&&x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i])hit=!hit;return hit;};
  const buildings=street.map.data.buildings.filter(b=>b.p.some((v,i)=>i%2===0&&Math.hypot(v-cx,b.p[i+1]-cz)<160));
  // Resolve approximate observations onto free pavement: protect full furniture extents from roads/buildings.
  const place=(dx,dz,hw,hl,yaw=0)=>{
    const cs=Math.cos(yaw),sn=Math.sin(yaw),offsets=[];
    for(let a=-8;a<=8;a+=2)for(let b=-8;b<=8;b+=2)offsets.push([a,b]);offsets.sort((a,b)=>Math.hypot(...a)-Math.hypot(...b));
    for(const [a,b] of offsets){const x=cx+dx+a,z=cz+dz+b;let clear=true;
      for(const u of [-hw,0,hw])for(const v of [-hl,0,hl]){const px=x+cs*u+sn*v,pz=z-sn*u+cs*v;
        if(street.network.mainInside(px,pz)||street.network.candidates(px,pz).some(s=>street.network.distance(s,px,pz)<s.hw+.3)||buildings.some(b=>inside(px,pz,b.p)))clear=false;
      }
      if(clear)return{x,z};
    }return null;
  };
  // Locations are approximate pavement observations, relative to the existing OSM junction anchor.
  for(const [dx,dz,asset,yaw,hw,hl] of [[22,38,'kiosk',-.55,2.5,2.3],[64,-37,'busShelter',-.55,2.5,1.1],[26,25,'planter',-.55,1.4,.6],[24,58,'planter',-.55,1.4,.6],[44,-6,'planter',-.55,1.4,.6]]){
    const p=place(dx,dz,hw,hl,yaw);if(p)put(street.props,200,p.x,p.z,{kind:'recognition',asset,...p,yaw,color:'#e9e7da'});
  }
  // Small pavement trees, deliberately sparse enough to keep the junction open. Each has a soil pit.
  for(const [dx,dz] of [[25,49],[26,19],[46,-18],[14,83],[-15,-22],[-25,-6],[-22,-43],[-45,-28]]){
    const p=place(dx,dz,1,1);if(!p)continue;
    put(street.props,200,p.x,p.z,{kind:'recognition',asset:'treePit',...p});
    put(street.canopy,320,p.x,p.z,{kind:'tree',...p,sp:4,h:5.2,seed:Math.round(dx*dz),pavement:true});
  }
}

export function drawFarosPaving(street,m,r) {
  const net=street.network;
  const clearance=(x,z)=>{
    let d=Infinity;
    if(net.nearMain(x,z)){const q=net.project(x,z);d=Math.abs(q.u)-street.route.edge(q.s)-.22;}
    for(const seg of net.candidates(x,z))d=Math.min(d,net.distance(seg,x,z)-seg.hw-seg.sw-.015);
    // Preserve the planted islands, including their existing concrete kerbs.
    if(net.islandAt(x,z))d=-1;
    return d;
  };
  const p=(x,z)=>[x,net.height(x,z)+.13,z];
  const clip=poly=>{
    const out=[];for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const a=poly[j],b=poly[i],da=clearance(...a),db=clearance(...b);
      if((da>0)!==(db>0)){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
      if(db>0)out.push(b);
    }return out;
  };
  m.stone=64;
  // Small triangles conform to the unchanged elevation surface, with boundaries clipped to road edges.
  for(let x=r.x;x<r.x+r.size;x+=2.5)for(let z=r.z;z<r.z+r.size;z+=2.5){
    const a=[x,z],b=[x+2.5,z],c=[x+2.5,z+2.5],d=[x,z+2.5];
    for(const tri of [[a,b,c],[a,c,d]]){
      const mid=tri.reduce((a,p)=>[a[0]+p[0]/3,a[1]+p[1]/3],[0,0]);if(net.islandAt(...mid))continue;
      const poly=clip(tri),color=(Math.floor(x/2.5)+Math.floor(z/2.5))%2?'#aaa99f':'#aeada3';
      for(let i=1;i+1<poly.length;i++)m.tri(...p(...poly[0]),...p(...poly[i+1]),...p(...poly[i]),color);
    }
  }
  m.stone=0;
}
