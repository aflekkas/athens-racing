import test from 'node:test';
import assert from 'node:assert/strict';
import { loading } from '../src/ui/loading.js';

test('completed loading stops intercepting immediately; a new map cancels the old hide', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const classes = new Set(['open']), attributes = new Map([['aria-busy', 'true']]);
  const element = { style: {}, inert: false, classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v) },
    setAttribute: (k, v) => attributes.set(k, v), removeAttribute: k => attributes.delete(k) };
  const previous = globalThis.document; globalThis.document = { getElementById: id => id === 'loading' ? element : null };
  t.mock.method(loading, 'setMap', () => {}); t.mock.method(loading, 'progress', () => {}); t.mock.method(loading, 'nextTip', () => {});
  try {
    loading.hide();
    assert.equal(element.style.pointerEvents, 'none'); assert.equal(element.inert, true);
    assert.equal(attributes.get('aria-hidden'), 'true'); assert.equal(classes.has('open'), true, 'fade delay still renders');
    t.mock.timers.tick(100); loading.show('penteli'); t.mock.timers.tick(200);
    assert.equal(classes.has('open'), true, 'previous map hide cannot close a new loader');
    assert.equal(element.style.pointerEvents, ''); assert.equal(element.inert, false); assert.equal(attributes.has('aria-hidden'), false);
    loading.hide(); t.mock.timers.tick(180);
    assert.equal(classes.has('open'), false); assert.equal(attributes.has('aria-busy'), false);
    assert.equal(element.style.pointerEvents, 'none'); assert.equal(element.inert, true);
  } finally { globalThis.document = previous; }
});

test('a long load shows real elapsed time and can return to a clean menu; completion stops its timer', t => {
  t.mock.timers.enable({ apis: ['setTimeout','setInterval'] });
  let now=0,navigated;
  t.mock.method(performance,'now',()=>now);
  const button={},recovery={hidden:true},wait={textContent:''},back={innerHTML:'',querySelector:selector=>{assert.equal(selector,'[role="button"]');return button;}};
  const element={style:{},classList:{add(){},remove(){},contains(){return true;}},setAttribute(){},removeAttribute(){}};
  const previousDocument=globalThis.document,previousLocation=globalThis.location;
  globalThis.document={getElementById:id=>({loading:element,ldRecovery:recovery,ldWait:wait,ldReturn:back}[id]||null)};
  globalThis.location={href:'https://example.test/?simhook&guest=1&lobby=ABC123',assign:url=>{navigated=new URL(url);}};
  t.mock.method(loading,'setMap',()=>{});t.mock.method(loading,'progress',()=>{});t.mock.method(loading,'nextTip',()=>{});
  try {
    loading.show('riviera');assert.equal(recovery.hidden,true);
    now=8000;t.mock.timers.tick(8000);assert.equal(recovery.hidden,false);assert.match(wait.textContent,/8s/);
    button.onclick();assert.equal(navigated.searchParams.get('menu'),'1');assert.equal(navigated.searchParams.has('lobby'),false);assert.equal(navigated.searchParams.get('guest'),'1');
    loading.hide();const text=wait.textContent;now=20000;t.mock.timers.tick(12000);assert.equal(wait.textContent,text);
  } finally {globalThis.document=previousDocument;if(previousLocation)globalThis.location=previousLocation;else delete globalThis.location;}
});

test('overlapping preload milestones cannot move displayed progress backwards',()=>{
  const previous=globalThis.document,pct={textContent:''},stat={textContent:''};
  globalThis.document={getElementById:id=>({lpct:pct,lstat:stat}[id]||null)};
  const old=loading.p;
  try{loading.p=0;loading.progress('BUFFERS READY',.33);loading.progress('BUILDING TERRAIN',.25);assert.equal(pct.textContent,'33%');assert.equal(stat.textContent,'BUILDING TERRAIN');}
  finally{loading.p=old;globalThis.document=previous;}
});
