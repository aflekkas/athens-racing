// The raster half of the track map. Sea, hillshaded land clipped by the vector coast, close-up relief, coast and the road
// hierarchy are expensive vector work that only changes with the camera, so it is painted ahead of time into cached
// bitmaps and a frame only blits them (a few dozen drawImage calls, however zoomed in the map is):
//   tiles     a pyramid with one level per power of two of zoom, painted on demand a few ms per frame; a tile that is not
//             ready yet is covered by a coarser (or finer) one that is
//   snapshot  the exact view for the camera at rest, painted with the same code a direct frame would use and faded in once
//             built, so a settled map is pixel-identical to painting it directly
// Nothing here runs on a timer: paint() draws, pump() does background work and reports whether more is pending, and the
// caller asks for another frame only while it is.

const BG = '#060b10';
export const TILE = 256, PAD = 2, MAX_LEVEL = 6, UPSCALE = 1.19, MARGIN = 96, FADE = 160, HOLD = 120, BUDGET = 4, CACHE_BYTES = 72 << 20;

// Roads: calm and few at region scale; the street hierarchy fades in only as the camera closes on a track.
// [layer, width px at region scale, width px close up, colour, opacity, zoom (px/unit) where it starts and is fully in]
export const ROADS = [
  ['street', .5, 1, '#9aa8b0', .12, 6, 11],
  ['tertiary', .6, 1.1, '#9aa8b0', .09, 4.5, 9],
  ['secondary', .7, 1.4, '#9aa8b0', .14, 3, 6.5],
  ['primary', .8, 2, '#a7b2b8', .26, 1.8, 4],
  ['trunk', .8, 2.2, '#b3aa9a', .3, 1.2, 2.2],
  ['motorway', 1, 2.8, '#c2b49c', .42, 0, 0],
];
export const smooth = (a, b, x) => { if (b <= a) return 1; const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Screen/world rects are [left, top, right, bottom].
const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sameCamera = (a, b) => Math.abs(a.scale / b.scale - 1) < 1e-9 && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
/** the pyramid level (device px per map unit = 2^level) a camera scale is drawn from: at most a modest upscale */
export const levelFor = (scale, dpr) => clamp(Math.ceil(Math.log2(scale * dpr / UPSCALE)), 0, MAX_LEVEL);

// The part of an image box that is inside `vis`, drawn from just that source rectangle.
function blitWorld(ctx, img, box, vis) {
  const x0 = Math.max(box[0], vis[0]), y0 = Math.max(box[1], vis[1]), x1 = Math.min(box[2], vis[2]), y1 = Math.min(box[3], vis[3]);
  if (x0 >= x1 || y0 >= y1) return;
  const fx = img.width / (box[2] - box[0]), fy = img.height / (box[3] - box[1]);
  ctx.drawImage(img, (x0 - box[0]) * fx, (y0 - box[1]) * fy, (x1 - x0) * fx, (y1 - y0) * fy, x0, y0, x1 - x0, y1 - y0);
}

// Everything under the route, for a camera at `scale` (css px per unit), onto a context whose transform already maps map
// units to its pixels, restricted to the world rect `vis`. A generator so a caller can slice a big paint across frames.
export function* paintBase(ctx, { art, layers, size }, scale, vis) {
  const px = 1 / scale, box = [0, 0, size.width, size.height], reach = 4 * px, near = smooth(1.5, 12, scale), closeUp = smooth(2.4, 5, scale);
  const cull = [vis[0] - reach, vis[1] - reach, vis[2] + reach, vis[3] + reach];
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.globalAlpha = 1;
  blitWorld(ctx, art.sea, box, vis);
  ctx.save(); ctx.clip(layers.land, 'evenodd'); blitWorld(ctx, art.land, box, vis);
  if (closeUp > 0) for (const d of art.detail) if (d.img && hit(d.box, vis)) { ctx.globalAlpha = closeUp; blitWorld(ctx, d.img, d.box, vis); }
  ctx.globalAlpha = 1; ctx.restore();
  yield;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  function* stroke(cells, width, colour, alpha) {
    if (alpha < .01) return;
    ctx.globalAlpha = alpha; ctx.strokeStyle = colour; ctx.lineWidth = width * px;
    let n = 0; for (const cell of cells) if (hit(cell.box, cull)) { ctx.stroke(cell.path); if (++n % 24 === 0) yield; }
  }
  yield* stroke(layers.coast, 2.6 + near * 2, '#1d3a48', .55);
  yield* stroke(layers.coast, .9 + near * .5, '#86a9b8', .62);
  for (const [id, w0, w1, colour, alpha, z0, z1] of ROADS) yield* stroke(layers[id], w0 + (w1 - w0) * near, colour, alpha * smooth(z0, z1, scale));
  ctx.globalAlpha = 1;
}

export function createMapRenderer({ ctx, data, makeCanvas, clock = () => performance.now() }) {
  const { width: W, height: H } = data.size;
  const surface = (w, h) => { const c = makeCanvas(w, h); return { c, g: c.getContext('2d', { alpha: false, willReadFrequently: true }) }; };
  // A canvas records its draw calls and rasterises them later; reading a pixel makes that happen now, inside the time budget.
  const flush = g => { g.getImageData?.(0, 0, 1, 1); };
  const cost = { tiles: 0, ms: 0 };
  const tiles = new Map(), ahead = [], needNow = new Map();
  let dpr = 1, vw = 0, vh = 0, cw = 0, ch = 0, bytes = 0, tick = 0, floor = -1, detailSeen = 0;
  let snap = null, job = null, spare = null, last = null, still = 0, busy = false;

  const xf = cam => { const k = cam.scale * dpr; return [k, (vw / 2 + cam.x - W / 2 * cam.scale) * dpr, (vh / 2 + cam.y - H / 2 * cam.scale) * dpr]; };
  const visible = (k, ox, oy, pad = 0) => [(-pad - ox) / k, (-pad - oy) / k, (cw + pad - ox) / k, (ch + pad - oy) / k];
  const key = (j, x, y) => `${j}/${x}/${y}`;
  const span = j => TILE / 2 ** j, cols = j => Math.ceil(W / span(j)), rows = j => Math.ceil(H / span(j));
  const range = (j, vis) => { const s = span(j); return [Math.max(0, Math.floor(vis[0] / s)), Math.max(0, Math.floor(vis[1] / s)), Math.min(cols(j) - 1, Math.floor(vis[2] / s)), Math.min(rows(j) - 1, Math.floor(vis[3] / s))]; };

  const drop = () => { tiles.clear(); ahead.length = 0; needNow.clear(); bytes = 0; snap = job = spare = null; floor = -1; };
  function paintTile(j, x, y) {
    const k = 2 ** j, s = span(j), size = TILE + 2 * PAD, { c, g } = surface(size, size), x0 = x * s, y0 = y * s;
    g.fillStyle = BG; g.fillRect(0, 0, size, size);
    g.setTransform(k, 0, 0, k, PAD - x0 * k, PAD - y0 * k);
    const t0 = clock(); for (const _ of paintBase(g, data, k / dpr, [x0 - PAD / k, y0 - PAD / k, x0 + s + PAD / k, y0 + s + PAD / k])); flush(g);
    cost.tiles++; cost.ms += clock() - t0;
    const tile = { j, x, y, c, used: tick, size: size * size * 4 }; tiles.set(key(j, x, y), tile); bytes += tile.size;
    // Least recently used tiles go; the floor level (the whole map, one step coarser than its closest zoom: what every flight falls back on) stays.
    if (bytes > CACHE_BYTES) for (const [id, t] of tiles) { if (bytes <= CACHE_BYTES) break; if (t.j !== floor && t.used < tick - 2) { tiles.delete(id); bytes -= t.size; } }
    return tile;
  }
  const tile = (j, x, y) => { const t = tiles.get(key(j, x, y)); if (t) t.used = tick; return t; };

  // A tile (or the part of a coarser one) drawn into the padded world rect of tile j/x/y.
  function blit(t, [k, ox, oy], j, x, y) {
    const s = span(j), r = [x * s - PAD / 2 ** j, y * s - PAD / 2 ** j], len = (TILE + 2 * PAD) / 2 ** j, dx = ox + r[0] * k, dy = oy + r[1] * k, dl = len * k;
    if (t.j === j) return ctx.drawImage(t.c, dx, dy, dl, dl);
    const a = 2 ** t.j, sa = span(t.j), sx = (r[0] - t.x * sa) * a + PAD, sy = (r[1] - t.y * sa) * a + PAD, sl = len * a;
    ctx.drawImage(t.c, sx, sy, sl, sl, dx, dy, dl, dl);
  }
  const ancestor = (j, x, y) => { for (let a = j - 1; a >= Math.max(0, floor); a--) { const t = tile(a, x >> (j - a), y >> (j - a)); if (t) return t; } return null; };

  function paintTiles(cam, [k, ox, oy], over) {
    const j = levelFor(cam.scale, dpr), t = [k, ox, oy], [x0, y0, x1, y1] = range(j, visible(k, ox, oy)), len = (TILE + 2 * PAD) / 2 ** j * k;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      // A tile wholly under the opaque exact view is not drawn (nor painted: it is only there as a stand-in).
      if (over) { const l = ox + (x * span(j) - PAD / 2 ** j) * k, tp = oy + (y * span(j) - PAD / 2 ** j) * k; if (l >= over[0] && tp >= over[1] && l + len <= over[0] + over[2] && tp + len <= over[1] + over[3]) continue; }
      const got = tile(j, x, y); if (got) { blit(got, t, j, x, y); continue; }
      needNow.set(key(j, x, y), { j, x, y });
      const up = ancestor(j, x, y); if (up) blit(up, t, j, x, y);
      // Zooming out: finer tiles that are already painted sit on top of the coarse stand-in.
      if (j < MAX_LEVEL) for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) { const f = tile(j + 1, x * 2 + cx, y * 2 + cy); if (f) blit(f, t, j + 1, x * 2 + cx, y * 2 + cy); }
    }
  }

  const snapAlpha = (cam, now) => {
    if (!snap) return 0;
    const r = cam.scale / snap.cam.scale, off = Math.max(r, 1 / r);
    return (1 - smooth(1.03, 1.2, off)) * (FADE ? clamp((now - snap.t0) / FADE, 0, 1) : 1);
  };
  // Where the snapshot lands in the canvas for the current camera: [left, top, width, height] in canvas px.
  const snapRect = (cam, [k, ox, oy]) => {
    const f = k / snap.k, left = ox - (snap.M + snap.ox) * f, top = oy - (snap.M + snap.oy) * f;
    return [Math.abs(left - Math.round(left)) < 1e-6 ? Math.round(left) : left, Math.abs(top - Math.round(top)) < 1e-6 ? Math.round(top) : top, snap.c.width * f, snap.c.height * f];
  };

  function startSnapshot(cam, prepared) {
    const [k, ox, oy] = xf(cam), M = Math.round(MARGIN * dpr), w = cw + 2 * M, h = ch + 2 * M;
    const s = spare && spare.c.width === w && spare.c.height === h ? spare : surface(w, h); spare = null;
    s.g.setTransform(1, 0, 0, 1, 0, 0); s.g.fillStyle = BG; s.g.fillRect(0, 0, w, h); s.g.setTransform(k, 0, 0, k, ox + M, oy + M);
    // The generator's world rect is the whole snapshot canvas, margins included.
    job = { cam: { ...cam }, prepared, s, k, ox, oy, M, run: paintBase(s.g, data, cam.scale, [(-M - ox) / k, (-M - oy) / k, (cw + M - ox) / k, (ch + M - oy) / k]) };
  }

  /** draw the base layer for `cam` (the caller draws the routes over it) */
  function paint(cam, now = clock()) {
    tick++; needNow.clear();
    // Late-arriving close-up relief invalidates everything painted without it.
    const seen = data.art.detail.reduce((n, d) => n + (d.img ? 1 : 0), 0);
    if (seen !== detailSeen) { detailSeen = seen; const f = floor; tiles.clear(); bytes = 0; snap = job = null; floor = f; ahead.length = 0; queueFloor(); }
    const moved = !last || !sameCamera(last, cam);
    if (moved) { still = now; if (job && !job.prepared) job = null; }
    last = { ...cam };
    const t = xf(cam), a = snapAlpha(cam, now);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
    const r = a >= 1 && snapRect(cam, t), covered = r && r[0] <= .5 && r[1] <= .5 && r[0] + r[2] >= cw - .5 && r[1] + r[3] >= ch - .5;
    if (!covered) { ctx.fillStyle = BG; ctx.fillRect(0, 0, cw, ch); paintTiles(cam, t, r || null); }
    if (a > 0) { const q = r || snapRect(cam, t); ctx.globalAlpha = a; ctx.drawImage(snap.c, q[0], q[1], q[2], q[3]); ctx.globalAlpha = 1; }
    return a;
  }

  function queueFloor() {
    if (floor < 0) return;
    for (let y = 0; y < rows(floor); y++) for (let x = 0; x < cols(floor); x++) if (!tiles.has(key(floor, x, y))) ahead.push({ j: floor, x, y });
  }
  const queueView = (cam, list) => {
    const j = levelFor(cam.scale, dpr), [k, ox, oy] = xf(cam), [x0, y0, x1, y1] = range(j, visible(k, ox, oy));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!tiles.has(key(j, x, y))) list.push({ j, x, y });
  };

  /** Flights know where they are going: paint the tiles along the way and the exact view at the end before they arrive. */
  function prepare(cams, dest) {
    const list = []; for (const cam of cams) queueView(cam, list);
    ahead.unshift(...list.filter((t, i) => list.findIndex(u => u.j === t.j && u.x === t.x && u.y === t.y) === i));
    if (dest && !(snap && sameCamera(snap.cam, dest))) startSnapshot(dest, true);
    busy = true;
  }
  const cancelPrepare = () => { if (job?.prepared) job = null; };
  /** paint what a camera needs right now (reduced motion: the camera jumps, there is no flight to hide the work) */
  function prime(cam) { const list = []; queueView(cam, list); for (const t of list) paintTile(t.j, t.x, t.y); busy = true; }

  /** background work for up to a few ms; true while more is pending (the caller then asks for another frame) */
  function pump(now = clock()) {
    const end = clock() + BUDGET; let worked = 0;
    const more = () => !worked || clock() < end;
    while (more()) {
      const need = needNow.values().next().value;
      if (need) { needNow.delete(key(need.j, need.x, need.y)); if (!tiles.has(key(need.j, need.x, need.y))) { paintTile(need.j, need.x, need.y); worked++; } continue; }
      while (ahead.length && tiles.has(key(ahead[0].j, ahead[0].x, ahead[0].y))) ahead.shift();
      if (ahead.length) { const t = ahead.shift(); paintTile(t.j, t.x, t.y); worked++; continue; }
      if (!job && last && now - still >= HOLD && !(snap && sameCamera(snap.cam, last))) startSnapshot(last, false);
      if (job) {
        worked++;
        const step = job.run.next(); flush(job.s.g);
        if (step.done) {
          const cam = job.cam, done = job; job = null; spare = snap?.s || spare; snap = { ...done, c: done.s.c, t0: now };
          // Behind the exact view, the tiles around it are painted so the next pan has them ready.
          if (last && sameCamera(cam, last)) queueView(cam, ahead);
        }
        continue;
      }
      break;
    }
    const waiting = last && !(snap && sameCamera(snap.cam, last));
    busy = needNow.size > 0 || ahead.length > 0 || !!job || !!waiting || !!(snap && now - snap.t0 < FADE && last && sameCamera(snap.cam, last));
    return busy;
  }

  return {
    paint, pump, prepare, cancelPrepare, prime,
    get busy() { return busy; },
    /** the canvas is `view` css px at `ratio` device px per css px; all cached pixels are for the previous size */
    resize(view, ratio) {
      if (ratio !== dpr) drop();
      dpr = ratio; vw = view.width; vh = view.height; cw = Math.round(vw * dpr); ch = Math.round(vh * dpr);
      snap = job = null; last = null; floor = Math.max(0, levelFor(Math.max(vw / W, vh / H), dpr) - 1); queueFloor(); busy = true;
    },
    dispose() { drop(); },
    stats: () => ({ painted: cost.tiles, paintMs: +cost.ms.toFixed(1), tiles: tiles.size, bytes, queued: ahead.length, snapshot: !!snap, building: !!job }),
  };
}
