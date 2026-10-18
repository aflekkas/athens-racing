// Body-local bounds for furniture seen through the exterior glazing. POV art is
// calibrated to the driving eye and is not an exterior modelling coordinate rig.
// Commercial stations come from the actual cab panes, not the cargo-box size.
export function exteriorCabinEnvelope(model,{cheap=false}={}){
 const d={...model.dims,...(typeof model.shape==='object'?model.shape:{})};
 const kind=model.spec?.nativeFleet||model.modelKind||model.shape;
 const commercial={
  van:{front:-1.92,header:-1.29,back:-.66,roofBack:-.70,belt:1.29,roof:2.12,half:.96,roofHalf:.86,floor:.30,seatZ:-1.02,seatY:1.04},
  truck:{front:-3.17,header:-2.81,back:-1.36,roofBack:-1.40,belt:1.34,roof:2.15,half:.97,roofHalf:.91,floor:.61,seatZ:-1.80,seatY:1.12},
  bus:{front:-5.97,header:-5.97,back:-4.18,roofBack:-4.18,belt:1.28,roof:2.64,half:1.22,roofHalf:1.22,floor:.52,seatZ:-4.88,seatY:1.08},
 }[kind];
 if(commercial){
  // The van's distance shell has a narrower trapezoidal window band. Traffic
  // shares one cabin between near/parked/far bodies, so fit their intersection.
  if(cheap&&kind==='van'){commercial.half=Math.min(commercial.half,d.W*.43-.02);commercial.roofHalf=Math.min(commercial.roofHalf,d.W*.34-.02);}
  return {...commercial,rearRoof:commercial.roof,margin:.015};
 }
 const eye=model.seat||model.spec?.cameraRig?.eye;
 const seatZ=eye?.z??eye?.[2]??d.seatZ??.20,eyeY=eye?.y??eye?.[1]??d.eyeY??1.15;
 const floor=Math.max(.20,Math.min(.38,eyeY-.78));
 return {front:d.cowl??-d.L*.30,header:d.header??-d.L*.15,
  back:d.back??d.L*.32,roofBack:d.roofBack??d.L*.18,
  belt:d.belt??eyeY-.20,roof:d.H-.065,
  rearRoof:d.H-.065-(d.roofDrop??(d.profile==='yaris'?.115:d.profile==='carrera'?.065:.012)),
  half:d.W/2-.15,roofHalf:typeof d.rw==='number'?d.rw-.025:d.W/2-(d.profile==='carrera'?.295:.255),
  floor:floor-.03,seatZ,seatY:floor+.15,margin:.015};
}
export function cabinSection(e,y){
 const t=Math.max(0,Math.min(1,(y-e.belt)/(e.roof-e.belt)));
 const rear=Math.max(0,Math.min(1,(y-e.belt)/(e.rearRoof-e.belt)));
 return {half:e.half+(e.roofHalf-e.half)*t-e.margin,
  front:e.front+(e.header-e.front)*t+e.margin,
  back:e.back+(e.roofBack-e.back)*rear-e.margin};
}
// Fit an exterior COPY only. Keep the authored topology, colours and furniture
// families; no clipping planes, extra draw calls or damage-dependent floor holes.
export function fitExteriorCabin(geometry,e){
 const p=geometry.attributes.position;
 for(let i=0;i<p.count;i++){
  const y=Math.max(e.floor,Math.min(e.roof-e.margin,p.getY(i))),s=cabinSection(e,y);
  p.setXYZ(i,Math.max(-s.half,Math.min(s.half,p.getX(i))),y,Math.max(s.front,Math.min(s.back,p.getZ(i))));
 }
 geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
 return geometry;
}
