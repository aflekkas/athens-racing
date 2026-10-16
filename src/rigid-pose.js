// Render-only quaternion helpers, independent of Three and the simulation.
const normalized = q => {const n=Math.hypot(...q);return q.map(x=>x/n);};
export function interpolateQuaternion(a,b,t) {
  let dot=a.reduce((s,x,i)=>s+x*b[i],0),sign=dot<0?-1:1;dot=Math.abs(dot);
  if(dot>.9995)return normalized(a.map((x,i)=>x+(b[i]*sign-x)*t));
  const theta=Math.acos(Math.min(1,dot)),sin=Math.sin(theta),u=Math.sin((1-t)*theta)/sin,v=Math.sin(t*theta)/sin;
  return a.map((x,i)=>u*x+v*b[i]*sign);
}
export function advanceQuaternion(q,omega,dt) {
  const speed=Math.hypot(...omega);if(speed<1e-9)return q.slice();
  const half=speed*dt/2,k=Math.sin(half)/speed,[a,b,c]=omega.map(x=>x*k),d=Math.cos(half),[x,y,z,w]=q;
  return normalized([d*x+a*w+b*z-c*y,d*y-a*z+b*w+c*x,d*z+a*y-b*x+c*w,d*w-a*x-b*y-c*z]);
}
