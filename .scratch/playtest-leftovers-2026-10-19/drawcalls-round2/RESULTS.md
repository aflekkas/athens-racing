# Draw calls, round 2 (instancing / coarser chunks), Riviera, 4x CPU throttle, 640x360

Before = prod 409982b2, after = this change, run side by side in one go (tools/lowend-profile.mjs, scripts alongside). Counts are deterministic per scenario; the submit time is noisy on a shared machine.

| scenario | draw calls per frame before → after | frames without mirror pass | triangles (k) | render submit ms (4× CPU) |
|---|---|---|---|---|
| potato, default (2 rivals, 2 traffic, police) | 420 → 307 | 395 → 281 | 1257 → 1262 | 101 → 82 |
| low, default (2 rivals, 2 traffic, police) | 345 → 313 | 320 → 288 | 1261 → 1279 | 81 → 74 |
| potato, world only (no traffic, no police) | 322 → 287 | 301 → 266 | 1242 → 1258 | 76 → 62 |
| low, world only (no traffic, no police) | 334 → 300 | 311 → 277 | 1252 → 1269 | 42 → 75 |

Reading the table: the default potato "before" ranged between 340 (three earlier invocations of the same tree) and 420 (the last ones): that scenario puts a traffic car with a full-detail model (about 70 calls) near the player in some runs, so use the world-only rows for the like-for-like change: potato 322 → 287 (-11%), low 334 → 300 (-10%). The default rows at the two stable `before` values give 340 → 307-328 on potato and 345-349 → 313-334 on low.

Not reached: under 200. Even an empty scene (no rivals, no traffic, no police) draws 225 calls on potato: race road 47 (five materials per 1 km chunk, drawn to the horizon), terrain 25 (one mesh per surface layer), the player cockpit about 44 (owner-locked POV), parked cars 33, osm roads 8, signal masts / halos 17. The scenery that can be instanced (lamps, posts, kerb furniture, trees, bins, signs) already is: it is 25-40 calls, and every class already draws it in coarse chunks.
