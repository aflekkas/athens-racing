#!/usr/bin/env python3
"""Freeze the Copernicus DEM GLO-30 window under the whole Psychiko terrain grid.

Range-reads only the needed pixels from the public AWS Cloud Optimized GeoTIFFs
(no full degree tile is downloaded or kept) and writes raw/copernicus.json.gz:
one window per degree tile, heights in integer centimetres, EGM2008 metres.
build.mjs mosaics these windows, applies the shared sigma-20 m Gaussian and
derives the lap, side roads, junctions, roundabouts and terrain from that field.

Needs rasterio, e.g.:
  uv run --no-project --with rasterio python3 tools/maps/psychiko/fetch_copernicus.py
Source: https://copernicus-dem-30m.s3.amazonaws.com/readme.html
"""
import gzip
import json
import math
from pathlib import Path

import rasterio
from rasterio.windows import Window, from_bounds

# Terrain grid bbox (fetch_dem.py / fetch_osm.py) plus a margin for the Gaussian.
S, W, N, E = 37.992, 23.758, 38.027, 23.799
MARGIN = .002
OUT = Path(__file__).resolve().parent / "raw" / "copernicus.json.gz"
URL = "https://copernicus-dem-30m.s3.amazonaws.com/{0}/{0}.tif"


def main():
    s, w, n, e = S - MARGIN, W - MARGIN, N + MARGIN, E + MARGIN
    windows = []
    env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_TIMEOUT="60")
    for lat in range(math.floor(s), math.floor(n) + 1):
        for lon in range(math.floor(w), math.floor(e) + 1):
            name = f"Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM"
            bounds = (max(w, lon), max(s, lat), min(e, lon + 1), min(n, lat + 1))
            with rasterio.Env(**env), rasterio.open(URL.format(name)) as src:
                win = from_bounds(*bounds, src.transform)
                col, row = max(0, math.floor(win.col_off)), max(0, math.floor(win.row_off))
                win = Window(col, row, min(src.width - col, math.ceil(win.width) + 2), min(src.height - row, math.ceil(win.height) + 2))
                a = src.read(1, window=win)
                t = src.window_transform(win)
                if not (a > -100).all():
                    raise SystemExit(f"{name}: no-data inside the Psychiko window")
                windows.append({"tile": name, "window": [int(v) for v in (win.col_off, win.row_off, win.width, win.height)],
                                "nx": int(a.shape[1]), "nz": int(a.shape[0]),
                                "lon0": t.c + t.a / 2, "lat0": t.f + t.e / 2, "dlon": t.a, "dlat": t.e,
                                "cm": [int(round(float(v) * 100)) for v in a.flatten()]})
                print(name, windows[-1]["window"], flush=True)
    payload = {"source": "Copernicus DEM GLO-30 Public (2021 release), AWS COG range reads",
               "license": "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved",
               "datum": "EGM2008", "bbox": [s, w, n, e], "fetched": "2026-10-19", "windows": windows}
    with gzip.GzipFile(str(OUT), "wb", mtime=0) as f:
        f.write(json.dumps(payload, separators=(",", ":")).encode())
    print(OUT, OUT.stat().st_size, "bytes", flush=True)


if __name__ == "__main__":
    main()
