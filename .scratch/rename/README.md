# ATHENS RACING rename evidence

Title screen captures: `title-1280.png` (1280×800), `title-1920.png` (1920×1080), `title-390.png` (390×844). These exercise the real game source and title hero on Low graphics. All were visually inspected; the mobile logo clears the hero panel.

`browser-tab-title.png` captures the real headed Chromium window through Xvfb/scrot. `browser-tab-title.json` records the complete document title, since Chrome truncates the narrow tab label.

`share-card.png` exercises `renderResultCard` with a real title-hero renderer frame and fixture result data (not a completed race). The branding, download filename and share title are updated. `browser-report.json` records zero page errors and no horizontal overflow at the three sizes.

The two regenerated JPEGs in `assets/share/` use the same A mark, red slash and the actual rendered MINI. The favicon raster assets already contain only the A mark, so only the SVG accessible label needed changing.

Intentional legacy identifiers: the three Worker name entries in `wrangler.jsonc`, plus the Worker names and fallback URLs documented in `deploy/README.md`. Public canonical/share links and the repository URL use the new domain/repository. Storage keys, Durable Object classes, bindings, D1 identifiers and service-worker cache prefixes are preserved.

Reproduce: from an isolated archive with dependencies linked, run `bash tools/browser-slot.sh node .scratch/rename/capture.mjs`. Headed Chromium, Xvfb and scrot are required. The script also regenerates the OG JPEGs. Release-gate logs and exit markers are in `gates/`.
