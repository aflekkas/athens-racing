// Do not restore this feature without a new owner decision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
const LOCK = 'Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.';
const root = new URL('../', import.meta.url);
async function scan(dir) {
  for (const entry of await readdir(new URL(dir, root), { withFileTypes: true })) {
    const path = dir + entry.name;
    assert.doesNotMatch(entry.name, /phone[-_]?wheel|qrcode/i, `${path}: ${LOCK}`);
    if (entry.isDirectory()) await scan(path + '/');
    else if (/\.(?:[cm]?js|html|css)$/.test(path)) {
      const source = await readFile(new URL(path, root), 'utf8');
      assert.doesNotMatch(source, /(?:['"`])\/(?:api\/)?wheel(?:[/?'"`])|PhoneWheelRoom|WheelRoom|WheelLink|WheelInput|phoneWheel|phone-wheel|USE PHONE AS WHEEL|RTCPeerConnection/, `${path}: ${LOCK}`);
    }
  }
}
test('owner lock: no wheel route, pairing, signalling, relay, input or controller UI', async () => {
  // Preferences deliberately retain only a migration that removes old saved keys.
  for (const dir of ['src/', 'server/', 'worker/']) await scan(dir);
  const config = JSON.parse(await readFile(new URL('wrangler.jsonc', root), 'utf8'));
  for (const scope of [config, ...Object.values(config.env)]) {
    assert.ok(!scope.durable_objects.bindings.some(binding => /WHEEL|PhoneWheel/.test(JSON.stringify(binding))), LOCK);
  }
  const removed = config.migrations.find(m => m.deleted_classes?.includes('PhoneWheelRoom'));
  assert.ok(removed, `Retire the deployed Durable Object through a deletion migration. ${LOCK}`);
});
