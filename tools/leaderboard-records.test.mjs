import test from 'node:test';
import assert from 'node:assert/strict';
import { setupLabels, carLabel, matchesRecord, routeId, formatRecordTime, recordDate } from '../src/leaderboard-records.js';
test('old records explicitly disclose unknown settings; missing values never match assist/weather filters', () => {
 const old={car:'mini',traffic:true,time:90};assert.match(setupLabels(old).join(' '),/density unknown/);assert.match(setupLabels(old).join(' '),/TC unknown/);
 assert(!matchesRecord(old,{tc:'true'}));assert(!matchesRecord(old,{weather:'clear'}));assert(matchesRecord(old,{mapId:'riviera'}));
 assert.equal(carLabel({...old,carGeneration:'F57',carTrim:'Cooper S'},[{id:'mini',name:'MINI'}]),'MINI · F57 · Cooper S');assert.equal(recordDate(old),'Date unknown');assert.equal(formatRecordTime(65.25),'1:05.25');assert.equal(formatRecordTime(59.999),'1:00.00');
});
test('route filtering keeps lap counts and directions distinct', () => {
 const r={eventId:'quick',setup:{from:0,to:6000,laps:3,direction:1}};
 assert(matchesRecord(r,{route:routeId(r)}));assert(!matchesRecord({...r,setup:{...r.setup,laps:2}},{route:routeId(r)}));
});

import { renderTrackTimes } from '../src/leaderboards-screen.js';
import { recordPersonalBest } from '../src/personal-bests.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('Quick Race track times filter PB and globals by the actual event, rank three, and ignore abandoned views', async () => {
  const previous = { fetch: globalThis.fetch, localStorage: globalThis.localStorage };
  const values = new Map();
  globalThis.localStorage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  const setup = { map: 'megara', event: 'megara-race', car: 'mini', from: 0, to: 2000, laps: 1, direction: 1, time: 'day', weather: 'rain', traffic: 0, rivals: 2, police: false, tc: true, abs: true, steering: 'full', gearbox: 'manual' };
  recordPersonalBest({ ...setup, event: 'megara-tt' }, { valid: true, time: 20 });
  recordPersonalBest(setup, { valid: true, time: 65.25 });
  let finish, requests = [], refreshes = 0;
  globalThis.fetch = url => { requests.push(new URL(url, 'http://localhost')); return new Promise(resolve => { finish = entries => resolve({ ok: true, json: async () => entries }); }); };
  try {
    const data = {}, menu = { screen: 'mapConfirm', data, refresh() { refreshes++; } }, filters = { mapId: 'megara', eventId: 'megara-race' };
    const render = () => renderTrackTimes(menu, data, filters);
    let html = render(); render(); await tick();
    assert.match(html, /PERSONAL BEST · 1:05.25/);
    assert.match(html, /RAIN/); assert.match(html, /Gearbox MANUAL/);
    assert.doesNotMatch(html, /0:20.00/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].searchParams.get('mapId'), 'megara');
    assert.equal(requests[0].searchParams.get('eventId'), 'megara-race');
    assert.equal(requests[0].searchParams.get('limit'), '3');
    finish([5, 2, 4, 1, 3].map(time => ({ mapId: 'megara', eventId: 'megara-race', car: 'mini', name: `DRIVER ${time}`, time })));
    await tick(); html = render();
    assert.equal(refreshes, 1); assert.match(html, /#1 · DRIVER 1/); assert.match(html, /#3 · DRIVER 3/); assert.doesNotMatch(html, /DRIVER 4|DRIVER 5/);
    const abandoned = {}, other = { screen: 'mapConfirm', data: abandoned, refresh() { throw Error('Stale request repainted another screen'); } };
    renderTrackTimes(other, abandoned, filters); await tick();
    other.data = {}; finish([]); await tick();
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});

test('track global errors settle and offer retry without discarding the PB', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('Leaderboard unavailable.'); };
  try {
    const data = {}, menu = { screen: 'mapConfirm', data, refresh() {} }, filters = { mapId: 'penteli', eventId: 'penteli-race' };
    renderTrackTimes(menu, data, filters); await tick();
    const html = renderTrackTimes(menu, data, filters);
    assert.match(html, /Leaderboard unavailable/); assert.match(html, /data-act="trackTimesRetry"/); assert.match(html, /PERSONAL BEST/);
  } finally { globalThis.fetch = previous; }
});
