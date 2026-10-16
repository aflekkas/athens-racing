"""Diagnostic triangle grades, independent of render/contact identity checks."""
import json,math,sys
from pathlib import Path
import numpy as np
reports=[]
for line in open(sys.argv[1]):
 tile=json.loads(line);t=tile['tables'];p=np.array(t['contactPositions']).reshape(-1,3);tri=np.array(t['contactTriangles']).reshape(-1,5);v=p[tri[:,:3]]
 n=np.cross(v[:,1]-v[:,0],v[:,2]-v[:,0]);slopes=np.hypot(n[:,0],n[:,2])/abs(n[:,1]);areas=abs(n[:,1])/2
 road=tri[:,4]==1;bad=road&(slopes>math.tan(math.radians(30)))
 worst=np.argsort(slopes*road)[-10:][::-1]
 reports.append(dict(cell=tile['metadata']['cell'],roadTriangles=int(road.sum()),roadArea=float(areas[road].sum()),maxRoadGrade=float(slopes[road].max()) if road.any() else 0,roadAbove30Degrees=int(bad.sum()),roadAreaAbove30Degrees=float(areas[bad].sum()),worst=[dict(grade=float(slopes[i]),area=float(areas[i]),center=v[i].mean(axis=0).tolist(),surface=tile['metadata']['ids'][tri[i,3]]) for i in worst],releaseReady=False))
print(json.dumps(reports,indent=2))
