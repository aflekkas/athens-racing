// The pre-race showroom uses the same model and cockpit as the driven car.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CARS, CarModel, setPaint, carTransmission } from './cars.js';
import { Cockpit } from './cockpit.js';
import { PAINTS, savedPaint, savePaint } from './vehicle-paint.js';
import { updateCarDecals } from './vehicle-decals.js';

// Period 0–100 km/h figures for the represented drivetrain (seconds).
// Power, mass and driven wheels come from the live physics catalogue.
// MINI: https://www.press.bmwgroup.com/united-kingdom/article/detail/T0240023EN_GB/the-new-mini-convertible
// Z4: https://www.press.bmwgroup.com/asia/article/attachment/T0294347EN/429869
// Octavia (110 kW DSG): https://cdn.skoda-storyboard.com/2020/11/TD-OCTAVIA-en.pdf
// Carrera: https://xr793.com/wp-content/uploads/2020/06/2012-Porsche-911.pdf
// GR Yaris: https://media.toyota.co.uk/wp-content/uploads/sites/5/pdf/241007-GR-Yaris-Press-Pack.pdf
// GTV: period estimate; the catalogue's net engine output is also approximate (tools/vehicle-model-notes.md).
export const ACCELERATION = { mini: 7.2, z4: 4.5, taxi: 8.7, carrera: 4.8, gr_yaris: 5.2, gtv: 9.0 };
import * as C from './ui/components.js';
const { esc, icon } = C;
export function renderCarSelect({ index = 0, def, garage = false } = {}) {
  const c = CARS[index], locked = !!def?.car, paints = PAINTS[c.id] || [], acc = ACCELERATION[c.id];
  const specs = [['POWER', `${Math.round(c.power * 1.341)} HP`, 'lightning'], ['WEIGHT', `${c.mass} KG`, 'cube'], ['DRIVE', String(c.drive).toUpperCase(), 'tire'], ['0–100 KM/H', acc ? `${c.id === 'gtv' ? '≈ ' : ''}${acc.toFixed(1)} S` : '—', 'timer']];
  const arrowBtn = (act, ic, label) => `<div class="mi car-arrow btn btn--secondary btn--icon ${locked ? 'off' : ''}" role="button" aria-label="${label}" data-act="${act}">${icon(ic)}</div>`;
  return C.screen({ cls: 'scr--car', kick: garage ? 'GARAGE' : esc(def?.name || 'CHOOSE YOUR CAR'), title: 'CHOOSE YOUR CAR',
    hints: [['leftright', 'CAR'], ['confirm', garage ? 'SELECT' : 'RACE'], ['back', 'BACK']],
    body: `<div class="car-layout"><div class="car-stage" id="carStage" aria-label="Rotating 3D view of ${esc(c.name)}"><span class="car-stage__count tnum">${locked ? `${icon('lock-simple')} EVENT CAR` : `${index + 1} / ${CARS.length}`}</span></div>
    <section class="car-info panel panel--notch">
      <div class="car-browse">${arrowBtn('carPrev', 'caret-left', 'Previous car')}<div class="car-browse__name"><h3>${esc(c.name)}</h3>${c.tag ? `<p>${esc(c.tag)}</p>` : ''}</div>${arrowBtn('carNext', 'caret-right', 'Next car')}</div>
      <!-- UI owner: restyle .car-transmission; retain data-transmission for grid badges. -->
      <div class="car-transmission label" data-transmission="${carTransmission(c)}">${carTransmission(c) === 'both' ? 'MANUAL / AUTO · PLAYER CHOICE' : carTransmission(c).toUpperCase() + ' ONLY'} · ${c.gears.length}-SPEED</div>
      <div class="car-dots" aria-hidden="true">${CARS.map((_, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('')}</div>
      ${C.stats(specs.map(([k, v, ic]) => [k, v, { icon: ic }]), 'car-specs')}
      <div class="car-paints"><span class="label">PAINT</span><div class="car-paints__row">${paints.map(([name, color]) => `<div class="mi paint ${savedPaint(c) === color ? 'selected' : ''}" role="button" aria-label="${esc(name)}" title="${esc(name)}" data-act="paint" data-color="${color}" style="--paint:${color}"></div>`).join('')}</div><div class="car-paint-name">${esc(paints.find((p) => p[1] === savedPaint(c))?.[0] || 'Custom paint')}</div></div>
      <div class="car-actions">${C.button({ label: garage ? 'SELECT CAR' : 'RACE', icon: garage ? 'check' : 'flag-checkered', variant: 'primary', size: 'lg', block: true, act: 'carConfirm', attrs: { 'data-default': '' } })}</div>
    </section></div>` });
}
export function mountCarSelect(root, index) {
  const container = root.querySelector('#carStage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04); scene.environment = environment.texture;
  room.dispose(); pmrem.dispose();
  const model = new CarModel(CARS[index]);
  new Cockpit(CARS[index], model);
  model.root.rotation.y = -.5; scene.add(model.root);
  // Clone materials so the studio cannot change shared materials on the road.
  const materialCopies = new Map();
  const cloneMaterial = m => {
    if (!materialCopies.has(m)) { const copy=m.clone(); if ('envMap' in copy) copy.envMap=environment.texture; materialCopies.set(m,copy); }
    return materialCopies.get(m);
  };
  model.root.traverse(o=>{if(o.material)o.material=Array.isArray(o.material)?o.material.map(cloneMaterial):cloneMaterial(o.material);});
  model.paint = cloneMaterial(model.paint);
  model.paintAccents = (model.paintAccents || []).map(cloneMaterial);
  model.materials.black = cloneMaterial(model.materials.black); // Keep roof-vinyl receivers in this showroom material set.
  scene.add(new THREE.HemisphereLight('#dceaff', '#303038', 2.2));
  for (const [x,y,z,intensity] of [[-4,6,-3,3],[4,3,5,2]]) { const light = new THREE.DirectionalLight('#ffffff',intensity); light.position.set(x,y,z); if (x < 0) { light.castShadow=true; light.shadow.mapSize.set(1024,1024); Object.assign(light.shadow.camera,{left:-5,right:5,top:5,bottom:-5,near:.1,far:20}); light.shadow.normalBias=.025; } scene.add(light); }
  const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2,64).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({color:'#242d36',roughness:.7})); floor.position.y=-.02; floor.receiveShadow=true; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(35,1,.05,50);
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return;
    renderer.setSize(w,h); camera.aspect=w/h;
    const distance = Math.max(8.3, 6.2 / camera.aspect);
    camera.position.set(distance*.64,distance*.32,distance*.69); camera.lookAt(0,.65,0); camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  let last = performance.now();
  renderer.setAnimationLoop(now => { updateCarDecals(model); model.root.rotation.y += Math.min(.05,(now-last)/1000)*.16; last=now; renderer.render(scene,camera); });
  return {
    paint(color) { if (savePaint(CARS[index].id,color)) setPaint(model,color); },
    dispose() {
      renderer.setAnimationLoop(null); observer.disconnect(); model.disposeDamage?.();
      const geometry=new Set(), materials=new Set(), textures=new Set();
      scene.traverse(o=>{if(o.geometry && !o.geometry.userData.shared)geometry.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isCanvasTexture)textures.add(v);}});
      for(const r of [...geometry,...materials,...textures])r.dispose();
      environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    }
  };
}
