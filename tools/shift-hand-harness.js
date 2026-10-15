// Cockpit-camera shift-hand harness: real CarModel + Driver + Cockpit, camera at the
// driver's eye, scripted gear-change events stepped with a fixed dt. Driven by
// tools/shift-hand-browser.mjs through window.shiftHand.
import * as THREE from 'three';
import { CARS, CarModel } from '../src/cars.js';
import { Driver } from '../src/driver.js';
import { Cockpit } from '../src/cockpit.js';
import { bindDriverToCar } from '../src/driver-seating.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(640, 360);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.querySelector('#work').append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a3642');
scene.add(new THREE.HemisphereLight('#e8f0ff', '#3a4048', 2.2));
for (const p of [[-2, 4, -3], [2, 2, 3]]) {
  const light = new THREE.DirectionalLight('#ffffff', 2.2);
  light.position.set(...p);
  scene.add(light);
}
const camera = new THREE.PerspectiveCamera(66, 640 / 360, 0.02, 60);

const rigs = new Map();
function rigFor(carId) {
  if (!rigs.has(carId)) {
    const spec = CARS.find((c) => c.id === carId);
    if (!spec) throw new Error('unknown car ' + carId);
    const car = new CarModel(spec, { decals: [] });
    scene.add(car.root);
    const driver = new Driver();
    const cockpit = new Cockpit(spec, car);
    bindDriverToCar(driver, car);
    // The cockpit camera sits at the eye: hide the head exactly like the game does.
    driver.head.visible = false;
    rigs.set(carId, { spec, car, driver, cockpit });
  }
  return rigs.get(carId);
}

function frameCamera(rig) {
  const { cockpit } = rig;
  const eye = cockpit.eye;
  camera.position.copy(eye);
  // Frame the wheel, both hands and the centre lever: aim between wheel and knob.
  const knob = (cockpit.stickKnob && cockpit.stickKnob.visible !== false) ? cockpit.stickKnob : cockpit.knob;
  const target = cockpit.wheelC.clone().lerp(knob.position, 0.45);
  target.y -= 0.07;
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

function stFor(rig, s) {
  const gear = s.t >= s.duration ? s.to : s.from;
  return {
    handbrake: false, manual: s.manual,
    gearChangeEvent: { serial: s.serial, from: s.from, to: s.to, direction: s.direction, duration: s.duration, manual: s.manual },
    steerInput: 0, rpm: 4500, redline: rig.spec.redline || 6500,
    gear, gearLabel: String(gear), kmh: 60,
  };
}

// Pose a scenario at time t (seconds since the shift trigger). Returns probe data.
function pose(name, t) {
  const SC = window.shiftHand.scenarios[name];
  const rig = rigFor(SC.car);
  const { driver, cockpit } = rig;
  // One car in the scene at a time: co-located rigs would composite into each other.
  for (const r of rigs.values()) r.car.root.visible = (r === rig);
  // Reset the choreography so every timestamp poses deterministically from rest.
  Object.assign(cockpit._shift, { serial: 0, t: 0, kind: 'none', queued: false, qT: 0, tap: false, paddle: 0 });
  cockpit._levX = 0; cockpit._levZ = 0;
  driver.shiftSerial = -1; driver.shiftSmooth = 0; driver.paddleSmoothL = 0; driver.paddleSmoothR = 0;
  // Settle first so springs and envelopes start from rest.
  const settle = { handbrake: false, manual: SC.manual, gearChangeEvent: null, steerInput: 0, rpm: 4000, redline: rig.spec.redline || 6500, gear: SC.from, gearLabel: String(SC.from), kmh: 60 };
  for (let i = 0; i < 40; i++) { cockpit.update(1 / 60, settle); driver.update(1 / 60, i / 60, 15, { x: 0, y: 0, z: 0 }, cockpit.wheelInfo, 0, 0); }
  const s = { serial: 1, from: SC.from, to: SC.to, direction: SC.direction, duration: SC.duration, manual: SC.manual, t };
  const steps = Math.max(0, Math.round(t * 60));
  for (let i = 0; i < steps; i++) {
    const st = stFor(rig, { ...s, t: (i + 1) / 60 });
    cockpit.update(1 / 60, st);
    driver.update(1 / 60, (i + 1) / 60, 15, { x: 0, y: 0, z: 0 }, cockpit.wheelInfo, 0, 0);
  }
  frameCamera(rig);
  renderer.render(scene, camera);
  const hand = rig.driver.arms[1].hand.getWorldPosition(rig.driver._v).toArray().map((x) => +x.toFixed(4));
  return {
    gear: stFor(rig, s).gear, kind: cockpit._shift.kind, blend: +cockpit.controlTargets.shiftBlend.toFixed(3),
    lever: [+cockpit._levX.toFixed(4), +cockpit._levZ.toFixed(4)], hand,
    paddle: rig.cockpit.paddleR ? +rig.cockpit.paddleR.position.z.toFixed(4) : null,
    hardware: cockpit.shiftHardware,
    summary: `g${stFor(rig, s).gear}/${cockpit._shift.kind}/b${cockpit.controlTargets.shiftBlend.toFixed(2)}/l[${cockpit._levX.toFixed(3)},${cockpit._levZ.toFixed(3)}]`,
  };
}

window.shiftHand = {
  scenarios: {
    'e36-upshift': { car: 'e36', manual: true, from: 1, to: 2, direction: 1, duration: 0.41, times: [0, 0.05, 0.1, 0.15, 0.2, 0.27, 0.34, 0.41, 0.5] },
    'e36-downshift': { car: 'e36', manual: true, from: 3, to: 2, direction: -1, duration: 0.36, times: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.32, 0.4, 0.48] },
    'cle-paddle-upshift': { car: 'cle', manual: true, from: 3, to: 4, direction: 1, duration: 0.16, times: [0, 0.03, 0.06, 0.09, 0.12, 0.16, 0.2, 0.26] },
    'carrera-upshift': { car: 'carrera', manual: true, from: 2, to: 3, direction: 1, duration: 0.38, times: [0, 0.05, 0.1, 0.15, 0.2, 0.26, 0.33, 0.4, 0.48] },
  },
  pose,
  ready: true,
};
document.querySelector('#result').textContent = 'Shift-hand harness ready.';
