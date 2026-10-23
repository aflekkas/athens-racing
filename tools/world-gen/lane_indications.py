"""Pure source lane indications; NEVER evidence of pavement paint or a release API.

Geometry below is an explicit synthetic-fixture prototype only. No generator
entry imports it. OSM lane order is left-to-right in each driving direction.
"""
import copy
import hashlib
import json
import math
import re
from model import road_tags
from road_section import cross_section


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def _count(value):
    return int(value) if isinstance(value,str) and re.fullmatch(r'\d+',value) and 0<=int(value)<=16 else None


def parse_lane_indications(tags, source, expected):
    """expected is the caller's separately retained source SHA/way/version receipt.

    Invalid, ambiguous or unsupported input returns no indications and explicit
    unresolved reasons. Neither a valid result nor turn:lanes activates paint.
    Points/nodeRefs retain ORIGINAL way order, never navigation edge direction.
    """
    tags=copy.deepcopy(tags);source=copy.deepcopy(source)
    issues=[]
    def bad(reason):issues.append(reason)
    for key in ('sourceSha256','wayId','version','timestamp','nodeRefsSha256','geometrySha256','tagsSha256','wayOrientation','normalizedRoadIds'):
        if source.get(key)!=expected.get(key):bad('source receipt mismatch: '+key)
    if not re.fullmatch('[a-f0-9]{64}',str(source.get('sourceSha256',''))):bad('missing source SHA')
    if not re.fullmatch(r'w[1-9]\d*',str(source.get('wayId',''))):bad('missing source way ID')
    if type(source.get('version')) is not int or source['version']<1:bad('missing source version')
    if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ',str(source.get('timestamp',''))):bad('missing source timestamp')
    if source.get('wayOrientation')!='original-node-order':bad('original source orientation required')
    road_ids=source.get('normalizedRoadIds')
    if not isinstance(road_ids,list) or not road_ids or any(not isinstance(v,str) or not re.fullmatch(re.escape(str(source.get('wayId')))+r':\d+',v) for v in road_ids):bad('missing normalized source-road mapping')
    points=source.get('points',[]);refs=source.get('nodeRefs',[])
    if not isinstance(points,list):points=[];bad('invalid original way points')
    if not isinstance(refs,list):refs=[];bad('invalid original node references')
    if len(points)<2 or len(points)!=len(refs) or any(not isinstance(n,str) or not re.fullmatch(r'[1-9]\d*',n) for n in refs):bad('missing original way orientation')
    if any(not isinstance(p,(list,tuple)) or len(p)!=2 or any(type(v) not in (int,float) or not math.isfinite(v) for v in p) for p in points):bad('invalid original way points')
    else:
        if any(a==b for a,b in zip(points,points[1:])):bad('degenerate original way segment')
        if source.get('geometrySha256')!=digest(points):bad('source geometry hash mismatch')
    if source.get('nodeRefsSha256')!=digest(refs):bad('source node orientation hash mismatch')
    if source.get('tagsSha256')!=digest(tags):bad('source tags hash mismatch')
    policy=road_tags(tags)
    if policy is None or policy['review'] or not policy['public']:bad('unsupported source access/direction policy')
    if any(':conditional' in k for k in tags) or tags.get('oneway') in ('reversible','alternating'):bad('conditional/reversible lane policy')
    if any(k.startswith(('access:lanes','vehicle:lanes','motor_vehicle:lanes','motorcar:lanes','bus:lanes','psv:lanes')) for k in tags):bad('unsupported per-lane access policy')
    if 'lanes:both_ways' in tags or 'turn:lanes:both_ways' in tags:bad('unsupported shared centre lane')
    section=cross_section(tags) if policy else None
    if section:
        one=section['oneway'];total=_count(tags.get('lanes'));f=_count(tags.get('lanes:forward'));b=_count(tags.get('lanes:backward'))
        for key in ('lanes','lanes:forward','lanes:backward'):
            if key in tags and _count(tags[key]) is None:bad('invalid explicit lane count: '+key)
        if total==0:bad('invalid zero total lanes')
        if one:
            active=f if one>0 else b;opposite=b if one>0 else f
            if total is None and active is None:bad('explicit lane count required')
            if opposite not in (None,0) or total is not None and active is not None and total!=active:bad('conflicting one-way lane counts')
        elif f is None or b is None or f<1 or b<1 or f+b>16 or total is not None and total!=f+b:
            bad('explicit consistent forward/backward counts required')
    values={k:v for k,v in tags.items() if k.startswith('turn:lanes')}
    supported={'turn:lanes','turn:lanes:forward','turn:lanes:backward'}
    if set(values)-supported:bad('unsupported turn indication key')
    directions={};indications=[]
    if section:
        one=section['oneway']
        for key,value in values.items():
            if key not in supported:continue
            direction=1 if key.endswith(':forward') else -1 if key.endswith(':backward') else one
            if not direction:bad('ambiguous unsuffixed two-way indications');continue
            count=section['lanesForward'] if direction>0 else section['lanesBackward']
            if not count:bad('indications against one-way travel');continue
            if not isinstance(value,str) or len(value)>2048:bad('invalid turn indication value');continue
            entries=value.split('|')
            if len(entries)!=count:bad('turn indication/lane count mismatch');continue
            lanes=[]
            for entry in entries:
                tokens=entry.split(';') if entry else []
                if any(t not in ('left','through','right','none') for t in tokens) or len(tokens)!=len(set(tokens)) or 'none' in tokens and len(tokens)>1:
                    bad('unsupported/conflicting lane indication');continue
                lanes.append(sorted(t for t in tokens if t!='none'))
            if len(lanes)!=count:continue
            if direction in directions and directions[direction]['lanes']!=lanes:bad('conflicting directional indication keys')
            else:directions.setdefault(direction,dict(lanes=lanes,keys=[]))['keys'].append(key)
        if not issues:
            for direction,data in sorted(directions.items()):
                for i,tokens in enumerate(data['lanes']):
                    indications.append(dict(direction=direction,laneIndex=i,turns=tokens,sourceKeys=data['keys']))
    result=dict(schemaVersion=1,kind='source-lane-indications',releaseEligible=False,paintEvidence=False,
                source=source,rawTags=tags,section=section,indications=indications if not issues else [],unresolved=sorted(set(issues)))
    result['recordSha256']=digest(result)
    return result


def synthetic_arrow_polygons(record,direction,lane_index,station,glyphs,*,synthetic=False):
    """Explicit synthetic geometry only; caller supplies its test glyph template.

    No real placement station, glyph dimensions, paint colour or legal turn is
    inferred. This API cannot accept an ordinary OSM source receipt for drawing.
    """
    from shapely.geometry import LineString,Polygon
    from shapely.ops import unary_union
    content={k:v for k,v in record.items() if k!='recordSha256'}
    if digest(content)!=record.get('recordSha256'):raise ValueError('Mutated indication record')
    if not synthetic or record['source'].get('kind')!='synthetic-fixture':raise ValueError('Synthetic-only arrow prototype')
    if record['releaseEligible'] is not False or record['paintEvidence'] is not False or record['unresolved']:raise ValueError('Unresolved/non-prototype record')
    policy=road_tags(record['rawTags'])
    if record['section']['surface'] not in ('asphalt','concrete'):raise ValueError('Existing paint surface policy excludes this material')
    if policy['bridge'] or policy['tunnel'] or policy['layer']!=0:raise ValueError('Unsolved structure/layer excluded')
    matches=[v for v in record['indications'] if v['direction']==direction and v['laneIndex']==lane_index]
    if len(matches)!=1 or not matches[0]['turns']:raise ValueError('Missing explicit lane indication')
    line=LineString(record['source']['points'])
    if not math.isfinite(station) or not 0<station<line.length:raise ValueError('Invalid source-global station')
    a=line.interpolate(max(0,station-.01));b=line.interpolate(min(line.length,station+.01));length=math.hypot(b.x-a.x,b.y-a.y)
    if length<=1e-9:raise ValueError('Ambiguous source tangent')
    tx,tz=(b.x-a.x)/length*direction,(b.y-a.y)/length*direction
    # Geographic right in the projected X/Z frame (Z south) is (-tz,tx).
    section=record['section'];width=section['laneWidth'];centre=section['width']/2-section['lanesForward']*width
    offset=centre+(lane_index+.5)*width if direction>0 else centre-(lane_index+.5)*width
    p=line.interpolate(station);x=p.x+(-tz*direction)*offset;z=p.y+(tx*direction)*offset
    if not isinstance(glyphs,dict) or not set(glyphs)<={'left','through','right'}:raise ValueError('Invalid bounded synthetic glyph template')
    for points in glyphs.values():
        if not isinstance(points,list) or not 3<=len(points)<=64 or any(not isinstance(v,(list,tuple)) or len(v)!=2 or any(type(q) not in (int,float) or not math.isfinite(q) for q in v) for v in points):
            raise ValueError('Invalid bounded synthetic glyph template')
    polygons=[]
    for token in matches[0]['turns']:
        points=glyphs.get(token)
        if not isinstance(points,list) or not 3<=len(points)<=64 or any(not isinstance(v,(list,tuple)) or len(v)!=2 or any(type(q) not in (int,float) or not math.isfinite(q) for q in v) for v in points):raise ValueError('Invalid bounded synthetic glyph template')
        polygon=Polygon([(x-tz*right+tx*forward,z+tx*right+tz*forward) for right,forward in points])
        if polygon.is_empty or not polygon.is_valid or polygon.area<=0:raise ValueError('Invalid synthetic glyph polygon')
        polygons.append(polygon)
    geometry=unary_union(polygons)
    lane=line.offset_curve(offset)
    if lane.geom_type!='LineString' or not lane.buffer(width/2,cap_style=2,join_style=2).covers(geometry):
        raise ValueError('Synthetic glyph leaves its modelled lane')
    return geometry,dict(sourceRecordSha256=record['recordSha256'],wayId=record['source']['wayId'],
        sourceSha256=record['source']['sourceSha256'],version=record['source']['version'],direction=direction,
        laneIndex=lane_index,station=station,templateSha256=digest(glyphs),releaseEligible=False,paintEvidence=False)
