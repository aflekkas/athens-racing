"""Independent full-body road/building/contact audit for emitted tow anchors."""
import json,math,sqlite3,sys
from pathlib import Path
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree
sys.path.insert(0,str(Path(__file__).parent/'world-gen'))
from tiles import Field
from surfaces import SurfaceHeight


def audit(tile,cache):
    db=sqlite3.connect(f'file:{cache}/profiles-a.sqlite?mode=ro',uri=True)
    source=sqlite3.connect(f'file:{cache}/clean.sqlite?mode=ro',uri=True)
    cell=tile['metadata']['cell'];ox,oz=(v*512 for v in cell)
    field=Field(db,source,cell,[cache/'attica-n37-e023.tif',cache/'attica-n38-e023.tif'])
    road=unary_union([r['polygon'] for r in field.roads if r['public']]).buffer(-.03)
    buildings=[]
    for data, in source.execute("SELECT o.data FROM spatial s CROSS JOIN objects o ON o.rowid=s.rowid WHERE o.kind='building' AND s.minx<=? AND s.maxx>=? AND s.minz<=? AND s.maxz>=?",(ox+512,ox,oz+512,oz)):
        buildings.extend(Polygon(p['footprint']) for p in json.loads(data)['parts'])
    tree=STRtree(buildings);t=tile['tables'];tri=t['contactTriangles']
    surface=SurfaceHeight(dict(cell=cell,positions=t['contactPositions'],triangles=[v for i,v in enumerate(tri) if i%5<3]))
    bad=[];height_error=0
    for i in range(0,len(t['anchors']),5):
        at=t['anchors'][i+1]*4;x,y,z,yaw=t['anchorTransforms'][at:at+4]
        dx,dz=-math.sin(yaw),-math.cos(yaw);right=(-dz,dx)
        body=Polygon([(ox+x+dx*f+right[0]*w,oz+z+dz*f+right[1]*w) for f,w in [(-7,-1.5),(-7,1.5),(7,1.5),(7,-1.5)]])
        if not road.covers(body) or any(buildings[int(j)].intersects(body) for j in tree.query(body)):bad.append(tile['metadata']['ids'][t['anchors'][i]])
        height_error=max(height_error,abs(surface(ox+x,oz+z)-y))
    field.dem.close();db.close();source.close()
    return dict(cell=cell,anchors=len(t['anchors'])//5,bad=bad,maxContactHeightError=height_error,halfLength=7,halfWidth=1.5,roadMargin=.03,passed=not bad and height_error<=.005)

if __name__=='__main__':
    cache=Path(sys.argv[1]);results=[audit(json.loads(line),cache) for path in sys.argv[2:] for line in open(path)]
    print(json.dumps(results,indent=2));sys.exit(0 if all(r['passed'] for r in results) else 1)
