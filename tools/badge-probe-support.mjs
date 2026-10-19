// Badge inventory of a built car model: every manufacturer mark (atlas badge plane), the model lettering and the
// wheel caps, classified front / rear / wheel and ray-tested against the finished bodywork (is it on the skin or buried / floating).
import * as THREE from 'three';
export function badgeInventory(car) {
  const body = car.body; body.updateWorldMatrix(true, true); car.root.updateMatrixWorld(true);
  const L = car.dims.L, wheelMeshes = new Set(), items = [], shells = [];
  for (const w of car.wheels) w.spin.traverse(o => wheelMeshes.add(o));
  const wheelCaps = [];
  for (const w of car.wheels) w.spin.traverse(o => { if (o.isMesh && [].concat(o.material).some(m => m?.userData?.brandBadge)) wheelCaps.push({ mesh: o, wheel: w }); });
  const isBadgeMat = m => !!m?.userData?.brandBadge;
  // the road-distance and far LOD shells only stand in for the bodywork from 15 m away: they never hide a badge
  const farLod = o => { for (let p = o; p; p = p.parent) if (p.name === 'player-road-detail' || p.name === 'player-distance-shell') return true; return false; };
  body.traverse(o => {
    if (!o.isMesh || !o.visible || farLod(o)) return;
    const mats = [].concat(o.material), badge = mats.some(isBadgeMat), lettering = o.name === 'trim-badge' || o.name === 'model-badge' || o.name === 'rear-badge';
    // everything opaque that is part of the vehicle body (not a badge itself) can hide a badge
    if (!badge && !lettering && !o.material.transparent && o.geometry?.attributes.position && !wheelMeshes.has(o) && !/cockpit|interior|seat|distant|distance/.test(o.name)) shells.push(o);
    if (!badge && !lettering) return;
    let inLod = false; for (let p = o; p; p = p.parent) if (p.isLOD && p.name !== 'player-body-lod' && p.name !== 'cockpit-lod') inLod = true;
    const centre = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()); body.worldToLocal(centre);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(o.matrixWorld);
    items.push({ mesh: o, name: o.name, kind: badge ? 'badge' : 'lettering', wheel: wheelMeshes.has(o), centre, normal, inLod });
  });
  for (const cap of wheelCaps) items.push({ mesh: cap.mesh, name: cap.mesh.name || 'wheel-cap', kind: 'badge', wheel: true, wheelRef: cap.wheel, zone: 'wheel' });
  const caster = new THREE.Raycaster(); caster.far = 1.2;
  for (const it of items) {
    if (it.wheel) { it.zone = 'wheel'; continue; }
    it.zone = it.centre.z < -L * .3 ? 'front' : it.centre.z > L * .3 ? 'rear' : 'body';
    // outward = the plane normal side that points away from the body centre. Seated: nothing in front, skin right behind (gap ~ 0).
    // gap > 0: floating in front of the skin; gap < 0: sunk into it (the skin is in front of the mark by |gap|); Infinity: nothing behind it at all.
    const world = body.localToWorld(it.centre.clone()), away = world.clone().sub(body.localToWorld(new THREE.Vector3(0, car.dims.H * .4, 0)));
    const out = it.normal.dot(away) >= 0 ? it.normal.clone() : it.normal.clone().negate();
    // look at the mark from outside, along the plane normal: the first skin the ray meets decides (skin behind the mark by gap, or in front of it)
    const hit = (() => { caster.set(world.clone().addScaledVector(out, .25), out.clone().negate()); return caster.intersectObjects(shells.filter(s => s !== it.mesh), false)[0]; })();
    it.gap = hit ? hit.distance - .25 : Infinity;
  }
  return items;
}
