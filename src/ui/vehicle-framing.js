// Fit the actual rendered exterior once, then centre its projected silhouette on every rotation.
import * as THREE from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';

export function createVehicleFraming(root) {
  // CarModel's on-road contact plane is not part of the vehicle silhouette.
  // Studio views supply their own feathered patch; never fit or draw the road blob.
  for (const object of root.children) if (object.isMesh && object.geometry?.type==='PlaneGeometry' && object.renderOrder===1 && !object.castShadow && object.material?.transparent) object.visible=false;
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert(), points = [], p = new THREE.Vector3();
  root.traverseVisible(object => {
    if (!object.isMesh || !object.geometry?.attributes.position) return;
    if (Array.isArray(object.material) ? object.material.every(m=>!m.visible) : object.material?.visible === false) return;
    const matrix = inverse.clone().multiply(object.matrixWorld), positions = object.geometry.attributes.position;
    for (let i=0; i<positions.count; i++) points.push(p.fromBufferAttribute(positions,i).clone().applyMatrix4(matrix));
  });
  const bounds = new THREE.Box3().setFromPoints(points), sphere = bounds.getBoundingSphere(new THREE.Sphere());
  // Only hull vertices can be silhouette extrema. Avoid walking the full car/cockpit every frame.
  const hull = new ConvexHull().setFromPoints(points), vertices = new Set();
  for (const face of hull.faces) { let edge=face.edge; do {vertices.add(edge.head().point);edge=edge.next;} while(edge!==face.edge); }
  return { points:[...vertices], center:sphere.center, radius:sphere.radius, bounds };
}

const direction = new THREE.Vector3(.64,.32,.69).normalize();
export function frameVehicle(camera, root, framing, width, height, { margin=1.10, viewDirection=direction } = {}) {
  if (!width || !height) return;
  root.updateWorldMatrix(true, false);
  camera.aspect = width / height;
  camera.clearViewOffset();
  const halfAngle = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*Math.min(1,camera.aspect));
  const distance = framing.radius / Math.sin(halfAngle) * margin;
  const center = framing.center.clone().applyMatrix4(root.matrixWorld);
  camera.position.copy(center).addScaledVector(viewDirection,distance);
  camera.near = Math.max(.01,distance-framing.radius*2);
  camera.far = distance+framing.radius*4;
  camera.lookAt(center);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const p = new THREE.Vector3();
  for (const point of framing.points) {
    p.copy(point).applyMatrix4(root.matrixWorld).project(camera);
    minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
  }
  // A lens shift centres perspective bounds exactly without changing angle, scale or the ground plane.
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  camera.setViewOffset(width,height,cx*width/2,-cy*height/2,width,height);
  return { minX:minX-cx,maxX:maxX-cx,minY:minY-cy,maxY:maxY-cy,distance };
}

/** A feathered contact patch, never an opaque floor or a sharp cast-shadow platform. */
export function createVehicleContactShadow() {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const context=canvas.getContext('2d'),gradient=context.createRadialGradient(64,64,4,64,64,64);
  gradient.addColorStop(0,'rgba(0,0,0,.65)');gradient.addColorStop(.5,'rgba(0,0,0,.4)');gradient.addColorStop(1,'rgba(0,0,0,0)');
  context.fillStyle=gradient;context.fillRect(0,0,128,128);
  const map=new THREE.CanvasTexture(canvas);
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({map,transparent:true,opacity:.65,depthWrite:false,toneMapped:false}));
  shadow.name='vehicle-contact-shadow';return shadow;
}
