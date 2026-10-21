import {loadWorldDefinition} from './world-manifest.js';
// Free roam spawn picker (owner decisions 2026-10-19 "i just pick where to be spawned" and 2026-10-20 "would it not make
// sense for free roam to just be click anywhere on the map"). The same full-page Attica map and screen template as Track
// select (src/map-select.js), with the floating panel over it. There are no POI pins: a click anywhere snaps to the nearest
// drivable road and a marker names the street. The arrows step through general areas, one per playable map, flying there
// and pre-selecting a road point. Drag and two-finger scroll pan, pinch and the mouse wheel zoom; there is no reset control.
// The panel shows the place, the car (with the garage path to change it) and DRIVE; the game then puts the car on the
// nearest road to that point with the tow placement (src/tow-placement.js), see spawnOnRoad in src/main.js.
import { upperName } from './greek-caps.js';
import { MAP_VIEW, MAP_LABELS } from './attica-map-data.js';
import { coverScale, frameBounds, fitTracks, clampCamera, flight } from './map-select-camera.js';
import { createMapRenderer, smooth } from './map-select-render.js';
import { createWheelClassifier, wheelZoomFactor, wheelPan, createGlide } from './map-wheel.js';
import { loadAssets } from './map-select.js';
import { freeRoam } from './events.js';
import { AREA_NAMES, athensCell, athensEnabled, decodeSpawnRoads, nearestDistrict, snapToRoad, spawnAreas } from './spawn-spots.js';
import * as C from './ui/components.js';

const { esc, icon } = C;
const COLORS = { riviera: '#ff7868', penteli: '#71d5c1', megara: '#e4bf70', psychiko: '#d7cf83', athens: '#8fb4ff' };
const color = id => COLORS[id] || COLORS.riviera;
const areaName = id => AREA_NAMES[id] || id.toUpperCase();
function style() {
  if (document.getElementById('map-select-style')) return;
  const link = document.createElement('link'); link.id = 'map-select-style'; link.rel = 'stylesheet'; link.href = new URL('./map-select.css', import.meta.url).href; document.head.append(link);
}
const FOCUS_SCALE = 14, ROAD_RADIUS_PX = 60;
// Zoom runs from the whole map (cover) down to street level, about 1.4 m per pixel; a district frames about 4 km.
const MAX_ZOOM = 64, DISTRICT_SCALE = 26, ZOOM_STEP = 1.6;
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const PIXEL_BUDGET = 5.5e6;
const PLACES = { c: [-.5, -.5, 0, 0], r: [0, -.5, 8, 0], l: [-1, -.5, -8, 0], t: [-.5, -1, 0, -6], b: [-.5, 0, 0, 6] };

/** What the panel and the game need to know about a choice: a point on a drivable road, named after its street or area. */
const areaChoice = a => ({ id: a.id, mapId: a.mapId, name: a.name, at: a.at, local: a.local, start: true, areaId: a.id, areaName: a.name });
// A road point belongs to its map's area, or in the Athens world to the nearest district (an unnamed road is named after it).
const roadChoice = (snap, areas) => {
  const d = snap.mapId === 'athens' ? nearestDistrict(areas, snap.at) : null;
  return { id: 'road', mapId: snap.mapId, name: upperName(snap.street) || (d ? 'NEAR ' + d.name : areaName(snap.mapId)), at: snap.at, local: snap.local,
    areaId: d ? d.id : snap.mapId, areaName: d ? d.name : areaName(snap.mapId) };
};
function card(choice, menu) {
  const car = menu.h.carSpec?.();
  return `<div class="map-preview__info"><h3>${esc(choice.name)}</h3>
    ${C.listRow({ icon: 'car', title: esc(car?.name || 'YOUR CAR'), desc: 'Change car', act: 'spawnCar', cls: 'spawn-car' })}
    ${C.button({ label: 'DRIVE', icon: 'car', iconRight: 'chevron-right', variant: 'primary', block: true, act: 'spawnDrive', attrs: { 'data-default': '' } })}</div>`;
}
// The last place you started from is remembered on this device (one per world), so DRIVE goes straight back there
// (owner 2026-10-20: fewer steps to get anywhere). Only a place in an area this picker offers is restored.
const SAVED = athens => athens ? 'paraliaki.spawn.athens' : 'paraliaki.spawn';
function savedChoice(areas, athens) {
  try {
    const c = JSON.parse(localStorage.getItem(SAVED(athens)) || 'null');
    const ok = c && typeof c.name === 'string' && [c.at, c.local].every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) && areas.some(a => a.mapId === c.mapId);
    return ok ? c : null;
  } catch { return null; }
}
const saveChoice = (c, athens) => { try { const { id, mapId, name, at, local, areaId, areaName, start } = c; localStorage.setItem(SAVED(athens), JSON.stringify({ id, mapId, name, at, local, areaId, areaName, start })); } catch {} };
const areaLabel = choice => esc(choice.areaName || areaName(choice.mapId));

export function renderSpawnSelect(menu) {
  style();
  const areas = spawnAreas({ athens: athensEnabled() });
  const choice = menu.data.spawn?.choice || savedChoice(areas, athensEnabled()) || areaChoice(areas[0]);
  const labels = MAP_LABELS.map((l, i) => `<span class="map-label map-label--${l.k}" data-label="${i}"><i></i><b>${esc(l.t)}${l.s ? `<small>${esc(l.s)}</small>` : ''}</b></span>`).join('');
  return C.mapStage({ variant: 'floating', cls: 'scr--maps scr--spawn', kick: 'FREE ROAM', title: 'CHOOSE WHERE TO START',
    hints: [['leftright', 'AREA'], ['+ / −', 'ZOOM'], ['confirm', 'DRIVE'], ['back', 'BACK']],
    stageAttrs: { role: 'img', 'aria-label': `Map of Attica. Click anywhere to start on the nearest road. Areas: ${areas.map(a => a.name).join(', ')}.` },
    stage: `<canvas class="attica-canvas" aria-hidden="true"></canvas>
      <div class="attica-overlay"><div class="attica-labels" aria-hidden="true">${labels}</div>
        <span class="spawn-marker on" aria-hidden="true" style="--pin:${color(choice.mapId)}"><i></i><b class="spawn-marker__name">${esc(choice.name)}</b></span><span class="spawn-nohere" role="status" aria-live="polite"><b>NO ROAD HERE</b></span></div>
      <p class="attica-credit"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">EU-DEM, Copernicus</a></p>`,
    cardAttrs: { 'data-map': choice.mapId, style: `--track:${color(choice.mapId)}` },
    nav: `${C.button({ icon: 'chevron-left', variant: 'ghost', act: 'mapPrev', title: 'Previous area' })}<div><b class="map-track-count">${areaLabel(choice)}</b></div>${C.button({ icon: 'chevron-right', variant: 'ghost', act: 'mapNext', title: 'Next area' })}`, card: card(choice, menu) });
}

// ---------------------------------------------------------------- roads (fetched once per page)
let roadsAsset;
// The Athens world (dev flag) has its own street file, built from the published cells by tools/build-athens-streets.mjs.
const loadRoads = (athens = false) => roadsAsset ||= fetch(athens ? 'assets/athens/streets.json' : 'assets/maps/spawn-roads.json').then(r => { if (!r.ok) throw new Error('spawn roads ' + r.status); return r.json(); }).then(decodeSpawnRoads).catch(error => { roadsAsset = null; throw error; });
// The dev-flagged Athens world: the 512 m cells the published manifest hosts (a click only snaps to a street in one).
/** The Athens streets bucketed into ~350 m squares (each a Path2D per class), the renderer's drivable overlay. */
function overlayCells(list, size = 4) {
  const buckets = new Map(), cell = (x, y) => `${Math.floor(x / size)},${Math.floor(y / size)}`;
  for (const r of list) {
    const p = r.pts, k = cell(p[0], p[1]);
    let b = buckets.get(k); if (!b) buckets.set(k, b = { major: { box: [Infinity, Infinity, -Infinity, -Infinity], path: new Path2D() }, minor: { box: [Infinity, Infinity, -Infinity, -Infinity], path: new Path2D() } });
    const c = r.major ? b.major : b.minor; c.path.moveTo(p[0], p[1]);
    for (let i = 0; i < p.length; i += 2) { if (i) c.path.lineTo(p[i], p[i + 1]); c.box[0] = Math.min(c.box[0], p[i]); c.box[1] = Math.min(c.box[1], p[i + 1]); c.box[2] = Math.max(c.box[2], p[i]); c.box[3] = Math.max(c.box[3], p[i + 1]); }
  }
  const of = cls => [...buckets.values()].map(b => b[cls]).filter(c => c.box[0] <= c.box[2]);
  // Every street shows at every zoom (the whole basin reads as drivable), so tiles of neighbouring zoom levels match.
  return { major: of('major'), minor: of('minor'), colour: COLORS.athens, streetsFrom: 0, streetsFull: 0 };
}
let athensAsset;
const loadAthens = () => athensAsset ||= loadWorldDefinition(new URL('./data/athens/manifest.json', document.baseURI)).then(({manifest}) => ({cells:new Set(Object.keys(manifest.tiles))})).catch(error => { console.info('[spawn] Athens world unavailable:', error.message); return { cells: new Set() }; });

export function mountSpawnSelect(root, menu) {
  const map = root.querySelector('.attica-map'), canvas = map?.querySelector('.attica-canvas'), cardEl = root.querySelector('.map-preview'), overlay = root.querySelector('.attica-overlay');
  if (!map || !canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false }), credit = map.querySelector('.attica-credit'), marker = overlay.querySelector('.spawn-marker'), markerName = marker.querySelector('.spawn-marker__name'), nohere = overlay.querySelector('.spawn-nohere');
  const events = new AbortController(), { signal } = events, reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const { width: W, height: H } = MAP_VIEW, session = menu.data.spawn ||= {};
  const athensMode = athensEnabled(), maxZoom = MAX_ZOOM;
  let areas = spawnAreas({ athens: athensMode }), choice = session.choice ||= savedChoice(areas, athensMode) || areaChoice(areas[0]), layers = null, streetLayer = null;
  let camera, view, safe, dpr = 1, art = null, base = null, roads = null, athens = null, drag = null, pinch = null, tap = null, frame = 0, resizeFrame = 0, motion = null, last = 0, dirty = false, settling = false, onScreen = true, panning = false, moving = false, shown = null, placed = 0, intro = !session.arrived, hideTimer = 0;
  const pointers = new Map(), roadPaths = {}, areaBounds = {}, wheelKind = createWheelClassifier(), glide = createGlide();
  const labels = [...overlay.querySelectorAll('.map-label')].map(el => ({ el, ...MAP_LABELS[+el.dataset.label], box: null, place: null, shown: false }));
  let chrome = [];
  const rel = (el, vr, grow = 6) => { const r = el.getBoundingClientRect(); return [r.left - vr.left - grow, r.top - vr.top - grow, r.right - vr.left + grow, r.bottom - vr.top + grow]; };
  const measure = () => {
    const vr = map.getBoundingClientRect();
    for (const l of labels) { const b = l.el.querySelector('b'); l.box = [b.offsetWidth, b.offsetHeight]; }
    const scr = root.querySelector('.scr'), parts = [...scr.querySelectorAll(':scope > .hu-status, :scope > .scr__head')].filter(el => el.offsetHeight);
    const top = Math.max(0, ...parts.map(el => rel(el, vr, 0)[3])), foot = scr.querySelector(':scope > .scr__foot'), bottom = foot?.offsetHeight ? rel(foot, vr, 0)[1] : vr.height;
    const c = rel(cardEl, vr, 0), sheet = c[2] - c[0] > vr.width * .6;
    safe = { left: 0, top, right: sheet ? vr.width : Math.max(vr.width * .4, c[0] - 8), bottom: sheet ? Math.max(top + 80, c[1] - 8) : bottom };
    credit.style.transform = `translate(${Math.round(safe.right - credit.offsetWidth - 10)}px,${Math.round(safe.bottom - credit.offsetHeight - 6)}px)`;
    chrome = [...parts, foot, cardEl, credit].filter(el => el?.offsetHeight).map(el => rel(el, vr));
  };
  const toScreen = (x, y) => [view.width / 2 + camera.x + (x - W / 2) * camera.scale, view.height / 2 + camera.y + (y - H / 2) * camera.scale];
  const worldAt = (cam, px, py) => [W / 2 + (px - cam.x) / cam.scale, H / 2 + (py - cam.y) / cam.scale];
  const cameraFor = (scale, [wx, wy], px = 0, py = 0) => ({ scale, x: px - (wx - W / 2) * scale, y: py - (wy - H / 2) * scale });
  const minScale = () => coverScale(view, MAP_VIEW);
  const clamped = c => clampCamera(c, view, MAP_VIEW, maxZoom);
  const focusOn = (at, scale = FOCUS_SCALE) => frameBounds(view, MAP_VIEW, [at[0] - .5, at[1] - .5, at[0] + .5, at[1] + .5], safe, { pad: 0, minSpan: 0, maxScale: Math.min(maxZoom, scale) });
  const region = () => fitTracks(view, MAP_VIEW, [Math.min(...areas.map(a => a.at[0])), Math.min(...areas.map(a => a.at[1])), Math.max(...areas.map(a => a.at[0])), Math.max(...areas.map(a => a.at[1]))], safe);
  // An area is framed by its map's drivable roads once they have loaded, around its start point before that.
  const areaCamera = a => a.mapId === 'athens' ? focusOn(a.at, DISTRICT_SCALE) : areaBounds[a.mapId] ? fitTracks(view, MAP_VIEW, areaBounds[a.mapId], safe) : focusOn(a.at, 6);
  const areaOf = c => areas.find(a => a.id === c.areaId) || areas.find(a => a.mapId === c.mapId) || c;

  // ---------------------------------------------------------------- canvas: the cached base map under the drivable roads
  const pathsFor = data => { for (const [id, { roads: list }] of Object.entries(data)) {
    if (id === 'athens') { streetLayer = overlayCells(list); if (layers) { layers.overlay = streetLayer; base?.refresh(); } continue; }
    const major = new Path2D(), minor = new Path2D(), b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of list) { const path = r.major ? major : minor, p = r.pts; path.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]); for (let i = 0; i < p.length; i += 2) { b[0] = Math.min(b[0], p[i]); b[1] = Math.min(b[1], p[i + 1]); b[2] = Math.max(b[2], p[i]); b[3] = Math.max(b[3], p[i + 1]); } }
    roadPaths[id] = { major, minor }; if (id !== 'athens') areaBounds[id] = b; } };
  const draw = now => {
    if (!view || !camera) return;
    const k = camera.scale * dpr, ox = (view.width / 2 + camera.x - W / 2 * camera.scale) * dpr, oy = (view.height / 2 + camera.y - H / 2 * camera.scale) * dpr;
    if (!base) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#060b10'; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
    base.paint(camera, now);
    ctx.setTransform(k, 0, 0, k, ox, oy); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const px = 1 / camera.scale, near = smooth(1.5, 7, camera.scale);
    // Every road the game can put a car on is lit in its map's colour, the selected map's brightest; local streets come in with zoom.
    for (const [id, { major, minor }] of Object.entries(roadPaths)) {
      const lead = id === choice.mapId ? 1 : .6;
      ctx.strokeStyle = '#05080b'; ctx.lineWidth = (3.4 + near * 1.6) * px; ctx.globalAlpha = .5 * lead; ctx.stroke(major); if (near > 0) { ctx.globalAlpha = .4 * near * lead; ctx.stroke(minor); }
      ctx.strokeStyle = color(id); ctx.lineWidth = (1.5 + near * 1.3) * px; ctx.globalAlpha = (.55 + .25 * near) * lead; ctx.stroke(major);
      if (near > 0) { ctx.lineWidth = (1 + near * 1.1) * px; ctx.globalAlpha = .5 * near * lead; ctx.stroke(minor); }
    }
    ctx.globalAlpha = 1;
  };
  // Place names avoid the marker, its street name and the screen chrome.
  const placeLabels = () => {
    const taken = [...chrome];
    { const [sx, sy] = toScreen(...choice.at); taken.push([sx - 16, sy - 16, sx + 24 + (markerName.offsetWidth || 0), sy + 16]); }
    for (const l of labels) {
      let place = null;
      if (camera.scale >= l.z) {
        const [sx, sy] = toScreen(l.x, l.y), [w, h] = l.box, centred = l.k === 'city' || l.k === 'water' || l.k === 'suburb';
        for (const key of centred ? ['c'] : [...new Set([l.place || 'r', 'r', 'l', 't', 'b'])]) {
          const [fx, fy, ox, oy] = PLACES[key], rect = [sx + fx * w + ox, sy + fy * h + oy]; rect.push(rect[0] + w, rect[1] + h);
          const dot = centred ? rect : [sx - 4, sy - 4, sx + 4, sy + 4];
          if (rect[0] < 4 || rect[1] < 4 || rect[2] > view.width - 4 || rect[3] > view.height - 4) continue;
          if (!taken.some(t => hit(t, rect) || hit(t, dot))) { place = key; taken.push([rect[0] - 8, rect[1] - 4, rect[2] + 8, rect[3] + 4], dot); break; }
        }
      }
      if (place && place !== l.place) { l.el.dataset.place = place; l.place = place; }
      if (!!place !== l.shown) { l.shown = !!place; l.el.classList.toggle('on', l.shown); }
    }
  };
  const sync = (now = performance.now(), settle = false) => {
    if (!camera || !view) return;
    camera = clamped(camera);
    draw(now);
    const still = shown && shown.scale === camera.scale && shown.x === camera.x && shown.y === camera.y; shown = { ...camera };
    if (still && !settle) return;
    { const [sx, sy] = toScreen(...choice.at); marker.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`; }
    for (const l of labels) { const [sx, sy] = toScreen(l.x, l.y); l.el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`; }
    if (settle || now - placed > 120) { placed = now; placeLabels(); }
  };
  // One frame loop drives every camera move and the base layer's background painting; a resting map costs nothing.
  const tint = () => { if (!!(motion || panning) !== moving) cardEl.classList.toggle('panel--moving', moving = !moving); };
  const run = now => {
    frame = 0; const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
    if (!view || !onScreen || document.hidden) return;
    let settle = settling; const wasDirty = dirty; dirty = settling = false;
    if (motion?.type === 'fly') {
      const t = reduced.matches ? 1 : Math.min(1, (now - motion.start) / motion.duration);
      camera = t >= 1 ? { ...motion.to } : motion.path.at(easeInOut(t)); if (t >= 1) { motion = null; settle = true; }
    } else if (motion?.type === 'zoom') {
      const k = reduced.matches ? 1 : 1 - Math.exp(-dt / .09), log = Math.log(camera.scale) + (motion.log - Math.log(camera.scale)) * k;
      camera = cameraFor(Math.exp(log), motion.world, ...motion.anchor); if (Math.abs(log - motion.log) < 1e-3) { camera = cameraFor(Math.exp(motion.log), motion.world, ...motion.anchor); motion = null; settle = true; }
    }
    // A released drag keeps sliding for a moment and eases to a stop.
    if (!motion && glide.active) { const d = glide.step(dt); if (d) { camera.x += d[0]; camera.y += d[1]; } else settle = true; }
    tint();
    if (wasDirty || motion || settle || glide.active || base?.busy) sync(now, settle);
    base?.pump(now); tint();
    if (motion || glide.active || base?.busy) frame = requestAnimationFrame(run);
  };
  const start = () => { if (!frame && onScreen && !document.hidden) { last = 0; frame = requestAnimationFrame(run); } };
  const want = (settle = false) => { dirty = true; settling ||= settle; start(); };
  const stop = () => { motion = null; glide.halt(); base?.cancelPrepare(); cancelAnimationFrame(frame); frame = 0; };
  const flyTo = target => {
    if (!camera || !view) return;
    const to = clamped(target), from = { ...camera }, path = flight(from, to, view, MAP_VIEW);
    motion = { type: 'fly', to, path, start: performance.now(), duration: path.duration };
    if (base) { if (reduced.matches) base.prime(to); else base.prepare([.2, .4, .6, .8].map(e => path.at(e)).concat(to), to); }
    start();
  };
  const zoomAt = (factor, px, py) => {
    if (!camera || !view) return;
    const anchor = [px - view.width / 2, py - view.height / 2];
    const keep = motion?.type === 'zoom' && Math.hypot(anchor[0] - motion.anchor[0], anchor[1] - motion.anchor[1]) < 3;
    const log = Math.log(Math.max(minScale(), Math.min(maxZoom, Math.exp((keep ? motion.log : Math.log(camera.scale))) * factor)));
    motion = { type: 'zoom', log, anchor, world: keep ? motion.world : worldAt(camera, ...anchor) }; start();
  };
  const local = e => { const r = map.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  // ---------------------------------------------------------------- choosing: a point on a road, or an area's start
  // camera: 'area' flies to frame the area, 'point' flies in to the point, 'stay' leaves the camera where the player put it.
  const render = (next, { camera: move = 'stay' } = {}) => {
    const changed = next.id !== choice.id || next.mapId !== choice.mapId || next.at !== choice.at;
    choice = session.choice = next; session.arrived = true; saveChoice(choice, athensMode);
    cardEl.dataset.map = choice.mapId; cardEl.style.setProperty('--track', color(choice.mapId)); marker.style.setProperty('--pin', color(choice.mapId));
    const hadFocus = cardEl.querySelector('[data-act=spawnDrive]') === document.activeElement;
    const focused = menu.items()[menu.focus], inCard = !!focused && cardEl.contains(focused), at = menu.focus;
    const content = cardEl.querySelector('.map-preview-content'); content.innerHTML = card(choice, menu);
    if (inCard) menu.setFocus(at, false); // the card's rows are new nodes: the menu's focus stays on the same row
    if (changed) { content.classList.remove('swap'); void content.offsetWidth; content.classList.add('swap'); }
    cardEl.querySelector('.map-track-count').innerHTML = areaLabel(choice);
    markerName.textContent = choice.name; marker.classList.remove('on'); void marker.offsetWidth; marker.classList.add('on');
    clearTimeout(hideTimer); nohere.classList.remove('on');
    if (hadFocus) cardEl.querySelector('[data-act=spawnDrive]').focus({ preventScroll: true });
    if (view && camera && move === 'area') flyTo(areaCamera(areaOf(choice)));
    else if (view && camera && move === 'point') flyTo(focusOn(choice.at));
    else want(true);
    if (view && camera) { const [sx, sy] = toScreen(...choice.at); marker.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`; }
  };
  // An area's start, named after the street it is on once the roads have loaded.
  const startOf = area => {
    const snap = roads?.[area.mapId] && snapToRoad({ [area.mapId]: roads[area.mapId] }, ...area.at, area.mapId === 'athens' ? 2 : .5);
    return snap && hosted(snap) ? { ...roadChoice(snap, areas), id: area.id, start: true, areaId: area.id, areaName: area.name } : areaChoice(area);
  };
  const chooseArea = id => { const area = areas.find(a => a.id === id || a.mapId === id); if (area) render(startOf(area), { camera: 'area' }); };
  const cycle = delta => { const i = Math.max(0, areas.findIndex(a => a.id === areaOf(choice).id)); chooseArea(areas[(i + delta + areas.length) % areas.length].id); cardEl.querySelector('[data-act=spawnDrive]').focus({ preventScroll: true }); };
  // The Athens street file and the served world can differ (a newer bake): a street only counts in a cell the world hosts.
  const hosted = snap => snap.mapId !== 'athens' || !athens?.cells.size || athens.cells.has(athensCell(...snap.local));
  const say = (x, y) => {
    nohere.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`; nohere.classList.add('on');
    clearTimeout(hideTimer); hideTimer = setTimeout(() => nohere.classList.remove('on'), 1700);
  };
  const click = ([sx, sy]) => {
    if (!camera || !view) return;
    // A click reaches 60 px, at most about 260 m (Athens: 350 m), so "no road" means open country, sea or outside the world.
    const [wx, wy] = worldAt(camera, sx - view.width / 2, sy - view.height / 2), radius = Math.max(.25, Math.min(athensMode ? 4 : 3, ROAD_RADIUS_PX / camera.scale));
    const snap = roads && snapToRoad(roads, wx, wy, radius);
    if (!snap || !hosted(snap)) { say(sx + 12, sy - 6); return; }
    render(roadChoice(snap, areas)); // the camera stays where the player put it
  };

  // ---------------------------------------------------------------- input
  root.addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select,[contenteditable]')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) cycle(e.key === 'ArrowRight' ? 1 : -1); }
  }, { capture: true, signal });
  // + and − (main row or keypad) zoom about the middle of the free map, as a web map does, wherever the focus is.
  document.addEventListener('keydown', e => {
    if (e.target.closest?.('input,textarea,select,[contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    const zoom = ['+', '='].includes(e.key) || e.code === 'NumpadAdd' ? ZOOM_STEP : ['-', '_'].includes(e.key) || e.code === 'NumpadSubtract' ? 1 / ZOOM_STEP : 0;
    if (zoom && view) { e.preventDefault(); zoomAt(zoom, (safe.left + safe.right) / 2, (safe.top + safe.bottom) / 2); }
  }, { signal });
  map.addEventListener('scroll', () => { map.scrollLeft = 0; map.scrollTop = 0; }, { signal });
  // Two-finger trackpad scroll pans, a pinch (ctrl+wheel) or a mouse wheel zooms (src/map-wheel.js, owner 2026-10-20).
  map.addEventListener('wheel', e => {
    e.preventDefault(); if (!camera || !view) return;
    if (wheelKind(e) === 'zoom') { zoomAt(wheelZoomFactor(e), ...local(e)); return; }
    if (motion || glide.active) stop();
    const [dx, dy] = wheelPan(e); camera.x += dx; camera.y += dy; want();
  }, { passive: false, signal });
  map.addEventListener('pointerdown', e => {
    if (e.target.closest('.mi,a') || !camera) return;
    stop(); map.setPointerCapture(e.pointerId); pointers.set(e.pointerId, local(e)); drag = local(e); pinch = null; map.classList.add('dragging');
    // A press that never travels is a click on the map.
    tap = pointers.size === 1 ? { at: local(e), t: performance.now(), id: e.pointerId, button: e.button } : null;
  }, { signal });
  map.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return; pointers.set(e.pointerId, local(e));
    if (tap && Math.hypot(...local(e).map((v, i) => v - tap.at[i])) > 6) tap = null;
    if (pointers.size > 1) {
      tap = null;
      const [a, b] = [...pointers.values()], mid = [(a[0] + b[0]) / 2 - view.width / 2, (a[1] + b[1]) / 2 - view.height / 2], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) { const scale = Math.max(minScale(), Math.min(maxZoom, camera.scale * d / pinch.d)); camera = cameraFor(scale, worldAt(camera, ...pinch.mid), ...mid); panning = true; want(); }
      pinch = { d, mid }; drag = null; return;
    }
    if (drag && !pinch && !tap) { const [x, y] = local(e); camera.x += x - drag[0]; camera.y += y - drag[1]; glide.track(x - drag[0], y - drag[1], e.timeStamp); panning = true; want(); drag = [x, y]; }
  }, { signal });
  const up = e => {
    const clicked = e.type === 'pointerup' && tap && tap.id === e.pointerId && tap.button === 0 && performance.now() - tap.t < 700 ? tap.at : null; tap = null;
    pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; drag = pointers.size ? [...pointers.values()][0] : null;
    if (!pointers.size) { map.classList.remove('dragging'); panning = false; if (e.type === 'pointerup' && !clicked) glide.release(e.timeStamp); want(true); }
    if (clicked) click(clicked);
  };
  map.addEventListener('pointerup', up, { signal }); map.addEventListener('pointercancel', up, { signal });
  const relayout = () => {
    const rect = map.getBoundingClientRect(), next = { width: rect.width, height: rect.height };
    if (!next.width || !next.height) return;
    const old = view && camera && { centre: worldAt(camera, 0, 0), zoom: camera.scale / coverScale(view, MAP_VIEW) };
    view = next; dpr = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(PIXEL_BUDGET / (view.width * view.height)));
    canvas.width = Math.round(view.width * dpr); canvas.height = Math.round(view.height * dpr); base?.resize(view, dpr);
    measure();
    if (!old) { camera = intro ? region() : focusOn(choice.at, 8); base?.prime(camera); }
    else if (motion?.type === 'fly' || !motion) { stop(); camera = focusOn(choice.at, Math.min(camera.scale, FOCUS_SCALE)); }
    else camera = cameraFor(coverScale(view, MAP_VIEW) * old.zoom, old.centre);
    sync(performance.now(), true); maybeIntro(); start();
  };
  // Arrive on the region with every area in view, then fly to the chosen area once the art is ready.
  const maybeIntro = () => { if (intro && art && view) { intro = false; session.arrived = true; flyTo(areaCamera(areaOf(choice))); } };
  const resize = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(relayout); }); resize.observe(map);
  // In the Athens world the base map waits for the street file (or its failure), so no tile is ever painted without the
  // streets and later swapped: the map fills in once, without patches.
  const roadsLoad = loadRoads(athensMode);
  Promise.all([loadAssets(), athensMode ? roadsLoad.catch(() => null) : null]).then(([a]) => {
    if (signal.aborted) return; art = a; map.classList.add('ready');
    // The picker's own copy of the layer list, so its street overlay never reaches the Track select map (same cached assets).
    layers = { ...a.layers, ...(streetLayer ? { overlay: streetLayer } : {}) };
    base = createMapRenderer({ ctx, data: { art, layers, size: MAP_VIEW }, makeCanvas: (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }) }); if (view) { base.resize(view, dpr); if (camera) base.prime(camera); }
    Promise.all(a.detail.map(d => d.ready)).then(() => { if (!signal.aborted) want(true); });
    sync(performance.now(), true); maybeIntro(); start();
  }, error => { if (!signal.aborted) { map.classList.add('ready', 'failed'); console.error(error); } });
  roadsLoad.then(data => {
    if (signal.aborted) return; roads = data; pathsFor(data);
    // The pre-selected start takes its street's name; an area still flying in reframes to its roads.
    if (choice.start) { const area = areas.find(a => a.id === choice.areaId || a.id === choice.id); if (area) render(startOf(area), { camera: !intro && motion?.type === 'fly' ? 'area' : 'stay' }); }
    want(true);
  }, error => console.error(error));
  // Under ?map=athens only: the districts the published world hosts become the areas, and clicks snap only inside its cells.
  if (athensMode) loadAthens().then(a => {
    if (signal.aborted) return; athens = a; if (a.cells.size) areas = spawnAreas({ athens: true, athensCells: a.cells });
    if (choice.start && !areas.some(d => d.id === choice.areaId) && areas.length) render(startOf(areas[0]), { camera: intro ? 'stay' : 'area' });
    want(true);
  });
  const away = () => { cancelAnimationFrame(frame); frame = 0; };
  const back = () => { if (view && onScreen && !document.hidden) want(true); };
  document.addEventListener('visibilitychange', () => { document.hidden ? away() : back(); }, { signal });
  const seen = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; onScreen ? back() : away(); }); seen.observe(map);
  document.fonts?.ready.then(() => { if (!signal.aborted && view) { measure(); sync(performance.now(), true); } });

  return { preview: chooseArea,
    /** where a point of the map (Attica units) is on screen (client px); used by the browser proofs to click a road */
    screenOf(at) { const r = map.getBoundingClientRect(), [x, y] = toScreen(...at); return [r.left + x, r.top + y]; },
    get choice() { return choice; },
    /** the base map renderer's counters (tiles painted, paint ms, cache), for the browser perf proofs */
    stats: () => base?.stats() || null,
    action(name) {
    if (['left', 'shiftDown', 'mapPrev'].includes(name)) { cycle(-1); return true; }
    if (['right', 'shiftUp', 'mapNext'].includes(name)) { cycle(1); return true; }
    if (name === 'mapZoomIn' || name === 'mapZoomOut') { if (view) zoomAt(name === 'mapZoomIn' ? 1.35 : 1 / 1.35, (safe.left + safe.right) / 2, (safe.top + safe.bottom) / 2); return true; }
    return false;
  }, dispose() { events.abort(); resize.disconnect(); seen.disconnect(); stop(); clearTimeout(hideTimer); cancelAnimationFrame(resizeFrame); base?.dispose(); base = null; } };
}

/** DRIVE: start free roam where the picker says. The Athens open world (dev flag) is its own entry, so it is a page load. */
export function driveFromSpawn(menu) {
  const choice = menu.data.spawn?.choice; if (!choice || menu.spawning) return;
  const [x, z] = choice.local.map(v => Math.round(v * 10) / 10);
  if (choice.mapId === 'athens') {
    const params = new URLSearchParams(location.search); params.delete('menu'); params.set('spawn', `${x},${z}`);
    const car = menu.h.carSpec?.(); if (car?.id) params.set('car', car.id);
    location.assign('?' + params); return;
  }
  menu.spawning = true;
  Promise.resolve(menu.h.startFree?.({ ...freeRoam(choice.mapId, { x, z, name: choice.name }) })).finally(() => { menu.spawning = false; });
}
