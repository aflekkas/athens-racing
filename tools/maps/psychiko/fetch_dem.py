#!/usr/bin/env python3
"""Fetch the real Psychiko terrain grid from EU-DEM v1.1 (25 m).

Output is resampled at 100 m in the game's local metre coordinates. Coastal
no-data cells use the existing map pipeline's -5 m sea convention. Resume uses
dem.json.partial; the residential route is wholly inland.
Source and attribution: https://www.opentopodata.org/datasets/eudem/
"""
import argparse
import json
import math
from pathlib import Path
import time
import urllib.error
import urllib.request

LAT0, LON0 = 38.009, 23.775
S, W, N, E = 37.992, 23.758, 38.027, 23.799
STEP = 100.0
OUT = Path(__file__).resolve().parent / "raw" / "dem.json"
CACHE = OUT.with_suffix(".json.partial")
SOURCE = "EU-DEM v1.1 (25 m) via api.opentopodata.org; bilinear samples at 100 m; no inland missing samples permitted"


def fetch_route():
    """Query the DEM directly at road stations, avoiding terrain-grid smoothing."""
    path = OUT.parent / "route-points.json"
    points = json.loads(path.read_text())
    route = []
    for k in range(0, len(points), 100):
        chunk = points[k:k + 100]
        url = "https://api.opentopodata.org/v1/eudem25m?interpolation=bilinear&locations=" + "|".join(
            f"{p['lat']:.7f},{p['lon']:.7f}" for p in chunk)
        for attempt in range(6):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "ParaliakiRacing-Psychiko/1.0"})
                with urllib.request.urlopen(req, timeout=60) as response:
                    payload = json.loads(response.read())
                if payload.get("status") != "OK" or len(payload.get("results", [])) != len(chunk):
                    raise ValueError(f"Incomplete route response: {payload}")
                if any(q.get("elevation") is None for q in payload["results"]):
                    raise ValueError("Route must have real measured elevation at every station")
                route.extend(dict(p, elevation=round(q["elevation"], 2))
                             for p, q in zip(chunk, payload["results"]))
                break
            except urllib.error.HTTPError as exc:
                if exc.code == 429:
                    raise SystemExit("OpenTopoData rate limit while fetching road elevations") from exc
                print(f"route retry at {k}: {exc}", flush=True)
                time.sleep(2 + attempt * 4)
            except Exception as exc:
                print(f"route retry at {k}: {exc}", flush=True)
                time.sleep(2 + attempt * 4)
        else:
            raise SystemExit("Road elevation fetch failed")
        print(f"Route {len(route)}/{len(points)}", flush=True)
        time.sleep(1.05)
    output = OUT.parent / "route-dem.json"
    output.write_text(json.dumps(route, separators=(",", ":")))
    heights = [p["elevation"] for p in route]
    print(f"Saved {output}; start {heights[0]:.2f}, end {heights[-1]:.2f}, "
          f"range {min(heights):.2f}–{max(heights):.2f} m", flush=True)


def main():
    phi = math.radians(LAT0)
    mlat = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
    mlon = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
    x0, x1 = (W - LON0) * mlon, (E - LON0) * mlon
    z0, z1 = -(N - LAT0) * mlat, -(S - LAT0) * mlat
    nx, nz = int((x1 - x0) / STEP) + 1, int((z1 - z0) / STEP) + 1
    pts = [(LAT0 - (z0 + j * STEP) / mlat, LON0 + (x0 + i * STEP) / mlon)
           for j in range(nz) for i in range(nx)]
    print(f"Grid {nx} x {nz}: {len(pts)} real elevation samples", flush=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    elev = json.loads(CACHE.read_text()) if CACHE.exists() else []
    if len(elev) > len(pts) or any(not isinstance(h, (int, float)) or not math.isfinite(h) for h in elev):
        raise ValueError("Invalid partial cache")
    for k in range(len(elev), len(pts), 100):
        chunk = pts[k:k + 100]
        url = "https://api.opentopodata.org/v1/eudem25m?interpolation=bilinear&locations=" + "|".join(
            f"{lat:.6f},{lon:.6f}" for lat, lon in chunk)
        for attempt in range(6):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "ParaliakiRacing-Psychiko/1.0"})
                with urllib.request.urlopen(req, timeout=60) as response:
                    payload = json.loads(response.read())
                if payload.get("status") != "OK":
                    raise ValueError(f"OpenTopoData status: {payload}")
                results = payload["results"]
                if len(results) != len(chunk):
                    raise ValueError("Incomplete elevation response")
                missing = [q for q in results if q.get("elevation") is None]
                # The only allowed no-data region is the eastern coastal strip;
                # fail rather than invent heights for missing mountain data.
                if any(q["location"]["lng"] < 23.970 for q in missing):
                    raise ValueError(f"Missing inland elevations: {missing}")
                elev.extend(-5.0 if q["elevation"] is None else round(q["elevation"], 1) for q in results)
                break
            except urllib.error.HTTPError as exc:
                if exc.code == 429:
                    raise SystemExit("OpenTopoData rate limit: partial cache preserved; choose a documented real DEM fallback") from exc
                print(f"retry at {k}: {exc}", flush=True)
                time.sleep(2 + attempt * 4)
            except Exception as exc:
                print(f"retry at {k}: {exc}", flush=True)
                time.sleep(2 + attempt * 4)
        else:
            raise SystemExit("DEM fetch failed; partial cache preserved")
        CACHE.write_text(json.dumps(elev, separators=(",", ":")))
        if k % 1000 == 0 or len(elev) == len(pts):
            print(f"{len(elev)}/{len(pts)}", flush=True)
        time.sleep(1.05)
    OUT.write_text(json.dumps({"source": SOURCE, "x0": x0, "z0": z0, "step": STEP,
                              "nx": nx, "nz": nz, "lat0": LAT0, "lon0": LON0,
                              "mlat": mlat, "mlon": mlon, "h": elev}, separators=(",", ":")))
    CACHE.unlink(missing_ok=True)
    print(f"Saved {OUT}; range {min(elev):.1f}–{max(elev):.1f} m", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--route-only", action="store_true", help="Fetch direct DEM heights for raw/route-points.json")
    args = parser.parse_args()
    if args.route_only:
        fetch_route()
    else:
        main()
