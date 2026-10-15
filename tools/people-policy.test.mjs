import test from 'node:test';
import assert from 'node:assert/strict';
import { PeoplePolicy, peopleSchedule, villageResidents, villageForecourtBuffer } from '../src/people-policy.js';
import { ROAD } from '../src/road.js';
import { worldLifeMap } from './world-life-map-fixture.mjs';

test('every Penteli mountain connector rejects pedestrians, despite synthetic shoulder width', async () => {
  const map = await worldLifeMap('penteli'), policy = new PeoplePolicy(map, ROAD.sidewalk);
  let mountain = 0, village = 0;
  for (let s = 30; s < map.route.length - 30; s += 10) for (const side of [-1, 1]) {
    const z = map.route.district(s), result = policy.zone(s, side);
    if (z === 'mountain') { mountain++; assert.equal(result.allowed, false, `mountain s=${s}`); }
    if (z === 'town' && result.allowed) village++;
    assert.equal(policy.safePoint(s, side * (map.route.edge(s) - .5)), false, 'no carriageway spawn');
  }
  assert.ok(mountain > 1500);
  const residents = villageResidents(map, policy); assert.ok(residents.length > 0, 'Dionysos forecourts stay populated');
  for (const a of residents) { assert.ok(policy.forecourt(a.x, a.z)); assert.ok(villageForecourtBuffer(map, a.x, a.z), 'scenery keeps resident courts clear'); }
  const mountainPoint = map.route.point(2500, 20); assert.equal(villageForecourtBuffer(map, mountainPoint.x, mountainPoint.z), false);
});
test('Riviera towns/promenades permit people; cliff roads never do', async () => {
  const map = await worldLifeMap('riviera'), policy = new PeoplePolicy(map, ROAD.sidewalk);
  let populated = 0;
  for (let s = 20; s < map.route.length - 20; s += 20) for (const side of [-1, 1]) {
    const z = policy.zone(s, side);
    if (map.route.district(s) === 'cliff') assert.equal(z.allowed, false);
    if (z.allowed) populated++;
  }
  assert.ok(populated > 50);
});
test('beaches only open by day in good weather, rain reduces street activity', () => {
  assert.equal(peopleSchedule('beach', 21, 0), 0); assert.equal(peopleSchedule('beach', 14, 1), 0);
  assert.equal(peopleSchedule('beach', 14, 0), 1);
  assert.ok(peopleSchedule('beach', 8, 0) < peopleSchedule('beach', 14, 0) / 4, 'quiet early beach opening');
  assert.ok(peopleSchedule('walker', 21, 0) > peopleSchedule('walker', 3, 0) * 10);
  assert.ok(peopleSchedule('walker', 3, 0, true) > peopleSchedule('walker', 3, 0));
  assert.ok(peopleSchedule('walker', 14, 1) < peopleSchedule('walker', 14, 0));
  assert.equal(peopleSchedule('cyclist', 3, 0), 0);
});
