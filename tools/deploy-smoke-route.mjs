import assert from 'node:assert/strict';
import { buildCourse, courseComplete, courseFrame, observeCourse } from '../src/course.js';

export const SMOKE_SPEED = 120;
export const SMOKE_STEP = 6;
// Six metre samples remain continuous even when two arrive in one packet.
// Use the shared road/tunnel geometry, rather than inventing world positions.
export function smokeDrive(event, geometry) {
  const course = buildCourse(event, geometry), samples = [];
  const length = Math.abs(event.s1 - event.s0), dir = event.dir || 1;
  for (let distance = 0; ; distance = Math.min(distance + SMOKE_STEP, length + 2)) {
    const s = event.s0 + dir * distance, frame = courseFrame(geometry, s, dir);
    const u = dir * (frame.halfWidth - 2) / 2;
    const offset = frame.lanes ? 0 : u;
    const state = { x: frame.x - frame.tz * offset, y: frame.y, z: frame.z + frame.tx * offset,
      yaw: Math.atan2(frame.tx * dir, frame.tz * dir), s, u, vLong: SMOKE_SPEED, vLat: 0, steer: 0, rpm: 5000, gear: 5 };
    observeCourse(course, state, distance / SMOKE_SPEED);
    assert.equal(course.onRoute, true, `Smoke path leaves the tracked route at station ${s}`);
    samples.push(state);
    if (distance === length + 2) break;
  }
  assert.equal(courseComplete(course), true, 'Smoke path must cover the whole route, including the finish');
  return { samples, finishedAt: course.finishedAt };
}
