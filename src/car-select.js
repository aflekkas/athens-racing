// The pre-race showroom uses the same model and cockpit as the driven car.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CARS, CarModel, setPaint, carTransmission } from './cars.js';
import { TurntableControl } from './turntable-control.js';
import { account } from './account.js';
import { Cockpit } from './cockpit.js';
import { PAINTS, savedPaint, savePaint } from './vehicle-paint.js';
import { updateCarDecals, listDecals, getCarDecals, setCarDecals } from './vehicle-decals.js';
import { CAR_CLASSES, carCategory, filterCars } from './car-catalog.js';
export { listDecals, getCarDecals, setCarDecals };

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
export function renderCarSelect({ index = 0, def, garage = false, detail = false, filters = {}, allowedCars, decal = {} } = {}) {
  const c = CARS[index] || CARS[0], allowed = !allowedCars || allowedCars.includes(c.id), paints = PAINTS[c.id] || [], acc = ACCELERATION[c.id];
  if (!detail) {
    const list = filterCars(CARS, filters), attrs = { 'data-scope': 'catalog' };
    return C.screen({ cls: 'scr--catalog', kick: garage ? 'GARAGE' : esc(def?.name || 'CHOOSE YOUR CAR'), title: 'THE GARAGE', hints: [['select', 'BROWSE'], ['confirm', 'DETAILS'], ['back', 'BACK']],
      body: `<div class="catalog-toolbar"><label class="catalog-search">${icon('magnifying-glass')}<input data-car-search type="search" placeholder="SEARCH CARS" aria-label="Search cars" value="${esc(filters.search || '')}" autocomplete="off" /></label>
      ${C.select({ key: 'category', label: 'CLASS', value: filters.category || 'all', options: [['all', 'ALL CLASSES'], ...CAR_CLASSES.map(x => [x, x.toUpperCase()])], attrs })}
      ${C.select({ key: 'drive', label: 'DRIVE', value: filters.drive || 'all', options: [['all', 'ALL'], ['FWD', 'FWD'], ['RWD', 'RWD'], ['AWD', 'AWD']], attrs })}
      ${C.select({ key: 'power', label: 'POWER', value: filters.power || 'all', options: [['all', 'ALL HP'], ['low', 'UNDER 150 HP'], ['mid', '150–300 HP'], ['high', 'OVER 300 HP']], attrs })}
      ${C.select({ key: 'sort', label: 'SORT', value: filters.sort || 'name', options: [['name', 'NAME'], ['power', 'POWER ↓'], ['weight', 'WEIGHT ↑']], attrs })}</div>
      <div class="catalog-count label">${list.length} / ${CARS.length} CARS${def?.car ? ' · EVENT CAR LOCKED' : allowedCars ? ' · LOBBY CAR RULES APPLY' : ''}</div>
      <div class="car-grid scroll-y">${list.map(({ car, index: i }) => {
        const locked = !!(def?.car && def.car !== car.id) || !!(allowedCars && !allowedCars.includes(car.id));
        return C.card({ cls: 'car-card' + (locked ? ' off' : ''), act: 'carDetail', selected: i === index,
          attrs: { 'data-car-index': i, 'aria-disabled': locked ? 'true' : 'false', title: locked ? def?.car ? 'THIS EVENT USES ITS FIXED CAR' : 'THE HOST DOES NOT ALLOW THIS CAR' : 'VIEW CAR AND CUSTOMISE', ...(i === index && !locked ? { 'data-default': '' } : {}) },
          media: `<img data-car-thumb="${car.id}" alt="${esc(car.name)}" />`, badge: C.badge(car.drive.toUpperCase()), title: esc(car.name),
          text: `${carCategory(car).toUpperCase()} · ${transmissionLabel(car)}`,
          foot: `<b>${Math.round(car.power * 1.341)} HP</b><span>${car.mass} KG</span>${locked ? C.badge(def?.car ? 'EVENT CAR ONLY' : 'HOST RULES', '', 'lock-simple') : ''}` });
      }).join('') || '<div class="empty">NO CARS MATCH · CHANGE YOUR FILTERS</div>'}</div>` });
  }
  const specs = [['POWER', `${Math.round(c.power * 1.341)} HP`, 'lightning'], ['WEIGHT', `${c.mass} KG`, 'cube'], ['DRIVE', c.drive.toUpperCase(), 'tire'], ['0–100 KM/H', acc ? `${c.id === 'gtv' ? '≈ ' : ''}${acc.toFixed(1)} S` : '—', 'timer']];
  const layer = { id: 'stripes', position: 'bonnet', color: '#ffffff', number: 7, ...decal }, designs = listDecals(), layers = getCarDecals(c.id), A = { 'data-scope': 'decal' };
  return C.screen({ cls: 'scr--car', kick: carCategory(c).toUpperCase(), title: c.name,
    hints: [['select', 'CUSTOMISE'], ['confirm', garage ? 'SELECT' : 'RACE'], ['back', 'CATALOGUE']],
    body: `<div class="car-layout"><div class="car-stage" id="carStage" aria-label="Rotating 3D view of ${esc(c.name)}"><span class="car-stage__count">${C.badge(c.drive.toUpperCase())}${C.badge(transmissionLabel(c))}</span></div>
    <section class="car-info panel panel--notch scroll-y"><p class="car-description">${esc(c.tag)}</p>
      <div class="car-transmission label" data-transmission="${carTransmission(c)}">${transmissionLabel(c)} · ${c.gears.length}-SPEED</div>
      ${C.stats(specs.map(([k, v, ic]) => [k, v, { icon: ic }]), 'car-specs')}
      <div class="car-paints"><span class="label">PAINT</span><div class="car-paints__row">${paints.map(([name, color]) => `<div class="mi paint ${savedPaint(c) === color ? 'selected' : ''}" role="button" aria-label="${esc(name)}" title="${esc(name)}" data-act="paint" data-color="${color}" style="--paint:${color}"></div>`).join('')}</div><div class="car-paint-name">${esc(paints.find(p => p[1] === savedPaint(c))?.[0] || 'Custom paint')}</div></div>
      <div class="car-decals"><h3 class="label">VINYLS · ${layers.length} / 8 LAYERS</h3>
        ${C.select({ key: 'id', label: 'DESIGN', value: layer.id, options: designs.map(d => [d.id, d.name.toUpperCase()]), attrs: A })}
        ${C.segmented({ key: 'position', label: 'POSITION', value: layer.position, options: ['bonnet', 'doors', 'roof', 'rear'].map(x => [x, x.toUpperCase()]), attrs: A })}
        <div class="car-paints__row">${designs[0].colors.map(color => `<div class="mi paint ${layer.color === color ? 'selected' : ''}" role="button" aria-label="Vinyl color ${color}" data-act="decalColor" data-color="${color}" style="--paint:${color}"></div>`).join('')}</div>
        ${layer.id === 'roundel' ? C.stepper({ key: 'number', label: 'RACE NUMBER', value: layer.number, min: 0, max: 999, step: 1, attrs: A }) : ''}
        <div class="decal-actions">${C.button({ label: 'ADD LAYER', icon: 'plus', act: 'decalAdd', disabled: layers.length >= 8 })}${C.button({ label: 'CLEAR ALL', icon: 'trash', act: 'decalClear', variant: 'ghost', disabled: !layers.length })}</div>
        <div class="decal-layers">${layers.map((l, i) => C.button({ label: `${i + 1}. ${designs.find(d => d.id === l.id)?.name || l.id} · ${l.position}`, iconRight: 'x', act: 'decalRemove', variant: 'ghost', size: 'sm', attrs: { 'data-layer': i }, title: 'Remove layer' })).join('')}</div>
      </div>
      <div class="car-actions">${C.button({ label: 'CUSTOMIZE', icon: 'sliders-horizontal', act: 'carCustomize', block: true })}${C.button({ label: garage ? 'SELECT CAR' : 'RACE', icon: garage ? 'check' : 'flag-checkered', variant: 'primary', size: 'lg', block: true, act: 'carConfirm', disabled: !allowed, attrs: { 'data-default': '' } })}</div>
    </section></div>` });
}
export const transmissionLabel = c => carTransmission(c) === 'both' ? 'MANUAL / AUTO' : carTransmission(c).toUpperCase() + ' ONLY';

// A single disposable renderer renders visible catalogue thumbnails; no per-card WebGL contexts.
const thumbs = new Map();
export function mountCarGrid(root) {
  let stopped = false, frame, renderer, observer;
  const pending = [], scene = new THREE.Scene(); scene.background = new THREE.Color('#141b23');
  scene.add(new THREE.HemisphereLight('#edf3ff', '#444650', 3));
  const keyLight = new THREE.DirectionalLight('#fff', 4); keyLight.position.set(-4, 6, -5); scene.add(keyLight);
  const camera = new THREE.PerspectiveCamera(32, 2, .1, 40); camera.position.set(6, 3, 7); camera.lookAt(0, .6, 0);
  const run = () => {
    if (stopped || !pending.length) return;
    const img = pending.shift(), c = CARS.find(c => c.id === img.dataset.carThumb);
    if (!c) return;
    const key = c.id + savedPaint(c);
    if (thumbs.has(key)) img.src = thumbs.get(key);
    else {
      try {
        renderer ||= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(480, 240); renderer.toneMapping = THREE.ACESFilmicToneMapping;
        const model = new CarModel(c); model.root.rotation.y = -.45; scene.add(model.root);
        renderer.render(scene, camera); const url = renderer.domElement.toDataURL('image/png'); img.src = url; thumbs.set(key, url);
        model.root.removeFromParent(); model.disposeDamage?.();
        // The models share geometry/materials with the game; only thumbnail-specific geometry may be released.
        const geo = new Set(); model.root.traverse(o => { if (o.geometry && !o.geometry.userData.shared) geo.add(o.geometry); }); geo.forEach(g => g.dispose());
      } catch { img.alt = c.short; }
    }
    frame = requestAnimationFrame(run);
  };
  observer = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) { pending.push(e.target); observer.unobserve(e.target); } cancelAnimationFrame(frame); frame = requestAnimationFrame(run); }, { root: root.querySelector('.car-grid'), rootMargin: '100px' });
  root.querySelectorAll('[data-car-thumb]').forEach(img => observer.observe(img));
  return { dispose() { stopped = true; cancelAnimationFrame(frame); observer.disconnect(); renderer?.dispose(); renderer?.forceContextLoss(); } };
}
/** Uses the live Menu instance supplied by main.js; selection returns a car ID without restarting the session. */
export function openCarPicker(options = {}) {
  const menu = options.menu || window.__flow?.menu;
  if (!menu) return false;
  menu.show('car', { ...options, garage: true, index: options.index ?? menu.h?.carIndex?.() ?? 0 }, true);
  return true;
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
  const model = new CarModel(CARS[index], { plate: account.plate() });
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
  const turntable = new TurntableControl(model.root.rotation.y); let pointer, pointerX, last = performance.now();
  const down = e => { if (pointer != null) return; e.preventDefault(); pointer=e.pointerId;pointerX=e.clientX;turntable.dragging=true;container.classList.add('dragging');container.setPointerCapture(pointer); };
  const move = e => { if(e.pointerId!==pointer)return;model.root.rotation.y=turntable.drag(e.clientX-pointerX);pointerX=e.clientX;renderer.render(scene,camera); };
  const up = e => { if(e.pointerId!==pointer)return;pointer=null;turntable.dragging=false;container.classList.remove('dragging'); };
  container.addEventListener('pointerdown',down);container.addEventListener('pointermove',move);
  for(const name of ['pointerup','pointercancel','lostpointercapture'])container.addEventListener(name,up);
  const hint=document.createElement('span');hint.className='car-stage__hint';hint.textContent='DRAG TO ROTATE · 360°';container.append(hint);
  renderer.setAnimationLoop(now => { updateCarDecals(model);model.root.rotation.y=turntable.advance((now-last)/1000);last=now;renderer.render(scene,camera); });
  return {
    index, get rotation() { return turntable.angle; },
    captureFrame() { renderer.setAnimationLoop(null); updateCarDecals(model); renderer.render(scene, camera); },
    paint(color) { if (savePaint(CARS[index].id,color)) setPaint(model,color); },
    dispose() {
      renderer.setAnimationLoop(null); observer.disconnect();container.removeEventListener('pointerdown',down);container.removeEventListener('pointermove',move);for(const name of ['pointerup','pointercancel','lostpointercapture'])container.removeEventListener(name,up); model.disposeDamage?.();
      const geometry=new Set(), materials=new Set(), textures=new Set();
      scene.traverse(o=>{if(o.geometry && !o.geometry.userData.shared)geometry.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isCanvasTexture)textures.add(v);}});
      for(const r of [...geometry,...materials,...textures])r.dispose();
      environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    }
  };
}
