import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { environmentBadge } from '../src/build-environment.js';

test('only an explicit production identity removes the environment badge', () => {
  assert.equal(environmentBadge('production', '2026.10.15.1'), '');
  for (const id of ['staging', 'preview-abc', 'test']) assert.equal(environmentBadge(id, '2026.10.15.1'), 'STAGING · 2026.10.15.1');
  assert.equal(environmentBadge(undefined), 'DEV · dev');
  assert.equal(environmentBadge('dev', 'local'), 'DEV · local');
});
test('Wrangler injects distinct build identities for staging and production', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  for (const env of ['staging', 'production']) assert.match(config.env[env].build.command, new RegExp(`ASR_BUILD_ENV=${env} `));
});

import { Input } from '../src/input.js';
test('menu keyboard bindings work while the account button has DOM focus', () => {
  const target = new EventTarget();
  const input = new Input({target, navigator: {getGamepads:()=>[]}, document:null});
  input.update(1/60, {inMenu:true});
  try {
    for (const [code,action] of [['ArrowUp','up'],['KeyW','up'],['ArrowDown','down'],['KeyS','down'],['Enter','confirm'],['Space','confirm'],['KeyG','garage']]) {
      const event = new Event('keydown', {cancelable:true});Object.assign(event,{code,repeat:false});
      Object.defineProperty(event,'target',{value:{closest:selector=>selector.includes('.input-bindings')?null:{}}});
      input.keyDown(event);input.update(1/60,{inMenu:true});
      assert.ok(input.actions.includes(action), `${code} routes ${action} from a menu button`);
      input.clear();input.update(1/60,{inMenu:true});
    }
  } finally {input.destroy();}
});
test('D-pad and A continue to emit menu navigation actions', () => {
  const pad={id:'menu-test',index:0,connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({value:0}))};
  const input=new Input({target:new EventTarget(),navigator:{getGamepads:()=>[pad]},document:null});
  try {
    for (const [index,action] of [[12,'up'],[13,'down'],[0,'confirm']]) {
      pad.buttons[index].value=1;input.update(1/60,{inMenu:true});assert.ok(input.actions.includes(action));
      pad.buttons[index].value=0;input.update(1/60,{inMenu:true});
    }
  } finally {input.destroy();}
});
