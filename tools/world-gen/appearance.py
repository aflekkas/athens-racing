"""Offline flat-colour inputs; no lights, textures, vegetation or props required."""
import math

# sRGB source colours; packing converts these to linear vertex/material colours.
BUILDINGS=['#f4f5f3','#e6e9ea','#d4d9de','#c5d2dc','#c7d5cf','#d8cbd1']
TERRAIN=dict(earth='#8d826a',rock='#8e9395',scrub='#717d65',sand='#b5ad8a',urban='#797d80')


def linear(hex_colour):
    values=[int(hex_colour[i:i+2],16)/255 for i in (1,3,5)]
    return [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values]


def ground_colour(x,z,height,slope,landuse='',natural='',coast_distance=math.inf):
    """Slope is rise/run, height and coast distance metres; deterministic world-space variation."""
    category='earth'
    if landuse in ('residential','commercial','retail','industrial','garages','railway'):
        category='urban'
    elif natural in ('beach','sand') or (coast_distance<35 and height<8 and slope<.15):
        category='sand'
    elif natural in ('bare_rock','scree','shingle') or slope>.55 or height>900:
        category='rock'
    elif natural in ('scrub','heath','grassland','wood') or landuse in ('forest','grass','meadow','orchard','olive_grove','farmland','vineyard'):
        category='scrub'
    # Continuous globally positioned colour field: independent tile baking has no colour seam.
    variation=1+.035*math.sin(x/43+math.sin(z/71))+.025*math.sin(z/29+x/113)
    return category,[min(1,max(0,c*variation)) for c in linear(TERRAIN[category])]
