// Free roam spawn picker (owner decision 2026-10-19: "free roam should have no tracks, it should be more of like i just
// pick where to be spawned"). The same full-page Attica map and screen template as Track select (src/map-select.js), with
// the floating panel over it: named spawn spots are pins, and a click on any drivable road snaps to the nearest road point.
// Selecting a spot flies the camera to it; drag, scroll and pinch stay map navigation; there is no reset control.
// The panel shows the place, the car (with the garage path to change it) and DRIVE; the game then puts the car on the
// nearest road to that point with the tow placement (src/tow-placement.js), see spawnOnRoad in src/main.js.
import { upperName } from './greek-caps.js';
import { MAP_VIEW, MAP_LABELS, MAP_ASSETS } from './attica-map-data.js';
import { coverScale, frameBounds, fitTracks, clampCamera, flight, MAX_SCALE } from './map-select-camera.js';
import { createMapRenderer, smooth } from './map-select-render.js';
import { loadAssets } from './map-select.js';
import { freeRoam } from './events.js';
import { AREA_NAMES, athensCell, athensEnabled, athensFromAttica, decodeSpawnRoads, nearestSpot, snapToRoad, spawnSpots } from './spawn-spots.js';
import * as C from './ui/components.js';

const { esc, icon } = C;
const COLORS = { riviera: '#ff7868', penteli: '#71d5c1', megara: '#e4bf70', psychiko: '#d7cf83', athens: '#8fb4ff' };
const color = id => COLORS[id] || COLORS.riviera;
const areaName = id => AREA_NAMES[id] || id.toUpperCase();
function style() {
  if (document.getElementById('map-select-style')) return;
  const link = document.createElement('link'); link.id = 'map-select-style'; link.rel = 'stylesheet'; link.href = new URL('./map-select.css', import.meta.url).href; document.head.append(link);
}
const FOCUS_SCALE = 14, ROAD_RADIUS_PX = 26;
const DEFAULT_SPOT = 'riviera:vouliagmeni';
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const PIXEL_BUDGET = 5.5e6, DOT = 18;
const PLACES = { c: [-.5, -.5, 0, 0], r: [0, -.5, 8, 0], l: [-1, -.5, -8, 0], t: [-.5, -1, 0, -6], b: [-.5, 0, 0, 6] };

/** What the panel and the game need to know about a choice: a named spot or a point snapped to a road. */
const spotChoice = s => ({ id: s.id, road: false, mapId: s.mapId, name: s.name, sub: `${areaName(s.mapId)}${s.note ? ' · ' + s.note : ''}`, at: s.at, local: s.local });
function roadChoice(snap, spots) {
  const near = nearestSpot(spots, snap.mapId, ...snap.at);
  return { id: 'road', road: true, mapId: snap.mapId, name: upperName(snap.street) || (near ? 'NEAR ' + near.name : areaName(snap.mapId)), sub: `${areaName(snap.mapId)} · ROAD POINT`, at: snap.at, local: snap.local };
}
function card(choice, menu) {
  const car = menu.h.carSpec?.();
  return `<div class="map-preview__info"><div class="map-kind">${icon(choice.road ? 'route' : 'map-pin')}${choice.road ? 'ROAD POINT' : 'SPAWN SPOT'}</div>
    <h3>${esc(choice.name)}</h3><p>${esc(choice.sub)}</p>
    ${C.listRow({ icon: 'car', title: esc(car?.name || 'YOUR CAR'), desc: 'YOUR CAR · CHANGE', act: 'spawnCar', cls: 'spawn-car' })}
    <p>${icon('mouse')} OR CLICK ANY ROAD ON THE MAP</p>
    ${C.button({ label: 'DRIVE', icon: 'car', iconRight: 'chevron-right', variant: 'primary', block: true, act: 'spawnDrive', attrs: { 'data-default': '' } })}</div>`;
}
const count = (spots, choice) => choice.road ? 'ROAD' : `${spots.findIndex(s => s.id === choice.id) + 1} <span>/ ${spots.length}</span>`;

export function renderSpawnSelect(menu) {
  style();
  const spots = spawnSpots({ athens: athensEnabled() });
  const choice = menu.data.spawn?.choice || spotChoice(spots.find(s => s.id === DEFAULT_SPOT) || spots[0]);
  const pins = spots.map(s => `<span role="button" tabindex="-1" class="mi track-pin spawn-pin ${s.id === choice.id ? 'selected active' : ''}" aria-label="Spawn at ${esc(s.name)}" aria-pressed="${s.id === choice.id}" data-spot="${s.id}" data-side="r" style="--pin:${color(s.mapId)}"><i class="track-pin__dot"></i><span>${esc(s.name)}</span></span>`).join('');
  const labels = MAP_LABELS.map((l, i) => `<span class="map-label map-label--${l.k}" data-label="${i}"><i></i><b>${esc(l.t)}${l.s ? `<small>${esc(l.s)}</small>` : ''}</b></span>`).join('');
  return C.mapStage({ variant: 'floating', cls: 'scr--maps scr--spawn', kick: 'FREE ROAM', title: 'ATTICA / CHOOSE WHERE TO START',
    hints: [['leftright', 'PLACE'], ['confirm', 'DRIVE'], ['back', 'BACK']],
    stageAttrs: { role: 'img', 'aria-label': `Map of Attica with ${spots.length} places to start: ${spots.map(s => s.name).join(', ')}. Click any road to start there.` },
    stage: `<canvas class="attica-canvas" aria-hidden="true"></canvas>
      <div class="attica-overlay"><div class="attica-labels" aria-hidden="true">${labels}</div>${pins}
        <span class="spawn-marker" aria-hidden="true" style="--pin:${color(choice.mapId)}"><i></i></span><span class="spawn-nohere" role="status" aria-live="polite"><b>NO ROAD HERE</b></span></div>
      <p class="attica-credit"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">EU-DEM, Copernicus</a></p>`,
    cardAttrs: { 'data-map': choice.mapId, style: `--track:${color(choice.mapId)}` },
    nav: `${C.button({ icon: 'chevron-left', variant: 'ghost', act: 'mapPrev', title: 'Previous place' })}<div><small>PLACE</small><b class="map-track-count">${count(spots, choice)}</b></div>${C.button({ icon: 'chevron-right', variant: 'ghost', act: 'mapNext', title: 'Next place' })}`, card: card(choice, menu) });
}

// ---------------------------------------------------------------- roads (fetched once per page)
let roadsAsset;
const loadRoads = () => roadsAsset ||= fetch('assets/maps/spawn-roads.json').then(r => { if (!r.ok) throw new Error('spawn roads ' + r.status); return r.json(); }).then(decodeSpawnRoads).catch(error => { roadsAsset = null; throw error; });
// The dev-flagged Athens world: its hosted 512 m cells, and the Attica road hierarchy to snap a click to inside them.
function decodeLines(buffer) {
  const view = new DataView(buffer), q = 1 / MAP_ASSETS.quantize, lines = []; let at = 6;
  for (let n = 0, count = view.getUint16(4, true); n < count; n++) {
    const id = MAP_ASSETS.layers[view.getUint8(at)], total = view.getUint32(at + 1, true); at += 5;
    for (let l = 0; l < total; l++) {
      const pts = view.getUint16(at, true); at += 2;
      const xy = new Float32Array(pts * 2); for (let p = 0; p < pts; p++, at += 4) { xy[p * 2] = view.getUint16(at, true) * q; xy[p * 2 + 1] = view.getUint16(at + 2, true) * q; }
      if (id !== 'land' && id !== 'coast') lines.push({ name: '', major: id !== 'street' && id !== 'tertiary', pts: xy });
    }
  }
  return lines;
}
let athensAsset;
const loadAthens = () => athensAsset ||= fetch(new URL('./data/athens/manifest.json', document.baseURI)).then(async r => {
  if (!r.ok) throw new Error('Athens cells are not hosted on this server');
  const manifest = await r.json(), vectors = await (await fetch(MAP_ASSETS.vectors)).arrayBuffer();
  return { cells: new Set(Object.keys(manifest.tiles || {})), roads: { athens: { roads: decodeLines(vectors) } } };
}).catch(error => { console.info('[spawn] Athens world unavailable:', error.message); return { cells: new Set(), roads: {} }; });

export function mountSpawnSelect(root, menu) {
  const map = root.querySelector('.attica-map'), canvas = map?.querySelector('.attica-canvas'), cardEl = root.querySelector('.map-preview'), overlay = root.querySelector('.attica-overlay');
  if (!map || !canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false }), credit = map.querySelector('.attica-credit'), marker = overlay.querySelector('.spawn-marker'), nohere = overlay.querySelector('.spawn-nohere');
  const events = new AbortController(), { signal } = events, reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const { width: W, height: H } = MAP_VIEW, session = menu.data.spawn ||= {};
  let spots = spawnSpots({ athens: athensEnabled() }), choice = session.choice || spotChoice(spots.find(s => s.id === DEFAULT_SPOT) || spots[0]);
  let camera, view, safe, dpr = 1, art = null, base = null, roads = null, athens = null, drag = null, pinch = null, tap = null, frame = 0, resizeFrame = 0, motion = null, last = 0, dirty = false, settling = false, onScreen = true, panning = false, moving = false, shown = null, placed = 0, intro = !session.arrived, hideTimer = 0;
  const pointers = new Map(), roadPaths = {};
  const pins = [...overlay.querySelectorAll('.spawn-pin')].map(el => ({ el, id: el.dataset.spot, spot: spots.find(s => s.id === el.dataset.spot), side: 'r', chip: false, w: 0 }));
  for (const p of pins) p.at = p.spot.at;
  const labels = [...overlay.querySelectorAll('.map-label')].map(el => ({ el, ...MAP_LABELS[+el.dataset.label], box: null, place: null, shown: false }));
  let chrome = [];
  const rel = (el, vr, grow = 6) => { const r = el.getBoundingClientRect(); return [r.left - vr.left - grow, r.top - vr.top - grow, r.right - vr.left + grow, r.bottom - vr.top + grow]; };
  const measure = () => {
    const vr = map.getBoundingClientRect();
    for (const p of pins) p.w = p.el.querySelector(':scope > span').offsetWidth + 8;
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
  const focusOn = (at, scale = FOCUS_SCALE) => frameBounds(view, MAP_VIEW, [at[0] - .5, at[1] - .5, at[0] + .5, at[1] + .5], safe, { pad: 0, minSpan: 0, maxScale: Math.min(MAX_SCALE, scale) });
  const region = () => fitTracks(view, MAP_VIEW, [Math.min(...pins.map(p => p.at[0])), Math.min(...pins.map(p => p.at[1])), Math.max(...pins.map(p => p.at[0])), Math.max(...pins.map(p => p.at[1]))], safe);

  // ---------------------------------------------------------------- canvas: the cached base map under the drivable roads
  const pathsFor = data => { for (const [id, { roads: list }] of Object.entries(data)) { const major = new Path2D(), minor = new Path2D(); for (const r of list) { const path = r.major ? major : minor, p = r.pts; path.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]); } roadPaths[id] = { major, minor }; } };
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
  // Pin chips, then place names, avoid the pins, the chips and the screen chrome; a chip keeps its side while it still fits.
  const placeLabels = () => {
    const taken = [...chrome], dots = pins.map(p => toScreen(...p.at));
    for (const [i, [sx, sy]] of dots.entries()) { const p = pins[i]; p.rect = [sx - DOT / 2 - 3, sy - DOT / 2 - 3, sx + DOT / 2 + 3, sy + DOT / 2 + 3]; }
    const rank = p => p.id === choice.id ? 0 : p.spot.mapId === choice.mapId ? 1 : 2;
    for (const p of [...pins].sort((a, b) => rank(a) - rank(b))) {
      const [sx, sy] = toScreen(...p.at), h = 22, chipRect = side => side === 'l' ? [sx - DOT / 2 - 6 - p.w + 8, sy - h / 2, sx - DOT / 2 - 6, sy + h / 2] : [sx + DOT / 2 + 6, sy - h / 2, sx + DOT / 2 + 6 + p.w - 8, sy + h / 2];
      const fits = side => { const r = chipRect(side); return r[0] > 6 && r[2] < view.width - 6 && !taken.some(t => hit(t, r)) && !pins.some(o => o !== p && hit(o.rect, r)); };
      const want = p.id === choice.id || camera.scale >= (rank(p) === 1 ? 5 : 9), side = want ? [p.side, p.side === 'l' ? 'r' : 'l'].find(fits) || (p.id === choice.id ? p.side : null) : null;
      if (side && side !== p.side) { p.side = side; p.el.dataset.side = side; }
      if (side) taken.push(chipRect(side));
      if (!!side !== p.chip) { p.chip = !!side; p.el.classList.toggle('named', p.chip); }
    }
    for (const p of pins) taken.push(p.rect);
    if (marker.classList.contains('on')) { const [sx, sy] = toScreen(...choice.at); taken.push([sx - 16, sy - 16, sx + 16, sy + 16]); }
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
    camera = clampCamera(camera, view, MAP_VIEW);
    draw(now);
    const still = shown && shown.scale === camera.scale && shown.x === camera.x && shown.y === camera.y; shown = { ...camera };
    if (still && !settle) return;
    for (const p of pins) { const [sx, sy] = toScreen(...p.at); p.el.style.transform = `translate(${(sx - DOT / 2).toFixed(1)}px,${(sy - DOT / 2).toFixed(1)}px)`; }
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
    tint();
    if (wasDirty || motion || settle || base?.busy) sync(now, settle);
    base?.pump(now); tint();
    if (motion || base?.busy) frame = requestAnimationFrame(run);
  };
  const start = () => { if (!frame && onScreen && !document.hidden) { last = 0; frame = requestAnimationFrame(run); } };
  const want = (settle = false) => { dirty = true; settling ||= settle; start(); };
  const stop = () => { motion = null; base?.cancelPrepare(); cancelAnimationFrame(frame); frame = 0; };
  const flyTo = target => {
    if (!camera || !view) return;
    const to = clampCamera(target, view, MAP_VIEW), from = { ...camera }, path = flight(from, to, view, MAP_VIEW);
    motion = { type: 'fly', to, path, start: performance.now(), duration: path.duration };
    if (base) { if (reduced.matches) base.prime(to); else base.prepare([.2, .4, .6, .8].map(e => path.at(e)).concat(to), to); }
    start();
  };
  const zoomAt = (factor, px, py) => {
    if (!camera || !view) return;
    const anchor = [px - view.width / 2, py - view.height / 2];
    const keep = motion?.type === 'zoom' && Math.hypot(anchor[0] - motion.anchor[0], anchor[1] - motion.anchor[1]) < 3;
    const log = Math.log(Math.max(minScale(), Math.min(MAX_SCALE, Math.exp((keep ? motion.log : Math.log(camera.scale))) * factor)));
    motion = { type: 'zoom', log, anchor, world: keep ? motion.world : worldAt(camera, ...anchor) }; start();
  };
  const local = e => { const r = map.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  // ---------------------------------------------------------------- choosing: a named spot or a point on a road
  const render = (next, { fly = true, flyScale = FOCUS_SCALE } = {}) => {
    const changed = next.id !== choice.id || next.road;
    choice = session.choice = next; session.arrived = true;
    cardEl.dataset.map = choice.mapId; cardEl.style.setProperty('--track', color(choice.mapId)); marker.style.setProperty('--pin', color(choice.mapId));
    const hadFocus = cardEl.querySelector('[data-act=spawnDrive]') === document.activeElement;
    const focused = menu.items()[menu.focus], inCard = !!focused && cardEl.contains(focused), at = menu.focus;
    const content = cardEl.querySelector('.map-preview-content'); content.innerHTML = card(choice, menu);
    if (inCard) menu.setFocus(at, false); // the card's rows are new nodes: the menu's focus stays on the same row
    if (changed) { content.classList.remove('swap'); void content.offsetWidth; content.classList.add('swap'); }
    cardEl.querySelector('.map-track-count').innerHTML = count(spots, choice);
    for (const p of pins) { const on = p.id === choice.id; p.el.classList.toggle('selected', on); p.el.classList.toggle('active', on); p.el.setAttribute('aria-pressed', String(on)); }
    marker.classList.toggle('on', choice.road); clearTimeout(hideTimer); nohere.classList.remove('on');
    if (hadFocus) cardEl.querySelector('[data-act=spawnDrive]').focus({ preventScroll: true });
    if (fly && view && camera) flyTo(focusOn(choice.at, flyScale)); else want(true);
    if (view && camera) { const [sx, sy] = toScreen(...choice.at); marker.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`; }
  };
  const chooseSpot = id => { const spot = spots.find(s => s.id === id); if (spot && (spot.id !== choice.id || choice.road)) render(spotChoice(spot)); else if (spot) flyTo(focusOn(choice.at)); };
  const cycle = delta => { const i = choice.road ? -1 : spots.findIndex(s => s.id === choice.id); const next = spots[((i < 0 ? (delta > 0 ? -1 : 0) : i) + delta + spots.length) % spots.length]; chooseSpot(next.id); cardEl.querySelector('[data-act=spawnDrive]').focus({ preventScroll: true }); };
  const say = (x, y) => {
    nohere.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`; nohere.classList.add('on');
    clearTimeout(hideTimer); hideTimer = setTimeout(() => nohere.classList.remove('on'), 1700);
  };
  const click = ([sx, sy]) => {
    if (!camera || !view) return;
    const [wx, wy] = worldAt(camera, sx - view.width / 2, sy - view.height / 2), radius = Math.max(.12, Math.min(1.4, ROAD_RADIUS_PX / camera.scale));
    let snap = roads && snapToRoad(roads, wx, wy, radius);
    // The open world (dev flag only): any road of its hosted cells that no playable map owns.
    if (!snap && athens?.cells.size) {
      const found = snapToRoad(athens.roads, wx, wy, radius);
      if (found && athens.cells.has(athensCell(...athensFromAttica(...found.at)))) { const [x, z] = athensFromAttica(...found.at); snap = { ...found, local: [x, z] }; }
    }
    if (!snap) { say(sx + 12, sy - 6); return; }
    render(roadChoice(snap, spots), { flyScale: Math.max(FOCUS_SCALE * .8, Math.min(camera.scale, FOCUS_SCALE)) });
  };

  // ---------------------------------------------------------------- input
  root.addEventListener('focusin', e => { const pin = e.target.closest('.spawn-pin'); if (pin && (pin.dataset.spot !== choice.id || choice.road)) chooseSpot(pin.dataset.spot); }, { signal });
  root.addEventListener('click', e => { const pin = e.target.closest('.spawn-pin'); if (pin) { e.stopPropagation(); chooseSpot(pin.dataset.spot); } }, { capture: true, signal });
  root.addEventListener('keydown', e => { if (e.target.closest('input,textarea,select,[contenteditable]')) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) cycle(e.key === 'ArrowRight' ? 1 : -1); } }, { capture: true, signal });
  map.addEventListener('scroll', () => { map.scrollLeft = 0; map.scrollTop = 0; }, { signal });
  map.addEventListener('wheel', e => { e.preventDefault(); const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1); zoomAt(Math.exp(-Math.max(-300, Math.min(300, dy)) * .0016), ...local(e)); }, { passive: false, signal });
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
      if (pinch) { const scale = Math.max(minScale(), Math.min(MAX_SCALE, camera.scale * d / pinch.d)); camera = cameraFor(scale, worldAt(camera, ...pinch.mid), ...mid); panning = true; want(); }
      pinch = { d, mid }; drag = null; return;
    }
    if (drag && !pinch && !tap) { const [x, y] = local(e); camera.x += x - drag[0]; camera.y += y - drag[1]; panning = true; want(); drag = [x, y]; }
  }, { signal });
  const up = e => {
    const clicked = e.type === 'pointerup' && tap && tap.id === e.pointerId && tap.button === 0 && performance.now() - tap.t < 700 ? tap.at : null; tap = null;
    pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; drag = pointers.size ? [...pointers.values()][0] : null;
    if (!pointers.size) { map.classList.remove('dragging'); panning = false; want(true); }
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
    if (!old) { camera = intro ? region() : focusOn(choice.at); base?.prime(camera); }
    else if (motion?.type === 'fly' || !motion) { stop(); camera = focusOn(choice.at); }
    else camera = cameraFor(coverScale(view, MAP_VIEW) * old.zoom, old.centre);
    if (choice.road) marker.classList.add('on');
    sync(performance.now(), true); maybeIntro(); start();
  };
  // Arrive on the region with every place in view, then fly in to the chosen one once the art is ready.
  const maybeIntro = () => { if (intro && art && view) { intro = false; session.arrived = true; flyTo(focusOn(choice.at)); } };
  const resize = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(relayout); }); resize.observe(map);
  loadAssets().then(a => {
    if (signal.aborted) return; art = a; map.classList.add('ready');
    base = createMapRenderer({ ctx, data: { art, layers: a.layers, size: MAP_VIEW }, makeCanvas: (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }) }); if (view) { base.resize(view, dpr); if (camera) base.prime(camera); }
    Promise.all(a.detail.map(d => d.ready)).then(() => { if (!signal.aborted) want(true); });
    sync(performance.now(), true); maybeIntro(); start();
  }, error => { if (!signal.aborted) { map.classList.add('ready', 'failed'); console.error(error); } });
  loadRoads().then(data => { if (signal.aborted) return; roads = data; pathsFor(data); want(true); }, error => console.error(error));
  // Under ?map=athens only: the open world's hosted cells join the picker (spots outside them are dropped, roads snap inside them).
  if (athensEnabled()) loadAthens().then(a => {
    if (signal.aborted) return; athens = a;
    const hosted = new Set(spawnSpots({ athens: true, athensCells: a.cells }).map(s => s.id));
    for (const p of [...pins]) if (p.spot.mapId === 'athens' && !hosted.has(p.id)) { p.el.remove(); pins.splice(pins.indexOf(p), 1); }
    spots = spots.filter(s => s.mapId !== 'athens' || hosted.has(s.id)); cardEl.querySelector('.map-track-count').innerHTML = count(spots, choice); want(true);
  });
  const away = () => { cancelAnimationFrame(frame); frame = 0; };
  const back = () => { if (view && onScreen && !document.hidden) want(true); };
  document.addEventListener('visibilitychange', () => { document.hidden ? away() : back(); }, { signal });
  const seen = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; onScreen ? back() : away(); }); seen.observe(map);
  document.fonts?.ready.then(() => { if (!signal.aborted && view) { measure(); sync(performance.now(), true); } });

  return { preview: chooseSpot,
    /** where a point of the map (Attica units) is on screen (client px); used by the browser proofs to click a road */
    screenOf(at) { const r = map.getBoundingClientRect(), [x, y] = toScreen(...at); return [r.left + x, r.top + y]; },
    get choice() { return choice; },
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
