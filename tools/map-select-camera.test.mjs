import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_VIEW, TRACK_ROUTES } from '../src/attica-map-data.js';
import { MAPS, getPlayableMaps } from '../src/map-catalog.js';
import { coverScale, routeBounds, fitTracks, focusTrack, clampCamera } from '../src/map-select-camera.js';
const bounds = routeBounds(Object.values(TRACK_ROUTES));
const screen = (camera, view, x, y) => [view.width/2+camera.x+(x-MAP_VIEW.width/2)*camera.scale, view.height/2+camera.y+(y-MAP_VIEW.height/2)*camera.scale];
function covers(camera,view) {
  const [left,top]=screen(camera,view,0,0),[right,bottom]=screen(camera,view,MAP_VIEW.width,MAP_VIEW.height);
  assert.ok(left<=.001 && top<=.001 && right>=view.width-.001 && bottom>=view.height-.001, 'Geographic image must cover the entire viewport');
}
for(const [name,view] of Object.entries({desktop:{width:1210,height:780},laptop:{width:795,height:475},phone:{width:349,height:293}})) {
  test(`${name}: default and hover cameras keep all routes padded without exposing asset edges`,()=>{
    const home=fitTracks(view,MAP_VIEW,bounds);
    for(const [camera,padding] of [[home,.079],...Object.values(TRACK_ROUTES).map(route=>[focusTrack(view,MAP_VIEW,bounds,home,route.pin),.059])]) {
      covers(camera,view);
      const [left,top]=screen(camera,view,bounds[0],bounds[1]),[right,bottom]=screen(camera,view,bounds[2],bounds[3]);
      assert.ok(left>=view.width*padding && right<=view.width*(1-padding),'Horizontal route margin');
      assert.ok(top>=view.height*padding && bottom<=view.height*(1-padding),'Vertical route margin');
    }
  });
  test(`${name}: navigation clamps all four corners at every zoom limit`,()=>{
    for(const scale of [-10,coverScale(view,MAP_VIEW),fitTracks(view,MAP_VIEW,bounds).scale,coverScale(view,MAP_VIEW)*3.5])
      for(const x of [-1e9,1e9])for(const y of [-1e9,1e9])covers(clampCamera({scale,x,y},view,MAP_VIEW),view);
  });
}

test('every playable map has an on-map geographic route and selector pin', () => {
  assert.deepEqual(getPlayableMaps(MAPS).map(map => map.id), ['riviera', 'megara', 'penteli', 'psychiko']);
  for (const {id} of getPlayableMaps(MAPS)) {
    const route = TRACK_ROUTES[id]; assert.ok(route, id + ': selector overlay missing');
    assert.ok(route.path.startsWith('M'));
    assert.ok(route.bounds[0] >= 0 && route.bounds[2] <= MAP_VIEW.width);
    assert.ok(route.bounds[1] >= 0 && route.bounds[3] <= MAP_VIEW.height);
  }
});
