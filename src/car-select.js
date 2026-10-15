// The pre-race showroom uses the same model and cockpit as the driven car.
import * as THREE from 'three';
import {exhaustPopsEnabled} from './exhaust-pops.js';
import {showroomRig} from './vehicle-camera.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CARS, CarModel, setPaint } from './cars.js';
import { TurntableControl } from './turntable-control.js';
import { driverName } from './driver-name.js';
import { Cockpit } from './cockpit.js';
import { PAINTS, savedPaint, savePaint } from './vehicle-paint.js';
import { GARAGE_CLASSES, GARAGE_CARS, carCategory, classLabel, filterCars, carModel, migrateCarSelection, bodyTrim, trimChoices, stepTrim } from './car-catalog.js';
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
function trimBrowser(c,model,trims,body,available) {
  const at=trims.indexOf(c.id),acc=c.zeroTo100 || ACCELERATION[c.id];
  return `<style>
  .car-trim-browser{position:absolute;z-index:4;top:14px;left:16px;right:16px;display:flex;align-items:center;gap:12px}
  .car-trim-browser__copy{flex:1;min-width:0;text-align:center}.car-trim-browser__name{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap}
  .car-trim-browser strong{font:500 18px var(--f-cond,sans-serif);letter-spacing:.08em}.car-trim-browser small{display:block;margin-top:7px;font-size:12px;color:var(--c-text-3,#a5afb8)}
  .car-trim-pips{display:flex;gap:7px;justify-content:center;margin-top:10px}.car-trim-pips i{height:5px;width:5px;border-radius:50%;background:currentColor;opacity:.25;transition:opacity 160ms linear}.car-trim-pips i.on{opacity:1}
  .car-trim-browser .btn{min-width:40px;min-height:40px;box-shadow:none!important;border-radius:3px}.car-trim-browser .field{padding:0;min-height:0;background:none;border:0;--s-4:.5rem;--t-sm:.72rem}.car-trim-browser .field__label{display:none}
  .car-trim-browser .field::after,.car-trim-browser .field::before{display:none}.car-trim-browser .seg,.car-trim-browser .sel-ind{box-shadow:none!important}.car-trim-browser .seg{border:1px solid var(--hu-hair,#39424b)}
  .car-preview-viewport{position:absolute;inset:112px 0 0;touch-action:pan-y}.car-stage:has([data-key=carBody]) .car-preview-viewport{top:134px}
  @media(max-width:600px){.car-trim-browser{left:8px;right:8px;gap:5px}.car-trim-browser strong{font-size:15px}.car-trim-browser__name{gap:7px}.car-trim-browser small{font-size:10px}}
  </style><div class="car-trim-browser" data-trim-current="${c.id}" aria-label="Engine and trim">
  ${C.button({icon:'caret-left',act:'carTrimPrev',variant:'ghost',disabled:trims.length<2,attrs:{'aria-label':'Previous trim',title:'Previous trim · A / LB'}})}
  <div class="car-trim-browser__copy"><div class="car-trim-browser__name"><strong aria-live="polite">${esc(c.trimLabel || c.short)}</strong>
  ${body?C.segmented({key:'carBody',label:'BODY',value:body[0],options:model.bodies.filter(([, ,ids])=>ids.some(available)).map(([id,label])=>[id,label]),attrs:{'data-scope':'car-body','aria-label':'Body style'}}):''}</div>
  <small>${Math.round(c.power*1.341)} HP · ${acc?.toFixed(1) || '—'} S 0–100 · ${c.drive.toUpperCase()}</small>
  <div class="car-trim-pips" role="img" aria-label="Trim ${at+1} of ${trims.length}">${trims.map((id,i)=>`<i class="${i===at?'on':''}"></i>`).join('')}</div></div>
  ${C.button({icon:'caret-right',act:'carTrimNext',variant:'ghost',disabled:trims.length<2,attrs:{'aria-label':'Next trim',title:'Next trim · D / RB'}})}</div>`;
}
export function renderCarSelect({ index = 0, def, garage = false, detail = false, filters = {}, allowedCars, rules, road = 'ATHENS RIVIERA' } = {}) {
  const c = CARS[index] || CARS[0], allowed = !allowedCars || allowedCars.includes(c.id), paints = PAINTS[c.id] || PAINTS[carModel(c)?.id] || [], acc = c.zeroTo100 || ACCELERATION[c.id], model = carModel(c);
  if (!detail) {
    const list = filterCars(CARS, filters).map(item=>{const ids=carModel(item.car).trims, wanted=ids.find(id=>(!allowedCars || allowedCars.includes(id)) && (!def?.car || def.car===id));return wanted && (def?.car || allowedCars && !allowedCars.includes(item.car.id)) ? {car:CARS.find(c=>c.id===wanted),index:CARS.findIndex(c=>c.id===wanted)} : item;}), attrs = { 'data-scope': 'catalog' };
    return C.screen({ appearance: 'racing', road, car: c.name, cls: 'scr--catalog', kick: garage ? 'GARAGE' : esc(def?.name || 'CHOOSE YOUR CAR'), title: 'THE GARAGE', hints: [['select', 'BROWSE'], ['confirm', 'DETAILS'], ['back', 'BACK']],
      body: `<div class="garage-intro"><div><span class="label">YOUR COLLECTION / ATTICA, GREECE</span><h3>FIND YOUR NEXT DRIVE.</h3><span class="garage-intro__selected">READY IN YOUR GARAGE · ${esc(c.name)}</span></div>${C.roadSign(undefined,road)}</div><div class="catalog-toolbar"><label class="catalog-search">${icon('magnifying-glass')}<input data-car-search type="search" placeholder="SEARCH CARS" aria-label="Search cars" value="${esc(filters.search || '')}" autocomplete="off" /></label>
      ${C.select({ key: 'category', label: 'CLASS', value: filters.category || 'all', options: [['all', 'ALL CLASSES'], ...GARAGE_CLASSES.map(([id, label]) => [id, label])], attrs })}
      ${C.select({ key: 'drive', label: 'DRIVE', value: filters.drive || 'all', options: [['all', 'ALL'], ['FWD', 'FWD'], ['RWD', 'RWD'], ['AWD', 'AWD']], attrs })}
      ${C.select({ key: 'power', label: 'POWER', value: filters.power || 'all', options: [['all', 'ALL HP'], ['low', 'UNDER 150 HP'], ['mid', '150–300 HP'], ['high', 'OVER 300 HP']], attrs })}
      ${C.select({ key: 'sort', label: 'SORT', value: filters.sort || 'lineup', options: [['lineup', 'LINEUP'], ['power', 'POWER ↓'], ['weight', 'WEIGHT ↑']], attrs })}</div>
      <div class="catalog-count label">${list.length} / ${GARAGE_CARS.length} CARS${def?.car ? ' · EVENT CAR LOCKED' : allowedCars ? ' · LOBBY CAR RULES APPLY' : ''}</div>
      <div class="car-grid scroll-y">${list.map(({ car, index: i }, n) => {

        const locked = !!(def?.car && def.car !== car.id) || !!(allowedCars && !allowedCars.includes(car.id));
        const reason = locked && !def?.car ? ruleReason(car, rules) : null;
        return C.card({ cls: 'car-card' + (locked ? ' off' : ''), act: 'carDetail', selected: i === index,
          attrs: { 'data-car-index': i, 'aria-disabled': locked ? 'true' : 'false', title: locked ? def?.car ? 'THIS EVENT USES ITS FIXED CAR' : reason || 'THE HOST DOES NOT ALLOW THIS CAR' : 'VIEW CAR', ...(i === index && !locked ? { 'data-default': '' } : {}) },
          media: `<img data-car-thumb="${car.id}" alt="${esc(car.name)}" />`, badge: C.badge(car.drive.toUpperCase()), title: esc(carModel(car)?.name || car.name),
          text: `${classLabel(carCategory(car))} · ${carModel(car).bodies ? carModel(car).bodies[0][2].length : carModel(car).trims.length} TRIM${carModel(car).trims.length === 1 ? '' : 'S'}${carModel(car).bodies ? ' · 2 BODIES' : ''}${reason ? ` · ${esc(reason)}` : ''}`,
          foot: `<b>${Math.round(car.power * 1.341)} HP</b><span>${car.mass} KG</span>${locked ? C.badge(def?.car ? 'EVENT CAR ONLY' : 'HOST RULES', '', 'lock-simple') : ''}` });
      }).join('') || '<div class="empty">NO CARS MATCH · CHANGE YOUR FILTERS</div>'}</div>` });
  }
  const available=id=>(!allowedCars || allowedCars.includes(id)) && (!def?.car || def.car===id);
  const body=model?.bodies?.find(([, ,ids])=>ids.includes(c.id));
  const trims=trimChoices(c.id,{allowedCars,def});
  const specs = [['POWER', `${Math.round(c.power * 1.341)} HP`, 'lightning'], ['TORQUE', `${c.torque} NM`, 'gauge'], ['WEIGHT', `${c.mass} KG`, 'cube'], ['DRIVE', c.drive.toUpperCase(), 'tire'], ['0–100 KM/H', acc ? `${c.id === 'gtv' ? '≈ ' : ''}${acc.toFixed(1)} S` : '—', 'timer']];
  return C.screen({ cls: 'scr--car', kick: classLabel(carCategory(c)), title: c.name,
    hints: [['leftright', 'TRIM · A/D · LB/RB'], ['confirm', garage ? 'SELECT' : 'RACE'], ['back', 'CATALOGUE']],
    body: `<div class="car-layout"><div class="car-stage" id="carStage" aria-label="Rotating 3D view of ${esc(c.name)}">${trimBrowser(c,model,trims,body,available)}<div class="car-preview-viewport" data-ui-keep="preview"></div></div>
    <section class="car-info panel panel--notch scroll-y"><p class="car-description">${esc(c.tag)}</p>
      <div class="car-transmission label">${c.gears.length}-SPEED · ${c.drive.toUpperCase()}</div>
      ${C.stats(specs.map(([k, v, ic]) => [k, v, { icon: ic }]), 'car-specs')}
      ${c.exhaustPops ? C.toggle({key:'exhaustPops',label:'EXHAUST POPS',value:exhaustPopsEnabled(c),attrs:{"data-scope":"exhaust"}}) : ''}
      <div class="car-paints"><span class="label">PAINT</span><div class="car-paints__row">${paints.map(([name, color]) => `<div class="mi paint ${savedPaint(c) === color ? 'selected' : ''}" role="button" aria-label="${esc(name)}" title="${esc(name)}" data-act="paint" data-color="${color}" style="--paint:${color}"></div>`).join('')}</div><div class="car-paint-name">${esc(paints.find(p => p[1] === savedPaint(c))?.[0] || 'Custom paint')}</div></div>
      <div class="car-actions">${!allowed && !def?.car && ruleReason(c, rules) ? `<p class="group__note">${icon('lock-simple')} ${esc(ruleReason(c, rules))}</p>` : ''}${C.button({ label: garage ? 'SELECT CAR' : 'RACE', icon: garage ? 'check' : 'flag-checkered', variant: 'primary', size: 'lg', block: true, act: 'carConfirm', disabled: !allowed, attrs: { 'data-default': '' } })}</div>
    </section></div>` });
}

// Import and allocate only after the catalogue is mounted; one renderer for visible cars.
export function mountCarGrid(root) {
  let stopped = false, view;
  void import('./ui/garage-thumbnails.js').then(({mountGarageThumbnails}) => {
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
    if (!materialCopies.has(m)) { const copy=m.clone(); if ('envMap' in copy) copy.envMap=environment.texture; materialCopies.set(m,copy); }
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
  // lite (the multiplayer showroom): no floor disc, only the car's soft shadow on the screen's own backdrop
  const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2,64).rotateX(-Math.PI/2),lite ? new THREE.ShadowMaterial({opacity:.5}) : new THREE.MeshStandardMaterial({color:'#242d36',roughness:.7})); floor.position.y=-.02; floor.receiveShadow=true; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(35,1,.05,50);
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return;
    renderer.setSize(w,h); camera.aspect=w/h;
    const framing=showroomRig(CARS[index],camera.aspect,35,Math.max(8.3,6.2/camera.aspect)*(lite?1.12:1)),distance=framing.distance;
    floor.scale.setScalar(Math.max(1,(CARS[index].length||4)/7));
    camera.position.set(distance*.64,distance*.32,distance*.69); camera.lookAt(0,CARS[index].nativeFleet?framing.targetY:lite?.45:.65,0); camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  const turntable = new TurntableControl(model.root.rotation.y); let pointer, pointerX, pointerStart, pointerAt, touch, last = performance.now();
  const down = e => { if (pointer != null) return; e.preventDefault(); pointer=e.pointerId;pointerX=e.clientX;pointerStart=e.clientX;pointerAt=performance.now();touch=e.pointerType==='touch';turntable.dragging=true;container.classList.add('dragging');container.setPointerCapture(pointer); };
  const move = e => { if(e.pointerId!==pointer)return;model.root.rotation.y=turntable.drag(e.clientX-pointerX);pointerX=e.clientX;renderer.render(scene,camera); };
  const up = e => { if(e.pointerId!==pointer)return;const swipe=touch?e.clientX-pointerStart:0;pointer=null;if(e.type==='pointerup' && Math.abs(swipe)>60 && performance.now()-pointerAt<350)step(swipe<0?1:-1);turntable.dragging=false;container.classList.remove('dragging'); };
  container.addEventListener('pointerdown',down);container.addEventListener('pointermove',move);
  for(const name of ['pointerup','pointercancel','lostpointercapture'])container.addEventListener(name,up);
  const hint=document.createElement('span');hint.className='car-stage__hint';hint.textContent='DRAG TO ROTATE · SWIPE TO CHANGE TRIM';if(!lite)container.append(hint);
  const rules=()=>window.__flow?.menu?.data || {};
  const swapTo = next => {
    if(next===index)return false;
    const nextSpec=CARS[next],old=model;
    const nextModel=new CarModel(nextSpec,{plate:driverName.plate()});new Cockpit(nextSpec,nextModel);studioMaterials(nextModel);
    nextModel.root.rotation.y=turntable.angle;scene.add(nextModel.root);old.root.removeFromParent();old.disposeDamage?.();
    old.root.traverse(o=>{if(o.geometry&&!o.geometry.userData.shared)o.geometry.dispose();});
    const nextMaterials=new Set(),nextTextures=new Set();nextModel.root.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){nextMaterials.add(m);for(const v of Object.values(m))if(v?.isTexture)nextTextures.add(v);}});
    for(const [original,copy]of materialCopies)if(!nextMaterials.has(copy)){for(const v of Object.values(copy))if(v?.isCanvasTexture&&!nextTextures.has(v))v.dispose();copy.dispose();materialCopies.delete(original);}
    model=nextModel;index=next;resize();
    const menu=window.__flow?.menu;if(menu){menu.data={...menu.data,index,detail:true};C.morph(root,renderCarSelect(menu.data));C.indicators(root);}
    renderer.render(scene,camera);return true;
  };
  const step = direction => {const id=stepTrim(CARS[index].id,direction,rules());return id?swapTo(CARS.findIndex(c=>c.id===id)):false;};
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
    renderer.render(scene, camera);
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
    captureFrame() { renderer.setAnimationLoop(null);  renderer.render(scene, camera); },
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
