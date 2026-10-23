"""Road cross-section model: OSM tags -> one consistent, class-banded street profile.

Pure Python (no geometry libraries). The generator calls cross_section() once per
OSM road part; everything the renderer draws across the road - carriageway width,
lane count, markings, kerbs, sidewalks, surface - comes from that one record, so
no street ever needs hand tuning. docs/world-roads.md documents the defaults table.

Lateral convention used everywhere: positive = the geographic RIGHT of the way's
direction (this is shapely's "left" in the projected x/z frame, where z points
south). OSM sidewalk:left / sidewalk:right and mapped footways use the same sides.
"""
from model import number

VERSION = 1
KERB_RISE = .12     # metres: a real, drivable kerb (<= 15 cm step, <= 30 degree gate)
KERB_RUN = .30      # horizontal bevel, so the kerb face is ~22 degrees

# class: (lane width, lanes one-way, lanes two-way, min width, max width, default sidewalk metres)
# Widths are carriageway only (asphalt), kerb to kerb. The band [min, max] is the hard
# range every generated road of the class must fall in, whatever its tags say.
CLASSES = {
    'motorway':      (3.6, 3, 4, 7.2, 21.0, 0.0),
    'motorway_link': (3.5, 1, 2, 4.5, 10.0, 0.0),
    'trunk':         (3.5, 2, 4, 7.0, 21.0, 2.0),
    'trunk_link':    (3.4, 1, 2, 4.5, 10.0, 0.0),
    'primary':       (3.5, 2, 2, 6.6, 17.5, 2.5),
    'primary_link':  (3.4, 1, 2, 4.5, 10.0, 0.0),
    'secondary':     (3.3, 2, 2, 6.2, 14.0, 2.2),
    'secondary_link': (3.3, 1, 2, 4.5, 10.0, 0.0),
    'tertiary':      (3.2, 1, 2, 5.6, 12.0, 2.0),
    'tertiary_link': (3.2, 1, 2, 4.5, 10.0, 0.0),
    'unclassified':  (3.0, 1, 2, 5.0, 8.0, 1.8),
    'residential':   (3.0, 1, 2, 4.8, 8.0, 1.8),
    'living_street': (3.0, 1, 2, 4.2, 6.0, 1.5),
    'service':       (2.4, 1, 2, 3.2, 7.0, 0.0),
    'road':          (3.0, 1, 2, 4.5, 7.0, 1.5),
}
SIDEWALK_MIN, SIDEWALK_MAX = 1.2, 4.0
UNPAVED = {'unpaved', 'gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'grass', 'mud', 'sand', 'compacted', 'pebblestone', 'woodchips'}
PAVING = {'paving_stones', 'sett', 'cobblestone', 'unhewn_cobblestone', 'paved', 'bricks', 'brick', 'concrete:plates', 'concrete:lanes', 'metal', 'wood'}
CONCRETE = {'concrete'}
ONEWAY_YES = ('yes', '1', 'true')
ONEWAY_REVERSE = ('-1', 'reverse')
FAST_CLASSES = ('motorway', 'trunk', 'primary', 'secondary')


def surface_class(tags):
    """asphalt | concrete | paving | unpaved (default asphalt: Athens roads without a surface tag)."""
    value = tags.get('surface', '').split(';')[0].strip().lower()
    if value in UNPAVED:
        return 'unpaved'
    if value in PAVING:
        return 'paving'
    if value in CONCRETE:
        return 'concrete'
    if not value and tags.get('highway') in ('track',):
        return 'unpaved'
    return 'asphalt'


def _integer(value, low, high):
    n = number(value)
    return int(n) if n is not None and float(n).is_integer() and low <= n <= high else None


def lane_counts(tags, klass, direction):
    """(total, forward, backward, source) for a road; direction: 1 one-way forward, -1 reverse, 0 two-way."""
    lane_width, lanes_one, lanes_two, low, high, _ = CLASSES[klass]
    total = _integer(tags.get('lanes'), 1, 16)
    forward, backward = _integer(tags.get('lanes:forward'), 0, 16), _integer(tags.get('lanes:backward'), 0, 16)
    if direction:
        # One carriageway: every lane runs the way's travel direction.
        count = total or (forward if direction > 0 else backward) or lanes_one
        return count, (count if direction > 0 else 0), (0 if direction > 0 else count), 'lanes' if total else 'class'
    if forward is not None and backward is not None and forward + backward > 0:
        return forward + backward, forward, backward, 'lanes'
    count = total or lanes_two
    count = max(2, count)  # a two-way road always carries one lane each way
    forward = count // 2 if count % 2 == 0 else (count + 1) // 2
    return count, forward, count - forward, 'lanes' if total else 'class'


def sidewalk_sides(tags):
    """Explicit tag decision per side: 'yes' | 'no' | 'separate' | None (untagged). left/right are geographic."""
    sides = {'left': None, 'right': None}
    def decode(value):
        value = (value or '').lower()
        if value in ('both', 'yes', 'left;right', 'right;left'): return 'yes'
        if value in ('no', 'none', 'neither'): return 'no'
        if value == 'separate': return 'separate'
        return None
    base = decode(tags.get('sidewalk'))
    if base:
        sides['left'] = sides['right'] = base
    if tags.get('sidewalk') in ('left', 'right'):
        sides[tags['sidewalk']] = 'yes'
        sides['right' if tags['sidewalk'] == 'left' else 'left'] = 'no'
    both = decode(tags.get('sidewalk:both'))
    if both:
        sides['left'] = sides['right'] = both
    for side in sides:
        value = decode(tags.get('sidewalk:' + side))
        if value:
            sides[side] = value
    return sides


def sidewalk_width(tags, side, mapped_width, default):
    for key in ('sidewalk:%s:width' % side, 'sidewalk:both:width', 'sidewalk:width'):
        value = number(tags.get(key))
        if value is not None and SIDEWALK_MIN <= value <= SIDEWALK_MAX:
            return value, 'tag'
    if mapped_width is not None and SIDEWALK_MIN <= mapped_width <= SIDEWALK_MAX:
        return mapped_width, 'mapped'
    return default, 'class'


def parking(tags):
    """Recorded, not drawn: parking:lane[:side] -> 'parallel'|'diagonal'|'perpendicular' per side, else None."""
    result = {}
    for side in ('left', 'right'):
        value = tags.get('parking:lane:' + side, tags.get('parking:lane:both', tags.get('parking:lane:' + side + ':parallel')))
        if value in (None, 'no', 'no_parking', 'no_stopping', 'separate'):
            result[side] = None
        else:
            result[side] = value if value in ('parallel', 'diagonal', 'perpendicular') else 'parallel'
    return result


def dash_pattern(speed, klass):
    """(dash, gap) metres for a dashed line: short urban dashes, long fast-road dashes."""
    if speed is None:
        speed = 80 if klass in ('motorway', 'trunk') else 50
    return (3., 3.) if speed <= 50 else (3., 9.) if speed <= 90 else (6., 12.)


def cross_section(tags, hints=None):
    """Return the section dict for one OSM road.

    hints: optional {'left': width|True|None, 'right': ...} from separately mapped
    footway=sidewalk ways snapped to this street (build-sections.py). A bridge or
    tunnel never gets sidewalks: the owner-approved bridge exception uses a narrow
    guarded shoulder instead.
    """
    hints = hints or {}
    highway = tags.get('highway')
    klass = highway if highway in CLASSES else 'road'
    lane_width, _, _, low, high, sidewalk_default = CLASSES[klass]
    direction = tags.get('oneway:motorcar', tags.get('oneway:motor_vehicle', tags.get('oneway')))
    if direction is None:
        direction = 'yes' if tags.get('junction') in ('roundabout', 'circular') or klass in ('motorway', 'motorway_link') else 'no'
    one = -1 if direction in ONEWAY_REVERSE else 1 if direction in ONEWAY_YES else 0
    lanes, forward, backward, lane_source = lane_counts(tags, klass, one)
    width_tag = None
    for key in ('width:carriageway', 'width', 'est_width'):
        value = number(tags.get(key))
        if value is not None and 1 <= value <= 60:
            width_tag = value; break
    if lane_source == 'lanes' or width_tag is None:
        width, width_source = lanes * lane_width, lane_source
    else:
        # No lane tag: a tagged width sets the lane count. It is still clamped to the class band below.
        lanes = max(1 if one else 2, round(width_tag / lane_width))
        forward, backward = (lanes, 0) if one > 0 else (0, lanes) if one < 0 else ((lanes + 1) // 2, lanes // 2)
        width, width_source = width_tag, 'width'
    width = round(min(high, max(low, width)), 3)
    structure = tags.get('bridge', 'no') not in ('no', 'false', '0') or tags.get('tunnel', 'no') not in ('no', 'false', '0')
    surface = surface_class(tags)
    paved = surface != 'unpaved'
    speed = number(tags.get('maxspeed'))
    section = dict(v=VERSION, **{'class': klass}, surface=surface, width=width, widthSource=width_source, lanes=lanes,
                   lanesForward=forward, lanesBackward=backward, laneWidth=round(width / lanes, 3), oneway=one)
    tagged, sidewalks, sources = sidewalk_sides(tags), {}, {}
    for side in ('left', 'right'):
        hint = hints.get(side)
        if structure or not paved:
            wanted, source = False, 'none'
        elif tagged[side] == 'no':
            wanted, source = False, 'tag'
        elif tagged[side] == 'yes':
            wanted, source = True, 'tag'
        elif hint:
            wanted, source = True, 'mapped'
        else:  # untagged, or tagged separate with no footway found in the data: class default
            wanted = sidewalk_default > 0
            source = 'class' if wanted else 'none'
        mapped = hint if isinstance(hint, (int, float)) and not isinstance(hint, bool) else None
        sidewalks[side] = round(sidewalk_width(tags, side, mapped, sidewalk_default or 1.8)[0], 3) if wanted else 0.
        sources[side] = source
    section.update(sidewalk=sidewalks, sidewalkSource=sources, kerb=KERB_RISE if any(sidewalks.values()) else 0.)
    # Markings: lane dividers wherever there are neighbouring same-direction lanes, a centre line on
    # two-way streets wide enough for two vehicles, edge lines on fast roads.
    fast = klass in FAST_CLASSES or (speed or 0) >= 70
    if not paved or surface == 'paving':
        centre = lane = edge = 'none'
    else:
        lane = 'dashed' if (forward > 1 or backward > 1) else 'none'
        if one:
            centre = 'none'
        elif lanes >= 4 and klass != 'service':
            centre = 'double'
        elif width < 5.2 or klass in ('living_street', 'service'):
            centre = 'none'
        else:
            centre = 'solid' if klass in FAST_CLASSES and (speed or 50) > 50 else 'dashed'
        edge = 'solid' if fast and width >= 6 else 'none'
        if klass.endswith('_link') and lanes < 2:
            edge = 'none'
    # Explicit virtual/unmarked lanes override inferred longitudinal separators.
    # OSM lane_markings excludes outer road-edge lines and independent crossings.
    if tags.get('lane_markings') == 'no':
        centre = lane = 'none'
    section['markings'] = dict(centre=centre, lane=lane, edge=edge, dash=list(dash_pattern(speed, klass)))
    section.update(parking=parking(tags), lit=None if 'lit' not in tags else tags['lit'] in ('yes', '24/7', 'automatic'),
                   maxspeed=speed)
    return section


def width_band(klass):
    """(min, max) carriageway width of a class; unknown classes use 'road'."""
    entry = CLASSES.get(klass, CLASSES['road'])
    return entry[3], entry[4]


def export_table():
    """The defaults table as plain JSON (fixtures/road-classes.json), for the JS conformance tests and docs."""
    return dict(kerbRise=KERB_RISE, kerbRun=KERB_RUN, sidewalkRange=[SIDEWALK_MIN, SIDEWALK_MAX],
                classes={k: dict(laneWidth=v[0], lanesOneWay=v[1], lanesTwoWay=v[2], minWidth=v[3], maxWidth=v[4], sidewalk=v[5]) for k, v in CLASSES.items()})


if __name__ == '__main__':
    import json
    print(json.dumps(export_table(), indent=1, sort_keys=True))
