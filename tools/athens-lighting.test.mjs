// Step 4 of the Athens beauty pass: fake lighting without a light. Contact shadows under street props and the aerial-perspective tint of far walls (locked look: unlit colour only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AthensProps, KINDS } from '../src/athens-props.js';
import { FACADE_APPLY } from '../src/athens-detail.js';

test('every kiosk, shelter, bench, fountain and monument in range gets a contact shadow, in one alpha-blended draw call, and none are made with World detail Off', () => {
  const group = new THREE.Group(), props = new AthensProps(group), rows = [], kinds = [];
  const add = (kind, x) => { rows.push(x, 5, 20, 0, 0); kinds.push(kind); };
  for (let i = 0; i < 6; i++) add(KINDS.kiosk, 10 + i * 6); for (let i = 0; i < 4; i++) add(KINDS.bench, 12 + i * 6); add(KINDS.fountain, 40); add(KINDS.monument, 44);
  for (let i = 0; i < 5; i++) add(KINDS.lamp, 10 + i * 8); // a lamp pole gets none
  props.addTile('0,0', { metadata: { origin: [0, 0, 0], extensions: { worldDetail: { props: { rows: 0, kind: 1 } } } }, arrays: [Float32Array.from(rows), Uint8Array.from(kinds)] });
  props.update({ position: { x: 40, z: 20 } }, 0);
  assert.equal(props.shadow.count, 12); assert.equal(props.shadow.visible, true);
  const material = props.shadow.material; assert.ok(material.transparent && !material.depthWrite && material.opacity < .5, 'a soft dark disc, no depth write');
  assert.equal(props.stats.drawCalls, 5 + 1, 'kiosks, benches, fountains, monuments, lamps and one batch of shadows');
  props.setEnabled(false); assert.equal(props.group.visible, false, 'the shadows are in the props group: hidden with it');
  assert.ok(!(props.shadow instanceof THREE.Light) && !material.isShadowMaterial, 'a decal, not a shadow map');
});
test('far walls and roofs take a little of the sky before the fog, and only with World detail on', () => {
  assert.match(FACADE_APPLY, /aerial perspective/); assert.match(FACADE_APPLY, /smoothstep\(180\.,720\.,vFacDist\)\*\.55\*uWorldDetail/);
  const i = FACADE_APPLY.indexOf('aerial perspective'), j = FACADE_APPLY.indexOf('facadeOrRoof()*wallShade()'); assert.ok(j >= 0 && i > j, 'after the facade pattern, so it tints whatever the wall shows');
});
