"""Underpass links the streamed world draws at grade, because the way into a whole district depends on them.

OSM tags a short underpass `tunnel=yes` (layer -1) beneath plain layer 0 roads. The world draws decks over ground and nothing
under ground, so by policy (bridge_policy.exclusion_reason) every tunnel is left out, and every street that is only reachable
through one with it. The structure planner cannot lift a deck over such a short link in a dense interchange (its approaches
are too short, whichever way round the deck is chosen), and a true tunnel (trench, walls, lid, portals) is a new structure type.

tunnels.json lists the few tunnels that matter. Each is solved and drawn as an ordinary street on layer 0: its profile follows
the roads it crosses (no vertical clearance is invented), where it crosses them there is a shared surface, and the graph treats
the crossing as the same surface (a one-way link that can be driven over the crossing roads' asphalt, no turn is created). It is
counted and reported in the bake summary as an at-grade underpass. Not for ramps that need a real separation.

Applied once, where roads enter an area's profile database (profiles.py), and again when a cell loads its roads (idempotent),
so caches solved before an entry was added still behave."""
import json
from pathlib import Path

PLAN=json.loads((Path(__file__).parent/'tunnels.json').read_text())
AT_GRADE={e['tunnel'] for e in PLAN}

def apply(road):
    """Re-tag a road dict in place as the plan says; returns it."""
    if road['id'] in AT_GRADE:road.update(tunnel=False,bridge=False,layer=0)
    return road
