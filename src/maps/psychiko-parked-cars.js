// Static street fleet: reuse the traffic fleet's body/greenhouse stations, reduced to a few hundred
// triangles. No registrations, interiors, animated wheel groups or per-car materials/textures.
import { PASSENGER_MODELS } from '../traffic-passenger-shapes.js';

export const PARKED_CAR_COLORS = ['#eeeeea', '#d0d2d2', '#8e9597', '#292d30', '#e4e5df', '#acb1b2', '#5d6468', '#202426', '#303d55', '#953d36', '#e9c546'];
export const PARKED_CAR_TYPES = ['city', 'sedan', 'suv'];

export function parkedCarTemplates(template, box) {
  return PARKED_CAR_TYPES.map(id => template(m => {
    const d = PASSENGER_MODELS[id], sx = Math.min(1, 1.68 / d.W), sz = Math.min(1, 4.04 / d.L);
    const p = (x,y,z) => [x*sx,y,z*sz], paint = '#ffffff', glass = '#253b48', rubber = '#171c20';
    const quad = (a,b,c,e,color,inside=[0,.7,0]) => m.quad(p(...a),p(...b),p(...c),p(...e),color,p(...inside));
    const section = z => { let i=1;while(i<d.sections.length-1&&z>d.sections[i][0])i++;const a=d.sections[i-1],b=d.sections[i],t=(z-a[0])/(b[0]-a[0]);return [a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]; };
    const axles = [-d.wb/2+d.ax,d.wb/2+d.ax], arch=d.r+.035;
    const zs=[-d.L/2,d.cowl,d.back,d.L/2];
    for(const z of axles)for(let k=0;k<=4;k++)zs.push(z+Math.cos(k*Math.PI/4)*arch);
    zs.sort((a,b)=>a-b);
    // The lower edge really follows the wheel openings; a black rectangular slab never hides the tyres.
    m.stone=255;
    for(let k=1;k<zs.length;k++){
      const a=zs[k-1],b=zs[k],[wa,ha]=section(a),[wb,hb]=section(b);
      const bottom=z=>Math.max(.24,...axles.map(ax=>Math.abs(z-ax)<arch?d.r+Math.sqrt(Math.max(0,arch*arch-(z-ax)**2)):.24));
      for(const s of [-1,1])quad([s*wa,bottom(a),a],[s*wb,bottom(b),b],[s*wb,hb,b],[s*wa,ha,a],paint);
      // Crown the bonnet and boot; the cabin closes the central deck.
      if(b<=d.cowl+.001||a>=d.back-.001)quad([-wa,ha,a],[wa,ha,a],[wb,hb,b],[-wb,hb,b],paint);
    }
    for(const s of [-1,1]){const z=s*d.L/2,[w,h]=section(z);quad([-w,.24,z],[w,.24,z],[w,h,z],[-w,h,z],paint);}
    const bw=d.W/2-.12,rw=d.rw,H=d.H-.04,A=[d.cowl,d.belt],B=[d.header,H],D=[d.back,d.belt+(d.windowRise||0)],E=[d.roofBack,H-(d.roofDrop||.05)];
    quad([-rw,B[1],B[0]],[rw,B[1],B[0]],[rw,E[1],E[0]],[-rw,E[1],E[0]],paint);
    m.stone=0;
    quad([-bw,A[1],A[0]],[bw,A[1],A[0]],[rw,B[1],B[0]],[-rw,B[1],B[0]],glass);
    quad([-rw,E[1],E[0]],[rw,E[1],E[0]],[bw,D[1],D[0]],[-bw,D[1],D[0]],glass);
    for(const s of [-1,1]){
      quad([s*bw,A[1],A[0]],[s*rw,B[1],B[0]],[s*rw,E[1],E[0]],[s*bw,D[1],D[0]],glass);
      m.stone=255;
      for(const [base,top,dz] of [[A,B,.065],[D,E,-.10]])quad([s*(bw+.008),base[1],base[0]],[s*(rw+.008),top[1],top[0]],[s*(rw+.008),top[1],top[0]+dz],[s*(bw+.008),base[1],base[0]+dz],paint);
      const t=(d.b-B[0])/(E[0]-B[0]),roof=B[1]+(E[1]-B[1])*t;
      m.stone=0;quad([s*(bw+.012),d.belt,d.b-.045],[s*(rw+.012),roof,d.b-.045],[s*(rw+.012),roof,d.b+.045],[s*(bw+.012),d.belt,d.b+.045],rubber);
      m.stone=255;box(m,s*.80,d.belt+.01,(d.cowl+.15)*sz,.10,.09,.16,paint);
    }
    m.stone=0;
    for(const z of axles)for(const s of [-1,1]){
      const inner=s*(d.W/2-.14)*sx,outer=s*.855,hub=outer+s*.006,r=d.r;
      const point=(x,a,rr)=>[x,r+Math.sin(a)*rr,(z+Math.cos(a)*rr)*sz];
      for(let k=0;k<8;k++){
        const a=k*Math.PI/4,b=(k+1)*Math.PI/4;
        m.quad(point(inner,a,r),point(outer,a,r),point(outer,b,r),point(inner,b,r),rubber,[0,r,z*sz]);
        m.tri(outer,r,z*sz,...point(outer,a,r),...point(outer,b,r),rubber,[0,r,z*sz]);
        m.tri(hub,r,z*sz,...point(hub,a,r*.58),...point(hub,b,r*.58),'#9ba5ab',[0,r,z*sz]);
      }
    }
    // Lamps, plate faces and grille remain their own colours even on a black or red car.
    for(const end of [-1,1]){
      const z=end*(d.L/2+.012),h=section(end*d.L/2)[1];
      for(const s of [-1,1])quad([s*.38,h-.15,z],[s*.70,h-.15,z],[s*.70,h-.025,z],[s*.38,h-.025,z],end<0?'#d6e2de':'#a42f30');
      quad([-.24,.43,z],[.24,.43,z],[.24,.54,z],[-.24,.54,z],'#d6d9d1');
      if(end<0)quad([-.28,.62,z],[.28,.62,z],[.28,.70,z],[-.28,.70,z],rubber);
    }
  }));
}
