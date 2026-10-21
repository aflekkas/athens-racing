// Exact Float64 samples. The immutable release owns these arrays; AI receives copies.
export const RIVAL_PLAN_VERSION = 1;
export const rivalLineKey = (dir, halfWidth) => `${dir}:${halfWidth}`;
export function packRivalArray(array) {
  const bytes=new Uint8Array(array.length*8),view=new DataView(bytes.buffer);
  for(let i=0;i<array.length;i++)view.setFloat64(i*8,array[i],true);
  let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(raw);
}
export function unpackRivalArray(encoded,n) {
  if(typeof encoded!=='string'||encoded.length!==Math.ceil(n*8/3)*4)throw Error('Invalid rival plan samples');
  const raw=atob(encoded);if(raw.length!==n*8)throw Error('Invalid rival plan samples');
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer),array=new Float64Array(n);
  for(let i=0;i<n;i++){array[i]=view.getFloat64(i*8,true);if(!Number.isFinite(array[i]))throw Error('Invalid rival plan sample');}return array;
}
export function validateRivalPlan(compiled,{required=true}={}) {
  const p=compiled.rivalPlan;if(!p&&!required)return null;
  if(!p||p.version!==RIVAL_PLAN_VERSION||p.geometryHash!==compiled.geometryHash||p.worldSetRevision!==compiled.worldSetRevision||!Number.isInteger(p.n)||p.n<2||p.n>100001||!p.lines||!p.profiles)throw Error('Stale rival racing plan');
  return p;
}
