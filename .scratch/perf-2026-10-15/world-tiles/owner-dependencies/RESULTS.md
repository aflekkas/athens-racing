# Bounded building-owner dependencies

A real generator audit reached at least 218 cells from Glyfada [4,25] by recursively following positive-area building owners. AWT/1 now defines direct owners only: a requested base and its direct owner set; owner-only loads do not recursively expand. The same set controls loading, pins, contact readiness and teleport completion. Local terrain/contact/clipped graph do not depend on owners.

The regression uses a 218-cell chain: before, one base reaches 218; after, it loads exactly two, becomes ready and can teleport without loading the third. An independently pinned/requested second cell adds only the third; shared pin release remains balanced. Cyclic owner lists remain valid; missing, duplicate and self owner references are rejected. This is a deterministic scheduler/contract check, not a playable-city or frame-time benchmark. There is no visible change.

All six required gates passed on the archived candidate in gates.json. npm test passed; standalone physics: 1,142 passed, 0 failed. Compressed full logs are adjacent. Streaming integration, default-on acceptance metrics and the real 20-minute stress gate remain outstanding.
