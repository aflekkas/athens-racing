import assert from 'node:assert/strict';
import { resolveMap } from '../server/map-definitions.mjs';

// Validate the complete deployed catalogue before creating a lobby. Track
// versions describe geometry; an old event catalogue can share that version.
export function verifySessionCatalogue(meta, data, offered) {
  const resolved = resolveMap(meta, data);
  assert.equal(resolved.track.version, offered.track.version, `${meta.id}: deployed geometry must match the server track`);
  const events = offered.events || [];
  const serverIds = events.map(e => e.id).sort(), resolvedIds = [...resolved.definitions.keys()].sort();
  assert.deepEqual(serverIds, resolvedIds, `${meta.id}: MP catalogue mismatch; server=${JSON.stringify(serverIds)} resolved=${JSON.stringify(resolvedIds)}`);
  assert.deepEqual(events.map(e => e.type).sort(), ['free', 'sprint'], `${meta.id}: expected exactly Quick Race and Free Roam`);
  for (const event of events) {
    const definition = resolved.definitions.get(event.id);
    assert.equal(event.type, definition.type, `${meta.id}/${event.id}: mode mismatch`);
    for (const field of ['s0', 's1', 'dir', 'len', 'routeKey']) assert.equal(event[field], definition[field], `${meta.id}/${event.id}: catalogue ${field} mismatch`);
  }
  const event = events.find(e => e.type === 'sprint');
  assert.ok(event, `${meta.id}: Quick Race missing`);
  return { event, definition: resolved.definitions.get(event.id), resolved };
}
