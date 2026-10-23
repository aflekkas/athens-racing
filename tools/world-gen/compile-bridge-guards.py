#!/usr/bin/env python3
"""Compile a complete committed OSM structure plan into canonical guard rings.

Geometry derives from OSM data (OpenStreetMap contributors, ODbL 1.0) and the
existing source generator's platform model. No measured support heights are
created. The original plan bytes must accompany this recipe at proof time.
"""
import hashlib,json,sys
from pathlib import Path
from shapely.geometry import shape
from street_regions import canonical_polygon,unary_union

def compile_plan(path,source_world):
 raw=sys.stdin.buffer.read() if path=='-' else Path(path).read_bytes();plan=json.loads(raw)
 platform=canonical_polygon(unary_union([shape(g['platform']) for g in sorted(plan['groups'],key=lambda g:g['id'])]))
 def ring(coords):
  points=[list(p) for p in coords][:-1]
  start=min(range(len(points)),key=lambda i:points[i]);points=points[start:]+points[:start]
  if points[-1]<points[1]:points=[points[0]]+list(reversed(points[1:]))
  return points
 polygons=[platform] if platform.geom_type=='Polygon' else list(platform.geoms)
 components=[sorted([ring(p.exterior.coords)]+[ring(r.coords) for r in p.interiors]) for p in polygons if not p.is_empty]
 return dict(version=1,kind='osm-bridge-guard-posts',sourceWorld=source_world,area=plan['area'],sourcePlanSha256=hashlib.sha256(raw).hexdigest(),
  compilerSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),licence='OpenStreetMap contributors, ODbL 1.0',
  groups=[{k:g[k] for k in ('id','bridgeSources','upper')} for g in sorted(plan['groups'],key=lambda g:g['id'])],components=sorted(components))
if __name__=='__main__':
 print(json.dumps(compile_plan(sys.argv[1],sys.argv[2]),sort_keys=True,separators=(',',':')))
