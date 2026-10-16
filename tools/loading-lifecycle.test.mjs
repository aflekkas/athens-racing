import test from 'node:test';
import assert from 'node:assert/strict';
import { loading, errorCode, FAILURES } from '../src/ui/loading.js';

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

// A tiny DOM double: enough of #loading for loading.js to render steps, notes and failure actions.
function fakeDom() {
  const make = () => {
    const attrs = new Map(), classes = new Set(), el = { attrs, classes, hidden: false, textContent: '', children: [], style: { setProperty(k, v) { this[k] = v; } },
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle: (c, on) => on ? classes.add(c) : classes.delete(c) },
      setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: k => attrs.get(k) ?? null, removeAttribute: k => attrs.delete(k),
      insertAdjacentHTML(_, html) { const b = make(); b.html = html; el.children.push(b); el.lastElementChild = b; },
      contains: x => el.children.includes(x), querySelector: () => null };
    Object.defineProperty(el, 'innerHTML', { get: () => el.children.map(c => c.html).join(''), set: () => { el.children = []; el.lastElementChild = null; } });
    return el;
  };
  const ids = {}, get = id => ids[id] ||= make();
  for (const id of ['ldNote', 'ldIssue', 'ldRecovery']) get(id).hidden = true;
  const steps = Object.fromEntries(['data', 'fetch', 'build', 'prep'].map(step => { const li = make(), seg = make(); li.querySelector = () => seg; li.seg = seg; return [step, li]; }));
  get('lbar').querySelector = sel => steps[/"(\w+)"/.exec(sel)[1]];
  get('loading').querySelector = () => null;
  return { ids, steps, document: { getElementById: get }, button: (host, label) => host.children.find(c => c.html.includes(`<span>${label}</span>`)) };
}
async function withDom(t, fn) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let now = 0; t.mock.method(performance, 'now', () => now);
  const dom = fakeDom(), previous = globalThis.document, previousLocation = globalThis.location;
  globalThis.document = dom.document;
  t.mock.method(loading, 'setMap', () => {}); t.mock.method(loading, 'nextTip', () => {});
  try { loading.show('riviera'); return await fn(dom, ms => { now += ms; t.mock.timers.tick(ms); }, url => { globalThis.location = url; }); }
  finally { loading.hide(); globalThis.document = previous; if (previousLocation) globalThis.location = previousLocation; else delete globalThis.location; }
}

test('a long load offers RETURN TO MENU without a running seconds counter; leaving keeps auth/guest params', t => withDom(t, (dom, advance, setLocation) => {
  let navigated;
  setLocation({ href: 'https://example.test/?simhook&guest=1&lobby=ABC123', assign: url => { navigated = new URL(url); } });
  assert.equal(dom.ids.ldRecovery.hidden, true);
  advance(12000);
  assert.equal(dom.ids.ldRecovery.hidden, false);
  assert.doesNotMatch(JSON.stringify(Object.values(dom.ids).map(e => e.textContent)), /\d+s\b/, 'no elapsed-seconds timer text');
  dom.button(dom.ids.ldReturn, 'RETURN TO MENU').onclick();
  assert.equal(navigated.searchParams.get('menu'), '1'); assert.equal(navigated.searchParams.has('lobby'), false); assert.equal(navigated.searchParams.get('guest'), '1');
}));

test('legacy milestones pick honest steps: no percentage, never backwards, unmeasured work is indeterminate', t => withDom(t, dom => {
  loading.progress('TERRAIN + ROADS READY', .33);
  assert.equal(dom.ids.lstat.textContent, 'BUILDING THE TRACK');
  loading.progress('DOWNLOADING TERRAIN + ROADS · 3.0 MB', .25);
  assert.equal(dom.ids.lstat.textContent, 'BUILDING THE TRACK', 'a late download milestone cannot step backwards');
  assert.equal(dom.ids.lpct.textContent, '', 'no fake percent');
  assert.equal(dom.steps.build.getAttribute('data-state'), 'active');
  assert.equal(dom.steps.fetch.getAttribute('data-state'), 'done');
  assert.ok(dom.steps.build.seg.classes.has('progress--indeterminate'));
  assert.equal(dom.ids.lbar.attrs.has('aria-valuenow'), false, 'indeterminate progressbar has no value');
  loading.progress('PAVING POSEIDONOS AVENUE', .4);
  assert.equal(dom.ids.lstat.textContent, 'PAVING POSEIDONOS AVENUE');
  loading.progress('PREPARING SHADERS', .98);
  assert.equal(dom.ids.lstat.textContent, 'PREPARING GRAPHICS');
  assert.equal(dom.steps.prep.getAttribute('data-state'), 'active');
}));

test('download fills only from measured bytes; unknown totals show bytes and keep sweeping', t => withDom(t, dom => {
  loading.progress('DOWNLOADING', .25, { phase: 'download', loadedBytes: 13 * 1048576, totalBytes: 36 * 1048576, source: 'download' });
  assert.equal(dom.ids.lstat.textContent, 'DOWNLOADING THE TRACK');
  assert.equal(dom.ids.lpct.textContent, '13.0 / 36.0 MB');
  assert.equal(dom.ids.lbar.getAttribute('aria-valuenow'), '36');
  assert.match(dom.ids.lbar.getAttribute('aria-valuetext'), /Step 2 of 4: downloading the track, 13.0 of 36.0 megabytes/);
  assert.equal(dom.steps.fetch.seg.classes.has('progress--indeterminate'), false);
  assert.equal(dom.steps.fetch.seg.style['--p'], 13 / 36);
  loading.progress('DOWNLOADING', .25, { phase: 'download', loadedBytes: 2 * 1048576, totalBytes: null });
  assert.equal(dom.ids.lpct.textContent, '2.0 MB');
  assert.ok(dom.steps.fetch.seg.classes.has('progress--indeterminate'));
  loading.progress('UNPACKING', .3, { phase: 'decode' });
  assert.equal(dom.ids.lstat.textContent, 'UNPACKING THE TRACK');
}));

test('quiet stretches say what is happening: network wait, offline, on-device build', t => withDom(t, (dom, advance) => {
  loading.progress('DOWNLOADING', .25, { phase: 'download', loadedBytes: 1048576, totalBytes: 8 * 1048576 });
  advance(5000); loading.tick(); assert.equal(dom.ids.ldNote.hidden, true, 'moving downloads need no note');
  loading.progress('DOWNLOADING', .25, { phase: 'download', loadedBytes: 1048576, totalBytes: 8 * 1048576 });
  advance(4000); loading.tick(); assert.equal(dom.ids.ldNote.hidden, false); assert.equal(dom.ids.ldNote.textContent, 'Waiting for the network…');
  loading.progress('DOWNLOADING', .25, { phase: 'download', loadedBytes: 2 * 1048576, totalBytes: 8 * 1048576 });
  assert.equal(dom.ids.ldNote.hidden, true, 'fresh bytes clear the wait note');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try { loading.tick(); assert.match(dom.ids.ldNote.textContent, /offline/); }
  finally { if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; }
  loading.progress('DOWNLOAD UNAVAILABLE · GENERATING TERRAIN + ROADS', .25);
  assert.equal(dom.ids.lstat.textContent, 'BUILDING THE TRACK ON THIS DEVICE');
  assert.match(dom.ids.ldNote.textContent, /download didn’t finish.*minute or two/);
  loading.progress('BUILDING', .3, { phase: 'generate', stage: 'roads', step: 2, steps: 4 });
  assert.equal(dom.ids.lpct.textContent, 'PART 3 OF 4', 'real generator stages, counted not timed');
  assert.ok(dom.steps.build.seg.classes.has('progress--indeterminate'));
}));

test('failures pause calmly with plain words, Retry resumes the same load, and the device build is opt-in', async t => {
  await withDom(t, async (dom, _advance, setLocation) => {
    let retried = 0, built = 0;
    setLocation({ href: 'https://example.test/', reload() { throw new Error('should use supplied retry'); } });
    loading.progress('DOWNLOADING', .25, { phase: 'download', loadedBytes: 1, totalBytes: 10 });
    loading.progress(null, undefined, { phase: 'failed', error: { code: 'timeout', message: 'World download timed out', retryable: true }, retry: () => { retried++; }, fallback: () => { built++; } });
    assert.equal(dom.ids.loading.getAttribute('data-state'), 'failed');
    assert.equal(dom.ids.ldIssue.hidden, false);
    assert.equal(dom.ids.ldIssueWhat.textContent, 'CONNECTION STALLED');
    assert.equal(dom.ids.lstat.textContent, 'DOWNLOAD PAUSED');
    const words = dom.ids.ldIssueWhat.textContent + dom.ids.ldIssueBody.textContent;
    assert.doesNotMatch(words, /world download|worker|gzip|http|meshopt|\.bin|error/i, 'no internals');
    assert.equal(dom.steps.fetch.getAttribute('data-state'), 'failed');
    assert.ok(dom.steps.fetch.seg.classes.has('progress--bad'));
    assert.equal(dom.ids.ldNote.hidden, true);
    assert.ok(dom.button(dom.ids.ldActions, 'RETURN TO MENU'));
    loading.progress('DOWNLOADING TERRAIN + ROADS · 3.0 MB', .25); // late chatter from a paused load
    assert.equal(dom.ids.loading.getAttribute('data-state'), 'failed');
    await dom.button(dom.ids.ldActions, 'TRY AGAIN').onclick();
    assert.equal(retried, 1); assert.equal(dom.ids.ldIssue.hidden, true); assert.equal(dom.ids.loading.getAttribute('data-state'), 'active');
    loading.fail({ code: 'network', fallback: () => { built++; } });
    assert.equal(dom.ids.ldIssueWhat.textContent, 'CONNECTION LOST');
    await dom.button(dom.ids.ldActions, 'BUILD ON THIS DEVICE').onclick();
    assert.equal(built, 1);
    loading.fail({ code: 'storage' });
    assert.equal(dom.button(dom.ids.ldActions, 'BUILD ON THIS DEVICE'), undefined, 'device build appears only when offered');
  });
});

test('error codes map to known copy; offline wins whatever the cause', () => {
  assert.equal(errorCode({ code: 'http' }), 'http');
  assert.equal(errorCode(new Error('x')), 'unknown');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try { assert.equal(errorCode({ code: 'http' }), 'offline'); }
  finally { if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; }
  for (const [what, body] of Object.values(FAILURES)) { assert.match(what, /^[A-Z’ ]+$/); assert.ok(body.length < 110); }
});

test('a new load never inherits the previous load’s note or failure', t => withDom(t, dom => {
  loading.progress(null, undefined, { phase: 'generate', step: 0, steps: 4 });
  assert.equal(dom.ids.ldNote.hidden, false);
  loading.fail({ code: 'generate' });
  loading.show('riviera');
  assert.equal(dom.ids.ldNote.hidden, true); assert.equal(dom.ids.ldNote.textContent, '');
  assert.equal(dom.ids.ldIssue.hidden, true); assert.equal(dom.ids.lstat.textContent, 'LOADING MAP DATA');
}));
