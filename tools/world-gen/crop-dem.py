#!/usr/bin/env python3
"""Crop cached DEMs to a fixed bbox with one source-pixel interpolation halo."""
import argparse
import json
import math
import os
from pathlib import Path
import rasterio
from rasterio.windows import Window, from_bounds
from rasterio.warp import transform_bounds
from fetch import sha


def crop(source,destination,bounds):
    inputs=dict(sourceSha256=sha(source),bounds=bounds,algorithm='pixel-window-halo1-v1')
    record=destination.with_suffix('.source.json')
    if destination.exists():
        meta=json.loads(record.read_text())
        if meta['inputs']!=inputs or sha(destination)!=meta['sha256']:raise ValueError('Crop cache mismatch')
        return meta
    with rasterio.open(source) as src:
        b=transform_bounds('EPSG:4326',src.crs,*bounds)
        b=(max(src.bounds.left,b[0]),max(src.bounds.bottom,b[1]),min(src.bounds.right,b[2]),min(src.bounds.top,b[3]))
        if b[0]>=b[2] or b[1]>=b[3]:raise ValueError('DEM does not overlap requested bounds')
        w=from_bounds(*b,src.transform)
        left=max(0,math.floor(w.col_off)-1);top=max(0,math.floor(w.row_off)-1)
        right=min(src.width,math.ceil(w.col_off+w.width)+1);bottom=min(src.height,math.ceil(w.row_off+w.height)+1)
        window=Window(left,top,right-left,bottom-top)
        profile=src.profile.copy();profile.update(width=right-left,height=bottom-top,transform=src.window_transform(window),compress='deflate',predictor=3 if src.dtypes[0].startswith('float') else 2,tiled=True,blockxsize=256,blockysize=256)
        tmp=destination.with_suffix('.partial.tif')
        with rasterio.open(tmp,'w',**profile) as dst:
            for _,block in dst.block_windows(1):
                data=src.read(window=Window(left+block.col_off,top+block.row_off,block.width,block.height))
                dst.write(data,window=block)
            dst.update_tags(**src.tags())
        os.replace(tmp,destination)
    result=dict(inputs=inputs,sha256=sha(destination),bytes=destination.stat().st_size,verticalDatum='EGM2008',dataset='Copernicus GLO-30 DSM')
    record.write_text(json.dumps(result,sort_keys=True,indent=2)+'\n');return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('destination',type=Path)
    p.add_argument('--bounds',nargs=4,type=float,default=[22.8,37.4,24.7,38.6]);a=p.parse_args()
    print(json.dumps(crop(a.source,a.destination,a.bounds)))
