// Shared with offline/AWT generators. No renderer or browser dependency.
export const FACADE_STYLES = Object.freeze(['plaster','balconies','shutters','awnings','shops','offices','masonry','industrial']);
export const DETAIL_LIMITS = Object.freeze({ near: 160, far: 240, boxes: 240, impostors: 96, drawRatio: 1.10, triangleRatio: 1.25, textureBytes: 8*1024*1024 });
export function detailSeed(id) {
  let h=2166136261;
  for(const byte of new TextEncoder().encode(String(id)))h=Math.imul(h^byte,16777619);
  return h>>>0;
}
export function buildingStyle(b) {
  if(Number.isInteger(b.facadeStyle)&&b.facadeStyle>=0&&b.facadeStyle<8)return b.facadeStyle;
  const kind=b.k||b.building||'',seed=b.detailSeed??detailSeed('way/'+b.id);
  return /industrial|warehouse/.test(kind)?7:/office/.test(kind)?5:/retail|commercial/.test(kind)?4:/villa|house/.test(kind)?2:1+seed%4;
}
