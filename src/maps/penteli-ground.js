import { Ground } from '../ground.js';

// Index the exact gravel/fill triangles. A visual embankment must also carry
// wheels; the generic Riviera sidewalk profile is not present on this road.
export function roadSurfaceSampler(group) {
  const cells=new Map(),size=16;
  for(const mesh of group.children){const g=mesh.geometry;if(!g?.index)continue;const p=g.attributes.position.array,ix=g.index.array;
    for(let k=0;k<ix.length;k+=3){const a=ix[k]*3,b=ix[k+1]*3,c=ix[k+2]*3,det=(p[b+2]-p[c+2])*(p[a]-p[c])+(p[c]-p[b])*(p[a+2]-p[c+2]);if(Math.abs(det)<1e-9)continue;
      const tri={p,a,b,c,det};
      for(let x=Math.floor(Math.min(p[a],p[b],p[c])/size);x<=Math.floor(Math.max(p[a],p[b],p[c])/size);x++)for(let z=Math.floor(Math.min(p[a+2],p[b+2],p[c+2])/size);z<=Math.floor(Math.max(p[a+2],p[b+2],p[c+2])/size);z++){
        const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(tri);
      }
    }
  }
  return (x,z)=>{let height=-Infinity;
    for(const {p,a,b,c,det} of cells.get(Math.floor(x/size)+','+Math.floor(z/size))||[]){
      const u=((p[b+2]-p[c+2])*(x-p[c])+(p[c]-p[b])*(z-p[c+2]))/det,v=((p[c+2]-p[a+2])*(x-p[c])+(p[a]-p[c])*(z-p[c+2]))/det;
      if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001)height=Math.max(height,u*p[a+1]+v*p[b+1]+(1-u-v)*p[c+1]);
    }return Number.isFinite(height)?height:null;
  };
}
export class PenteliGround extends Ground {
  constructor(map,heightC,assets,road){
    const surface=roadSurfaceSampler(road.group);
    super(map,(x,z)=>Math.max(heightC(x,z),surface(x,z)??-Infinity),assets);
    this.vergeSurface=surface;
  }
  at(x,z,s,u,out=this.out){
    // Preserve the main race's smooth road plane; outside it use the actual
    // network/shoulder/cut triangles, without invented pavement or kerb steps.
    if(Math.abs(u)<=this.route.edge(s))return super.at(x,z,s,u,out);
    out.water=0;out.hump=0;out.trap=null;out.network=true;out.networkStep=0;
    const n=this.network?.sample(x,z,this._net||(this._net={}));
    if(n){out.y=n.y;out.surf=n.surf;out.networkStep=n.step;return out;}
    out.y=this.heightC(x,z);out.surf=Math.abs(u)<this.route.edge(s)+3?'gravel':'dirt';return out;
  }
  _curbs() { /* The photographed Penteli road has gravel margins, not raised kerbs. */ }
}
