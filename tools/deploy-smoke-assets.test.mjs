import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { deployedModules, checkDeployedEntry } from './deploy-smoke-assets.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
test('smoke discovers a hashed entry and validates both module bytes and immutable copies', async () => {
  const code = 'export const loaded = true;', h = hash(code), paths = [];
  const html = '<meta content="release-B" name="asr-build"><script src="./src/main-HASH.js" type="module"></script>';
  const sw = `self.ASR_RELEASE = ${JSON.stringify({ build: 'release-B', files: { '/src/main-HASH.js': h } })};\n/* worker */`;
  const server = createServer((req, res) => { paths.push(req.url); const text = req.url === '/' ? html : req.url === '/sw.js' ? sw : ['/src/main-HASH.js', `/_c/${h}.js`].includes(req.url) ? code : null; res.statusCode = text ? 200 : 404; res.end(text || 'missing'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    assert.deepEqual(await checkDeployedEntry(`http://127.0.0.1:${server.address().port}`), { build: 'release-B', entry: '/src/main-HASH.js' });
    assert.deepEqual(paths, ['/', '/sw.js', '/src/main-HASH.js', `/_c/${h}.js`]);
  } finally { await new Promise(r => server.close(r)); }
});
test('legacy unbundled entry, registrar ordering, and release-skew failures', () => {
  assert.equal(deployedModules('<script type="module" src="./src/main.js"></script>', 'https://game.test').entry, '/src/main.js');
  const html = `<meta name='asr-build' content='B'><script type='module' src='./src/offline-cache.js'></script><script src='./src/main-NEXT.js' type='module'></script>`;
  const manifest = { build: 'B', files: { '/src/offline-cache.js': 'a'.repeat(16), '/src/main-NEXT.js': 'b'.repeat(16) } };
  assert.equal(deployedModules(html, 'https://game.test', `self.ASR_RELEASE = ${JSON.stringify(manifest)};`).entry, '/src/main-NEXT.js');
  assert.throws(() => deployedModules(html, 'https://game.test', 'self.ASR_RELEASE = {"build":"A","files":{}};'), /same release/);
  assert.throws(() => deployedModules(html, 'https://game.test', 'self.ASR_RELEASE = {"build":"B","files":{}};'), /missing from sw/);
  assert.throws(() => deployedModules(html, 'https://game.test', '/* no release */'), /manifest missing/);
});
