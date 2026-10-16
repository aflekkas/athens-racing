import {tintGlass} from './glass-tint.js';
// A single, static studio view of the real selected vehicle. No map/world dependencies are constructed.
import * as THREE from 'three';
import { CARS, CarModel, setPaint } from './cars.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createHeroStudio() {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .85;
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(31, 2, .1, 100);
  const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, .04); room.dispose(); pmrem.dispose();
  scene.environment = env.texture;
  scene.add(new THREE.HemisphereLight('#a6d4d7', '#16252d', .65));
  for (const [color, power, x,y,z] of [['#fff1d9',3.1,-3,5,-5],['#83c8d4',1.3,4,3,2]]) {
    const light = new THREE.DirectionalLight(color,power);light.position.set(x,y,z);scene.add(light);
  }
  let model, ownedMaterials = new Set(), ownedGeometry = new Set(), ownedTextures = new Set(), stopped = false, serial = 0;
  const releaseVehicle = () => {
    model?.root.removeFromParent(); model?.disposeDamage?.();
    ownedGeometry.forEach(g=>g.dispose()); ownedMaterials.forEach(m=>m.dispose()); ownedTextures.forEach(t=>t.dispose());
    ownedGeometry.clear(); ownedMaterials.clear(); ownedTextures.clear(); model = null;
  };
  const setVehicle = (spec, paint) => {
    releaseVehicle(); serial++;
    model = new CarModel(spec); setPaint(model, paint || spec.color);
    // Explicit environment maps also cover materials created with a null on-road probe.
    const clones = new Map(), interiors = new Set([model.materials?.seat]);
    const roof = model.shape, closed = !roof?.open && !spec.twoWheeler;
    const planes = closed ? [new THREE.Plane(new THREE.Vector3(0,-1,0), (model.dims.H || spec.height || 1.5)-.13)] : [];
    if (closed && Number.isFinite(roof?.roofBack) && Number.isFinite(roof?.back)) {
      const slope = Math.max(0, ((roof.H-.13)-(roof.belt-.04))/Math.max(.2,roof.back-roof.roofBack));
      planes.push(new THREE.Plane(new THREE.Vector3(0,-1,-slope),roof.H-.13+slope*roof.roofBack).normalize());
    }
    model.root.traverse(o => {
      if (o.isLOD) { o.autoUpdate = false; o.levels.forEach((l,i)=>{l.object.visible=i===0;}); }
      if (o.geometry && !o.geometry.userData.shared) ownedGeometry.add(o.geometry);
      if (!o.material) return;
      const copy = original => {
        if (!clones.has(original)) {
          const m = original.clone();
          if (m.isMeshStandardMaterial || m.isMeshPhongMaterial) {m.envMap = env.texture; m.envMapIntensity = original.transparent ? 1.35 : .85;}
          if (original.userData.vehicleGlass) tintGlass(m);
          if (interiors.has(original)) m.clippingPlanes = planes;
          for(const value of Object.values(original)) if(value?.isCanvasTexture && !value.userData.shared) ownedTextures.add(value);
          clones.set(original,m);ownedMaterials.add(m);
        }
        return clones.get(original);
      };
      o.material = Array.isArray(o.material) ? o.material.map(copy) : copy(o.material);
    });
    scene.add(model.root); model.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model.root), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    model.root.position.sub(center); model.root.position.y += size.y*.04;
    model.root.updateMatrixWorld(true); planes.forEach(p=>p.applyMatrix4(model.root.matrixWorld));
    model.root.userData.heroSize = size;
    renderer.domElement.dataset.carId = spec.id; renderer.domElement.dataset.paint = (paint || spec.color).toLowerCase();
    renderer.domElement.setAttribute('aria-label', `${spec.name} · ${paint || spec.color}`);
  };
  const draw = async (width=800,height=380) => {
    if (stopped || !model || width<1 || height<1) return;
    const token=serial, size=model.root.userData.heroSize;
    renderer.setSize(Math.min(1200,width),Math.min(600,height),false);camera.aspect=width/height;
    const direction=new THREE.Vector3(.68,.31,-.74).normalize();
    // Fit all eight body bounds in the actual camera basis, including buses and tall bikes.
    camera.position.copy(direction);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
    const tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));let distance=0;
    for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]) {
      const p=new THREE.Vector3(x*size.x/2,y*size.y/2,z*size.z/2);
      distance=Math.max(distance,p.dot(direction)+Math.max(Math.abs(p.dot(up))/tan,Math.abs(p.dot(right))/(tan*camera.aspect)));
    }
    camera.position.copy(direction).multiplyScalar(distance*1.10);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
    await renderer.compileAsync(scene,camera);
    if (!stopped && token===serial) renderer.render(scene,camera);
  };
  return { canvas:renderer.domElement, setVehicle, draw, get info(){return {carId:renderer.domElement.dataset.carId,paint:renderer.domElement.dataset.paint,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,drawCalls:renderer.info.render.calls};},dispose(){stopped=true;serial++;releaseVehicle();env.dispose();renderer.dispose();renderer.forceContextLoss();} };
}
