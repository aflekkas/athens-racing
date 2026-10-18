import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_VIEW, TRACK_ROUTES } from '../src/attica-map-data.js';
import { MAPS, getPlayableMaps } from '../src/map-catalog.js';
import { coverScale, routeBounds, fitTracks, focusTrack, clampCamera, flight, MAX_SCALE } from '../src/map-select-camera.js';
const bounds = routeBounds(Object.values(TRACK_ROUTES));
const screen = (camera, view, x, y) => [view.width/2+camera.x+(x-MAP_VIEW.width/2)*camera.scale, view.height/2+camera.y+(y-MAP_VIEW.height/2)*camera.scale];
function covers(camera,view) {
  const [left,top]=screen(camera,view,0,0),[right,bottom]=screen(camera,view,MAP_VIEW.width,MAP_VIEW.height);
  assert.ok(left<=.001 && top<=.001 && right>=view.width-.001 && bottom>=view.height-.001, 'Geographic art must cover the entire full-screen map');
}
// Full-screen map; `safe` is the free area beside the floating card (desktop) or above the bottom sheet (phone).
const VIEWS = {
  desktop: { view: { width: 1280, height: 800 }, safe: { left: 0, top: 150, right: 880, bottom: 750 } },
  laptop: { view: { width: 1024, height: 640 }, safe: { left: 0, top: 130, right: 680, bottom: 595 } },
  phone: { view: { width: 390, height: 844 }, safe: { left: 0, top: 120, right: 390, bottom: 470 } },
  landscape: { view: { width: 844, height: 390 }, safe: { left: 0, top: 70, right: 560, bottom: 350 } },
};
for (const [name, { view, safe }] of Object.entries(VIEWS)) {
  test(`${name}: each selected track is framed whole inside the free area, never exposing the art's edges`, () => {
    for (const [id, route] of Object.entries(TRACK_ROUTES)) {
      const camera = focusTrack(view, MAP_VIEW, route, safe); covers(camera, view);
      const [left, top] = screen(camera, view, route.bounds[0], route.bounds[1]), [right, bottom] = screen(camera, view, route.bounds[2], route.bounds[3]);
      const w = safe.right - safe.left, h = safe.bottom - safe.top;
      assert.ok(left >= safe.left + w * .05 && right <= safe.right - w * .05, `${id}: horizontal route margin`);
      assert.ok(top >= safe.top + h * .05 && bottom <= safe.bottom - h * .05, `${id}: vertical route margin`);
      // Framed close enough to read the route; the compact Megara loop keeps about 3 km of surroundings around it.
      assert.ok(Math.max((right - left) / w, (bottom - top) / h) > .05, `${id}: route too small on screen`);
      assert.ok(camera.scale <= MAX_SCALE + 1e-9, `${id}: zoom past the art's useful resolution`);
    }
  });
  test(`${name}: flights between tracks stay on the art and land exactly on the next frame`, () => {
    const cams = Object.values(TRACK_ROUTES).map(route => focusTrack(view, MAP_VIEW, route, safe));
    cams.unshift(fitTracks(view, MAP_VIEW, bounds, safe));
    for (const from of cams) for (const to of cams) {
      const path = flight(from, to, view, MAP_VIEW);
      assert.ok(path.duration > 0 && path.duration <= 1500, 'flight duration');
      for (let e = 0; e <= 1; e += .125) covers(clampCamera(path.at(e), view, MAP_VIEW), view);
      const end = path.at(1); for (const k of ['scale', 'x', 'y']) assert.ok(Math.abs(end[k] - to[k]) < 1e-6, 'flight must end on the target frame');
    }
  });
  test(`${name}: navigation clamps all four corners at every zoom limit`, () => {
    for (const scale of [-10, coverScale(view, MAP_VIEW), fitTracks(view, MAP_VIEW, bounds, safe).scale, MAX_SCALE, 1e3])
      for (const x of [-1e9, 1e9]) for (const y of [-1e9, 1e9]) covers(clampCamera({ scale, x, y }, view, MAP_VIEW), view);
  });
}

test('every playable map has an on-map geographic route, start/finish and selector pin', () => {
  assert.deepEqual(getPlayableMaps(MAPS).map(map => map.id), ['riviera', 'megara', 'penteli', 'psychiko']);
  for (const map of getPlayableMaps(MAPS)) {
    const route = TRACK_ROUTES[map.id]; assert.ok(route, map.id + ': selector overlay missing');
    assert.ok(route.path.startsWith('M'));
    assert.ok(route.bounds[0] >= 0 && route.bounds[2] <= MAP_VIEW.width);
    assert.ok(route.bounds[1] >= 0 && route.bounds[3] <= MAP_VIEW.height);
    assert.equal(route.loop, map.type === 'circuit', map.id + ': circuits close their loop, point-to-point routes do not');
    assert.ok(route.length > 0 && route.start.length === 2 && route.end.length === 2);
  }
});
