// Do not change this without a new owner decision. 2026-10-19: Athens Racing is a computer game. Phones and tablets get one
// full screen ("Athens Racing is made for computers") and never reach the sign-in, the title menu or any asset download.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, copyFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deviceBlockReason, deviceBlocked, readDevice, showDeviceGate, GATE_TITLE, GATE_TEXT, GATE_URL } from '../src/device-gate.js';

const LOCK = 'Owner-locked decision (2026-10-19, computer only), see docs/OWNER-DECISIONS.md and docs/plans/desktop-only.md. Ask the owner before changing.';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_OLD = 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'; // iPadOS 13+ sends this, too
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'; // no "Mobile" token
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// [name, device, expected reason (null = plays)]
const TABLE = [
  ['iPhone', { coarse: true, anyFine: false, userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 }, 'phone'],
  ['Android phone', { coarse: true, anyFine: false, mobileHint: true, userAgent: PIXEL, platform: 'Linux armv81', maxTouchPoints: 5 }, 'mobile-hint'],
  ['Android phone by user agent alone (no Client Hints, as in Firefox)', { coarse: true, anyFine: false, userAgent: PIXEL.replace('Chrome/126.0.0.0', 'Firefox/127.0'), maxTouchPoints: 5 }, 'phone'],
  ['phone that asked for the desktop site', { coarse: true, anyFine: false, userAgent: LINUX, platform: 'Linux armv81', maxTouchPoints: 5 }, 'touch-only'],
  ['phone in a desktop-sized window with a Bluetooth mouse is still a phone by its hints', { coarse: true, anyFine: true, mobileHint: true, userAgent: PIXEL, maxTouchPoints: 5 }, 'mobile-hint'],
  ['iPad, default iPadOS Safari (Mac user agent)', { coarse: true, anyFine: false, userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5 }, 'ipad'],
  ['iPad with a keyboard but no fine pointer', { coarse: true, anyFine: false, userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5 }, 'ipad'],
  ['older iPad (iPad user agent)', { coarse: true, anyFine: false, userAgent: IPAD_OLD, platform: 'iPad', maxTouchPoints: 5 }, 'ipad'],
  ['iPad with a trackpad: it is still an iPad', { coarse: true, anyFine: true, userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5 }, 'ipad'],
  ['Android tablet with no mouse', { coarse: true, anyFine: false, userAgent: ANDROID_TABLET, platform: 'Linux armv81', maxTouchPoints: 10 }, 'touch-only'],
  ['Windows tablet with the keyboard detached', { coarse: true, anyFine: false, userAgent: WINDOWS, platform: 'Win32', maxTouchPoints: 10 }, 'touch-only'],
  ['Android tablet with a mouse: a fine pointer exists, so it plays', { coarse: true, anyFine: true, userAgent: ANDROID_TABLET, platform: 'Linux armv81', maxTouchPoints: 10 }, null],
  ['touchscreen laptop (trackpad is the primary pointer)', { coarse: false, anyFine: true, userAgent: WINDOWS, platform: 'Win32', maxTouchPoints: 10 }, null],
  ['touchscreen laptop whose primary pointer reports coarse but has a trackpad', { coarse: true, anyFine: true, userAgent: WINDOWS, platform: 'Win32', maxTouchPoints: 10 }, null],
  ['Chromebook with a touch screen', { coarse: false, anyFine: true, userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', platform: 'Linux x86_64', maxTouchPoints: 10 }, null],
  ['Mac desktop', { coarse: false, anyFine: true, userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 }, null],
  ['Windows desktop', { coarse: false, anyFine: true, userAgent: WINDOWS, platform: 'Win32', maxTouchPoints: 0 }, null],
  ['Linux desktop', { coarse: false, anyFine: true, userAgent: LINUX, platform: 'Linux x86_64', maxTouchPoints: 0 }, null],
  ['a browser that knows neither media feature and sends a desktop user agent', { userAgent: WINDOWS, platform: 'Win32' }, null],
  ['nothing known at all', {}, null],
];
for (const [name, device, reason] of TABLE) test(`decision table: ${name} -> ${reason ?? 'plays'}`, () => {
  assert.equal(deviceBlockReason(device), reason, LOCK);
  assert.equal(deviceBlocked(device), reason !== null, LOCK);
});

test('readDevice reads the pointer media queries, the Client Hints flag and the platform, and never throws', () => {
  const asked = [];
  const scope = {
    matchMedia: query => { asked.push(query); return { matches: query === '(pointer: coarse)' }; },
    navigator: { userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5, userAgentData: { mobile: true } },
  };
  assert.deepEqual(readDevice(scope), { coarse: true, anyFine: false, mobileHint: true, userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 });
  assert.deepEqual(asked.sort(), ['(any-pointer: fine)', '(pointer: coarse)'], LOCK);
  assert.deepEqual(readDevice({}), { coarse: false, anyFine: false, mobileHint: false, userAgent: '', platform: '', maxTouchPoints: 0 });
  assert.equal(readDevice({ matchMedia() { throw new Error('unsupported'); }, navigator: {} }).coarse, false);
});

test('showDeviceGate marks the document, which is what reveals the gate and hides the rest', () => {
  const doc = { documentElement: { dataset: {} } };
  showDeviceGate(doc, 'phone');
  assert.equal(doc.documentElement.dataset.device, 'blocked'); assert.equal(doc.documentElement.dataset.deviceReason, 'phone');
});

// ---------------------------------------------------------------- phones never reach the game
// Run the real entry.js with a stand-in main.js, under each device. A blocked device must not import the game at all.
async function runEntry(device, { maxTouchPoints = 0, platform = '', userAgent = '', userAgentData, entrySource } = {}) {
  const dir = await mkdtemp(resolve(tmpdir(), 'asr-entry-'));
  try {
    if(entrySource==null)await copyFile(new URL('../src/entry.js', import.meta.url), resolve(dir, 'entry.js'));else await writeFile(resolve(dir,'entry.js'),entrySource);
    await copyFile(new URL('../src/device-gate.js', import.meta.url), resolve(dir, 'device-gate.js'));
    await writeFile(resolve(dir,'game-entry.js'),"export * from './main.js';");
    await writeFile(resolve(dir, 'main.js'), 'globalThis.__gameImports = (globalThis.__gameImports || 0) + 1; export const title = true;');
    await writeFile(resolve(dir,'route-entry-prefetch.js'),"globalThis.__routeModuleImports++; export function prefetchDirectRace(){globalThis.__routePrefetchCalls++;return null;}");
    const requests=[];const document = { documentElement: { dataset: {} } };
    const saved = Object.fromEntries(['document','matchMedia','__gameImports','__routeModuleImports','__routePrefetchCalls','__routeEntryPrefetch','__authPrefetch','fetch','location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])), navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.assign(globalThis, {__routeModuleImports:0,__routePrefetchCalls:0,location:{search:'?event=megara-tt'},fetch:path=>{requests.push(path);return Promise.resolve({ok:true});}, document, matchMedia: query => ({ matches: query === '(pointer: coarse)' ? device.coarse : query === '(any-pointer: fine)' ? device.anyFine : false }), __gameImports: 0 });
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent, platform, maxTouchPoints, userAgentData }, configurable: true });
    try { await import(pathToFileURL(resolve(dir, 'entry.js')).href);await globalThis.__routeEntryPrefetch;return {imports:globalThis.__gameImports,prefetchImports:globalThis.__routeModuleImports,prefetchCalls:globalThis.__routePrefetchCalls,requests,dataset:{...document.documentElement.dataset}}; }
    finally { for (const [key, descriptor] of Object.entries(saved)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; Object.defineProperty(globalThis, 'navigator', navigator); }
  } finally { await rm(dir, { recursive: true, force: true }); }
}
test('entry.js: a phone, an iPad and a touch-only tablet stop at the gate and never import the game', async () => {
  for (const [name, device, extra] of [
    ['iPhone', { coarse: true, anyFine: false }, { userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 }],
    ['Android phone', { coarse: true, anyFine: false }, { userAgent: PIXEL, userAgentData: { mobile: true }, maxTouchPoints: 5 }],
    ['iPad', { coarse: true, anyFine: false }, { userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5 }],
    ['Android tablet', { coarse: true, anyFine: false }, { userAgent: ANDROID_TABLET, maxTouchPoints: 10 }],
  ]) {
    const result = await runEntry(device, extra);
    assert.equal(result.imports, 0, `${name} must not load the game. ${LOCK}`);assert.equal(result.prefetchImports,0,`${name} must not import route prefetch. ${LOCK}`);assert.equal(result.prefetchCalls,0);assert.deepEqual(result.requests,[],`${name} makes no auth/route requests. ${LOCK}`);
    assert.equal(result.dataset.device, 'blocked', `${name} must see the gate. ${LOCK}`);
  }
});
test('entry.js: a desktop and a touchscreen laptop go straight on to the game, with no gate', async () => {
  for (const [name, device, extra] of [
    ['Windows desktop', { coarse: false, anyFine: true }, { userAgent: WINDOWS, platform: 'Win32' }],
    ['touchscreen laptop', { coarse: false, anyFine: true }, { userAgent: WINDOWS, platform: 'Win32', maxTouchPoints: 10 }],
    ['Mac', { coarse: false, anyFine: true }, { userAgent: MAC, platform: 'MacIntel' }],
  ]) {
    const result = await runEntry(device, extra);
    assert.equal(result.imports, 1, `${name} loads the game. ${LOCK}`);assert.equal(result.prefetchImports,1);assert.equal(result.prefetchCalls,1);assert.deepEqual(result.requests,['/api/auth/config','/api/auth/session']);
    assert.equal(result.dataset.device, undefined, `${name} sees no gate. ${LOCK}`);
  }
});
test('entry.js is the only way in: index.html loads it and nothing else, and it carries no bypass', async () => {
  const html = await read('index.html'), entry = await read('src/entry.js'), gate = await read('src/device-gate.js');
  assert.deepEqual([...html.matchAll(/<script\b[^>]*\btype="module"[^>]*>/g)].map(m => m[0].match(/src="([^"]+)"/)?.[1]), ['./src/entry.js'], `index.html loads one module, the gate. ${LOCK}`);
  assert.doesNotMatch(html, /modulepreload|<link[^>]+(?:main|boot)\.js/, `nothing preloads the game for a device that may be blocked. ${LOCK}`);
  assert.deepEqual([...entry.matchAll(/^import .*$/gm)].map(m => m[0]), ["import { deviceBlockReason, readDevice, showDeviceGate } from './device-gate.js';"], `entry.js statically imports only the gate. ${LOCK}`);
  assert.deepEqual([...entry.matchAll(/import\('([^']+)'\)/g)].map(m => m[1]), ['./route-entry-prefetch.js','./game-entry.js'], LOCK);
  assert.ok(entry.indexOf('else {')<entry.indexOf("import('./route-entry-prefetch.js')"),`route prefetch stays behind the desktop decision. ${LOCK}`);
  assert.ok(entry.indexOf('showDeviceGate') < entry.indexOf("import('./game-entry.js')"), `the gate decides before the game loads. ${LOCK}`);
  assert.doesNotMatch(entry.slice(0,entry.indexOf('else {')) + gate, /location|localStorage|sessionStorage|URLSearchParams|cookie/, `no query flag, storage switch or cookie lifts the gate. ${LOCK}`);
  assert.doesNotMatch(gate, /^\s*import\b/m, `device-gate.js imports nothing: it is all a blocked device runs. ${LOCK}`);
});

// ---------------------------------------------------------------- the screen
test('the gate is a full screen on the shared kit, in the game font with Lucide icons, and index.html matches the generator', async () => {
  const html = await read('index.html'), { syncLayouts, deviceGateMarkup } = await import('./sync-loading-layout.mjs');
  assert.equal(syncLayouts(html), html, 'run node tools/sync-loading-layout.mjs to refresh the kit templates');
  const markup = deviceGateMarkup();
  assert.match(markup, /class="scr [^"]*layout--sheet-list-narrow/, `built by the kit's sheetList. ${LOCK}`);
  assert.doesNotMatch(markup, /dialog/, `a full screen, not a dialog. ${LOCK}`);
  assert.match(markup, /#monitor"/); assert.match(markup, /#globe"/);
  assert.match(markup, /wordmark/); assert.match(markup, /assets\/icon\.svg/);
  assert.equal(GATE_TITLE, 'ATHENS RACING IS MADE FOR COMPUTERS', LOCK);
  assert.match(GATE_TEXT, /laptop or desktop/);
  assert.equal(GATE_URL, 'athensracing.com');
  for (const text of [GATE_TITLE, GATE_TEXT, GATE_URL]) assert.ok(markup.includes(text), `gate shows "${text}"`);
  assert.doesNotMatch(markup, /file:\/\//, 'icons use the relative sprite URL');
  const css = await read('src/ui/ui.css');
  assert.match(css, /html\[data-device="blocked"\] body > :not\(#device-gate\)\s*\{\s*display:\s*none\s*!important/, `a blocked device sees nothing but the gate. ${LOCK}`);
  assert.match(css, /html\[data-device="blocked"\] #device-gate\s*\{[^}]*position:\s*fixed;\s*inset:\s*0/, LOCK);
});

// ---------------------------------------------------------------- the production bundle
test('bundle: the page entry is the gate, the game is only a dynamic import, and the menu shell is still precached', async () => {
  const { bundleBrowser } = await import('./bundle-browser.mjs');
  const root = await mkdtemp(resolve(tmpdir(), 'asr-gate-bundle-')), out = resolve(root, '.deploy/assets');
  try {
    await mkdir(resolve(root, 'src'), { recursive: true }); await mkdir(resolve(out, 'src'), { recursive: true });
    await writeFile(resolve(root, 'package.json'), '{"type":"module"}');
    await copyFile(new URL('../src/entry.js', import.meta.url), resolve(root, 'src/entry.js'));
    await copyFile(new URL('../src/device-gate.js', import.meta.url), resolve(root, 'src/device-gate.js'));
    await writeFile(resolve(root,'src/route-entry-prefetch.js'),'export function prefetchDirectRace(){return null;}');
    await writeFile(resolve(root,'src/game-entry.js'),"export const ready=import('./main.js');");
    await writeFile(resolve(root, 'src/main.js'), 'export const wrong = "dev entry";');
    await writeFile(resolve(root, 'src/boot.js'), "import { menu } from './menu-shell.js'; globalThis.title = menu;");
    await writeFile(resolve(root, 'src/menu-shell.js'), 'export const menu = "title";');
    await writeFile(resolve(out, 'src/offline-cache.js'), '/* registrar */');
    await writeFile(resolve(out, 'index.html'), '<script type="module" src="./src/entry.js"></script>');
    const meta = await bundleBrowser(root, out);
    const page = (await readFile(resolve(out, 'index.html'), 'utf8')).match(/src="\.\/(src\/[^"]+)"/)[1];
    const pageOutput = meta.outputs['.deploy/assets/' + page];
    assert.equal(pageOutput.entryPoint, 'src/entry.js', `the page loads the gate. ${LOCK}`);
    const imports = (output, kind) => output.imports.filter(i => i.kind === kind && !i.external).map(i => i.path);
    const closure = (path, seen = new Set()) => { if (!seen.has(path)) { seen.add(path); for (const next of imports(meta.outputs[path], 'import-statement')) closure(next, seen); } return seen; };
    const gateInputs = [...closure('.deploy/assets/' + page)].flatMap(path => Object.keys(meta.outputs[path].inputs)).sort();
    assert.deepEqual(gateInputs, ['src/device-gate.js', 'src/entry.js'], `everything the gate loads statically is the gate itself (esbuild's empty runtime chunk aside). ${LOCK}`);
    const dynamic = imports(pageOutput, 'dynamic-import');
    assert.deepEqual(dynamic.map(path=>meta.outputs[path].entryPoint).sort(),['src/game-entry.js','src/route-entry-prefetch.js'],LOCK);const dispatcher=dynamic.find(path=>meta.outputs[path].entryPoint==='src/game-entry.js'),game=imports(meta.outputs[dispatcher],'dynamic-import').find(path=>meta.outputs[path].entryPoint==='src/boot.js');assert.ok(game,'dispatcher reaches the production menu dynamically');
    const initial = new Set(meta.initial);
    assert.ok(initial.has('/' + game.replace('.deploy/assets/', '')), 'the menu shell stays in the service worker core list');
    assert.ok(Object.entries(meta.outputs).filter(([, o]) => Object.keys(o.inputs).includes('src/menu-shell.js')).every(([path]) => initial.has('/' + path.replace('.deploy/assets/', ''))));
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- the phone and tablet support stays removed
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(new URL('../' + dir, import.meta.url), { withFileTypes: true })) {
    const path = dir + entry.name;
    if (entry.isDirectory()) out.push(...await walk(path + '/')); else out.push(path);
  }
  return out;
}
test('no touch controls, tilt steering, add-to-home-screen card, manifest or phone caps return', async () => {
  const sources = (await walk('src/')).filter(path => /\.(?:js|css)$/.test(path));
  const banned = [
    [/touch-controls|touch-driving|\.touch-(?:steer|pedals|buttons|gears|actions|rotate)|mountTouch|touchUI|touchSteering(?!['":,\s]*['"]?tilt['"]?\s*[,}])/, 'on-screen touch driving controls'],
    [/deviceorientation|DeviceOrientationEvent|requestFullscreen|orientation\.lock/, 'tilt steering and fullscreen/orientation lock'],
    [/beforeinstallprompt|appinstalled|install-notice|display-mode:\s*standalone|navigator\.standalone/, 'the add-to-home-screen card'],
    [/safe-area-inset/, 'notch padding'],
    [/mobileDevice|showroomPixelRatio|\bMobile\b[^'"`\n]*Android|Android\|iPhone/, 'phone performance paths'],
  ];
  const hits = [];
  for (const path of sources) {
    if (path === 'src/device-gate.js') continue; // the gate is where phones are recognised, and stopped
    const text = await read(path);
    for (const [pattern, what] of banned) if (pattern.test(text)) hits.push(`${path}: ${what}`);
  }
  assert.deepEqual(hits, [], LOCK);
  for (const gone of ['src/mobile.js', 'src/install-prompt.js', 'src/ui/install-card.js', 'assets/manifest.webmanifest', 'assets/apple-touch-icon.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-192.png', 'assets/icon-maskable-512.png']) {
    await assert.rejects(readFile(new URL('../' + gone, import.meta.url)), { code: 'ENOENT' }, `${gone} stays removed. ${LOCK}`);
  }
  const html = await read('index.html');
  assert.doesNotMatch(html, /manifest|apple-touch-icon|apple-mobile-web-app|mobile-web-app-capable|user-scalable|maximum-scale|viewport-fit/, `index.html carries no app-install or phone viewport tags. ${LOCK}`);
});
test('narrow desktop windows keep their layouts: the 860, 900, 1000 and 1100 px queries stay, the phone-width ones do not', async () => {
  const css = (await Promise.all(['style.css', 'src/ui/ui.css', 'src/menu.css', 'src/multiplayer.css', 'src/map-select.css', 'src/recovery-prompt.css', 'src/input.css'].map(read))).join('\n');
  const queries = [...css.matchAll(/@media\s*([^{]+)\{/g)].map(m => m[1]);
  for (const width of [860, 900, 1100]) assert.ok(queries.some(q => new RegExp(`max-width:\\s*${width}px`).test(q)), `the ${width}px narrow-window layout stays`);
  const phone = queries.filter(q => /max-width:\s*(?:[1-6]\d{2}|7[0-2]\d)px|max-height:\s*(?:[1-4]\d{2}|500)px|pointer:\s*coarse|orientation:\s*portrait|hover:\s*none/.test(q.replace(/any-pointer/g, '')));
  assert.deepEqual(phone, [], `no phone-width, short-landscape, coarse-pointer or portrait query returns. ${LOCK}`);
});

test('desktop gate fixture catches eager route-prefetch imports on a blocked phone',async()=>{const entry=await read('src/entry.js'),result=await runEntry({coarse:true,anyFine:false},{userAgent:IPHONE,platform:'iPhone',maxTouchPoints:5,entrySource:"import './route-entry-prefetch.js';\n"+entry});assert.equal(result.imports,0);assert.equal(result.prefetchImports,1,'negative control crosses the gate without starting main');assert.throws(()=>assert.equal(result.prefetchImports,0));});
