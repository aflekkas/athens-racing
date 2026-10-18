import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSmokeToken, SMOKE_TOKEN_FILE } from './smoke-token.mjs';

test('smoke token comes from the environment first, then the owner file, else empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-token-')), file = join(dir, 'smoke-token');
  try {
    assert.equal(loadSmokeToken({}, file), '');
    writeFileSync(file, 'from-file\n');
    assert.equal(loadSmokeToken({}, file), 'from-file');
    assert.equal(loadSmokeToken({ SMOKE_TOKEN: 'from-env' }, file), 'from-env');
    assert.equal(loadSmokeToken({ SMOKE_TOKEN: '' }, file), 'from-file');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.match(SMOKE_TOKEN_FILE, /\.config\/athens-racing\/smoke-token$/);
});

test('both smoke tools read the token through the shared loader', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const f of ['deploy-smoke.mjs', 'resumable-smoke-client.mjs']) {
    const src = await readFile(new URL('./' + f, import.meta.url), 'utf8');
    assert.match(src, /loadSmokeToken\(/, f);
    assert.doesNotMatch(src, /process\.env\.SMOKE_TOKEN/, f);
  }
});
