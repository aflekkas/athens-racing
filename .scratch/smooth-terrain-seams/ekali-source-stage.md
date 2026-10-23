# Connected Ekali source stage (2026-10-23)

This is a local source/data preparation result. It is not route, geographic, visual or release acceptance. Parent owns integration and publication.

The complete twenty-cell source manifest is `ekali-complete-source/manifest.json`, SHA `41da1ae7e99346363d58582b8a2f69259e12b38515d13a8bd85811ffe3807167`. All packets retain source world `athens-ekali-development`, revision `12935f07f7dceacdfbf96d7a9de8fa10ae88f49fcf673fb08c6c8dfe5cb0cc31`. The provisional composed Athens manifest is `ekali-complete-source/athens-provisional.json`, SHA `4f1f69bd05b9a8c38747c12df5563f06387f43a197118698ee2a854a33cf043c`, revision `358325da4b458b4b15c2f419aed0c204da91e714f4a011991cbecbdb23d2e3a8`, region `basin`, 1,766 cells. Both remain development-only and releaseReady=false.

Twenty cells replace two old boundary cells and add eighteen. All 1,746 other original entries, the seven accepted Kifissia cells and all 297 original Megara/Penteli entries are exactly preserved in this overlay. Parent-authorized independent Megara graph-surface binding repair may later change those explicit packets' hashes while retaining authored physical geometry; that repair is not included here.

## Checks completed

- All 20 packets pass ordinary `packTiles`: physical surface, road section, bridge/guard/headroom/anchor, bore and within-run strict seam gates. No limits or exclusions were relaxed. The remaining fourteen-cell run exited zero under its bounded CPU allocation.
- 3,755,541 shoulder samples; 500,771 triangles; 5,270,494 compressed bytes; 158 mesh draw records; 1,608 source building pieces.
- `audit-ekali-seams.mjs`: all 33 shared edges, including three to unchanged original cells, pass strict structural boundary equality and contact lookup. 75,798 contact samples, zero failures/missing contacts; maximum same-surface difference 0.0000192723 m. Exact source identities/hashes are validated before metadata.world is normalized only for the composed-frame comparison. Geometry and tolerances are unchanged.
- `audit-ekali-complete-portals.mjs`: 151 internal shared graph copies, zero internal or outer conflicts. All 13 old north-boundary portal IDs and XYZ coordinates are exact, including Rodon north/south and Thiseos part identities. This is shared graph identity proof, not the complete route/directed reachability acceptance.
- Composed compressed bytes: 458,671,360. Worst 2×2 resident descriptors: 30,407,222 bytes versus existing 64 MiB cap; worst cluster remains the original `-10,-10` vicinity. No browser performance claim.
- One bounded source bridge group `w15631655:0` (bridge sources `w15631655:0`, `w15631710:0`) is emitted across four cells. Three crossing cells report minimum clearance 5.4714806376 m; the fourth contains approaches only. These structural passes do not establish geographic profile fidelity.

Source receipt, canonical official OSM closure, actual Copernicus DEM crop and pinned generator hashes remain in the one terrain task cache. No inferred DEM, invented connector or source clipping is used. No infill database is generated for Ekali. Source limitations remain: 29 invalid building footprints were rejected, one unassembled/outside building relation is counted, and positive-elevation inland mode retains actual water masks without inventing water-plane heights. Full crown/building/road clearance and final world scenery integration remain separate combined-candidate checks.

## Independent comfort blocker

A separate actual-contact comfort probe over the twenty new source packets found 19/20 cells exceed the unchanged 0.5 m affine-corrected 32 m chord limit somewhere on their roads (22,466 samples, zero nulls). Maximum is 1.136911 m at `19,-31`. Core-cell maxima are 0.746413 m (`17,-29`), 0.624580 m (`18,-30`) and 0.811323 m (`18,-29`); this whole-cell audit does not establish which exact route occurrences fail. Of the four protected structure cells, `17,-31` passes (0.441099 m); `17,-30`, `16,-30` and `16,-29` fail (0.597848/0.839445/0.614858 m). These protected failures require explicit separate review. No physical pass is presented as a comfort pass, and no threshold or protection was changed. Full results: `ekali-source-comfort.json`.

## What remains

The route child must compile against the new composed identity, run unchanged corridor/run-in/runout/grid/contact/recovery proofs and drive the actual route in game. The runtime width fix must be included when regenerating per-point width results; do not hand-edit geometry hashes. Actual screenshots, final combined source clean-archive gates, all-route recompile/sidecars and release binding are pending. Existing all-world terrain smoothing remains blocked by the rejected Lycabettus profile; this source expansion does not resolve that independent blocker or the Kifisias six-metre geographic depression audit.

Tools/model: Codex gpt-6.1-sol implemented the source assembly, generator fixes, mathematical projection experiment and proof scripts. The parent and other Sol children own runtime width, route, loading/recovery, scenery, infill and infrastructure integration.

## Evidence and retained data

Tracked reduced reports: `ekali-contact-seams.json`, `ekali-portals-complete-source.json`, `ekali-source-accounting.json`; reproducible scripts under `proof-tools/`. Source assembly receipt is `ekali-complete-source/assembly-source.json` (retained local data). Large packets stay out of Git. Earlier six-cell/provisional files remain immutable for concurrent route reads; final cells are hard links to the same owned packet bytes rather than duplicate large caches. No browser/server/heavy process remains active after the CPU END handoff. Shared original cache remains loader-owned and read-only.
