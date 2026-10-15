# Brand badges

SVG artwork from Simple Icons 11.0.0, distributed under CC0-1.0 (LICENSE.md).
These are monochrome vector recreations, tinted silver or gold in atlas.svg;
the Lamborghini/Porsche outer shield paths supply dark enamel backing;
no downloaded raster photographs or extracted game assets are used.
CC0 does not grant trademark rights. Trademark clearance remains the project
owner’s decision. Set enabled:false for any brand in src/brand-badges.js to
replace it with the original generic triangle medallion on every mounting.

Each source is pinned to the release; originals are retained unchanged:

- alfaromeo: https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/alfaromeo.svg — CC0-1.0.
- bmw: https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/bmw.svg — CC0-1.0.
- fiat: https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/fiat.svg — CC0-1.0.
- honda: https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/honda.svg — CC0-1.0.
- lamborghini: https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/lamborghini.svg — CC0-1.0.
- mazda: https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/mazda.svg — CC0-1.0.
- mercedes: https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/mercedes.svg — CC0-1.0.
- mini: https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/mini.svg — CC0-1.0.
- porsche: https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/porsche.svg — CC0-1.0.
- seat: https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/seat.svg — CC0-1.0.
- skoda: https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/skoda.svg — CC0-1.0.
- toyota: https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/toyota.svg — CC0-1.0.
- volkswagen: https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/volkswagen.svg — CC0-1.0.

Atlas: 512×512 RGBA, shared by all badge materials, 1 MiB plus mipmaps
(about 1.33 MiB total). 128-pixel cells include 22-pixel gutters. Anisotropy
is 1 on every preset; no extra render targets or per-car texture copies.
Existing vehicle LOD hides these small details with the rest of the cabin
and exterior. Rebuild atlas.svg from the retained SVGs preserving their
24×24 viewBoxes and uniform scale; never fill a rectangular badge by stretching.
Generic artwork is original project artwork under CC0-1.0.

Rebuild: `node tools/build-brand-badges.mjs`. Brand flags take effect on
new vehicle construction; reload after changing configuration. The current
18-entry garage contains no Mazda; Mazda artwork/mapping is ready for an MX-5
entry without pretending one is currently selectable.
