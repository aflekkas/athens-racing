// Three cameras look down local -Z; Web Audio uses forward x up = screen right.
// StereoPannerNode does not consult AudioListener, so both paths use this same basis.
export function cameraAudioFrame(camera) {
  camera.updateMatrixWorld?.();
  const e = camera.matrixWorld.elements;
  return { position: [e[12], e[13], e[14]], right: [e[0], e[1], e[2]],
    up: [e[4], e[5], e[6]], forward: [-e[8], -e[9], -e[10]] };
}
export function syncAudioListener(ctx, camera, now = ctx.currentTime) {
  const frame = cameraAudioFrame(camera), l = ctx.listener;
  if (l.positionX) {
    for (const [prefix, vector] of [['position',frame.position],['forward',frame.forward],['up',frame.up]])
      for (let i=0;i<3;i++) l[prefix+'XYZ'[i]].setValueAtTime(vector[i],now);
  } else {
    l.setPosition(...frame.position); l.setOrientation(...frame.forward,...frame.up);
  }
  return frame;
}
export function cameraDirectionPan(camera, x, y, z) {
  camera.updateMatrixWorld?.(); const e=camera.matrixWorld.elements;
  return Math.max(-1,Math.min(1,(x*e[0]+y*e[1]+z*e[2])/Math.max(1e-6,Math.hypot(x,y,z))));
}
export function cameraRelativeSource(camera, velocity, x, y, z, vx=0, vz=0) {
  camera.updateMatrixWorld?.(); const e=camera.matrixWorld.elements;
  const dx=x-e[12],dy=y-e[13],dz=z-e[14],d=Math.hypot(dx,dy,dz);
  return {d,pan:Math.max(-1,Math.min(1,(dx*e[0]+dy*e[1]+dz*e[2])/Math.max(3,d))),
    vr:-(dx*(vx-velocity.vx)+dz*(vz-velocity.vz))/Math.max(1,d)};
}
