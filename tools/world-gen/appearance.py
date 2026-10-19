"""Offline flat-colour inputs; no lights, textures, vegetation or props required."""
import math

# sRGB source colours; packing converts these to linear vertex/material colours.
BUILDINGS=['#f4f5f3','#e6e9ea','#d4d9de','#c5d2dc','#c7d5cf','#d8cbd1']
# The runtime classifies ground by these colours (src/athens-detail.js GROUND_CLASS_COLOURS, kept equal by tools/athens-detail.test.mjs):
# each class gets its own procedural texture and a boundary between two classes blends softly through interpolated colour.
TERRAIN=dict(earth='#958669',rock='#868e96',scrub='#6f7b55',sand='#d8c78e',urban='#86837a',grass='#8ba352',forest='#3d5638')
URBAN_LANDUSE=('commercial','retail','industrial','garages','railway')
GRASS_LANDUSE=('grass','meadow','recreation_ground','village_green','cemetery','allotments')
GRASS_LEISURE=('park','garden','pitch','playground','golf_course','nature_reserve')
SCRUB_LANDUSE=('orchard','olive_grove','farmland','vineyard')


def linear(hex_colour):
    values=[int(hex_colour[i:i+2],16)/255 for i in (1,3,5)]
    return [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values]


def ground_category(height,slope,landuse='',natural='',coast_distance=math.inf,leisure=''):
    """OSM land class of a ground point: urban paving, earth/gravel (residential and the default), grass and parks,
    scrub, pine forest floor, sand, bare rock (steep or tagged)."""
    if landuse in URBAN_LANDUSE:return 'urban'
    if natural in ('beach','sand') or (coast_distance<35 and height<8 and slope<.15):return 'sand'
    if natural in ('bare_rock','scree','shingle') or slope>.42 or height>900:return 'rock'
    if landuse=='forest' or natural=='wood':return 'forest'
    if leisure in GRASS_LEISURE or landuse in GRASS_LANDUSE or natural=='grassland':return 'grass'
    if natural in ('scrub','heath') or landuse in SCRUB_LANDUSE:return 'scrub'
    return 'earth'


def ground_colour(x,z,height,slope,landuse='',natural='',coast_distance=math.inf,leisure=''):
    """Slope is rise/run, height and coast distance metres; deterministic world-space variation."""
    category=ground_category(height,slope,landuse,natural,coast_distance,leisure)
    # Continuous globally positioned colour field: independent tile baking has no colour seam.
    variation=1+.035*math.sin(x/43+math.sin(z/71))+.025*math.sin(z/29+x/113)
    return category,[min(1,max(0,c*variation)) for c in linear(TERRAIN[category])]
