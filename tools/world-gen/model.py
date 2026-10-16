"""Deterministic OSM normalization. No runtime/game dependencies."""
import hashlib
import math
import re
from appearance import BUILDINGS as PALETTE

VERSION = 1
PROJECTION = dict(lat0=37.98, lon0=23.73, mlat=111320.0, mlon=111320*math.cos(math.radians(37.98)))
WIDTHS = dict(motorway=10.5, trunk=9, primary=8, secondary=7, tertiary=6.5,
              unclassified=6, residential=5.6, living_street=4.5, service=4, road=5)
WIDTHS.update({k + '_link': 4.5 for k in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary')})
HEIGHTS = dict(residential=9.6, commercial=9.6, retail=6.4, industrial=8, garages=3.2)


def project(lon, lat):
    return ((lon-PROJECTION['lon0'])*PROJECTION['mlon'], -(lat-PROJECTION['lat0'])*PROJECTION['mlat'])


def unproject(x, z):
    return (PROJECTION['lon0']+x/PROJECTION['mlon'], PROJECTION['lat0']-z/PROJECTION['mlat'])


def number(value):
    match = re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(m|metres|meters|ft|feet|mph|km/h|kph)?\s*', str(value or ''), re.I)
    if not match:
        return None
    n = float(match[1]); unit = (match[2] or '').lower()
    return n * (0.3048 if unit in ('ft', 'feet') else 1.609344 if unit == 'mph' else 1)


def road_tags(tags):
    h = tags.get('highway')
    if h not in WIDTHS or tags.get('area') == 'yes':
        return None
    # Specific motorcar rules override general access, including affirmative overrides.
    access = next((tags[k] for k in ('motorcar', 'motor_vehicle', 'vehicle', 'access') if k in tags), 'yes')
    direction = tags.get('oneway:motorcar', tags.get('oneway:motor_vehicle', tags.get('oneway')))
    if direction is None:
        direction = 'yes' if tags.get('junction') in ('roundabout', 'circular') or h in ('motorway','motorway_link') else 'no'
    uncertain = direction not in ('yes', '1', 'true', '-1', 'reverse', 'no', '0', 'false')
    conditional = {k: v for k, v in tags.items() if ':conditional' in k or k in ('opening_hours',)}
    if conditional:
        uncertain = True
    one = -1 if direction in ('-1', 'reverse') else 1 if direction in ('yes', '1', 'true') else 0
    width = number(tags.get('width:carriageway', tags.get('width')))
    lanes = number(tags.get('lanes'))
    width_source = 'width'
    if width is None or not 1 <= width <= 60:
        width_source = 'lanes' if lanes is not None and 1 <= lanes <= 16 else 'class'
        width = lanes*3.2 if width_source == 'lanes' else WIDTHS[h]
    speed = number(tags.get('maxspeed'))
    speeds = {k: number(tags.get('maxspeed:'+k)) for k in ('forward', 'backward')}
    try:
        layer = int(tags.get('layer', '0'))
    except ValueError:
        layer = 0; uncertain = True
    bridge = tags.get('bridge', 'no') not in ('no', 'false', '0')
    tunnel = tags.get('tunnel', 'no') not in ('no', 'false', '0')
    return dict(highway=h, width=round(width, 3), widthSource=width_source, lanes=lanes,
                oneway=one, access=access, public=access in ('yes', 'permissive', 'designated') and not uncertain,
                conditional=conditional, review=uncertain, layer=layer, bridge=bridge, tunnel=tunnel,
                speed=speed, speedForward=speeds['forward'], speedBackward=speeds['backward'],
                surface=tags.get('surface', 'asphalt'), name=tags.get('name', ''), ref=tags.get('ref', ''),
                # Keep physically separate carriageways separate: proximity is never topology.
                carriagewayGroup=(tags.get('ref') or tags.get('name') or '') + ':' + str(layer))


def building_height(tags, landuse):
    height = number(tags.get('height'))
    if height is not None and 1 <= height <= 1000:
        return height, 'height'
    levels = number(tags.get('building:levels'))
    if levels is not None and 0 < levels <= 200:
        return levels*3.2, 'levels'
    kind = tags.get('building')
    if kind in ('garage', 'garages', 'shed'):
        return 3.2, 'building-default'
    return HEIGHTS.get(landuse, 9.6), 'landuse-default' if landuse in HEIGHTS else 'default'


def palette_index(identifier):
    return int.from_bytes(hashlib.sha256(str(identifier).encode()).digest()[:4], 'big') % len(PALETTE)
