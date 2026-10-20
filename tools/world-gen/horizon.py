#!/usr/bin/env python3
"""The far mountain ring's data: a coarse, max-pooled height grid of the whole Attica basin from the cached DEM.

`horizon.py CACHE OUT.bin` writes `assets/athens/horizon.bin`: eight little-endian int32 (nx, nz, x0, z0, step, quantum, 0, 0),
then nx*nz bytes, row-major from z0 (north) to the south, each the largest DEM height in its 250 m cell in units of `quantum`
metres (6). The runtime (src/athens-horizon.js) walks rays across it to draw Hymettus, Penteli, Parnitha, Aigaleo and the hills
of the city on the horizon. World metres: x east, z south (the projection every cell uses). 36 KB gzipped."""
import struct,sys
from pathlib import Path
import numpy as np,rasterio

LAT0,LON0,MLAT,MLON=37.98,23.73,111320.,87745.27512677578
X0,X1,Z0,Z1,STEP,QUANTUM=-38000,34000,-36000,32000,250,6

def main():
 cache=Path(sys.argv[1]);out=Path(sys.argv[2])
 tiles=[rasterio.open(cache/'attica-n37-e023.tif'),rasterio.open(cache/'attica-n38-e023.tif')]
 arrays=[np.maximum(t.read(1).astype('float32'),0) for t in tiles]
 nx=(X1-X0)//STEP;nz=(Z1-Z0)//STEP;grid=np.zeros((nz,nx),np.float32)
 for j in range(nz):
  for i in range(nx):
   best=0.
   for dj in range(5):
    for di in range(5):
     lat=LAT0-(Z0+j*STEP+(dj+.5)*STEP/5)/MLAT;lon=LON0+(X0+i*STEP+(di+.5)*STEP/5)/MLON
     t,a=(tiles[0],arrays[0]) if lat<38.00013888 else (tiles[1],arrays[1])
     r=int((t.bounds.top-lat)*3600);c=int((lon-t.bounds.left)*3600)
     if 0<=r<a.shape[0] and 0<=c<a.shape[1]:best=max(best,float(a[r,c]))
   grid[j,i]=best
 data=np.clip(np.round(grid/QUANTUM),0,255).astype(np.uint8)
 out.write_bytes(struct.pack('<8i',nx,nz,X0,Z0,STEP,QUANTUM,0,0)+data.tobytes());print(nx,nz,float(grid.max()))
if __name__=='__main__':main()
