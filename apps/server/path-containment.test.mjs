import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathIsWithin } from '../../server/path-containment.mjs';

test('POSIX confinement rejects sibling prefixes, traversal, relative paths and the root itself', () => {
  assert.equal(pathIsWithin('/game', '/game/assets/car.bin', path.posix), true);
  assert.equal(pathIsWithin('/', '/index.html', path.posix), true);
  for (const candidate of ['/game', '/game-other/assets/a', '/game/assets/../../private/a', '/private', 'assets/a', '/game/\0a']) assert.equal(pathIsWithin('/game', candidate, path.posix), false, candidate);
});

test('Windows drive paths compare case-insensitively while rejecting siblings and other drives', () => {
  const root = 'C:\\Games\\Athens';
  for (const candidate of ['C:\\Games\\Athens\\assets\\car.bin', 'c:\\games\\ATHENS\\world\\cell.bin.gz', 'C:/Games/Athens/data/map.json']) assert.equal(pathIsWithin(root, candidate, path.win32), true, candidate);
  for (const candidate of [root, 'C:\\Games\\Athens-other\\asset', 'D:\\Games\\Athens\\asset', 'C:\\Games\\Athens\\..\\secret', 'C:assets\\car.bin', 'assets\\car.bin']) assert.equal(pathIsWithin(root, candidate, path.win32), false, candidate);
});

test('Windows UNC confinement handles server/share case and rejects a different share or server', () => {
  const root = '\\\\SERVER\\Share\\Athens';
  for (const candidate of ['\\\\server\\share\\athens\\world\\cell', '\\\\SERVER\\Share\\Athens\\assets\\a']) assert.equal(pathIsWithin(root, candidate, path.win32), true, candidate);
  for (const candidate of ['\\\\server\\ShareOther\\Athens\\a', '\\\\other\\Share\\Athens\\a', '\\\\server\\share\\AthensSibling\\a', '\\\\server\\share\\Athens\\..\\secret', root]) assert.equal(pathIsWithin(root, candidate, path.win32), false, candidate);
});
