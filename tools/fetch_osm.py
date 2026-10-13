#!/usr/bin/env python3
"""Fetch OpenStreetMap data for the Glyfada -> Limanakia route via Overpass.
Raw responses are stored in data/raw/ so the game never calls a live API.
Data (c) OpenStreetMap contributors, ODbL."""
import json, sys, time, urllib.parse, urllib.request, os

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
BBOX = "37.784,23.728,37.882,23.825"  # S,W,N,E
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "raw")

QUERIES = {
    "roads": f"""[out:json][timeout:120];
(way({BBOX})[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|pedestrian|footway|cycleway|path|track|steps)$"];);
out body geom qt;""",
    "coast": f"""[out:json][timeout:120];
(way({BBOX})[natural=coastline];);
out body geom qt;""",
    "buildings": f"""[out:json][timeout:180];
(way({BBOX})[building];);
out body geom qt;""",
    "features": f"""[out:json][timeout:180];
(
  way({BBOX})[natural~"^(water|beach|scrub|bare_rock|cliff|wood|heath|grassland|sand|rock|tree_row)$"];
  relation({BBOX})[natural~"^(water|beach|scrub|wood|bare_rock)$"];
  way({BBOX})[landuse~"^(grass|forest|residential|commercial|retail|recreation_ground|meadow|construction)$"];
  way({BBOX})[leisure~"^(park|marina|pitch|golf_course|garden|beach_resort|slipway|swimming_pool)$"];
  way({BBOX})[man_made~"^(pier|breakwater|groyne|lighthouse)$"];
  way({BBOX})[amenity~"^(parking|fuel)$"];
  node({BBOX})[natural~"^(tree|peak|beach|cape|bay)$"];
  node({BBOX})[place~"^(suburb|neighbourhood|locality|village|town|hamlet|island|islet)$"];
  node({BBOX})[tourism];
  node({BBOX})[amenity~"^(cafe|restaurant|bar|fuel|pharmacy|bank|fast_food|ice_cream|bus_station)$"];
  node({BBOX})[highway~"^(traffic_signals|bus_stop|crossing|street_lamp)$"];
  node({BBOX})[shop];
  node({BBOX})[leisure];
  way({BBOX})[tourism];
  way({BBOX})[place~"^(island|islet)$"];
);
out body geom qt;""",
}

def fetch(name, q):
    for m in MIRRORS:
        for attempt in range(2):
            try:
                print(f"[{name}] {m} attempt {attempt+1}", flush=True)
                req = urllib.request.Request(m, data=urllib.parse.urlencode({"data": q}).encode(),
                                             headers={"User-Agent": "ParaliakiRaceGame/3.0 (local build script)"})
                with urllib.request.urlopen(req, timeout=200) as r:
                    body = r.read()
                d = json.loads(body)
                if "remark" in d and not d.get("elements"):
                    raise RuntimeError(d["remark"])
                print(f"  ok: {len(d['elements'])} elements, {len(body)//1024} KB")
                return d
            except Exception as e:
                print("  failed:", str(e)[:200])
                time.sleep(4)
    raise SystemExit(f"could not fetch {name}")

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    names = sys.argv[1:] or list(QUERIES)
    for n in names:
        d = fetch(n, QUERIES[n])
        with open(os.path.join(OUT, n + ".json"), "w") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
