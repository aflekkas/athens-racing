import { importWithUpdate } from './client-release.js';
// The pre-race showroom uses the same model and cockpit as the driven car.
import * as THREE from 'three';
import {exhaustPopsEnabled} from './exhaust-pops.js';
import { createVehicleFraming, frameVehicle } from './ui/vehicle-framing.js';
import { badgeBrand, manufacturerOptions } from './manufacturers.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CARS, CarModel, setPaint } from './cars.js';
import { TurntableControl } from './turntable-control.js';
import { driverName } from './driver-name.js';
import { Cockpit } from './cockpit.js';
import { PAINTS, savedPaint, savePaint } from './vehicle-paint.js';
import { GARAGE_CLASSES, GARAGE_CARS, carCategory, classLabel, filterCars, carModel, migrateCarSelection, bodyTrim, trimChoices, stepTrim, readCarSelection } from './car-catalog.js';
import { classifyCar } from './car-performance.js';
import { carEligibility } from './mp-car-rules.js';
// Why a trim is locked by lobby car rules (null without rules or when eligible).
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
function displayTrim(c, model = carModel(c)) {
  const label = c.trimLabel || c.short || c.name, prefix = model?.name || '';
  return prefix && label.toUpperCase().startsWith(prefix.toUpperCase()) ? label.slice(prefix.length).trim() || label : label;
}
export function renderCarSelect({ index = 0, def, garage = false, detail = false, filters = {}, allowedCars, rules } = {}) {
  const c = CARS[index] || CARS[0], allowed = !allowedCars || allowedCars.includes(c.id), paints = PAINTS[c.id] || PAINTS[carModel(c)?.id] || [], acc = c.zeroTo100 || ACCELERATION[c.id], model = carModel(c);
  if (!detail) {
    let saved;try{saved=readCarSelection(localStorage);}catch{}
    const list = filterCars(CARS, filters, saved).map(item=>{const ids=carModel(item.car).trims, wanted=ids.find(id=>(!allowedCars || allowedCars.includes(id)) && (!def?.car || def.car===id));return wanted && (def?.car || allowedCars && !allowedCars.includes(item.car.id)) ? {car:CARS.find(c=>c.id===wanted),index:CARS.findIndex(c=>c.id===wanted)} : item;}), attrs = { 'data-scope': 'catalog' };
    const toolbar = `<div class="catalog-toolbar">${C.searchField({ name: 'car-search', label: 'Search cars', placeholder: 'SEARCH CARS', value: filters.search || '', inputAttrs: { 'data-car-search': '' } })}
      ${C.select({ key: 'brand', label: 'BRAND', compact: true, value: filters.brand || 'all', options: [['all', 'ALL'], ...manufacturerOptions(CARS.filter(car=>carModel(car))).map(([id,name])=>[id,name,{brand:id}])], attrs })}
      ${C.select({ key: 'category', label: 'CLASS', compact: true, value: filters.category || 'all', options: [['all', 'ALL'], ...GARAGE_CLASSES.map(([id, label]) => [id, label])], attrs })}
      ${C.select({ key: 'drive', label: 'DRIVE', compact: true, value: filters.drive || 'all', options: [['all', 'ALL'], ['FWD', 'FWD'], ['RWD', 'RWD'], ['AWD', 'AWD']], attrs })}
      ${C.select({ key: 'power', label: 'POWER', compact: true, value: filters.power || 'all', options: [['all', 'ALL'], ['low', 'UNDER 150 HP'], ['mid', '150–300 HP'], ['high', 'OVER 300 HP']], attrs })}
      ${C.select({ key: 'sort', label: 'SORT', compact: true, value: filters.sort || 'lineup', options: [['lineup', 'LINEUP'], ['power', 'POWER ↓'], ['weight', 'WEIGHT ↑']], attrs })}</div>`;
    const count = `${list.length} / ${GARAGE_CARS.length} CARS${def?.car ? ' · EVENT CAR LOCKED' : allowedCars ? ' · LOBBY CAR RULES APPLY' : ''}`;
    return C.screen({ cls: 'scr--catalog', kick: `${garage ? 'GARAGE' : esc(def?.name || 'CHOOSE YOUR CAR')} · ${count}`, title: 'GARAGE', hints: [['select', 'BROWSE'], ['confirm', 'DETAILS'], ['back', 'BACK']],
      body: `${toolbar}<div class="car-grid scroll-y">${list.map(({ car, index: i }) => {
        const locked = !!(def?.car && def.car !== car.id) || !!(allowedCars && !allowedCars.includes(car.id));
        const reason = locked && !def?.car ? ruleReason(car, rules) : null, m = carModel(car), trims = m.bodies ? m.bodies[0][2].length : m.trims.length;
        return C.carCard({ id: car.id, brand: badgeBrand(car), name: esc(m?.name || car.name), hp: Math.round(car.power * 1.341), kg: car.mass, drive: car.drive.toUpperCase(), locked, selected: carModel(CARS[index])===m,
          lockLabel: def?.car ? 'EVENT CAR ONLY' : 'HOST RULES',
          line: `${classLabel(carCategory(car))} · ${trims} TRIM${m.trims.length === 1 ? '' : 'S'}${m.bodies ? ' · 2 BODIES' : ''}${reason ? ` · ${esc(reason)}` : ''}`,
          attrs: { 'data-car-index': i, 'aria-disabled': locked ? 'true' : 'false', title: locked ? def?.car ? 'THIS EVENT USES ITS FIXED CAR' : reason || 'THE HOST DOES NOT ALLOW THIS CAR' : 'VIEW CAR', ...(carModel(CARS[index])===m && !locked ? { 'data-default': '' } : {}) } });
      }).join('') || '<div class="empty">NO CARS MATCH · CHANGE YOUR FILTERS</div>'}</div>` });
  }
  const available=id=>(!allowedCars || allowedCars.includes(id)) && (!def?.car || def.car===id);
  const body=model?.bodies?.find(([, ,ids])=>ids.includes(c.id));
  const trims=trimChoices(c.id,{allowedCars,def,cars:CARS});
  const specs = [['POWER', `${Math.round(c.power * 1.341)} HP`, 'lightning'], ['TORQUE', `${c.torque} NM`, 'gauge'], ['WEIGHT', `${c.mass} KG`, 'cube'], ['DRIVE', c.drive.toUpperCase(), 'tire'], ['0–100 KM/H', acc ? `${c.id === 'gtv' ? '≈ ' : ''}${acc.toFixed(1)} S` : '—', 'timer'], ['TOP SPEED', `${c.vmax} KM/H`, 'gauge']];
  return C.screen({ cls: 'scr--car', kick: classLabel(carCategory(c)), title: c.name,
    hints: [['leftright', 'TRIM · A/D · LB/RB'], ['confirm', garage ? 'SELECT' : 'RACE'], ['back', 'CATALOGUE']],
    body: `<div class="car-layout"><div class="car-stage" id="carStage" data-trim-current="${c.id}" aria-label="Rotating 3D view of ${esc(c.name)}"><div class="car-preview-viewport" data-ui-keep="preview"></div></div>
    ${C.vehicleSpecs({ brand: badgeBrand(c), name: model?.name || c.name, trim: displayTrim(c,model), transmission: `${c.gears.length}-SPEED ${c.gearbox === 'MT' ? 'MANUAL' : c.gearbox || ''} · ${c.drive.toUpperCase()}`, specs,
      choices: `${body ? C.segmented({key:'carBody',label:'BODY',value:body[0],options:model.bodies.filter(([, ,ids])=>ids.some(available)).map(([id,label])=>[id,label]),attrs:{'data-scope':'car-body'}}) : ''}${trims.length > 1 ? C.segmented({key:'carTrim',label:'TRIM',value:c.id,options:trims.map(id=>{const car=CARS.find(c=>c.id===id);return [id,esc(displayTrim(car,model))];}),attrs:{'data-scope':'car-trim'}}) : ''}`,
      extra: c.exhaustPops ? C.toggle({key:'exhaustPops',label:'EXHAUST POPS',value:exhaustPopsEnabled(c),attrs:{'data-scope':'exhaust'}}) : '',
      paint: paints.length ? `<div class="car-paints"><span class="label">PAINT</span><div class="car-paints__row">${paints.map(([name, color]) => `<div class="mi paint ${savedPaint(c) === color ? 'selected' : ''}" role="button" aria-label="${esc(name)}" title="${esc(name)}" data-act="paint" data-color="${color}" style="--paint:${color}"></div>`).join('')}</div><div class="car-paint-name">${esc(paints.find(p => p[1] === savedPaint(c))?.[0] || '')}</div></div>` : '',
      action: `${!allowed && !def?.car && ruleReason(c, rules) ? `<p class="group__note">${icon('lock-simple')} ${esc(ruleReason(c, rules))}</p>` : ''}${C.button({ label: garage ? 'SELECT CAR' : 'RACE', icon: garage ? 'check' : 'flag-checkered', variant: 'primary', block: true, act: 'carConfirm', disabled: !allowed, attrs: { 'data-default': '' } })}`
    })}</div>` });
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
 *  small shadow map, 30 fps, no hint; it sits behind menu panels, so it stays light on the GPU) */
export function mountCarSelect(root, index, opts = {}) {
  // Keep trim events inside this component; the shared menu owns navigation/layout.
  const onTrim = e => {
    const scope=e.detail?.el?.dataset.scope;
    if(!['car-trim','car-body'].includes(scope)) return;
    e.stopPropagation();
    const menu=window.__flow?.menu, model=carModel(CARS[index]);
    const allowed=menu?.data?.def?.car ? [menu.data.def.car] : menu?.data?.allowedCars;
    const id=scope==='car-body'?bodyTrim(model,CARS[index].id,e.detail.value,allowed):e.detail.value;
    const next=CARS.findIndex(c=>c.id===id);
    if(allowed && !allowed.includes(id))return;
    if(next>=0 && carModel(CARS[next])===carModel(CARS[index]) && menu)swapTo(next);
  };
  const onConfirm = e => {
    if(!e.target.closest('[data-act="carConfirm"]')) return;
    try { localStorage.setItem('paraliaki.car.selection',JSON.stringify(migrateCarSelection(CARS[index].id))); } catch {}
  };
  root.addEventListener('ui:change',onTrim,true); root.addEventListener('click',onConfirm,true);
  const container = opts.container || root.querySelector('.car-preview-viewport') || root.querySelector('#carStage'), lite = !!opts.lite;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lite ? 1 : 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
  for (const [x,y,z,intensity] of [[-4,6,-3,3],[4,3,5,2]]) { const light = new THREE.DirectionalLight('#ffffff',intensity); light.position.set(x,y,z); if (x < 0) { light.castShadow=true; light.shadow.mapSize.set(lite ? 512 : 1024, lite ? 512 : 1024); Object.assign(light.shadow.camera,{left:-5,right:5,top:5,bottom:-5,near:.1,far:20}); light.shadow.normalBias=.025; } scene.add(light); }
  // Transparent ground receives a soft contact shadow; no visible plinth or turntable disc.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),new THREE.ShadowMaterial({opacity:.22}));
  floor.receiveShadow=true;scene.add(floor);
  const camera = new THREE.PerspectiveCamera(35,1,.05,100);
  const prepareFraming = () => {
    model.root.traverse(o=>{if(o.isLOD){o.autoUpdate=false;o.levels.forEach((l,i)=>{l.object.visible=i===0;});}});
    return createVehicleFraming(model.root);
  };
  let framing=prepareFraming();
  const frame = () => frameVehicle(camera,model.root,framing,container.clientWidth,container.clientHeight,{margin:lite?1.18:1.10});
  const resize = () => {
    const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;
    renderer.setSize(w,h);floor.position.y=framing.bounds.min.y-.015;floor.scale.setScalar(framing.radius*6);
    scene.traverse(o=>{if(o.isDirectionalLight&&o.castShadow){const radius=framing.radius*1.5;Object.assign(o.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,far:Math.max(20,radius*6)});o.shadow.camera.updateProjectionMatrix();}});
    frame();
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  const turntable = new TurntableControl(model.root.rotation.y); let pointer, pointerX, pointerStart, pointerAt, touch, last = performance.now();
  const down = e => { if (pointer != null) return; e.preventDefault(); pointer=e.pointerId;pointerX=e.clientX;pointerStart=e.clientX;pointerAt=performance.now();touch=e.pointerType==='touch';turntable.dragging=true;container.classList.add('dragging');container.setPointerCapture(pointer); };
  const move = e => { if(e.pointerId!==pointer)return;model.root.rotation.y=turntable.drag(e.clientX-pointerX);pointerX=e.clientX;frame();renderer.render(scene,camera); };
  const up = e => { if(e.pointerId!==pointer)return;const swipe=touch?e.clientX-pointerStart:0;pointer=null;if(e.type==='pointerup' && Math.abs(swipe)>60 && performance.now()-pointerAt<350)step(swipe<0?1:-1);turntable.dragging=false;container.classList.remove('dragging'); };
  container.addEventListener('pointerdown',down);container.addEventListener('pointermove',move);
  for(const name of ['pointerup','pointercancel','lostpointercapture'])container.addEventListener(name,up);
  const hint=document.createElement('span');hint.className='car-stage__hint';hint.setAttribute('aria-hidden','true');hint.textContent='DRAG TO ROTATE · SWIPE TO CHANGE TRIM';if(!lite)container.append(hint);
  const rules=()=>window.__flow?.menu?.data || {};
  const swapTo = next => {
    if(next===index)return false;
    const nextSpec=CARS[next],old=model;
    const nextModel=new CarModel(nextSpec,{plate:driverName.plate()});new Cockpit(nextSpec,nextModel);studioMaterials(nextModel);
    nextModel.root.rotation.y=turntable.angle;scene.add(nextModel.root);old.root.removeFromParent();old.disposeDamage?.();
    old.root.traverse(o=>{if(o.geometry&&!o.geometry.userData.shared)o.geometry.dispose();});
    const nextMaterials=new Set(),nextTextures=new Set();nextModel.root.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){nextMaterials.add(m);for(const v of Object.values(m))if(v?.isTexture)nextTextures.add(v);}});
    for(const [original,copy]of materialCopies)if(!nextMaterials.has(copy)){for(const v of Object.values(copy))if(v?.isCanvasTexture&&!nextTextures.has(v))v.dispose();copy.dispose();materialCopies.delete(original);}
    model=nextModel;index=next;framing=prepareFraming();resize();
    const menu=window.__flow?.menu;if(menu){menu.data={...menu.data,index,detail:true};C.morph(root,renderCarSelect(menu.data));C.indicators(root);}
    renderer.render(scene,camera);return true;
  };
  const step = direction => {const id=stepTrim(CARS[index].id,direction,{...rules(),cars:CARS});return id?swapTo(CARS.findIndex(c=>c.id===id)):false;};
  const onStepClick=e=>{const act=e.target.closest('[data-act]')?.dataset.act;if(!['carTrimPrev','carTrimNext'].includes(act))return;e.preventDefault();e.stopImmediatePropagation();step(act==='carTrimNext'?1:-1);};
  const onKey=e=>{if(lite||window.__flow?.menu?.screen!=='car'||e.repeat||e.ctrlKey||e.altKey||e.metaKey||e.target.closest?.('input,textarea,[contenteditable]')||!['KeyA','KeyD'].includes(e.code))return;e.preventDefault();e.stopImmediatePropagation();step(e.code==='KeyD'?1:-1);};
  root.addEventListener('click',onStepClick,true);document.addEventListener('keydown',onKey,true);
  let previousShoulders=[false,false],padFrame;
  const pollPad=()=>{const pads=navigator.getGamepads?.()||[];const buttons=[...pads].filter(Boolean).reduce((a,p)=>[a[0]||!!p.buttons[4]?.pressed,a[1]||!!p.buttons[5]?.pressed],[false,false]);for(let i=0;i<2;i++)if(!lite&&window.__flow?.menu?.screen==='car'&&buttons[i]&&!previousShoulders[i])step(i?1:-1);previousShoulders=buttons;padFrame=requestAnimationFrame(pollPad);};padFrame=requestAnimationFrame(pollPad);
  let drawn = 0, showroomVisible = true, showroomRunning = false;
  // The turntable keeps redrawing even when the menu is hidden behind the race or another screen: pause it
  // while the stage is not visible (or the tab is), and render one frame on return so it never looks stale.
  const showroomDraw = now => {
    if (lite && now - drawn < 32) return; drawn = now;
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
    get index() { return index; }, stepTrim:step, get rotation() { return turntable.angle; },
    captureFrame(angle) { renderer.setAnimationLoop(null); if(Number.isFinite(angle)){turntable.angle=angle;model.root.rotation.y=angle;} frame();renderer.render(scene, camera); },
    get framingBounds() { return frame(); },
    paint(color) { if (savePaint(CARS[index].id,color)) setPaint(model,color); },
    dispose() {
      cancelAnimationFrame(padFrame);root.removeEventListener('click',onStepClick,true);document.removeEventListener('keydown',onKey,true);root.removeEventListener('ui:change',onTrim,true);root.removeEventListener('click',onConfirm,true);
      document.removeEventListener('visibilitychange', showroomVis); showroomObserver.disconnect();
      showroomRunning = false; renderer.setAnimationLoop(null); observer.disconnect();container.removeEventListener('pointerdown',down);container.removeEventListener('pointermove',move);for(const name of ['pointerup','pointercancel','lostpointercapture'])container.removeEventListener(name,up); model.disposeDamage?.();
      const geometry=new Set(), materials=new Set(), textures=new Set();
      scene.traverse(o=>{if(o.geometry && !o.geometry.userData.shared)geometry.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isCanvasTexture)textures.add(v);}});
      for(const r of [...geometry,...materials,...textures])r.dispose();
      environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    }
  };
}
