#!/usr/bin/env python3
"""Named shops and amenities of Athens from OSM: `pois.py CACHE OUT.json` writes `assets/athens/pois.json`.

Every node, and the centroid of every building or area, that has a `name` (the Greek `name:el` first) and a `shop` or one of the listed `amenity`
values, inside the Attica extract, in world metres (x east, z south, the cells' projection), with the sign kind it gets (src/athens-signs.js:
0 other shop, 1 pharmacy, 2 cafe or bar, 3 bakery, 4 kiosk (periptero), 5 supermarket or grocery, 6 restaurant or taverna, 7 bank, 8 hairdresser or beauty,
9 clothes or shoes). Format: {unit: 1, names: [...], rows: [x, z, kind, nameIndex, ...]}; the names are sorted by first use and shared.
The runtime puts the sign on the nearest ground-floor wall of the building it stands in or beside, in capitals without accents."""
import json,sys
from pathlib import Path
import osmium

LAT0,LON0,MLAT,MLON=37.98,23.73,111320.,87745.27512677578
def world(lat,lon):return ((lon-LON0)*MLON,-(lat-LAT0)*MLAT)
REGION=(-17000.,-11000.,12000.,21000.)
AMENITY={'pharmacy':1,'cafe':2,'bar':2,'pub':2,'ice_cream':2,'restaurant':6,'fast_food':6,'bank':7,'bakery':3,'marketplace':5}
SHOP={'chemist':1,'bakery':3,'pastry':3,'kiosk':4,'supermarket':5,'convenience':5,'greengrocer':5,'butcher':5,'deli':5,'hairdresser':8,'beauty':8,'cosmetics':8,'clothes':9,'shoes':9,'boutique':9,'bag':9,'jewelry':0}
def kind(t):
 if t.get('amenity') in AMENITY:return AMENITY[t['amenity']]
 s=t.get('shop')
 if s:return SHOP.get(s,0)
 return None
def name(t):
 n=(t.get('name:el') or t.get('name') or '').strip()
 return n[:26] if any(c.isalpha() for c in n) else ''

class Collect(osmium.SimpleHandler):
 def __init__(s):super().__init__();s.rows=[]
 def add(s,t,lat,lon):
  k=kind(t);n=name(t)
  if k is None or not n:return
  x,z=world(lat,lon)
  if REGION[0]<=x<=REGION[2] and REGION[1]<=z<=REGION[3]:s.rows.append((round(x),round(z),k,n))
 def node(s,n):
  if n.tags:s.add(n.tags,n.location.lat,n.location.lon)
 def area(s,a):
  t=a.tags
  if not t or (not t.get('shop') and not t.get('amenity')):return
  pts=[(n.lat,n.lon) for r in a.outer_rings() for n in r]
  if pts:s.add(t,sum(p[0] for p in pts)/len(pts),sum(p[1] for p in pts)/len(pts))

def main():
 cache=Path(sys.argv[1]);out=Path(sys.argv[2]);h=Collect()
 h.apply_file(str(cache/'attica.osm.pbf'),locations=True)
 names=[];index={};rows=[]
 for x,z,k,n in sorted(set(h.rows)):
  if n not in index:index[n]=len(names);names.append(n)
  rows+= [x,z,k,index[n]]
 out.write_text(json.dumps({'unit':1,'names':names,'rows':rows},ensure_ascii=False,separators=(',',':')))
 print(len(rows)//4,'pois',len(names),'names',out.stat().st_size,'bytes')
if __name__=='__main__':main()
