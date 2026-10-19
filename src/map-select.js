// Geographic track selector: the full-screen Attica map (offline OSM/DEM, pre-rendered by tools/build-attica-map.py) with
// the track card floating over it. Selecting a track flies the camera to frame its route; there is no reset control.
import { MAPS } from './map-catalog.js';
import { getPlayableMaps, isMapEnabled } from './enabled-maps.js';
import { MAP_VIEW, MAP_ASSETS, TRACK_ROUTES, MAP_LABELS } from './attica-map-data.js';
import { coverScale, routeBounds, fitTracks, focusTrack, clampCamera, flight, MAX_SCALE } from './map-select-camera.js';
import { createMapRenderer } from './map-select-render.js';
import { fmtDist } from './settings.js';
import * as C from './ui/components.js';
import { getMapPersonalBest } from './personal-bests.js';

const { esc, icon } = C;
const playable = () => getPlayableMaps(MAPS).filter(m => TRACK_ROUTES[m.id]);
const color = id => id === 'penteli' ? '#71d5c1' : id === 'megara' ? '#e4bf70' : id === 'psychiko' ? '#d7cf83' : '#ff7868';
function style() {
  if (document.getElementById('map-select-style')) return;
  const link = document.createElement('link'); link.id = 'map-select-style'; link.rel = 'stylesheet'; link.href = new URL('./map-select.css', import.meta.url).href; document.head.append(link);
}
const KIND = m => m.type === 'circuit' ? ['CIRCUIT', 'refresh-cw'] : m.id === 'penteli' ? ['HILL CLIMB', 'mountain'] : ['POINT TO POINT', 'route'];
const lapTime = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
// The big map frames the selected route, so the card carries only what the map cannot say.
function preview(map) {
  const [kind, ic] = KIND(map), pb = getMapPersonalBest(map.id);
  // A best only appears once one exists; an empty record box is noise.
  const best = pb ? `<div class="map-spec map-spec--best"><small>${icon('timer')}BEST</small><b>${lapTime(pb.time)}</b><span>${esc(pb.setup.car)} · ${pb.setup.laps} LAP${pb.setup.laps === 1 ? '' : 'S'}${pb.setup.direction < 0 ? ' · REV' : ''}</span></div>` : '';
  return `<div class="map-preview__info"><div class="map-kind">${icon(ic)}${kind}</div><h3>${esc(map.name)}</h3><p>${esc(map.subtitle)}</p>
    <div class="map-specs"><div class="map-spec"><small>LENGTH</small><b>${fmtDist(map.length)}${map.type === 'circuit' ? '<span> / LAP</span>' : ''}</b></div>${best}</div>
    ${C.button({ label: 'SELECT TRACK', icon: 'flag', iconRight: 'chevron-right', variant: 'primary', block: true, attrs: { 'data-confirm-track': '', 'data-map-id': map.id } })}</div>`;
}
const count = (selectable, m) => `${selectable.indexOf(m) + 1} <span>/ ${selectable.length}</span>`;
// A pin's name chip sits on the side away from its route, so it never covers the track it names.
const side = r => (r.bounds[0] + r.bounds[2]) / 2 >= r.start[0] - .5 ? 'l' : 'r';
export function renderMapSelect(selectedId = 'riviera') {
  style(); const selectable = playable(), selected = selectable.find(m => m.id === selectedId) || selectable[0];
  const labels = MAP_LABELS.map((l, i) => `<span class="map-label map-label--${l.k}" data-label="${i}"><i></i><b>${esc(l.t)}${l.s ? `<small>${esc(l.s)}</small>` : ''}</b></span>`).join('');
  const pins = selectable.map((m, i) => `<span role="button" tabindex="-1" class="mi track-pin ${m.id === selected.id ? 'selected active' : ''}" aria-label="Preview ${esc(m.name)}" aria-pressed="${m.id === selected.id}" data-map-id="${m.id}" data-side="${side(TRACK_ROUTES[m.id])}" style="--pin:${color(m.id)}" ${m.id === selected.id ? 'data-default' : ''}><i class="track-pin__dot">${i + 1}</i><span>${esc(m.name)}</span></span>`).join('');
  return C.mapStage({ variant: 'floating', cls: 'scr--maps', kick: 'QUICK RACE', title: 'ATTICA / CHOOSE YOUR TRACK',
    hints: [['leftright', 'TRACK'], ['confirm', 'SELECT'], ['back', 'BACK']],
    stageAttrs: { role: 'img', 'aria-label': `Map of Attica with ${selectable.length} tracks: ${selectable.map(m => m.name).join(', ')}` },
    stage: `<canvas class="attica-canvas" aria-hidden="true"></canvas>
      <div class="attica-overlay"><div class="attica-labels" aria-hidden="true">${labels}</div>${pins}</div>
      <p class="attica-credit"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">EU-DEM, Copernicus</a></p>`,
    cardAttrs: { 'data-map': selected.id, style: `--track:${color(selected.id)}` },
    nav: `${C.button({ icon: 'chevron-left', variant: 'ghost', act: 'mapPrev', title: 'Previous track' })}<div><small>TRACK</small><b class="map-track-count">${count(selectable, selected)}</b></div>${C.button({ icon: 'chevron-right', variant: 'ghost', act: 'mapNext', title: 'Next track' })}`, card: preview(selected) });
}

// ---------------------------------------------------------------- map assets (fetched once per page, shared by every visit)
let assets;
const image = src => { const img = new Image(); img.decoding = 'async'; img.src = src; return img.decode().then(() => img); };
function parseVectors(buffer) {
  const view = new DataView(buffer), q = 1 / MAP_ASSETS.quantize, layers = {}, CELL = 96;
  let at = 6; const count = view.getUint16(4, true);
  for (let n = 0; n < count; n++) {
    const id = MAP_ASSETS.layers[view.getUint8(at)], lines = view.getUint32(at + 1, true); at += 5;
    const cells = new Map(), all = new Path2D();
    for (let l = 0; l < lines; l++) {
      const pts = view.getUint16(at, true); at += 2;
      const path = new Path2D(); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let p = 0; p < pts; p++, at += 4) {
        const x = view.getUint16(at, true) * q, y = view.getUint16(at + 2, true) * q;
        p ? path.lineTo(x, y) : path.moveTo(x, y);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (id === 'land') { path.closePath(); all.addPath(path); continue; }
      // Bucket lines by cell so a zoomed-in frame strokes only what is on screen.
      const key = `${Math.floor((x0 + x1) / 2 / CELL)},${Math.floor((y0 + y1) / 2 / CELL)}`;
      let cell = cells.get(key); if (!cell) cells.set(key, cell = { path: new Path2D(), box: [Infinity, Infinity, -Infinity, -Infinity] });
      cell.path.addPath(path); cell.box = [Math.min(cell.box[0], x0), Math.min(cell.box[1], y0), Math.max(cell.box[2], x1), Math.max(cell.box[3], y1)];
    }
    layers[id] = id === 'land' ? all : [...cells.values()];
  }
  return layers;
}
export const loadAssets = () => assets ||= Promise.all([image(MAP_ASSETS.land), image(MAP_ASSETS.sea), fetch(MAP_ASSETS.vectors).then(r => { if (!r.ok) throw new Error('map vectors ' + r.status); return r.arrayBuffer(); })])
  .then(([land, sea, buffer]) => ({ land, sea, layers: parseVectors(buffer),
    // Close-up relief and building fabric per track; they arrive after the region art and fade in with zoom.
    detail: MAP_ASSETS.detail.map(d => { const entry = { ...d, img: null }; entry.ready = image(d.src).then(img => { entry.img = img; }, () => {}); return entry; }) }))
  .catch(error => { assets = null; throw error; });

const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
// Screen rects are [left, top, right, bottom] in viewport pixels.
const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const PIXEL_BUDGET = 5.5e6;
const PLACES = { c: [-.5, -.5, 0, 0], r: [0, -.5, 8, 0], l: [-1, -.5, -8, 0], t: [-.5, -1, 0, -6], b: [-.5, 0, 0, 6] };

export function mountMapSelect(root) {
  const map = root.querySelector('.attica-map'), canvas = map?.querySelector('.attica-canvas'), card = root.querySelector('.map-preview'), overlay = root.querySelector('.attica-overlay');
  if (!map || !canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false }), credit = map.querySelector('.attica-credit');
  const selectable = playable(), events = new AbortController(), { signal } = events;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const { width: W, height: H } = MAP_VIEW;
  let selected = card.dataset.map, camera, view, safe, dpr = 1, layers = null, art = null, base = null, drag, pinch, frame = 0, resizeFrame = 0, motion = null, last = 0, reveal = null, intro = true, dirty = false, settling = false, onScreen = true, panning = false, moving = false, shown = null;
  const bounds = routeBounds(selectable.map(m => TRACK_ROUTES[m.id]));
  const routes = Object.fromEntries(selectable.map(m => { const r = TRACK_ROUTES[m.id], path = new Path2D(r.path);
    // Sample points (every half unit) let labels avoid the line itself rather than its whole bounding box.
    const pts = r.path.slice(1).split('L').map(p => p.split(',').map(Number)), samples = [];
    pts.forEach((p, i) => { const q = pts[i + 1]; if (!q) return samples.push(p); const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / .5); for (let k = 0; k < n; k++) samples.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]); });
    return [m.id, { ...r, path2d: path, samples, color: color(m.id) }]; }));
  const pointers = new Map();
  const pins = [...overlay.querySelectorAll('.track-pin')].map(el => ({ el, id: el.dataset.mapId, side: el.dataset.side, prefer: el.dataset.side, at: TRACK_ROUTES[el.dataset.mapId].start }));
  const DOT = 24, anchor = p => p.side === 'l' ? p.w - DOT / 2 : DOT / 2;
  // The chip part of a pin (not its dot) for a side, in screen px.
  const chipRect = (p, side, sx, sy) => side === 'l' ? [sx - p.w + DOT / 2, sy - p.h / 2, sx - DOT / 2 - 2, sy + p.h / 2] : [sx + DOT / 2 + 2, sy - p.h / 2, sx - DOT / 2 + p.w, sy + p.h / 2];
  const labels = [...overlay.querySelectorAll('.map-label')].map(el => ({ el, ...MAP_LABELS[+el.dataset.label], box: null, place: null, shown: false }));
  let chrome = [];
  const rel = (el, vr, grow = 6) => { const r = el.getBoundingClientRect(); return [r.left - vr.left - grow, r.top - vr.top - grow, r.right - vr.left + grow, r.bottom - vr.top + grow]; };
  // Measured once per layout (sizes are fixed in screen pixels), so camera frames never read layout.
  const measure = () => {
    const vr = map.getBoundingClientRect();
    for (const p of pins) { p.w = p.el.offsetWidth; p.h = p.el.offsetHeight; }
    for (const l of labels) { const b = l.el.querySelector('b'); l.box = [b.offsetWidth, b.offsetHeight]; }
    const scr = root.querySelector('.scr'), parts = [...scr.querySelectorAll(':scope > .hu-status, :scope > .scr__head')].filter(el => el.offsetHeight);
    const top = Math.max(0, ...parts.map(el => rel(el, vr, 0)[3])), foot = scr.querySelector(':scope > .scr__foot'), bottom = foot?.offsetHeight ? rel(foot, vr, 0)[1] : vr.height;
    const c = rel(card, vr, 0), sheet = c[2] - c[0] > vr.width * .6;
    // The free area: below the header, above the footer, beside the floating card.
    safe = { left: 0, top, right: sheet ? vr.width : Math.max(vr.width * .4, c[0] - 8), bottom: sheet ? Math.max(top + 80, c[1] - 8) : bottom };
    // The attribution sits in the free area's bottom corner, clear of the card and the footer.
    credit.style.transform = `translate(${Math.round(safe.right - credit.offsetWidth - (sheet ? 12 : 10))}px,${Math.round(safe.bottom - credit.offsetHeight - 6)}px)`;
    chrome = [...parts, foot, card, map.querySelector('.attica-credit')].filter(el => el?.offsetHeight).map(el => rel(el, vr));
  };
  const toScreen = (x, y) => [view.width / 2 + camera.x + (x - W / 2) * camera.scale, view.height / 2 + camera.y + (y - H / 2) * camera.scale];
  const worldAt = (cam, px, py) => [W / 2 + (px - cam.x) / cam.scale, H / 2 + (py - cam.y) / cam.scale];
  const cameraFor = (scale, [wx, wy], px = 0, py = 0) => ({ scale, x: px - (wx - W / 2) * scale, y: py - (wy - H / 2) * scale });
  const minScale = () => coverScale(view, MAP_VIEW);

  // ---------------------------------------------------------------- canvas: cached sea/land/coast/roads (map-select-render.js) under the live routes
  const draw = now => {
    if (!view || !camera) return;
    const k = camera.scale * dpr, ox = (view.width / 2 + camera.x - W / 2 * camera.scale) * dpr, oy = (view.height / 2 + camera.y - H / 2 * camera.scale) * dpr;
    if (!base) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#060b10'; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
    base.paint(camera, now);
    ctx.setTransform(k, 0, 0, k, ox, oy); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const px = 1 / camera.scale;
    // Other tracks stay muted; the selected route is cased, glows faintly and traces itself in after a change.
    for (const m of selectable) {
      const r = routes[m.id]; if (m.id === selected) continue;
      ctx.lineWidth = 4.5 * px; ctx.strokeStyle = '#05080b'; ctx.globalAlpha = .55; ctx.stroke(r.path2d);
      ctx.lineWidth = 2 * px; ctx.strokeStyle = '#c4d2d8'; ctx.globalAlpha = .55; ctx.stroke(r.path2d);
    }
    const r = routes[selected]; ctx.globalAlpha = 1;
    ctx.lineWidth = 14 * px; ctx.strokeStyle = r.color; ctx.globalAlpha = .13; ctx.stroke(r.path2d);
    ctx.lineWidth = 7.5 * px; ctx.strokeStyle = '#05080b'; ctx.globalAlpha = .85; ctx.stroke(r.path2d);
    ctx.lineWidth = 3.6 * px; ctx.strokeStyle = r.color; ctx.globalAlpha = .4; ctx.stroke(r.path2d);
    const t = reveal ? reduced.matches ? 1 : easeOut(Math.min(1, (now - reveal.start) / reveal.duration)) : 1;
    if (t > 0) { ctx.globalAlpha = 1; ctx.setLineDash([r.length * t, r.length * 2]); ctx.stroke(r.path2d); ctx.setLineDash([]); }
    if (t >= 1) reveal = null;
    // Finish flag on point-to-point routes (the pin marks the start).
    if (!r.loop && t > .98) {
      const [fx, fy] = r.end, s = 3.4 * px; ctx.globalAlpha = 1;
      ctx.fillStyle = '#05080b'; ctx.fillRect(fx - s * 2.6, fy - s * 2.6, s * 5.2, s * 5.2);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { ctx.fillStyle = (i + j) % 2 ? '#0b1116' : '#f1f5f8'; ctx.fillRect(fx - s * 2 + i * s, fy - s * 2 + j * s, s, s); }
    }
    ctx.globalAlpha = 1;
  };
  // Greedy, ranked placement: pins, routes and the screen chrome are obstacles; a label keeps its side while it still fits.
  const placeLabels = () => {
    const taken = [...chrome];
    const dots = [];
    for (const m of selectable) for (const s of routes[m.id].samples) dots.push(toScreen(...s));
    const crosses = rect => dots.some(([x, y]) => x > rect[0] - 5 && x < rect[2] + 5 && y > rect[1] - 5 && y < rect[3] + 5);
    // A pin's chip takes whichever side stays on screen and off the routes, keeping its side while that still works.
    for (const p of pins) {
      const [sx, sy] = toScreen(...p.at), fits = side => { const r = chipRect(p, side, sx, sy); return r[0] > 6 && r[2] < view.width - 6 && !chrome.some(t => hit(t, r)) && !crosses(r); };
      const side = [p.side, p.prefer, p.prefer === 'l' ? 'r' : 'l'].find(fits) || p.prefer;
      if (side !== p.side) { p.side = side; p.el.dataset.side = side; p.el.style.transform = `translate(${(sx - anchor(p)).toFixed(1)}px,${(sy - p.h / 2).toFixed(1)}px)`; }
      const r = chipRect(p, p.side, sx, sy); taken.push([Math.min(r[0], sx - DOT / 2) - 4, r[1] - 4, Math.max(r[2], sx + DOT / 2) + 4, r[3] + 4]);
    }
    for (const l of labels) {
      let place = null;
      if (camera.scale >= l.z) {
        const [sx, sy] = toScreen(l.x, l.y), [w, h] = l.box, centred = l.k === 'city' || l.k === 'water' || l.k === 'suburb';
        const order = centred ? ['c'] : [...new Set([l.place || 'r', 'r', 'l', 't', 'b'])];
        for (const key of order) {
          const [fx, fy, ox, oy] = PLACES[key], rect = [sx + fx * w + ox, sy + fy * h + oy]; rect.push(rect[0] + w, rect[1] + h);
          const marker = centred ? rect : [sx - 4, sy - 4, sx + 4, sy + 4];
          if (rect[0] < 4 || rect[1] < 4 || rect[2] > view.width - 4 || rect[3] > view.height - 4) continue;
          if (!taken.some(t => hit(t, rect) || hit(t, marker)) && !crosses(rect)) { place = key; taken.push([rect[0] - 8, rect[1] - 4, rect[2] + 8, rect[3] + 4], marker); break; }
        }
      }
      if (place && place !== l.place) { l.el.dataset.place = place; l.place = place; }
      if (!!place !== l.shown) { l.shown = !!place; l.el.classList.toggle('on', l.shown); }
    }
  };
  let placed = 0;
  const sync = (now = performance.now(), settle = false) => {
    if (!camera || !view) return;
    camera = clampCamera(camera, view, MAP_VIEW);
    draw(now);
    // Pins and labels live in screen space: constant UI size, positioned from the same camera. A frame that only advanced
    // background painting (same camera) leaves them where they are.
    const still = shown && shown.scale === camera.scale && shown.x === camera.x && shown.y === camera.y; shown = { ...camera };
    if (still && !settle) return;
    for (const p of pins) { const [sx, sy] = toScreen(...p.at); p.el.style.transform = `translate(${(sx - anchor(p)).toFixed(1)}px,${(sy - p.h / 2).toFixed(1)}px)`; }
    for (const l of labels) { const [sx, sy] = toScreen(l.x, l.y); l.el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`; }
    // Labels re-place a few times a second in flight (fades cover the steps) and exactly once when the camera rests.
    if (settle || now - placed > 120) { placed = now; placeLabels(); }
  };
  // One frame loop drives every camera move, the route trace and the base layer's background painting. It only runs while one
  // of them has work (a gesture marks the frame dirty instead of drawing from the event handler), so a resting map costs nothing.
  // While the camera moves the card trades its live backdrop blur (re-run on every composited frame) for a near-opaque tint.
  const tint = () => { if (!!(motion || reveal || panning) !== moving) card.classList.toggle('panel--moving', moving = !moving); };
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
    if (wasDirty || motion || reveal || settle || base?.busy) sync(now, settle);
    base?.pump(now); tint();
    if (motion || reveal || base?.busy) frame = requestAnimationFrame(run);
  };
  const start = () => { if (!frame && onScreen && !document.hidden) { last = 0; frame = requestAnimationFrame(run); } };
  const want = (settle = false) => { dirty = true; settling ||= settle; start(); };
  const stop = () => { motion = null; base?.cancelPrepare(); cancelAnimationFrame(frame); frame = 0; };
  const flyTo = target => {
    if (!camera || !view) return;
    const to = clampCamera(target, view, MAP_VIEW), from = { ...camera }, path = flight(from, to, view, MAP_VIEW);
    motion = { type: 'fly', to, path, start: performance.now(), duration: path.duration };
    // The tiles along the way and the exact view of the destination are painted while the camera is in the air.
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
  // Frame the route and its pin's name chip together, so the chip never ends up clipped at the screen edge.
  const framing = () => {
    const route = TRACK_ROUTES[selected], pin = pins.find(p => p.id === selected);
    let cam = focusTrack(view, MAP_VIEW, route, safe);
    if (!pin?.w) return cam;
    for (let i = 0; i < 2; i++) {
      const s = cam.scale, [x, y] = route.start, b = route.bounds, reach = (pin.w - DOT / 2 + 8) / s, half = (pin.h / 2 + 6) / s;
      const chip = pin.prefer === 'l' ? [x - reach, y - half, x, y + half] : [x, y - half, x + reach, y + half];
      cam = focusTrack(view, MAP_VIEW, { bounds: [Math.min(b[0], chip[0]), Math.min(b[1], chip[1]), Math.max(b[2], chip[2]), Math.max(b[3], chip[3])] }, safe);
    }
    return cam;
  };
  const local = e => { const r = map.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  // Choosing a track always frames it, even after free zoom/pan, so the map never needs a reset control.
  const frameSelected = () => { if (!view || !camera) return; flyTo(framing()); reveal = { start: performance.now() + (motion ? motion.duration * .3 : 0), duration: 900 }; start(); };
  const maybeIntro = () => { if (intro && art && view) { intro = false; frameSelected(); } };
  const show = (id, reframe = false) => {
    const m = selectable.find(m => m.id === id); if (!m) return;
    if (selected !== id) {
      const hadFocus = card.querySelector('[data-confirm-track]') === document.activeElement;
      selected = id; card.dataset.map = id; card.style.setProperty('--track', color(id));
      const content = card.querySelector('.map-preview-content'); content.innerHTML = preview(m); content.classList.remove('swap'); void content.offsetWidth; content.classList.add('swap');
      card.querySelector('.map-track-count').innerHTML = count(selectable, m);
      pins.forEach(p => { const on = p.id === id; p.el.classList.toggle('selected', on); p.el.classList.toggle('active', on); p.el.setAttribute('aria-pressed', String(on)); });
      if (hadFocus) card.querySelector('[data-confirm-track]').focus({ preventScroll: true });
    } else if (!reframe) return;
    frameSelected();
  };
  const cycle = delta => { const index = selectable.findIndex(m => m.id === selected); show(selectable[(index + delta + selectable.length) % selectable.length].id); card.querySelector('[data-confirm-track]').focus({ preventScroll: true }); };
  root.addEventListener('focusin', e => { const pin = e.target.closest('.track-pin'); if (pin && pin.dataset.mapId !== selected) show(pin.dataset.mapId); }, { signal });
  root.addEventListener('click', e => { const pin = e.target.closest('.track-pin'); if (pin) { e.stopPropagation(); show(pin.dataset.mapId, true); } }, { capture: true, signal });
  root.addEventListener('keydown', e => { if (e.target.closest('input,textarea,select,[contenteditable]')) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) cycle(e.key === 'ArrowRight' ? 1 : -1); } }, { capture: true, signal });
  // Where overflow: clip is unsupported, a focused off-screen pin could scroll the map layer: pin it back.
  map.addEventListener('scroll', () => { map.scrollLeft = 0; map.scrollTop = 0; }, { signal });
  map.addEventListener('wheel', e => { e.preventDefault(); const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1); zoomAt(Math.exp(-Math.max(-300, Math.min(300, dy)) * .0016), ...local(e)); }, { passive: false, signal });
  map.addEventListener('pointerdown', e => { if (e.target.closest('.mi,a') || !camera) return; stop(); reveal = null; map.setPointerCapture(e.pointerId); pointers.set(e.pointerId, local(e)); drag = local(e); pinch = null; map.classList.add('dragging'); }, { signal });
  map.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return; pointers.set(e.pointerId, local(e));
    if (pointers.size > 1) {
      // Pinch zooms about the fingers' midpoint and pans with it, in one camera update.
      const [a, b] = [...pointers.values()], mid = [(a[0] + b[0]) / 2 - view.width / 2, (a[1] + b[1]) / 2 - view.height / 2], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) { const scale = Math.max(minScale(), Math.min(MAX_SCALE, camera.scale * d / pinch.d)); camera = cameraFor(scale, worldAt(camera, ...pinch.mid), ...mid); panning = true; want(); }
      pinch = { d, mid }; drag = null; return;
    }
    if (drag && !pinch) { const [x, y] = local(e); camera.x += x - drag[0]; camera.y += y - drag[1]; panning = true; want(); drag = [x, y]; }
  }, { signal });
  const up = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; drag = pointers.size ? [...pointers.values()][0] : null; if (!pointers.size) { map.classList.remove('dragging'); panning = false; want(true); } };
  map.addEventListener('pointerup', up, { signal }); map.addEventListener('pointercancel', up, { signal });
  // ResizeObserver callbacks run during layout: defer writes to avoid another
  // resize notification in the same delivery cycle (and the global error banner).
  const relayout = () => {
    const rect = map.getBoundingClientRect(), next = { width: rect.width, height: rect.height };
    if (!next.width || !next.height) return;
    const old = view && camera && { centre: worldAt(camera, 0, 0), zoom: camera.scale / coverScale(view, MAP_VIEW) };
    // Capped at 2x, and below that on very large windows: the canvas stays under a fixed pixel budget.
    view = next; dpr = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(PIXEL_BUDGET / (view.width * view.height)));
    canvas.width = Math.round(view.width * dpr); canvas.height = Math.round(view.height * dpr); base?.resize(view, dpr);
    measure();
    if (!old) {
      // Arrive on the region with every track in view, then fly in to the selected one once the art is ready.
      camera = fitTracks(view, MAP_VIEW, bounds, safe); base?.prime(camera);
    } else if (motion?.type === 'fly' || !motion) { stop(); camera = framing(); }
    else camera = cameraFor(coverScale(view, MAP_VIEW) * old.zoom, old.centre);
    sync(performance.now(), true); maybeIntro(); start();
  };
  const resize = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(relayout); }); resize.observe(map);
  loadAssets().then(a => {
    if (signal.aborted) return; art = a; layers = a.layers; map.classList.add('ready');
    base = createMapRenderer({ ctx, data: { art, layers, size: MAP_VIEW }, makeCanvas: (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }) }); if (view) { base.resize(view, dpr); if (camera) base.prime(camera); }
    // Close-up relief arrives after the region art; the base layer repaints once it has.
    Promise.all(a.detail.map(d => d.ready)).then(() => { if (!signal.aborted) want(true); });
    sync(performance.now(), true); maybeIntro(); start();
  }, error => { if (!signal.aborted) { map.classList.add('ready', 'failed'); console.error(error); } });
  // Off screen (another screen, the menu closed, a hidden tab): no frames, no painting; one repaint when it is back.
  const away = () => { cancelAnimationFrame(frame); frame = 0; };
  const back = () => { if (view && onScreen && !document.hidden) want(true); };
  document.addEventListener('visibilitychange', () => { document.hidden ? away() : back(); }, { signal });
  const seen = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; onScreen ? back() : away(); }); seen.observe(map);
  document.fonts?.ready.then(() => { if (!signal.aborted && view) { measure(); sync(performance.now(), true); } });

  return { preview: show, action(name) {
    if (['left', 'shiftDown', 'mapPrev'].includes(name)) { cycle(-1); return true; }
    if (['right', 'shiftUp', 'mapNext'].includes(name)) { cycle(1); return true; }
    if (name === 'mapZoomIn' || name === 'mapZoomOut') { if (view) zoomAt(name === 'mapZoomIn' ? 1.35 : 1 / 1.35, (safe.left + safe.right) / 2, (safe.top + safe.bottom) / 2); return true; }
    return false;
  }, dispose() { events.abort(); resize.disconnect(); seen.disconnect(); stop(); cancelAnimationFrame(resizeFrame); base?.dispose(); base = null; } };
}
// Quick Race confirms the track and compares times before race setup. (Free roam has no tracks: src/spawn-select.js.)
export async function selectMap(menu, id) {
  if (menu.mapLoading || !isMapEnabled(id)) return;
  menu.mapLoading = true;
  try {
    menu.h.selectMap(id);
    menu.filter = menu.data.filter || menu.filter || 'all';
    menu.show('mapConfirm', { mapId: id, mode: 'quick' }, true);
  } catch (error) { C.ui.toast('COULD NOT LOAD THIS MAP', { icon: 'triangle-alert', tone: 'bad' }); console.error(error); }
  finally { menu.mapLoading = false; }
}
