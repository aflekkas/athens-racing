import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Face normal is local +Z. Put the entire panel in front of the support,
// including its back surface; never centre a sign on the post centreline.
export const SIGN_PANEL_THICKNESS = .02;
export function signFaceOffset(postDepth, thickness = SIGN_PANEL_THICKNESS) {
  return postDepth / 2 + thickness + .005;
}

// Two readable outward-facing panels, one draw call. DoubleSide would show
// mirrored lettering on the reverse and leave the support in front of it.
export function twoSidedSignGeometry(width, height, postDepth) {
  const z = signFaceOffset(postDepth);
  const front = new THREE.PlaneGeometry(width, height).translate(0, 0, z);
  const back = new THREE.PlaneGeometry(width, height).rotateY(Math.PI).translate(0, 0, -z);
  const geometry = mergeGeometries([front, back]);
  front.dispose(); back.dispose();
  return geometry;
}
