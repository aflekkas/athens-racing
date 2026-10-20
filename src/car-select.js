import { settings } from './settings.js';
import { FrameLimiter } from './frame-pacing.js';
import { importWithUpdate } from './client-release.js';
// The pre-race showroom uses the same model and cockpit as the driven car.
import * as THREE from 'three';
import { createVehicleFraming, frameVehicle, createVehicleContactShadow } from './ui/vehicle-framing.js';
import { badgeBrand, manufacturerOptions } from './manufacturers.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CARS, CarModel, setPaint } from './cars.js';
import { TurntableControl } from './turntable-control.js';
import { driverName } from './driver-name.js';
import { Cockpit } from './cockpit.js';
import { PAINTS, savedPaint, savePaint } from './vehicle-paint.js';
import { GARAGE_CLASSES, GARAGE_CARS, carCategory, classLabel, filterCars, carModel, inGarage } from './car-catalog.js';
const sentence = t => String(t).charAt(0) + String(t).slice(1).toLowerCase();
import { classifyCar } from './car-performance.js';
import { carEligibility } from './mp-car-rules.js';
// Why a car is locked by lobby car rules (null without rules or when eligible).
const ruleReason = (car, rules) => {
  if (!rules || !car) return null;
  const { pi, class: cls } = classifyCar(car);
  return carEligibility({ id: car.id, name: car.short || car.name || car.id, pi, class: cls, category: carCategory(car) }, rules).reason || null;
};

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
export function renderCarSelect({ index = 0, def, garage = false, detail = false, filters = {}, allowedCars, rules } = {}) {
  const c = CARS[index] || CARS[0], allowed = !allowedCars || allowedCars.includes(c.id), paints = PAINTS[c.id] || PAINTS[carModel(c)?.id] || [], acc = c.zeroTo100 || ACCELERATION[c.id], model = carModel(c);
  if (!detail) {
    const list = filterCars(CARS, filters), attrs = { 'data-scope': 'catalog' };
    const toolbar = `${C.searchField({ name: 'car-search', label: 'Search cars', placeholder: 'SEARCH CARS', value: filters.search || '', inputAttrs: { 'data-car-search': '' } })}
      ${C.select({ key: 'brand', label: 'BRAND', compact: true, value: filters.brand || 'all', options: [['all', 'ALL'], ...manufacturerOptions(CARS.filter(car=>inGarage(car))).map(([id,name])=>[id,name,{brand:id}])], attrs })}
      ${C.select({ key: 'category', label: 'CLASS', compact: true, value: filters.category || 'all', options: [['all', 'ALL'], ...GARAGE_CLASSES.map(([id, label]) => [id, label])], attrs })}
      ${C.select({ key: 'drive', label: 'DRIVE', compact: true, value: filters.drive || 'all', options: [['all', 'ALL'], ['FWD', 'FWD'], ['RWD', 'RWD'], ['AWD', 'AWD']], attrs })}
      ${C.select({ key: 'power', label: 'POWER', compact: true, value: filters.power || 'all', options: [['all', 'ALL'], ['low', 'UNDER 150 HP'], ['mid', '150–300 HP'], ['high', 'OVER 300 HP']], attrs })}
      ${C.select({ key: 'sort', label: 'SORT', compact: true, value: filters.sort || 'lineup', options: [['lineup', 'LINEUP'], ['power', 'POWER', { icon: 'arrow-down' }], ['weight', 'WEIGHT', { icon: 'arrow-up' }]], attrs })}`;
    // The breadcrumb is a real parent (the event or the lobby), never a count; the grid shows what matches.
    const kick = def?.car ? `${esc(def.name || 'EVENT')} · EVENT CAR` : allowedCars ? 'MULTIPLAYER · LOBBY CAR RULES' : garage ? '' : esc(def?.name || '');
    return C.browseGrid({ variant: 'catalog', cls: 'scr--catalog', kick, title: 'GARAGE', hints: [['select', 'BROWSE'], ['confirm', 'DETAILS'], ['back', 'BACK']],
      filters: toolbar, items: list.map(({ car, index: i }) => {
        const locked = !!(def?.car && def.car !== car.id) || !!(allowedCars && !allowedCars.includes(car.id));
        const reason = locked && !def?.car ? ruleReason(car, rules) : null, m = carModel(car);
        return C.carCard({ id: car.id, brand: badgeBrand(car), name: esc(m?.name || car.name), hp: Math.round(car.power * 1.341), kg: car.mass, drive: car.drive.toUpperCase(), locked, selected: CARS[index]?.id === car.id,
          lockLabel: def?.car ? 'EVENT CAR ONLY' : 'HOST RULES',
          line: `${sentence(classLabel(carCategory(car)))}${reason ? ` · ${esc(reason)}` : ''}`,
          attrs: { 'data-car-index': i, 'aria-disabled': locked ? 'true' : 'false', title: locked ? def?.car ? 'THIS EVENT USES ITS FIXED CAR' : reason || 'THE HOST DOES NOT ALLOW THIS CAR' : 'VIEW CAR', ...(CARS[index]?.id === car.id && !locked ? { 'data-default': '' } : {}) } });
      }).join('') || C.emptyState({ icon: 'search', title: 'NO CARS MATCH', text: 'Try fewer filters.' }) });
  }
  const specs = [['POWER', `${Math.round(c.power * 1.341)} HP`, 'zap'], ['TORQUE', `${c.torque} NM`, 'gauge'], ['WEIGHT', `${c.mass} KG`, 'box'], ['DRIVE', c.drive.toUpperCase(), 'circle-dot'], ['0–100 KM/H', acc ? `${c.id === 'gtv' ? '≈ ' : ''}${acc.toFixed(1)} S` : '—', 'timer'], ['TOP SPEED', `${c.vmax} KM/H`, 'gauge']];
  return C.stageInspector({ variant: 'vehicle', cls: 'scr--car', kick: 'GARAGE', title: c.name,
    hints: [['confirm', garage ? 'SELECT' : 'RACE'], ['back', 'CATALOGUE']],
    stageAttrs: { id: 'carStage', 'aria-label': `Rotating 3D view of ${c.name}` },
    stage: '<div class="car-preview-viewport" data-ui-keep="preview"></div>',
    inspector: C.vehicleSpecs({ brand: badgeBrand(c), name: model?.name || c.name, transmission: `${c.gears.length}-SPEED ${c.gearbox === 'MT' ? 'MANUAL' : c.gearbox || ''} · ${c.drive.toUpperCase()}`, specs,
      paint: paints.length ? `<div class="car-paints"><span class="label">PAINT</span><div class="car-paints__row">${paints.map(([name, color]) => C.paintSwatch({ name, color, selected: savedPaint(c) === color })).join('')}</div><div class="car-paint-name">${esc(paints.find(p => p[1] === savedPaint(c))?.[0] || '')}</div></div>` : '',
      action: `${!allowed && !def?.car && ruleReason(c, rules) ? `<p class="group__note">${icon('lock')} ${esc(ruleReason(c, rules))}</p>` : ''}${C.button({ label: garage ? 'SELECT CAR' : 'RACE', icon: garage ? 'check' : 'flag', variant: 'primary', block: true, act: 'carConfirm', disabled: !allowed, attrs: { 'data-default': '' } })}`
    }) });
}

// Import and allocate only after the catalogue is mounted; one renderer for visible cars.
export function mountCarGrid(root) {
  let stopped = false, view;
  void importWithUpdate(() => import('./ui/garage-thumbnails.js')).then(({mountGarageThumbnails}) => {
    if (!stopped && root.isConnected) view = mountGarageThumbnails(root, CARS, savedPaint);
  });
  return { get thumbnailInfo() { return view?.info; }, dispose() { stopped = true; view?.dispose(); } };
}
/** Uses the live Menu instance supplied by main.js; selection returns a car ID without restarting the session. */
export function openCarPicker(options = {}) {
  const menu = options.menu || window.__flow?.menu;
  if (!menu) return false;
  menu.show('car', { ...options, garage: true, index: options.index ?? menu.h?.carIndex?.() ?? 0 }, true);
  return true;
}
/** opts (all optional): container (default #carStage under root), lite (the multiplayer showroom: pixel ratio 1, a
 *  soft contact shadow, at most 30 fps under a frame rate limit, no hint; it sits behind menu panels, so it stays light on the GPU) */
export function mountCarSelect(root, index, opts = {}) {
  const container = opts.container || root.querySelector('.car-preview-viewport') || root.querySelector('#carStage'), lite = !!opts.lite;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, lite ? 1 : 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04); scene.environment = environment.texture;
  room.dispose(); pmrem.dispose();
  let model = new CarModel(CARS[index], { plate: driverName.plate() });
  new Cockpit(CARS[index], model);
  model.root.rotation.y = -.5; scene.add(model.root);
  // Clone materials so the studio cannot change shared materials on the road.
  const materialCopies = new Map();
  const cloneMaterial = m => {
    if (!materialCopies.has(m)) { const copy=m.clone(); if ('envMap' in copy && !copy.userData.vehicleGlass) copy.envMap=environment.texture; materialCopies.set(m,copy); }
    return materialCopies.get(m);
  };
  const studioMaterials = model => {
  model.root.traverse(o=>{if(o.material)o.material=Array.isArray(o.material)?o.material.map(cloneMaterial):cloneMaterial(o.material);});
  model.paint = cloneMaterial(model.paint);
  model.paintAccents = (model.paintAccents || []).map(cloneMaterial);
  model.materials.black = cloneMaterial(model.materials.black);
  };studioMaterials(model);
  scene.add(new THREE.HemisphereLight('#dceaff', '#303038', 2.2));
  for (const [x,y,z,intensity] of [[-4,6,-3,3],[4,3,5,2]]) { const light = new THREE.DirectionalLight('#ffffff',intensity); light.position.set(x,y,z);scene.add(light); }
  const floor=createVehicleContactShadow();scene.add(floor);
  const camera = new THREE.PerspectiveCamera(35,1,.05,100);
  const prepareFraming = () => {
    model.root.traverse(o=>{if(o.isLOD){o.autoUpdate=false;o.levels.forEach((l,i)=>{l.object.visible=i===0;});}});
    return createVehicleFraming(model.root);
  };
  let framing=prepareFraming();
  const frame = () => {
    const fit=frameVehicle(camera,model.root,framing,container.clientWidth,container.clientHeight,{margin:lite?1.18:1.10});
    const center=framing.center.clone().applyMatrix4(model.root.matrixWorld);
    floor.position.set(center.x,framing.bounds.min.y-.015,center.z);floor.rotation.y=model.root.rotation.y;
    return fit;
  };
  const resize = () => {
    const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;
    renderer.setSize(w,h);const size=framing.bounds.getSize(new THREE.Vector3());floor.scale.set(size.x*1.6,1,size.z*1.3);
    frame();
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  const turntable = new TurntableControl(model.root.rotation.y); let pointer, pointerX, last = performance.now();
  const down = e => { if (pointer != null) return; e.preventDefault(); pointer=e.pointerId;pointerX=e.clientX;turntable.dragging=true;container.classList.add('dragging');container.setPointerCapture(pointer); };
  const move = e => { if(e.pointerId!==pointer)return;model.root.rotation.y=turntable.drag(e.clientX-pointerX);pointerX=e.clientX;frame();renderer.render(scene,camera); };
  const up = e => { if(e.pointerId!==pointer)return;pointer=null;turntable.dragging=false;container.classList.remove('dragging'); };
  container.addEventListener('pointerdown',down);container.addEventListener('pointermove',move);
  for(const name of ['pointerup','pointercancel','lostpointercapture'])container.addEventListener(name,up);
  const hint=document.createElement('span');hint.className='car-stage__hint';hint.setAttribute('aria-hidden','true');hint.textContent='DRAG TO ROTATE';if(!lite)container.append(hint);
  const limiter = new FrameLimiter();
  // The showroom follows Settings > Graphics > FRAME RATE LIMIT like the race does (NO LIMIT: every display refresh).
  // The multiplayer lobby's light variant also stays at or under 30 fps while a limit is set.
  const showroomCap = () => lite && settings.frameCap > 0 ? Math.min(30, settings.frameCap) : settings.frameCap;
  let showroomVisible = true, showroomRunning = false;
  // The turntable keeps redrawing even when the menu is hidden behind the race or another screen: pause it
  // while the stage is not visible (or the tab is), and render one frame on return so it never looks stale.
  const showroomDraw = now => {
    if (!limiter.allow(now, showroomCap())) return;
    model.root.rotation.y = turntable.advance((now - last) / 1000); last = now;
    frame();renderer.render(scene, camera);
  };
  const showroomResume = () => {
    if (showroomRunning || !showroomVisible || document.hidden) return;
    showroomRunning = true; last = performance.now(); renderer.setAnimationLoop(showroomDraw);
  };
  const showroomPause = (renderOnce = false) => {
    if (showroomRunning) { renderer.setAnimationLoop(null); showroomRunning = false; }
    if (renderOnce) renderer.render(scene, camera);
  };
  showroomRunning = true; renderer.setAnimationLoop(showroomDraw);
  const showroomObserver = new IntersectionObserver(entries => {
    showroomVisible = entries.some(e => e.isIntersecting);
    if (showroomVisible) showroomResume(); else showroomPause();
  });
  showroomObserver.observe(container);
  const showroomVis = () => { if (document.hidden) showroomPause(); else if (showroomVisible) showroomResume(); };
  document.addEventListener('visibilitychange', showroomVis);
  return {
    get index() { return index; }, get rotation() { return turntable.angle; },
    captureFrame(angle) { renderer.setAnimationLoop(null); if(Number.isFinite(angle)){turntable.angle=angle;model.root.rotation.y=angle;} frame();renderer.render(scene, camera); },
    get framingBounds() { return frame(); },
    paint(color) { if (savePaint(CARS[index].id,color)) setPaint(model,color); },
    dispose() {
            document.removeEventListener('visibilitychange', showroomVis); showroomObserver.disconnect();
      showroomRunning = false; renderer.setAnimationLoop(null); observer.disconnect();container.removeEventListener('pointerdown',down);container.removeEventListener('pointermove',move);for(const name of ['pointerup','pointercancel','lostpointercapture'])container.removeEventListener(name,up); model.disposeDamage?.();
      const geometry=new Set(), materials=new Set(), textures=new Set();
      scene.traverse(o=>{if(o.geometry && !o.geometry.userData.shared)geometry.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isCanvasTexture)textures.add(v);}});
      for(const r of [...geometry,...materials,...textures])r.dispose();
      environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    }
  };
}
