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
