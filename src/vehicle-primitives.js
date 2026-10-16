// Owner-directed blocky vehicle primitives. These exports are local to vehicle
// builders: world geometry and physics continue to use Three.js directly.
export * from 'three';
import * as T from 'three';
export class RoundedBoxGeometry extends T.BoxGeometry {
  constructor(w=1,h=1,d=1){super(w,h,d);}
}
export class SphereGeometry extends T.SphereGeometry {
  constructor(r=1,w=8,h=4,...rest){super(r,Math.min(w,8),Math.min(h,4),...rest);}
}
export class CylinderGeometry extends T.CylinderGeometry {
  constructor(a=1,b=1,h=1,n=8,rows=1,...rest){super(a,b,h,Math.min(n,4),Math.min(rows,1),...rest);}
}
export class CircleGeometry extends T.CircleGeometry {
  constructor(r=1,n=8,...rest){super(r,Math.min(n,8),...rest);}
}
export class TorusGeometry extends T.TorusGeometry {
  constructor(r=1,t=.4,radial=3,tubular=8,...rest){super(r,t,Math.min(radial,3),Math.min(tubular,8),...rest);}
}
// Preserve actual corners in trim paths. Uniformly sampling a closed rectangle
// cuts across the windscreen; this samples the simplified polyline by vertex.
function simplifyPath(points,tolerance=.02){
 if(points.length<=2)return points;
 const a=points[0],b=points.at(-1),ab=b.clone().sub(a),len=ab.lengthSq();let far=0,index=0;
 for(let i=1;i<points.length-1;i++){const t=len?T.MathUtils.clamp(points[i].clone().sub(a).dot(ab)/len,0,1):0,d=points[i].distanceToSquared(a.clone().addScaledVector(ab,t));if(d>far){far=d;index=i;}}
 if(far<=tolerance*tolerance)return[a,b];
 return [...simplifyPath(points.slice(0,index+1),tolerance).slice(0,-1),...simplifyPath(points.slice(index),tolerance)];
}
class CornerPath extends T.Curve{
 constructor(points){super();this.points=points;}
 getPoint(t,target=new T.Vector3()){const v=t*(this.points.length-1),i=Math.min(this.points.length-2,Math.floor(v));return target.copy(this.points[i]).lerp(this.points[i+1],v-i);}
 getPointAt(t,target){return this.getPoint(t,target);}
}
export class TubeGeometry extends T.TubeGeometry {
 constructor(path,n=6,r=1,radial=3,closed=false){
  let points=path?.curves?.length?[path.curves[0].getPoint(0),...path.curves.map(c=>c.getPoint(1))]:path?.getPoints(Math.min(n,12));
  if(points){points=simplifyPath(points);path=new CornerPath(points);n=points.length-1;}
  super(path,n,r,Math.min(radial,3),closed);
 }
}
export class LatheGeometry extends T.LatheGeometry {
  constructor(points,n=8,...rest){super(points,Math.min(n,8),...rest);}
}
export class CapsuleGeometry extends T.CapsuleGeometry {
  constructor(r=1,h=1,caps=1,n=4){super(r,h,Math.min(caps,1),Math.min(n,4));}
}
export class ExtrudeGeometry extends T.ExtrudeGeometry {
  constructor(shape,options={}){super(shape,{...options,curveSegments:Math.min(options.curveSegments??4,2),bevelEnabled:false,bevelSegments:1,steps:1});}
}

export class PlaneGeometry extends T.PlaneGeometry {
 constructor(w=1,h=1,x=1,y=1){super(w,h,Math.min(x,4),Math.min(y,2));}
}
