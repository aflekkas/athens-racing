"""Source-only mapped structure records and hash-bound local profile certificates.

OSM geometry is OpenStreetMap contributors / ODbL 1.0. No height defaults,
nearest-road association, invented pier placements or runtime integration.
"""
import hashlib
import json
import math
import re
from dataclasses import dataclass
from weakref import WeakSet
from shapely.geometry import LineString, Polygon, Point, box


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def context_kind(tags):
    if tags.get('barrier') == 'retaining_wall':
        return 'retaining_wall'
    if tags.get('man_made') == 'bridge':
        return 'bridge_footprint'
    return None


def source_record(identifier, kind, version, timestamp, source_sha, tags, geometry, refs=None):
    if kind not in ('retaining_wall', 'bridge_footprint') or context_kind(tags) != kind:
        raise ValueError('Unclassified mapped structure')
    if not isinstance(version, int) or version < 1 or not re.fullmatch('[a-f0-9]{64}',source_sha):
        raise ValueError('Missing source version/hash')
    if geometry.is_empty or not geometry.is_valid:
        raise ValueError('Invalid mapped structure geometry')
    if kind == 'retaining_wall' and geometry.geom_type != 'LineString':
        raise ValueError('Retaining wall must retain its source line')
    if kind == 'bridge_footprint' and geometry.geom_type not in ('Polygon', 'MultiPolygon'):
        raise ValueError('Bridge footprint must be closed')
    record = dict(id=identifier, kind=kind, version=version, timestamp=str(timestamp),
                  sourceSha256=source_sha, tags=dict(tags), refs=list(refs or []),
                  geometrySha256=digest(geometry.wkb))
    record['recordSha256'] = digest(encode(record).encode())
    return record


def create_context_tables(db):
    db.executescript('''
      CREATE TABLE context_sources(rowid INTEGER PRIMARY KEY,id TEXT UNIQUE,kind TEXT,
        version INTEGER,timestamp TEXT,sourceSha256 TEXT,geometrySha256 TEXT,
        recordSha256 TEXT,tags TEXT,geometry BLOB,refs TEXT);
      CREATE VIRTUAL TABLE context_spatial USING rtree(rowid,minx,maxx,minz,maxz);
      CREATE TABLE context_relations(id INTEGER PRIMARY KEY,version INTEGER,timestamp TEXT,members TEXT);
      CREATE TABLE context_memberships(way INTEGER PRIMARY KEY);
    ''')


def insert_context(db, record, geometry):
    cursor = db.execute('INSERT INTO context_sources(id,kind,version,timestamp,sourceSha256,geometrySha256,recordSha256,tags,geometry,refs) VALUES(?,?,?,?,?,?,?,?,?,?)',
                        tuple(record[k] for k in ('id','kind','version','timestamp','sourceSha256','geometrySha256','recordSha256')) +
                        (encode(record['tags']), geometry.wkb, encode(record['refs'])))
    x,z,xx,zz = geometry.bounds
    db.execute('INSERT INTO context_spatial VALUES(?,?,?,?,?)', (cursor.lastrowid,x,xx,z,zz))


def intersected_cells(geometry):
    """Enumerate segment/area intersections, including cells without source vertices."""
    a,b,c,d = geometry.bounds
    result = []
    for x in range(math.floor(a/512), math.floor(c/512)+1):
        for z in range(math.floor(b/512), math.floor(d/512)+1):
            part = geometry.intersection(box(x*512,z*512,(x+1)*512,(z+1)*512))
            if (part.area if geometry.geom_type in ('Polygon','MultiPolygon') else part.length) > 1e-9:
                result.append([x,z])
    return result


_certificates = WeakSet()


@dataclass(frozen=True, eq=False)
class ProfileCertificate:
    """Exact local compiler output, bound by an external expected SHA."""
    sha256: str
    payload: str


def read_profile_certificate(raw, expected_sha):
    if digest(raw) != expected_sha:
        raise ValueError('Profile certificate hash mismatch')
    value = json.loads(raw)
    if value.get('schemaVersion') != 1 or value.get('kind') not in ('certified-mapped-wall-profile','certified-structure-boundaries'):
        raise ValueError('Unknown profile certificate')
    if value.get('releaseEligible') is not False or not value.get('sources'):
        raise ValueError('Profile certificate must remain source-only')
    certificate=ProfileCertificate(expected_sha, encode(value))
    _certificates.add(certificate)
    return certificate


def certified_payload(certificate):
    if not isinstance(certificate,ProfileCertificate) or certificate not in _certificates:
        raise ValueError('Unsealed local certificate')
    return json.loads(certificate.payload)


def mapped_wall_mesh(record, geometry, certificate, cell):
    if not isinstance(certificate, ProfileCertificate) or certificate not in _certificates:
        raise ValueError('Missing hash-bound profile certificate')
    p = json.loads(certificate.payload)
    content = {k:v for k,v in record.items() if k != 'recordSha256'}
    if digest(encode(content).encode()) != record.get('recordSha256'):
        raise ValueError('Source record hash mismatch')
    if record['kind'] != 'retaining_wall' or p['recordSha256'] != record['recordSha256'] or p['geometrySha256'] != digest(geometry.wkb):
        raise ValueError('Profile/source geometry mismatch')
    if p.get('kind')!='certified-mapped-wall-profile':raise ValueError('Wrong profile kind')
    if p['retainedSide'] not in ('left','right'):
        raise ValueError('Missing retained side')
    ox,oz = [v*512 for v in cell]
    bounds = box(ox,oz,ox+512,oz+512)
    positions,indices = [],[]
    # Compiler splits at every source vertex and supporting triangle boundary.
    # A face is affine between certified endpoints; no interpolation over gaps.
    for span in p['spans']:
        a,b = span['a'],span['b']
        line = LineString([(a['x'],a['z']),(b['x'],b['z'])])
        if not geometry.covers(line) or line.length <= 0:
            raise ValueError('Profile leaves mapped wall')
        cut = line.intersection(bounds)
        if cut.is_empty or cut.geom_type != 'LineString' or cut.length <= 1e-9:
            continue
        coords = list(cut.coords)
        q=[]
        for x,z in (coords[0],coords[-1]):
            f=line.project(Point(x,z))/line.length
            top=a['top']+(b['top']-a['top'])*f;bottom=a['bottom']+(b['bottom']-a['bottom'])*f
            if not math.isfinite(top+bottom) or top <= bottom:
                raise ValueError('Inverted wall profile')
            q.append((x-ox,top,z-oz,bottom))
        # A wall exactly on a tile edge has one owner; ordinary crossing spans
        # share only the edge vertices and have matching Float32 input values.
        mid=line.interpolate(.5,normalized=True)
        if line.within(bounds.boundary) and (math.floor(mid.x/512),math.floor(mid.y/512)) != tuple(cell):
            continue
        start=len(positions)//3
        a,b=q
        positions.extend([a[0],a[3],a[2], b[0],b[3],b[2], b[0],b[1],b[2], a[0],a[1],a[2]])
        order=[0,1,2,0,2,3] if p['retainedSide']=='left' else [0,2,1,0,3,2]
        indices.extend(start+i for i in order)
    return (positions,indices),dict(sourceId=record['id'],profileSha256=certificate.sha256,
                                   cells=intersected_cells(geometry),triangles=len(indices)//3,
                                   arrayBytes=len(positions)*4+len(indices)*2,releaseEligible=False)


def matched_footprint(records, bridge_sources, source_sha):
    """Require explicit provenance/association; proximity cannot select a deck."""
    wanted=set(bridge_sources)
    matches=[r for r in records if r['record']['kind']=='bridge_footprint' and
             r['record']['sourceSha256']==source_sha and set(r.get('bridgeSources',[]))==wanted]
    if not wanted or len(matches)!=1:
        raise ValueError('Missing/ambiguous source-bound bridge footprint')
    return matches[0]
