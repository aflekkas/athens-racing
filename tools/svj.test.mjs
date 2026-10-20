import test from 'node:test';
import assert from 'node:assert/strict';
import {engineProfile,gearboxSound} from '../src/audio/engine-profiles.js';
// Owner decision 2026-10-20 (docs/OWNER-DECISIONS.md): the SVJ's exhaust pops, flames, flash light and toggle are gone.
// Only its normal naturally aspirated V12 voice and its ISR gearbox sound stay.
test('SVJ has a dedicated naturally aspirated V12 voice and ISR gearbox sound',()=>{const spec={id:'aventador_svj',engine:'v12',powertrain:{gearboxType:'amt'}};assert.equal(engineProfile(spec).id,'aventador-svj-v12');assert.equal(engineProfile(spec).turbo,false);assert.equal(engineProfile(spec).cylinders,12);assert.equal(gearboxSound(spec),'amt');});
