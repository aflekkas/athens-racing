# `.reference/` — local-only reference material (never committed)

This directory holds **third-party or copyrighted reference media** that must
never be committed to the repository:

- Street View / Google Maps / Google Earth captures
- web images, photos, downloaded images, map-service tiles
- recordings and any other media without a clear licence

It is git-ignored (see `.gitignore`; only this `README.md` is tracked).
Keep the same subfolder layout as the evidence it came from
(e.g. `.reference/psychiko-realism/...`).

Recovering files: past commits may still contain old copies; do not recommit
them — copy them here instead. Evidence screenshots of our own game belong in
`.scratch/`, not here. Committed audio or images need their source and
licence recorded (`docs/audio-sources.md` covers audio).
