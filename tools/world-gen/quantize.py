#!/usr/bin/env python3
"""Stream canonical surface meshes into the shared terrain-u16-v1 layout.

Contact/fine tables stay unchanged. Building, paint and prop meshes stay in
Float32. This stage uses no new wire codec and emits no runtime textures.
"""
import argparse,json,sqlite3,sys
from pathlib import Path
from shapely.geometry import Point,shape
from shapely.strtree import STRtree
from layout import compact_positions,vertex_normals
from ingest import encode

URBAN={'residential','commercial','retail','industrial','garages','railway'}


def quantize_tile(tile,source):
    m=tile['metadata'];ox,_,oz=m['origin'];land=[]
    for data, in source.execute("SELECT o.data FROM spatial s CROSS JOIN objects o ON o.rowid=s.rowid WHERE s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=? AND o.kind IN ('landuse','landcover') ORDER BY o.id",(ox+512,ox,oz+512,oz)):
        value=json.loads(data);land.append((shape(value['geometry']),value['tags']))
    tree=STRtree([g for g,t in land]);urban_cache={}
    def urban(x,z):
        key=(x,z)
        if key not in urban_cache:
            point=Point(ox+x,oz+z);covered=[int(i) for i in tree.query(point) if land[int(i)][0].covers(point)]
            tags=land[min(covered,key=lambda i:land[i][0].area)][1] if covered else {}
            urban_cache[key]=255 if tags.get('landuse') in URBAN else 0
        return urban_cache[key]
    arrays=tile['arrays'];fine=tile['tables']['finePositions'];normals=vertex_normals(fine,tile['tables']['fineTriangles'])
    by_vertex={tuple(fine[i:i+3]):normals[i:i+3] for i in range(0,len(fine),3)};converted={}
    def append(type,data):arrays.append(dict(type=type,data=data));return len(arrays)-1
    for mesh in m['meshes']:
        if not mesh.get('userData',{}).get('worldSurface'):continue
        if mesh['userData'].get('terrainDecode'):continue
        index=mesh['attributes']['position']['array']
        if index not in converted:
            if arrays[index]['type']!='Float32Array':raise ValueError('Expected Float32 source surface')
            positions=arrays[index]['data'];q,residual,decode=compact_positions(positions)
            local_normals=[]
            if all(tuple(positions[i:i+3]) in by_vertex for i in range(0,len(positions),3)):
                for i in range(0,len(positions),3):local_normals.extend(by_vertex[tuple(positions[i:i+3])])
            else:local_normals=vertex_normals(positions,arrays[mesh['index']]['data'])
            arrays[index]=dict(type='Uint16Array',data=q)
            converted[index]=(decode,append('Float32Array',residual),append('Int8Array',local_normals),append('Uint8Array',[urban(positions[i],positions[i+2]) for i in range(0,len(positions),3)]))
        decode,residual,normal,blend=converted[index];mesh['userData']['terrainDecode']=decode
        mesh['attributes']['aHeightResidual']=dict(array=residual,itemSize=1,normalized=False)
        mesh['attributes']['normal']=dict(array=normal,itemSize=3,normalized=True)
        mesh['attributes']['aU']=dict(array=blend,itemSize=1,normalized=True)
    return tile


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source',type=Path);args=parser.parse_args()
    source=sqlite3.connect(f'file:{args.source}?mode=ro',uri=True)
    for line in sys.stdin:
        if line.strip():print(encode(quantize_tile(json.loads(line),source)),flush=True)
    source.close()
