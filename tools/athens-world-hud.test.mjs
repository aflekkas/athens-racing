// The streamed Athens world draws the tacho with Hud's own code. A plain {tacho,tctx} object lacks the methods that
// drawTacho calls (tachoBase, fontsReady), which threw on the first frame and paused the car. Guard the dial's shape.
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('Athens world builds its tacho dial from Hud.prototype, and Hud.drawTacho only needs methods Hud defines',async()=>{
  const world=await readFile(new URL('../src/athens-world.js',import.meta.url),'utf8'),hud=await readFile(new URL('../src/hud.js',import.meta.url),'utf8');
  assert.match(world,/dial=Object\.assign\(Object\.create\(Hud\.prototype\),\{tacho,tctx:/);assert.match(world,/dial\.drawTacho\(/);
  assert.doesNotMatch(world,/Hud\.prototype\.drawTacho\.call/);
  for(const method of ['tachoBase','fontsReady','drawTacho'])assert.match(hud,new RegExp('\\n  '+method+'\\('),method+' is a Hud method');
});
