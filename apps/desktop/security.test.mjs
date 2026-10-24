import test from 'node:test';
import assert from 'node:assert/strict';
import { assertJoinAddress, assertTrustedSender, rendererRequestAllowed, trustedURL, gamePermissionAllowed, trustedResultDownload, RESULT_DOWNLOAD_MAX_BYTES } from './security.mjs';
const origin = 'http://127.0.0.1:17833';

test('renderer can load local assets and workers, but cannot contact external services or another local port', () => {
  for (const url of [`${origin}/src/main.js`, 'ws://127.0.0.1:17833/ws', `blob:${origin}/worker-id`, 'data:image/svg+xml,<svg/>']) {
    assert.equal(rendererRequestAllowed(url, origin), true, url);
  }
  for (const url of ['https://athensracing.com/', 'https://fonts.googleapis.com/a', 'http://192.168.1.4:8000/', 'http://127.0.0.1:17834/', 'file:///etc/passwd', 'blob:https://example.com/worker', 'http://127.0.0.1:17833.evil.test/', 'http://user:secret@127.0.0.1:17833/']) {
    assert.equal(rendererRequestAllowed(url, origin), false, url);
  }
});

test('navigation remains at the exact HTTP game origin', () => {
  assert.equal(trustedURL(`${origin}/?desktopLan=host`, origin), true);
  for (const url of ['ws://127.0.0.1:17833/', 'https://127.0.0.1:17833/', 'http://localhost:17833/', 'data:text/html,hello', 'not a URL']) {
    assert.equal(trustedURL(url, origin), false, url);
  }
});

test('desktop commands require the live main frame of the trusted game window', () => {
  const mainFrame = { url: origin + '/' }, webContents = { mainFrame };
  const window = { webContents, isDestroyed: () => false };
  assert.doesNotThrow(() => assertTrustedSender({ sender: webContents, senderFrame: mainFrame }, window, origin));
  assert.throws(() => assertTrustedSender({ sender: {}, senderFrame: mainFrame }, window, origin), /untrusted/);
  assert.throws(() => assertTrustedSender({ sender: webContents, senderFrame: { url: origin + '/' } }, window, origin), /untrusted/);
  mainFrame.url = 'https://evil.test/';
  assert.throws(() => assertTrustedSender({ sender: webContents, senderFrame: mainFrame }, window, origin), /untrusted/);
  mainFrame.url = origin;
  window.isDestroyed = () => true;
  assert.throws(() => assertTrustedSender({ sender: webContents, senderFrame: mainFrame }, window, origin), /untrusted/);
});

test('join bridge rejects non-string and oversized payloads before invoking the server', () => {
  assert.doesNotThrow(() => assertJoinAddress('192.168.1.20:17834'));
  for (const value of [null, {}, 42, '', ' host ', 'a'.repeat(256)]) assert.throws(() => assertJoinAddress(value), /host address/);
});


test('trusted game main frame can lock mouse look and enter fullscreen, while device permissions stay denied', () => {
  assert.equal(gamePermissionAllowed('pointerLock', origin, origin, true), true);
  assert.equal(gamePermissionAllowed('fullscreen', origin + '/game', origin, true), true);
  for (const permission of ['media', 'geolocation', 'openExternal', 'usb', 'fileSystem', 'keyboardLock']) assert.equal(gamePermissionAllowed(permission, origin, origin, true), false);
  assert.equal(gamePermissionAllowed('pointerLock', origin, origin, false), false);
  assert.equal(gamePermissionAllowed('pointerLock', 'https://outside.test', origin, true), false);
});


test('only a user-requested bounded local result PNG from the live main frame may download', () => {
  const frame = { url: origin + '/?results' }, contents = { mainFrame: frame };
  const window = { webContents: contents, isDestroyed: () => false };
  const url = 'blob:' + origin + '/result-id';
  const item = { getInitiatorOrigin: () => origin, hasUserGesture: () => true, getFilename: () => 'athens-racing-result.png', getMimeType: () => 'image/png', getURL: () => url, getURLChain: () => [url], getTotalBytes: () => 1024 };
  assert.equal(trustedResultDownload(item, contents, frame, window, origin), true);
  const reject = overrides => assert.equal(trustedResultDownload({ ...item, ...overrides }, contents, frame, window, origin), false);
  for (const value of [0, -1, Infinity, NaN, 1.5, RESULT_DOWNLOAD_MAX_BYTES + 1]) reject({ getTotalBytes: () => value });
  assert.equal(trustedResultDownload({ ...item, getTotalBytes: () => RESULT_DOWNLOAD_MAX_BYTES }, contents, frame, window, origin), true);
  for (const value of ['https://outside.test/result.png', origin + '/assets/result.png', 'blob:https://outside.test/result', 'data:image/png;base64,AAAA', 'file:///private/result.png']) reject({ getURL: () => value, getURLChain: () => [value] });
  reject({ getURLChain: () => [] });
  reject({ getURLChain: () => ['https://outside.test/result.png', url] });
  reject({ getFilename: () => 'result.exe' });
  reject({ getFilename: () => '../athens-racing-result.png' });
  reject({ getMimeType: () => 'text/html' });
  reject({ hasUserGesture: () => false });
  for (const value of ['', 'null', 'https://outside.test', 'http://localhost:17833']) reject({ getInitiatorOrigin: () => value });
  assert.equal(trustedResultDownload(item, {}, frame, window, origin), false);
  assert.equal(trustedResultDownload(item, contents, { url: origin }, window, origin), false);
  assert.equal(trustedResultDownload(item, contents, frame, { ...window, isDestroyed: () => true }, origin), false);
  frame.url = 'https://outside.test/';
  assert.equal(trustedResultDownload(item, contents, frame, window, origin), false);
});
