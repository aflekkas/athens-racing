#!/usr/bin/env python3
"""Fetch a terrain elevation grid for the Glyfada -> Limanakia corridor.
Source: EU-DEM v1.1 (25 m) via the public OpenTopoData API (api.opentopodata.org).
Sea cells come back as null and are stored as -5. Saved to data/raw/dem.json."""
import json, math, os, time, urllib.request

LAT0, LON0 = 37.835, 23.77
S, W, N, E = 37.784, 23.722, 37.886, 23.828
STEP = 60.0  # metres
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "raw", "dem.json")
CACHE = OUT + ".partial"
phi = math.radians(LAT0)
mlat = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
mlon = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
x0, x1 = (W - LON0) * mlon, (E - LON0) * mlon
z0, z1 = -(N - LAT0) * mlat, -(S - LAT0) * mlat
nx = int((x1 - x0) / STEP) + 1
nz = int((z1 - z0) / STEP) + 1
pts = [(LAT0 - (z0 + j * STEP) / mlat, LON0 + (x0 + i * STEP) / mlon) for j in range(nz) for i in range(nx)]
print(nx, nz, len(pts), "points", flush=True)
elev = json.load(open(CACHE)) if os.path.exists(CACHE) else []
for k in range(len(elev), len(pts), 100):
    chunk = pts[k:k + 100]
    url = "https://api.opentopodata.org/v1/eudem25m?locations=" + "|".join(f"{a:.6f},{b:.6f}" for a, b in chunk)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ParaliakiRaceGame/3.0"}), timeout=60) as r:
                res = json.loads(r.read())["results"]
            elev += [(-5.0 if q["elevation"] is None else round(q["elevation"], 1)) for q in res]
            break
        except Exception as e:
            print("retry", k, e, flush=True); time.sleep(2 + attempt * 4)
    else:
        raise SystemExit("failed")
    json.dump(elev, open(CACHE, "w"))
    if k % 2000 == 0: print(k, flush=True)
    time.sleep(1.05)
json.dump({"source": "EU-DEM v1.1 (25 m) via api.opentopodata.org", "x0": x0, "z0": z0, "step": STEP, "nx": nx, "nz": nz,
           "lat0": LAT0, "lon0": LON0, "h": elev}, open(OUT, "w"))
os.remove(CACHE)
print("saved", OUT)
