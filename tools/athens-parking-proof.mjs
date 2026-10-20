// Clearance proof for the parked cars (docs/world-beauty.md, step 5): runs the real tile pipeline on a local bake and measures, at every tow anchor, the gap between a
// 4.5 x 1.9 m player car and every parked car or scooter, and per street class (carriageway half width w) how far the cars stand from the axis.
// usage: node tools/athens-parking-proof.mjs <bake cells dir> [cell keys...]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeTilePack } from '../src/world-tile-codec.js';
import { tileTables } from '../src/world-tile-format.js';
import { prepareTilePacket } from '../src/world-tile-worker.js';
import { asphaltIndex } from '../src/world-tile-asphalt.js';
import { boxCorners as rect, boxGap as gap } from '../src/world-tile-parking.js';
export { gap };
if (process.argv[1] && process.argv[1].endsWith('athens-parking-proof.mjs')) {
  const dir = process.argv[2], keys = process.argv.slice(3), man = JSON.parse(readFileSync(dir + '/manifest.json'));
  const classes = {}, report = { anchors: 0, minGap: Infinity, below: 0, cars: 0, scooters: 0 };
  for (const key of keys.length ? keys : Object.keys(man.tiles)) {
    const entry = { ...man.tiles[key] }, buf = gunzipSync(readFileSync(dir + '/' + entry.url.slice(2)));
    const pack = await decodeTilePack(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), buf.length * 2);
    const p = prepareTilePacket(pack, { entry, world: man.world, revision: man.revision, cell: key.split(',').map(Number) }), ext = p.metadata.extensions?.worldDetail?.parking;
    if (ext == null) continue;
    const rows = p.arrays[ext], t = tileTables(p), AT = t.anchorTransforms, E = t.edges, P = t.edgePoints, A = asphaltIndex(t), boxes = [];
    for (let i = 0; i < rows.length; i += 5) { const sc = rows[i + 4] >> 3; boxes.push({ x: rows[i], z: rows[i + 2], r: rect(rows[i], rows[i + 2], rows[i + 3], sc ? .55 : 2.15, sc ? .3 : .9), sc }); if (sc) report.scooters++; else report.cars++; }
    let tileMin = Infinity;
    for (let a = 0; a < AT.length / 4; a++) {
      const x = AT[a * 4], z = AT[a * 4 + 2], yaw = AT[a * 4 + 3]; report.anchors++;
      // the game's heading convention: a vehicle at yaw moves along (-sin yaw, -cos yaw), so its long axis is (sin yaw, cos yaw), like the rows' own yaw
      for (const orient of [yaw]) { const pr = rect(x, z, orient, 2.25, .95); for (const b of boxes) { if (Math.hypot(b.x - x, b.z - z) > 12) continue; const g = gap(pr, b.r); tileMin = Math.min(tileMin, g); report.minGap = Math.min(report.minGap, g); if (g <= .5) report.below++; } }
    }
    for (const b of boxes) { // nearest edge axis -> the street class of the car and its distance from the axis
      let best = null;
      for (let e = 0; e < E.length / 10; e++) for (let k = E[e * 10 + 3]; k < E[e * 10 + 3] + E[e * 10 + 4] - 1; k++) { const ax = P[k * 3], az = P[k * 3 + 2], bx = P[k * 3 + 3], bz = P[k * 3 + 5], dx = bx - ax, dz = bz - az, q = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((b.x - ax) * dx + (b.z - az) * dz) / q)), px = ax + u * dx, pz = az + u * dz, d = Math.hypot(b.x - px, b.z - pz); if (!best || d < best.d) best = { d, px, pz, nx: (b.x - px) / (d || 1), nz: (b.z - pz) / (d || 1) }; }
      if (!best) continue; const w = A.reach(best.px, best.pz, best.nx, best.nz, 12); if (w < 0) continue;
      const cls = w < 3 ? 'w<3 (road under 6 m)' : w < 4 ? '3<=w<4' : w < 5 ? '4<=w<5' : 'w>=5 (road 10 m+)', c = classes[cls] || (classes[cls] = { n: 0, inner: [], overRoad: 0 });
      c.n++; c.inner.push(best.d - (b.sc ? .3 : .9)); if (best.d - (b.sc ? .3 : .9) < w) c.overRoad++;
    }
    console.log(key, 'cars+scooters', boxes.length, 'min gap to a player box at any anchor in the cell', tileMin === Infinity ? 'n/a (none within 12 m)' : tileMin.toFixed(2) + ' m', 'obstacle walls', p.obstacleIndex.segments.length / 6);
  }
  console.log(JSON.stringify({ ...report, minGap: +report.minGap.toFixed(2) }));
  for (const [cls, c] of Object.entries(classes)) { c.inner.sort((a, b) => a - b); console.log(cls.padEnd(22), 'n', c.n, 'inner flank from axis: min', c.inner[0].toFixed(2), 'median', c.inner[c.inner.length >> 1].toFixed(2), '-> lane left between two rows >=', (2 * c.inner[0]).toFixed(1), 'm; cars with the flank still over the asphalt', c.overRoad); }
}
