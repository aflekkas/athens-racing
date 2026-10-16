# Private two-cell browser check

Revision: `9fb9370614c7b2b2ded2685274406cfb1d090aa1c656bc02e7d3ec3da6ac44d3`. Source stays developmentOnly:true, releaseReady:false. The car meshes are the existing game model, with traffic controlled by the new adapter probe rather than native traffic AI/vehicle physics.

- Compressed tile transfer: 2736034 bytes; retained packet/GPU accounting: 10939811 bytes (excludes JS graph objects; full residency accounting remains pending).
- 310 directed edges / 172 nodes / 7 turn rules installed. 230 anchors passed runtime car-footprint checks; GPS example traverses seven legal fragments. Generated contact spawn and validated tow passed.
- Four traffic probes / 120 steps / zero missing contacts / zero load failures or WebGL errors. No observed long tasks during the short probe movement interval. This is not physical driving acceptance or the 20-minute stress gate.
- Uploads: 105 calls, <=32 KiB per chunk; longest activation step 1.8 ms, longest measured upload call 1.6 ms. A 4 ms target is not a hard per-call guarantee.
- Known generator road-grade defects remain. Exact topology/contact identity does not validate drivable slopes.

`glyfada-tow.png` is the reviewed evidence image. The fixed spawn camera was occluded by a tall building; that view is not selected as visual evidence. The private viewer needs camera collision/orbit controls before use beyond diagnostics.

Private browser check repeated after rebasing over interiors 5b633e4: four probes, 120 moves, zero missing contacts/errors/observed long tasks; peak activation step 1.8 ms. Latest screenshot uses the resulting game car model.
