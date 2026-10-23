"""Explicit positive-DEM inland prerequisite; never substitutes a coastline.

Existing coastal bakes still require their OSM mainland mask. An inland bake
keeps source water polygons/tags separately and never draws them at sea level.
"""
import json
import math
from pathlib import Path
import numpy as np
from shapely.geometry import box,shape,mapping,GeometryCollection
from rasterio.windows import from_bounds
from rasterio.warp import transform_bounds
from elevation import Elevation
from ingest import sha
from model import project,unproject
from influence import ROAD_QUERY_HALO


def validate_facts(source_bounds,required_bounds,coast_count,dem_min,dem_missing,margin=10):
    a,b,c,d=required_bounds;w,s,e,n=source_bounds
    west,north=unproject(a,b);east,south=unproject(c,d)
    if west<w or east>e or south<s or north>n:raise ValueError('Inland source coverage missing')
    if coast_count:raise ValueError('Inland source contains coastline; use resolved coastal branch')
    if dem_missing or not math.isfinite(dem_min) or dem_min<=margin:raise ValueError('Inland DEM missing/nonpositive/sea ambiguity')


class VerifiedInland:
    def __init__(self,source,dems,extent,source_bounds):
        # A source feature beyond ROAD_QUERY_HALO cannot influence a cell;
        # Field may overfetch512m but the documented width/support bound is256m.
        required=extent.buffer(ROAD_QUERY_HALO).bounds
        coast=source.execute("SELECT count(*) FROM objects WHERE kind='coast'").fetchone()[0]
        support=extent.buffer(512).bounds;w,n=unproject(support[0],support[1]);e,s=unproject(support[2],support[3])
        elevation=Elevation(dems)
        try:
            if len(elevation.datasets)!=1:raise ValueError('Inland validation requires one complete covering pinned raster')
            dataset=elevation.datasets[0];bounds=transform_bounds('EPSG:4326',dataset.crs,w,s,e,n)
            if bounds[0]<dataset.bounds.left or bounds[1]<dataset.bounds.bottom or bounds[2]>dataset.bounds.right or bounds[3]>dataset.bounds.top:raise ValueError('Inland DEM does not cover full requested support')
            window=from_bounds(*bounds,dataset.transform);left=math.floor(window.col_off)-1;top=math.floor(window.row_off)-1;right=math.ceil(window.col_off+window.width)+1;bottom=math.ceil(window.row_off+window.height)+1
            from rasterio.windows import Window
            values=dataset.read(1,window=Window(left,top,right-left,bottom-top),masked=True)
            missing=bool(np.ma.getmaskarray(values).any()) or not bool(np.isfinite(values).all())
            minimum=float(values.min())
            validate_facts(source_bounds,required,coast,minimum,missing)
        finally:elevation.close()
        self.bounds=support;self.land=box(*support);self.waters=[]
        for identifier,data in source.execute("SELECT id,data FROM objects WHERE kind='water' ORDER BY id"):
            row=json.loads(data);geometry=shape(row['geometry'])
            if geometry.intersects(self.land):self.waters.append((identifier,geometry,row['tags']))
        self.evidence=dict(schema=1,mode='verified-positive-dem-inland',sourceBounds=source_bounds,sourceSupportMetres=ROAD_QUERY_HALO,demSupportBounds=list(support),demMinimum=minimum,demMargin=10,coastlineCount=0,dem=[dict(name=Path(p).name,sha256=sha(p)) for p in dems],waterCount=len(self.waters),waterRendering='mapped masks retained; no sea-level substitution')

    def baseline(self,x,z,y):
        if not(self.bounds[0]<=x<=self.bounds[2] and self.bounds[1]<=z<=self.bounds[3]) or not math.isfinite(y) or y<=10:raise ValueError('Inland sample outside verified DEM support')
        return y

    def water(self,cell,roads):
        return GeometryCollection()  # ocean only; never invent inland water level

    def water_masks(self,cell):
        x,z=(v*512 for v in cell);area=box(x,z,x+512,z+512)
        return [dict(id=identifier,tags=tags,geometry=mapping(geometry.intersection(area))) for identifier,geometry,tags in self.waters if geometry.intersects(area)]
