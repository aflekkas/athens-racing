"""Opt-in source-only three-level feasibility prototype. NEVER release eligible.

Not imported by bridge_policy/coastal/tiles/packer. Constraints can demonstrate
infeasibility; they cannot replace the ordinary full-surface/rail/AI/tow gates.
"""
import hashlib
import json
import math
import xml.etree.ElementTree as ET
from collections import defaultdict
from shapely.geometry import LineString, box
from model import project, road_tags
from structure_context import ProfileCertificate, intersected_cells, certified_payload

EXPERIMENTAL_ALLOWLIST = {
    'kifisias-a6-three-level-v1': frozenset('w'+str(i) for i in
        (5168796,215668928,215668930,215668931,215668934,604643289,604643299,604643301,604643302,1042971402))
}
SUPPORT_ALLOWLIST = frozenset('w'+str(i) for i in (26984266,26984271,154259480,154259484,219037844,219039054,219039056,219039058,219039059,43547259,5168798,774625030,774625031,87158770))
REQUIRED_GATES = ('asphalt30deg','groundShoulder6m15cm30deg','deckShoulder025m',
                  'fullCarriagewayClearance45m','approachContinuity','exactSeams',
                  'solidRail065m150kmh','aiOnDeck','towSafePlacement')


def source_graph(raw, bounds):
    """A bounded API/PBF reduction; only interior nodes certify full adjacency."""
    root=ET.fromstring(raw);sha=hashlib.sha256(raw).hexdigest()
    nodes={n.get('id'):dict(point=project(float(n.get('lon')),float(n.get('lat'))),version=int(n.get('version')),timestamp=n.get('timestamp'),sourceSha256=sha,
                           complete=bounds[0]<float(n.get('lon'))<bounds[2] and bounds[1]<float(n.get('lat'))<bounds[3])
           for n in root.findall('node')}
    ways={};segments={};adj=defaultdict(list)
    for way in root.findall('way'):
        tags={t.get('k'):t.get('v') for t in way.findall('tag')};road=road_tags(tags)
        if road is None:continue
        refs=[n.get('ref') for n in way.findall('nd')]
        if any(n not in nodes for n in refs):raise ValueError('Incomplete source way node references')
        identifier='w'+way.get('id')
        ways[identifier]=dict(version=int(way.get('version')),tags=tags,sourceLayer=road['layer'],refs=refs,sourceSha256=sha,public=road['public'],review=road['review'],tunnel=road['tunnel'])
        for i,(a,b) in enumerate(zip(refs,refs[1:])):
            if a==b:continue
            key=identifier+':'+str(i);segments[key]=dict(way=identifier,index=i,a=a,b=b)
            adj[a].append(key);adj[b].append(key)
    return dict(sourceSha256=sha,bounds=list(bounds),nodes=nodes,ways=ways,segments=segments,adjacency=dict(adj))


def full_approach_graph(graph, bridge_ways):
    """Follow actual shared nodes, all connected roundabout pieces, then every
    branch through degree-two nodes until its first genuine junction/dead-end.
    No radius or nearest-road rule. Returns unresolved adjacency at crop edges.
    This is an audit recipe proposal, NOT an activation list.
    """
    ways=graph['ways'];family=set(bridge_ways)
    if not family or not family<=ways.keys():raise ValueError('Missing seed source ways')
    while True:
        nodes={n for w in family for n in ways[w]['refs']}
        extra={w for w,v in ways.items() if v['tags'].get('junction')=='roundabout' and set(v['refs'])&nodes}
        if extra<=family:break
        family|=extra
    chosen={key for key,s in graph['segments'].items() if s['way'] in family}
    family_nodes={n for w in family for n in ways[w]['refs']};boundaries={};unresolved=set()
    def walk(node,key):
        while key not in chosen:
            chosen.add(key);segment=graph['segments'][key];node=segment['b'] if segment['a']==node else segment['a']
            if node in family_nodes:return
            adjacent=graph['adjacency'][node]
            if not graph['nodes'][node]['complete']:
                unresolved.add(node);return
            if len(adjacent)!=2:
                boundaries[node]=sorted(adjacent);return
            key=next(k for k in adjacent if k!=key)
    for node in sorted(family_nodes):
        for key in graph['adjacency'].get(node,[]):
            if key not in chosen:walk(node,key)
    unresolved.update(n for key in chosen for n in (graph['segments'][key]['a'],graph['segments'][key]['b']) if not graph['nodes'][n]['complete'])
    cells=set()
    for key in chosen:
        s=graph['segments'][key];line=LineString([graph['nodes'][s[n]]['point'] for n in ('a','b')])
        if line.length:cells.update(map(tuple,intersected_cells(line)))
    for node in {n for key in chosen for n in (graph['segments'][key]['a'],graph['segments'][key]['b'])}:
        adjacent=graph['adjacency'][node]
        if len(adjacent)==1 or any(k not in chosen for k in adjacent):boundaries[node]=sorted(adjacent)
    source_ways=sorted({graph['segments'][s]['way'] for s in chosen})
    return dict(releaseEligible=False,sourceSha256=graph['sourceSha256'],bridgeWays=sorted(bridge_ways),
                roundaboutFamily=sorted(family),segments=sorted(chosen),ways={w:ways[w] for w in source_ways},
                boundaries=boundaries,unresolvedNodes=sorted(unresolved),cells=[list(c) for c in sorted(cells)],
                boundaryProfilesRequired=sorted(boundaries))


def _order(nodes,dependencies):
    outgoing=defaultdict(list);degree={n:0 for n in nodes}
    for lower,upper in dependencies:
        if lower not in degree or upper not in degree:raise ValueError('Unknown physical dependency')
        outgoing[lower].append(upper);degree[upper]+=1
    ready=sorted(n for n,d in degree.items() if not d);result=[]
    while ready:
        n=ready.pop(0);result.append(n)
        for q in outgoing[n]:
            degree[q]-=1
            if not degree[q]:ready.append(q);ready.sort()
    if len(result)!=len(nodes):raise ValueError('Cyclic physical dependency')
    return result


def _profile_graph(graph,scope,layers):
    """Subdivide profiles at geometric crossings without adding graph turns."""
    chosen=scope['segments'];splits={k:{0.:graph['segments'][k]['a'],1.:graph['segments'][k]['b']} for k in chosen}
    vertices={n:tuple(graph['nodes'][n]['point']) for k in chosen for n in (graph['segments'][k]['a'],graph['segments'][k]['b'])}
    lines={k:LineString([vertices[graph['segments'][k][n]] for n in ('a','b')]) for k in chosen}
    crossings=[]
    for i,a in enumerate(chosen):
        for b in chosen[i+1:]:
            if layers[a]==layers[b]:continue
            sa,sb=graph['segments'][a],graph['segments'][b]
            shared={sa['a'],sa['b']}&{sb['a'],sb['b']}
            hit=lines[a].intersection(lines[b])
            if hit.is_empty:continue
            if hit.geom_type!='Point':raise ValueError('Overlapping physical source levels require explicit footprint/profile review')
            if any(math.dist(vertices[n],(hit.x,hit.y))<1e-7 for n in shared):continue
            ids=[]
            for key in (a,b):
                f=lines[key].project(hit)/lines[key].length
                if f<1e-10:f=0.
                if f>1-1e-10:f=1.
                node=splits[key].get(f)
                if node is None:
                    node='profile:'+key+'@'+float(f).hex();splits[key][f]=node;vertices[node]=(hit.x,hit.y)
                ids.append(node)
            lo,hi=(0,1) if layers[a]<layers[b] else (1,0)
            crossings.append(dict(lower=ids[lo],upper=ids[hi],lowerLayer=min(layers[a],layers[b]),upperLayer=max(layers[a],layers[b]),point=[hit.x,hit.y],segments=[a,b]))
    arcs=[];vertex_layers=defaultdict(set)
    for key,stations in splits.items():
        values=[v for _,v in sorted(stations.items())]
        for node in values:vertex_layers[node].add(layers[key])
        for a,b in zip(values,values[1:]):
            maximum=math.dist(vertices[a],vertices[b])*math.tan(math.radians(30))
            arcs.extend([(a,b,-maximum,'grade:'+key),(b,a,-maximum,'grade:'+key)])
    for c in crossings:arcs.append((c['lower'],c['upper'],5.,'clearance:'+'>'.join(c['segments'])))
    return vertices,arcs,crossings,vertex_layers


def solve_recipe(recipe, graph, boundary_certificate, *, experimental=False):
    """Scalar feasibility only; full rendered widths and all release guards stay pending."""
    if not experimental or recipe.get('id') not in EXPERIMENTAL_ALLOWLIST:
        raise ValueError('EXPERIMENTAL explicit recipe opt-in required')
    seeds=set(recipe.get('bridgeWays',[]));supports=set(recipe.get('supportWays',[]))
    if not seeds or not seeds<=EXPERIMENTAL_ALLOWLIST[recipe['id']] or not supports<=SUPPORT_ALLOWLIST:
        raise ValueError('Recipe source ways outside experimental allowlist')
    if any(graph['ways'].get(w,{}).get('tags',{}).get('bridge')!='yes' or graph['ways'].get(w,{}).get('sourceLayer')!=1 for w in seeds):
        raise ValueError('Seed requires literal bridge=yes source layer1')
    if recipe.get('sourceSha256')!=graph['sourceSha256']:
        raise ValueError('Source graph hash mismatch')
    if not isinstance(boundary_certificate,ProfileCertificate):
        raise ValueError('Certified boundary heights required; no baseline guess')
    certificate=certified_payload(boundary_certificate)
    if certificate.get('sourceGraphSha256')!=graph['sourceSha256']:raise ValueError('Boundary graph hash mismatch')
    if certificate.get('kind')!='certified-structure-boundaries':raise ValueError('Wrong boundary certificate kind')
    scope=full_approach_graph(graph,seeds|supports)
    if scope['unresolvedNodes']:raise ValueError('Incomplete real approach graph: '+','.join(scope['unresolvedNodes']))
    if sorted(recipe.get('segments',[]))!=scope['segments']:raise ValueError('Recipe omits/adds actual approach segments')
    for way,record in scope['ways'].items():
        if record['tunnel'] or record['review'] or not record['public'] or record['sourceLayer'] not in (0,1):
            raise ValueError('Unsupported source approach policy: '+way)
        if recipe.get('wayVersions',{}).get(way)!=record['version']:raise ValueError('Way version mismatch: '+way)
    layers=recipe.get('physicalLayers',{})
    if set(layers)!=set(scope['segments']) or set(layers.values())!={0,1,2}:raise ValueError('Three explicit physical levels required')
    _order({0,1,2},recipe.get('dependencies',[]))
    if recipe.get('dependencies')!=[[0,1],[1,2]]:raise ValueError('Complete three-level dependency chain required')
    vertices,arcs,crossings,vertex_layers=_profile_graph(graph,scope,layers)
    if not {(0,1),(1,2)}<={(c['lowerLayer'],c['upperLayer']) for c in crossings}:
        raise ValueError('Missing actual three-level source crossings')
    fixed={}
    for n,p in certificate['nodes'].items():
        if n not in vertices or math.dist(vertices[n],(p['x'],p['z']))>1e-7:raise ValueError('Boundary source coordinate mismatch')
        if not math.isfinite(p['y']):raise ValueError('Nonfinite certified boundary')
        fixed[n]=p['y']
    required_fixed=set(scope['boundaryProfilesRequired'])|{n for n,levels in vertex_layers.items() if min(levels)<2}
    missing=required_fixed-fixed.keys()
    if missing:raise ValueError('Missing approach boundary profiles: '+','.join(sorted(missing)))
    values={n:fixed.get(n,-math.inf) for n in vertices};residuals=[]
    for iteration in range(len(vertices)+1):
        changed=False
        for a,b,delta,label in arcs:
            candidate=values[a]+delta
            if candidate>values[b]+1e-9:
                values[b]=candidate;changed=True
                if b in fixed and candidate>fixed[b]+1e-9:
                    residuals.append(dict(constraint=label,node=b,required=candidate,certified=fixed[b],residualMetres=candidate-fixed[b]))
        if not changed:break
        if iteration==len(vertices):residuals.append(dict(constraint='positive constraint cycle'))
    unresolved=sorted(n for n,v in values.items() if not math.isfinite(v))
    if unresolved:residuals.append(dict(constraint='unbounded profile',nodes=unresolved))
    return dict(schemaVersion=1,experimental=True,releaseEligible=False,feasible=not residuals,
                sourceSha256=graph['sourceSha256'],boundaryCertificateSha256=boundary_certificate.sha256,
                heightMeaning='least constraint-bound heights; not surveyed elevations; all existing lower levels pinned',
                heights={n:v if math.isfinite(v) else None for n,v in sorted(values.items())},residuals=residuals,crossings=crossings,
                sourceLayers={w:r['sourceLayer'] for w,r in scope['ways'].items()},physicalLayers=dict(layers),
                cells=scope['cells'],requiredGates={gate:'pending ordinary rendered-candidate audit' for gate in REQUIRED_GATES})


def require_release_candidate(_):
    raise ValueError('Experimental structure prototype is never release eligible')


def certify_node_adjacency(graph, node_id, raw):
    """Bind a bounded OSM /node/ID/ways response to the exact source versions.
    Only confirms adjacency when every returned driveable way already matches
    the snapshot in full; missing/stale source geometry remains a hard failure.
    """
    import copy
    if node_id not in graph['nodes']:raise ValueError('Unknown adjacency node')
    root=ET.fromstring(raw);returned={};versions={}
    for way in root.findall('way'):
        tags={t.get('k'):t.get('v') for t in way.findall('tag')}
        refs=[n.get('ref') for n in way.findall('nd')]
        if node_id not in refs:raise ValueError('Adjacency response belongs to another node')
        if road_tags(tags) is None:continue
        identifier='w'+way.get('id');version=int(way.get('version'));source=graph['ways'].get(identifier)
        if source is None or source['version']!=version or source['refs']!=refs or source['tags']!=tags:
            raise ValueError('Missing/stale full source way in adjacency proof: '+identifier)
        returned[identifier]=True;versions[identifier]=version
    expected={graph['segments'][key]['way'] for key in graph['adjacency'].get(node_id,[])}
    if set(returned)!=expected:raise ValueError('Incomplete adjacency response')
    result=copy.deepcopy(graph);result['nodes'][node_id]['complete']=True
    proofs=result.setdefault('adjacencyProofs',{})
    proofs[node_id]=dict(url='https://api.openstreetmap.org/api/0.6/node/'+node_id+'/ways',sha256=hashlib.sha256(raw).hexdigest(),wayVersions=versions)
    result.setdefault('primarySourceSha256',graph['sourceSha256'])
    _refresh_graph_hash(result)
    return result


def extend_source_way(graph, way_id, raw):
    """Add ONE exact /way/ID/full source response; no adjacency is inferred."""
    import copy
    root=ET.fromstring(raw);ways=root.findall('way')
    if len(ways)!=1 or 'w'+ways[0].get('id')!=way_id:raise ValueError('Unexpected full-way response')
    imported=source_graph(raw,graph['bounds']);incoming=imported['ways'].get(way_id)
    if incoming is None:raise ValueError('Full-way response is not a driveable source')
    result=copy.deepcopy(graph)
    for node,record in imported['nodes'].items():
        if node in result['nodes'] and any(result['nodes'][node][k]!=record[k] for k in ('point','version')):raise ValueError('Source node moved/changed between snapshots')
    if way_id in result['ways']:
        existing=result['ways'][way_id]
        if any(existing[k]!=incoming[k] for k in ('version','tags','refs')):raise ValueError('Stale source-way version/geometry')
        return result
    for node,record in imported['nodes'].items():
        if node not in result['nodes']:result['nodes'][node]=dict(record,complete=False)
    result['ways'][way_id]=incoming
    for key,segment in imported['segments'].items():
        result['segments'][key]=segment
        for node in (segment['a'],segment['b']):result['adjacency'].setdefault(node,[]).append(key)
    result.setdefault('primarySourceSha256',graph['sourceSha256'])
    result.setdefault('wayProofs',{})[way_id]=dict(url='https://api.openstreetmap.org/api/0.6/way/'+way_id[1:]+'/full',sha256=hashlib.sha256(raw).hexdigest(),version=incoming['version'])
    _refresh_graph_hash(result)
    return result


def _refresh_graph_hash(graph):
    payload=json.dumps(dict(primarySourceSha256=graph['primarySourceSha256'],adjacencyProofs=graph.get('adjacencyProofs',{}),wayProofs=graph.get('wayProofs',{})),sort_keys=True,separators=(',',':'))
    graph['sourceSha256']=hashlib.sha256(payload.encode()).hexdigest()
