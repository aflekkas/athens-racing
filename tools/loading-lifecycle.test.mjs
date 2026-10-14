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
