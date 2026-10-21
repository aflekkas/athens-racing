# Route guidance implementation

The visual module consumes the exact `GuidanceDataV1` contract in [the unified-world plan §7](plans/unified-world.md). It does not project a racing cursor, infer compiled-route decisions, validate progress, route a vehicle, or modify physics. RouteNavigation/course owns off-route notices, wrong-way state, earned rejoin positions, and legal return paths.

```js
import {RouteGuidance} from './src/route-guidance.js';
const guidance = new RouteGuidance(scene, {
  contact: (x, z, referenceY, layer) => stream.contact(x, z, {
    referenceY, layer, requiredFlags: 1,
  }),
});
guidance.setRoute(guidanceDataV1);
guidance.onTileActivated(key);
guidance.update({cursorS, occurrence, lap, position, heading, origin, activeCells, isRace});
// Within the HUD's existing world-to-minimap transform:
guidance.drawMinimap(context, pixelsPerMetre);
guidance.onTileRemoved(key);
guidance.setRoute(null); // removes and disposes the route
// At session teardown:
guidance.dispose();
```

`setRoute` accepts the plan's `version`, route/world identity, `closed`, `lengthM`, `polyline`, `decisions`, `start`, and `finish` without converting their station/width/occurrence metadata. `update` consumes the plan's per-frame object; `isRace` must explicitly be true. Otherwise instances, decisions, and minimap route strokes are absent. `activeCells` is optional when tile callbacks already maintain membership. No world-detail or lighting setting controls gameplay paint. Origin subtraction happens once at the paint mesh.

Four 1.2 × 2.0 m chevrons sit at −35/−20/−8/+8 m from each supplied decision, in directed route order. Preview starts up to 80 m before it (48–80 m according to movement speed), then fades through 8 m after it. Rejected exits are metadata only: there are no crosses, arrows, barriers, walls or colliders on those branches. The minimap highlights the selected turn and dims travelled route.

One shared original 128 × 64 procedural alpha atlas and unlit `MeshBasicMaterial`, opacity 0.36 with normal blending, draw every chevron and 0.30 m timing stripe in one `InstancedMesh`. Four corner contacts conform each quad to asphalt; any unavailable corner rejects that instance. Supplied legal lane widths bound the stripe, including asymmetric widths. A closed circuit has one shared stripe. Active-cell instances compact within `[cursor−40,cursor+250]`, wrapping at a circuit seam; at most 128 quads / 256 triangles, with about 44 KiB of atlas/buffer storage. Texture and buffers are disposed with the route.

`decisionPoints(polyline, roadGraph)` is separately exported for authoring/tests and the development preview. It accepts world graph registries or plain directed node/edge arrays. It tests actual junction choices, layer/height, direction and graph turn restrictions, excludes incoming-only/reverse arms and degree-two portals, and falls back to a 25° heading change over 12 m where matching graph data is absent. Its `wrong` arrays describe real legal alternate exits; the renderer never draws them. Compiled race routes supply their own §7 decisions instead.

The opt-in `?map=athens&guidance=1` is a development guidance preview, labelled ROUTE DEMO, using Syntagma → Panepistimiou → Omonia → Stadiou → Syntagma. It is not a timed race or Phase 1 runtime. Ordinary `?map=athens` creates no guidance module. The preview uses the same public §7 interface as the forthcoming runtime, with cached resident-street minimap paths. Its local authoring projection is cosmetic and never used for earned race progress.

Demo geometry source: existing Athens OSM directed graph, OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). No world cells or third-party imagery are included. The procedural atlas is original code-generated artwork.
