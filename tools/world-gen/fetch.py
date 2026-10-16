#!/usr/bin/env python3
"""One raw-data cache, hash-checked downloads, atomic completion; no runtime network."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import urllib.request

OSM = ('greece-261014.osm.pbf', 'https://download.geofabrik.de/europe/greece-261014.osm.pbf',
       '7087cf00b0e47833c40837b9ee7cc5c3020420decc3980406d3b8f0b5d62a6f3')

DEM_HASHES = {
    (37,23): 'c8b33e52681e6d15c4217472e9db7c54fab88f9ccf3b7d9ad177b611891e1d74',
    (38,23): 'c289c4a9b2c5c8b5b07e475129134bbb6b64b3ccb86d23eca3428b8e7f5bce28',
}


def sha(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def fetch(cache, name, url, expected=None):
    destination = cache/name
    lock = destination.with_suffix(destination.suffix+'.source.json')
    if lock.exists():
        meta = json.loads(lock.read_text())
        if meta['url'] != url or expected and meta['sha256'] != expected:
            raise ValueError('Source lock mismatch: '+str(lock))
        expected = meta['sha256']
    if not destination.exists():
        partial = destination.with_suffix(destination.suffix+'.part')
        request = urllib.request.Request(url,headers={'User-Agent':'AthensRacing-world-gen/1'})
        with urllib.request.urlopen(request,timeout=120) as response, partial.open('wb') as stream:
            while chunk := response.read(1024*1024):
                stream.write(chunk)
        actual = sha(partial)
        if expected and actual != expected:
            raise ValueError('Download hash mismatch: '+str(partial))
        os.replace(partial,destination)
    actual = sha(destination)
    if expected and actual != expected:
        raise ValueError('Cached file hash mismatch: '+str(destination))
    meta = dict(url=url, sha256=actual, bytes=destination.stat().st_size)
    temporary = lock.with_suffix('.tmp'); temporary.write_text(json.dumps(meta,sort_keys=True,indent=2)+'\n'); os.replace(temporary,lock)
    return meta


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache',type=Path); parser.add_argument('--osm',action='store_true')
    parser.add_argument('--dem',nargs=2,type=int,action='append',default=[],metavar=('LAT','LON'))
    args=parser.parse_args();args.cache.mkdir(parents=True,exist_ok=True)
    if args.osm:
        print(json.dumps(fetch(args.cache,*OSM)),flush=True)
    for lat,lon in args.dem:
        name=f'Copernicus_DSM_COG_10_{"N" if lat>=0 else "S"}{abs(lat):02d}_00_{"E" if lon>=0 else "W"}{abs(lon):03d}_00_DEM'
        print(json.dumps(fetch(args.cache,name+'.tif',f'https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif',DEM_HASHES.get((lat,lon)))),flush=True)
    print(json.dumps(dict(cacheBytes=sum(p.stat().st_size for p in args.cache.iterdir() if p.is_file()))))
