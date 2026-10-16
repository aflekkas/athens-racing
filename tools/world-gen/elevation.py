"""Read only small windows of pinned Copernicus/EU-DEM rasters."""
from functools import lru_cache
import math
from pathlib import Path
import rasterio
from rasterio.windows import Window
from rasterio.warp import transform
from model import unproject


class Elevation:
    def __init__(self, paths):
        self.datasets = [rasterio.open(p) for p in sorted(map(str,paths))]
        if not self.datasets:
            raise ValueError('No elevation rasters supplied')
        self.metadata = [dict(path=Path(d.name).name,crs=str(d.crs),resolution=list(d.res),nodata=d.nodata) for d in self.datasets]

    @lru_cache(maxsize=256)
    def block(self, index, col, row):
        return self.datasets[index].read(1,window=Window(col*128,row*128,128,128),masked=True)

    def pixel(self, index, col, row):
        d=self.datasets[index]
        col=max(0,min(d.width-1,col)); row=max(0,min(d.height-1,row))
        value=self.block(index,col//128,row//128)[row%128,col%128]
        if getattr(value,'mask',False) or not math.isfinite(float(value)):
            raise ValueError(f'DEM nodata at {d.name}:{col},{row}')
        return float(value)

    def height(self,x,z):
        lon,lat=unproject(x,z)
        for i,d in enumerate(self.datasets):
            if d.crs == rasterio.crs.CRS.from_epsg(4326):xx,yy=lon,lat
            else:
                xx,yy=transform('EPSG:4326',d.crs,[lon],[lat]);xx=xx[0];yy=yy[0]
            if not (d.bounds.left<=xx<d.bounds.right and d.bounds.bottom<yy<=d.bounds.top):
                continue
            col,row=~d.transform*(xx,yy);col-=.5;row-=.5
            c=math.floor(col);r=math.floor(row);u=col-c;v=row-r
            return ((1-u)*self.pixel(i,c,r)+u*self.pixel(i,c+1,r))*(1-v)+((1-u)*self.pixel(i,c,r+1)+u*self.pixel(i,c+1,r+1))*v
        raise ValueError(f'No DEM coverage for {lon},{lat}; never substitute a flat zero plane')

    def close(self):
        self.block.cache_clear()
        for dataset in self.datasets:dataset.close()
