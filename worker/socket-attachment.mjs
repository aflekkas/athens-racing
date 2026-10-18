// Arena storage owns full course state. Socket attachments only need
// bounded connection data for token lookup and the no-arena recovery fallback.
export function socketAttachment(data) {
  // Keep a conservative 2KiB budget within the 16KiB attachment limit. Enforcement claims,
  // recovery caches, courses and long numeric telemetry grow during a race.
  const keys = ['identity', 'id', 'token', 'protocol', 'lobbyCode', 'stateAt', 'messages', 'window', 'finish', 'dnf', 'loaded'];
  const connection = Object.fromEntries(keys.filter(k => data[k] !== undefined).map(k => [k, data[k]]));
  const round = value => typeof value === 'number' ? Math.round(value * 10000) / 10000
    : Array.isArray(value) ? value.map(round) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round(v)])) : value;
  connection.state = round(data.state);
  if (data.course) { const { raceId, reached, validProgress, previousTime, finishedAt, lastRoad } = data.course; connection.courseCursor = round({ raceId, reached, validProgress, previousTime, finishedAt, lastRoad }); }
  const size = () => new TextEncoder().encode(JSON.stringify(connection)).byteLength;
  // Cosmetics remain in arena storage/lobby metadata. Drop them from the
  // per-socket fallback first; always retain pose, motion epoch and course.
  for (const key of ['tyreTelemetry', 'driver', 'engineFailureReason']) if (size() > 1980 && connection.state) delete connection.state[key];
  if (size() > 1980 && connection.state) {
    const physical = ['vy', 'angularX', 'angularY', 'angularZ', 'bodyQ', 'bodyDynamic', 'air', 'x', 'y', 'z', 's', 'u', 'yaw', 'vLong', 'vLat', 'steer', 'rpm', 'gear', 'nitro', 'damage', 'reverse', 'motionEpoch', 'sampleTime', 'sampleAge', 'recoveryUntil'];
    connection.state = Object.fromEntries(physical.filter(k => connection.state[k] !== undefined).map(k => [k, connection.state[k]]));
  }
  return connection;
}
