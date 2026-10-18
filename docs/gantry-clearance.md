# Starting clear of gantry posts

`src/start-placement.js` owns initial placement only. Free roam and driving modes start 20 m past the event's start station, facing along the road in the existing lane (centre on a closed circuit). Race solo starts and the first grid row start 30 m before the line; later rows retain the existing length-aware spacing and lane assignment. Multiplayer waiting cars and race grids use the same helper. Open routes clamp placements to their usable bounds; closed routes keep their unwrapped station for lap progress.

The extra race approach keeps even the forward cockpit eye of a bus more than 20 m from a start post. Event resolution, timing stations, route progress, auto-tow placement and recovery logic are unchanged. This increases the initial approach distance by 26 m; it does not move the event itself.

`src/gantry-legs.js` shares the rendered road/event leg geometry with the clearance guard. Megara's single cantilever pier stays in its existing batch, using the shared dimensions and transform. The refactor adds no geometry, textures, draw calls or per-frame work.

`tools/gantry-clearance.test.mjs` loads all four maps and their event catalogue, builds every catalogue car's real cockpit eye at default FOV and zero seat adjustment, and tests solo spawns plus all eight multiplayer grid slots. The central region is NDC x ±0.9, y −0.8…0.85. Each post's projected bounds are sampled with actual Three.js raycasts, rejecting any hit under 20 m. The original Riviera MINI spawn must fail the same detector, proving that the reported upper-right post is covered. Live builders and placement entry points are also checked for use of the guarded helpers.

The guard targets fresh spawns. Saved-session resume, user teleporting and tow recovery deliberately retain their existing positions.
