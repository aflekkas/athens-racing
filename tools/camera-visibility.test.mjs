import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import { CARS, CarModel, Cockpit } from './vehicle-budget-support.mjs';
import { syncCameraVehicleView } from '../src/camera-visibility.js';
import { seatPosition } from '../src/seat-position.js';
import { resolveGraphics, PERF_CLASSES } from '../src/graphics.js';

function rendered(model, camera) {
  camera.updateMatrixWorld(true); model.root.updateMatrixWorld(true);
  model.root.traverse(o => { if (o.isLOD && o.autoUpdate) o.update(camera); });
  const frustum = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const meshes = [];
  model.root.traverseVisible(o => { if (o.isMesh && [].concat(o.material).some(m => m.visible) && (!o.frustumCulled || frustum.intersectsObject(o))) meshes.push(o); });
  return meshes;
}
function shell(mesh, model) {
  for (let p = mesh; p; p = p.parent) if (p.userData.vehicleCabin || /cockpit|mirror/i.test(p.name)) return false;
  return [].concat(mesh.material).includes(model.paint) && mesh.geometry.attributes.position.count > 20;
}
for (const spec of CARS) test(`${spec.id}: body accompanies visible cabin across tiers, phone profiles and POV transitions`, () => {
  const model = new CarModel(spec), cockpit = new Cockpit(spec, model);
  const camera = new T.PerspectiveCamera(60, .6, .05, 2000);
  model.root.position.set(31, 4, -17); model.root.rotation.y = .7;
  try {
    for (const perfClass of PERF_CLASSES) for (const profile of ['desktop', 'iPhone', 'Android']) {
      const graphics = resolveGraphics({ perfClass }, { userAgent: profile === 'desktop' ? 'Desktop Chrome' : `Mozilla/5.0 (${profile}) Mobile`, deviceRatio: 3 });
      camera.far = graphics.drawDistance; camera.updateProjectionMatrix();
      for (const aspect of [.6, 2.1]) for (const distance of [7, 20, 30]) {
        camera.aspect = aspect; camera.updateProjectionMatrix();
        // Reproduce starting a race from orbit: mode switches first, camera has
        // not reached the cockpit yet. The old mode-only path leaves a bare tray.
        cockpit.setVisible(true);
        model.root.updateMatrixWorld(true);
        camera.position.copy(model.root.localToWorld(new T.Vector3(0, 2, distance)));
        camera.lookAt(model.root.localToWorld(new T.Vector3(0, .7, 0)));
        assert.equal(syncCameraVehicleView(model, camera, 'cockpit'), false);
        const meshes = rendered(model, camera);
        assert.ok(meshes.some(o => shell(o, model)), `${perfClass}/${profile}/${aspect}/${distance}: exterior body missing`);
        assert.ok(meshes.length > 0);
        // Ordinary chase/orbit and result photos use the same restoration path.
        for (const [mode, photo] of [['chase', false], ['orbit', false], ['cockpit', true]]) {
          cockpit.setVisible(true);
          assert.equal(syncCameraVehicleView(model, camera, mode, photo), false);
          assert.ok(rendered(model, camera).some(o => shell(o, model)), `${mode}: exterior body missing`);
        }
      }
    }
    const seat = seatPosition(spec.id), eye = cockpit.eye.clone(); eye.y += seat.height; eye.z -= seat.position;
    camera.position.copy(model.body.localToWorld(eye));
    assert.equal(syncCameraVehicleView(model, camera, 'cockpit'), true);
    assert.equal(cockpit.inPOV, true, 'Settled authored POV must remain active');
  } finally { cockpit.disposeMirrors(); model.disposeDamage?.(); }
});
test('render synchronizes visibility after temporary camera placement and restores after photos', async () => {
  const source = await fs.readFile('src/main.js', 'utf8'), render = source.slice(source.indexOf('function render()'), source.indexOf('function onResize()'));
  assert.ok(render.indexOf('syncCameraVehicleView') > render.indexOf('if (photoCamera)'));
  assert.ok(render.indexOf('syncCameraVehicleView') < render.indexOf('post.render('));
  assert.equal(render.match(/syncCameraVehicleView/g).length, 2);
});

test('mode-only race-start reproduction hides the MINI shell before the camera reaches the seat', () => {
 const model = new CarModel(CARS.find(s => s.id === 'mini')), cockpit = new Cockpit(model.spec, model);
 const camera = new T.PerspectiveCamera(60, .6, .05, 500); camera.position.set(0, 2, 7); camera.lookAt(0, .7, 0);
 try {
  cockpit.setVisible(true);
  assert.equal(rendered(model, camera).some(o => shell(o, model)), false, 'Negative control must reproduce the missing body');
  syncCameraVehicleView(model, camera, 'cockpit');
  assert.ok(rendered(model, camera).some(o => shell(o, model)));
 } finally { cockpit.disposeMirrors(); model.disposeDamage?.(); }
});
