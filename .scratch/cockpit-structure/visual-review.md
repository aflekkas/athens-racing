# Visual review — 2026-10-16

Personally inspected all 18 final fixture contact sheets (70 before/after pairs) and all eight Riviera sheets (32 before/after pairs), plus the full SVJ and 911 rain captures and the changelog picture. The new painted deck, connected dash and pillar/header frame surround the view. Instruments remain legible through the low polygon wheel; the hub badges are present. Native fleet vehicles have larger dash/wheel proportions. Convertibles retain only the windscreen frame and door tops; bikes show tank/fairing, mounted clocks and handlebars. No hands or cabin characters appear.

The strict 20% opaque allowance means the bonnet is a narrow visible strip and much of the wheel occupies the bottom band. The frame is intentionally slim. All final semantic masks independently confirm visible structural roles, and the 70 clear-view masks range from 82.64462890625% to 92.85830078125% with no auxiliary flags.

Rain review: the old grey lens blobs and detached shader blades are gone. Small sparse texture droplets sit inside the windscreen frame; physical blades pivot at its bottom edge. Mirrors have structural mounting bars. The before/after rain scenes use the same saved eye and quaternion.

A large red rectangle in several world frames was investigated rather than hidden. It occurs in the before baseline too. Exact road.js START-gantry reconstruction and the saved-camera ray probe identify its red leg; start-post-probe.json records equal before/after distances. This is a source reconstruction probe, not a claim of a full-scene runtime raycast.

The world harness saved every expected frame without page errors and closed browser contexts. Its leftover server heartbeat was then stopped by terminating only its own Node process; world-process.exit records 143. capture-completion.json distinguishes this cleanup from the successful image capture. The generator now closes the whole application. The final 70-config browser audit exits 0.
