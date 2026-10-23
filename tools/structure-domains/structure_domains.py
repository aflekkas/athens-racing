"""Analysis-only declared domain plans. No generator/runtime/certificate callsite.

Wire contract exact-binary64-json-v1: finite binary64 numbers are written as their
EXACT decimal value, without exponents; 1.0 -> 1 and -0.0 -> -0.0. No evidence
rounding. Python integers must be safe integers. A finite float may be larger.
Keys sort by UTF-16 code units; strings use ASCII JSON escapes with valid Unicode.
The Node reader implements this same contract, hashes privately captured ORIGINAL
bytes, and rejects noncanonical wire encodings. Checksums identify declarations;
they do not authenticate a survey, source measurement, protection claim or policy.

Only metadata consistency is analyzed. No generated height, surface selector,
physical certificate, geometry, filesystem, network or DEM sampling is provided.
Every output is declared-unverified and permanently ineligible for construction.

Schema: source-domain-spec binds literal sourceWays to a separately supplied
metadata-only declared-source-inventory. Explicit domains, wall boundaries,
source-global stationing and physicalOrder DAG declarations are preserved in
sourceSpec. Observations contain caller-declared intervals, never selected y;
uncertainty is retained separately, not silently added/removed or converted.
Measured, DEM-observed-outside and model-inferred records require different
provenance fields. Inventory references do NOT authenticate those declarations.
Native protection requires 225 Penteli + 72 Megara identities, plus the original
Vas source map/boundary inventory. No physical affected-cell list is accepted.
Malformed types/unknown fields/identities raise ValueError. Missing evidence,
continuous zero, interval ambiguity, cycles and protection conflicts return a
blocked plan with exact missingFields/conflicts. contract-consistent means only
that supplied metadata has no detected contradiction; ALL future physical proofs
remain required. The sourceSpec copy prevents caller mutation of its hash binding.

Caps: each canonical document <=512KiB; depth16, 20k values, 262144 UTF16 string
units, 8192 generic array entries and 64 object keys. Domain/way/boundary/order
node collections <=2048; generated issues <=2048 (overflow raises, never truncates).
Connection statements apply to every unordered domain pair at the named source
node. Opposing kinds for a common pair conflict, including reversed order or
partially overlapping incident sets; same-kind repetitions are idempotent.
Same-node equality is transitive within that source node, never across nodes.
Pair expansion is bounded to 8192 visits and 262144 UTF16 key units before keys
are allocated. Retaining-wall top roles are crown/retained-ground, bottom roles
toe/lower-road; null/omitted roles block and other known roles are incompatible.
Domain names and numeric interval height never infer a role.
No raw JSON parser is exposed by this Python API.
"""
import copy
import hashlib
import json
import math
import re

MAX_BYTES = 524288
MAX_NODES = 20000
MAX_DEPTH = 16
MAX_STRING_UNITS = 262144
MAX_ARRAY = 8192
SAFE = 9007199254740991
SHA = re.compile(r'^[a-f0-9]{64}$')
FORBIDDEN = {'__proto__', 'constructor', 'prototype'}
REQUIRED_PROOFS = ['source-authentication', 'protected-impact', 'physical-domain-construction',
                   'exact-closed-triangle-certificate', 'unchanged-physical-guards']


def _number(value):
    if type(value) is int:
        if abs(value) > SAFE:
            raise ValueError('unsafe Python integer')
        return str(value)
    if type(value) is not float or not math.isfinite(value):
        raise ValueError('finite binary64 required')
    if value == 0:
        return '-0.0' if math.copysign(1, value) < 0 else '0'
    sign = '-' if value < 0 else ''
    numerator, denominator = abs(value).as_integer_ratio()
    places = denominator.bit_length() - 1
    digits = str(numerator * 5 ** places)
    if not places:
        return sign + digits
    digits = digits.zfill(places + 1)
    return sign + (digits[:-places] + '.' + digits[-places:]).rstrip('0').rstrip('.')


def canonical_plan_bytes(value):
    """Bounded canonical encoding; reject cycles/non-JSON types/nonfinite values."""
    parts, active = [], set()
    nodes = units = size = 0

    def put(text):
        nonlocal size
        size += len(text)  # Everything emitted is ASCII.
        if size > MAX_BYTES:
            raise ValueError('canonical byte cap')
        parts.append(text)

    def string(text):
        nonlocal units
        if type(text) is not str:
            raise ValueError('JSON string required')
        try:
            encoded = text.encode('utf-16-be')
        except UnicodeError as error:
            raise ValueError('unpaired Unicode surrogate') from error
        if len(encoded) // 2 > 2048:
            raise ValueError('string cap')
        units += len(encoded) // 2
        if units > MAX_STRING_UNITS:
            raise ValueError('combined string cap')
        return json.dumps(text, ensure_ascii=True)

    def walk(v, depth):
        nonlocal nodes
        nodes += 1
        if nodes > MAX_NODES or depth > MAX_DEPTH:
            raise ValueError('JSON graph/depth cap')
        if v is None:
            put('null')
        elif type(v) is bool:
            put('true' if v else 'false')
        elif type(v) in (int, float):
            put(_number(v))
        elif type(v) is str:
            put(string(v))
        elif type(v) in (list, dict):
            if id(v) in active:
                raise ValueError('cyclic JSON')
            active.add(id(v))
            if type(v) is list:
                if len(v) > MAX_ARRAY:
                    raise ValueError('array cap')
                put('[')
                for i, item in enumerate(v):
                    if i:
                        put(',')
                    walk(item, depth + 1)
                put(']')
            else:
                if len(v) > 64 or any(type(k) is not str or k in FORBIDDEN for k in v):
                    raise ValueError('object key cap/type/reserved key')
                for key in v:
                    if len(key) > 128:
                        raise ValueError('key cap')
                    string(key)  # Check Unicode before UTF-16 sorting.
                put('{')
                for i, key in enumerate(sorted(v, key=lambda k: k.encode('utf-16-be'))):
                    if i:
                        put(',')
                    put(json.dumps(key, ensure_ascii=True)); put(':')
                    walk(v[key], depth + 1)
                put('}')
            active.remove(id(v))
        else:
            raise ValueError('plain JSON values required')
    walk(value, 0)
    return ''.join(parts).encode('ascii')


def projected_left_normal(dx, dz):
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in (dx, dz)):
        raise ValueError('finite tangent required')
    length = math.hypot(dx, dz)
    if length == 0 or not math.isfinite(length):
        raise ValueError('degenerate tangent')
    return dz / length, -dx / length


def _object(v, fields, required=None):
    if type(v) is not dict or set(v) - set(fields) or any(k in FORBIDDEN for k in v):
        raise ValueError('object/unknown field')
    if set(fields if required is None else required) - set(v):
        raise ValueError('missing structural field')


def _array(v, cap=MAX_ARRAY):
    if type(v) is not list or len(v) > cap:
        raise ValueError('collection cap/type')
    return v


def _text(v):
    if type(v) is not str or not v:
        raise ValueError('nonempty string required')
    return v


def _hash(v):
    if type(v) is not str or SHA.fullmatch(v) is None:
        raise ValueError('SHA256 required')


def _finite(v):
    if type(v) not in (int, float) or not math.isfinite(v):
        raise ValueError('finite number required')


def _integer(v):
    _finite(v)
    if v != int(v) or abs(v) > SAFE:
        raise ValueError('safe integer required')


def _strings(values, cap=MAX_ARRAY):
    for v in _array(values, cap):
        _text(v)
    if len(set(values)) != len(values):
        raise ValueError('duplicate references')


def _index(rows, cap):
    result = {}
    for row in _array(rows, cap):
        if type(row) is not dict or 'id' not in row:
            raise ValueError('record id required')
        key = _text(row['id'])
        if key in result:
            raise ValueError('duplicate id')
        result[key] = row
    return result


def _way(w):
    _object(w, ['id', 'version', 'timestamp', 'sourceSha256', 'nodeRefsSha256',
                'geometrySha256', 'wayOrientation', 'sourceTags'])
    _text(w['id']); _text(w['timestamp']); _integer(w['version'])
    if w['version'] < 1 or w['wayOrientation'] != 'original-node-order':
        raise ValueError('source version/orientation')
    for k in ('sourceSha256', 'nodeRefsSha256', 'geometrySha256'):
        _hash(w[k])
    if type(w['sourceTags']) is not dict or len(w['sourceTags']) > 64:
        raise ValueError('source tag collection')
    for k, v in w['sourceTags'].items():
        _text(k); _text(v)  # Literal tags, including layer, remain strings.


def _validate(spec, inventory):
    # Encoding checks input graph/type/size before validation copies or indexing.
    spec_bytes, inv_bytes = canonical_plan_bytes(spec), canonical_plan_bytes(inventory)
    if len(spec_bytes) + len(inv_bytes) > 2 * MAX_BYTES:
        raise ValueError('combined raw cap')
    _object(inventory, ['schemaVersion', 'kind', 'sourceWays', 'evidenceDescriptors',
                        'protectedNative', 'protectedVas'])
    _integer(inventory['schemaVersion'])
    if inventory['schemaVersion'] != 1 or inventory['kind'] != 'declared-source-inventory':
        raise ValueError('inventory schema')
    sources = _index(inventory['sourceWays'], 2048)
    for w in sources.values():
        _way(w)
    descriptors = _index(inventory['evidenceDescriptors'], 10000)
    for d in descriptors.values():
        _object(d, ['id', 'sha256', 'kind', 'authority'])
        _hash(d['sha256'])
        if d['kind'] not in ('synthetic', 'metadata-only') or d['authority'] != 'declared-unverified':
            raise ValueError('descriptor authority')
    native = _index(inventory['protectedNative'], 297)
    counts = {'penteli': 0, 'megara': 0}
    native_cells = set()
    for n in native.values():
        _object(n, ['id', 'region', 'world', 'revision', 'cell', 'sha256', 'bytes', 'ownerRefs'])
        if n['region'] not in counts:
            raise ValueError('unknown native family')
        counts[n['region']] += 1
        _text(n['world']); _text(n['revision']); _hash(n['sha256']); _integer(n['bytes'])
        if n['bytes'] < 1 or len(_array(n['cell'], 2)) != 2:
            raise ValueError('native cell/budget')
        for c in n['cell']:
            _integer(c)
        identity = (n['world'], n['revision'], *n['cell'])
        if identity in native_cells:
            raise ValueError('duplicate protected physical identity')
        native_cells.add(identity)
        _strings(n['ownerRefs'])
    if counts != {'penteli': 225, 'megara': 72}:
        raise ValueError('protected 297 inventory incomplete')
    vas = inventory['protectedVas']
    _object(vas, ['sourceMapSha256', 'boundaryOwnerRefs', 'stateHashes'])
    _hash(vas['sourceMapSha256']); _strings(vas['boundaryOwnerRefs'])
    _object(vas['stateHashes'], ['classes', 'widths', 'ccw', 'planes', 'profiles', 'outerBand'])
    for v in vas['stateHashes'].values():
        _hash(v)
    _object(spec, ['schemaVersion', 'kind', 'mode', 'releaseEligible', 'sourceWays', 'evidence',
                   'domains', 'boundaries', 'physicalOrder', 'connections', 'protection', 'sourceScope'])
    _integer(spec['schemaVersion'])
    if spec['schemaVersion'] != 1 or spec['kind'] != 'source-domain-spec' or spec['mode'] != 'source-only' or spec['releaseEligible'] is not False:
        raise ValueError('source-only schema/flags')
    ways = _index(spec['sourceWays'], 2048)
    for key, w in ways.items():
        _way(w)
        if key not in sources or canonical_plan_bytes(w) != canonical_plan_bytes(sources[key]):
            raise ValueError('source identity/version/node order mismatch')
    evidence = _index(spec['evidence'], 10000)
    for e in evidence.values():
        _object(e, ['id', 'kind', 'sourceRef', 'units', 'verticalDatum', 'uncertainty', 'observations', 'metadata'])
        if e['kind'] not in ('measured', 'DEM-observed-outside', 'model-inferred') or e['units'] != 'm':
            raise ValueError('evidence kind/units')
        _text(e['verticalDatum'])
        if e['verticalDatum'] not in ('EGM2008', 'EVRS2000', 'unknown') and not (e['verticalDatum'].startswith('ellipsoidal:') and len(e['verticalDatum']) > len('ellipsoidal:')):
            raise ValueError('datum vocabulary')
        if e['sourceRef'] is not None and e['sourceRef'] not in descriptors:
            raise ValueError('unknown evidence source reference')
        if e['uncertainty'] is not None:
            u = e['uncertainty']; _object(u, ['lowerMetres', 'upperMetres', 'meaning', 'provenanceRef'])
            for k in ('lowerMetres', 'upperMetres'):
                _finite(u[k])
                if u[k] < 0:
                    raise ValueError('negative uncertainty')
            _text(u['meaning'])
            if u['provenanceRef'] is not None and u['provenanceRef'] not in descriptors:
                raise ValueError('unknown uncertainty reference')
        seen = set()
        if e['observations'] is not None:
            for o in _array(e['observations'], 8192):
                _object(o, ['station', 'interval']); _finite(o['station'])
                if o['station'] < 0 or o['station'] in seen or len(_array(o['interval'], 2)) != 2:
                    raise ValueError('station/interval')
                seen.add(o['station'])
                for v in o['interval']:
                    _finite(v)
                if o['interval'][0] > o['interval'][1]:
                    raise ValueError('inverted evidence interval')
        allowed = {'measured': ['primaryProfileRef', 'referenceHeightDefinition'],
                   'DEM-observed-outside': ['rasterSha256', 'product', 'epoch', 'crs', 'transform', 'pixelWindow', 'featureMaskSha256', 'classificationRef', 'interpolationMethod', 'surveyedGround'],
                   'model-inferred': ['inferencePolicyRef', 'constraintInputRefs', 'notSurveyed']}[e['kind']]
        _object(e['metadata'], allowed, [])
        m = e['metadata']
        for k, v in m.items():
            if v is None:
                continue
            if k in ('surveyedGround', 'notSurveyed'):
                if v is not (k == 'notSurveyed'):
                    raise ValueError('surveyed/inference flag')
            elif k in ('transform', 'pixelWindow'):
                if len(_array(v, 6)) != (6 if k == 'transform' else 4):
                    raise ValueError('raster descriptor shape')
                for n in v:
                    (_integer if k == 'pixelWindow' else _finite)(n)
                if k == 'pixelWindow' and (min(v) < 0 or min(v[2:]) <= 0):
                    raise ValueError('pixel window bounds')
            elif k == 'constraintInputRefs':
                _strings(v)
                if any(r not in descriptors for r in v):
                    raise ValueError('unknown model constraint reference')
            elif k.endswith('Sha256'):
                _hash(v)
            elif k.endswith('Ref'):
                if v not in descriptors:
                    raise ValueError('unknown metadata reference')
            else:
                _text(v)
    domains = _index(spec['domains'], 2048)
    roles = ('retained-ground', 'wall-crown', 'wall-toe', 'lower-road', 'deck-top', 'deck-underside')
    order = spec['physicalOrder']; _object(order, ['nodes', 'relations', 'unknownRelations']); _strings(order['nodes'], 2048)
    for d in domains.values():
        fields = ['id', 'role', 'sourceWayRef', 'physicalOrderNode', 'stationing', 'profileEvidenceRefs', 'ownerAssociation', 'boundaryRefs']
        _object(d, fields, [k for k in fields if k != 'role'])
        if (d.get('role') is not None and d['role'] not in roles) or d['sourceWayRef'] not in ways or d['physicalOrderNode'] not in order['nodes']:
            raise ValueError('unknown domain role/source/order reference')
        s = d['stationing']; _object(s, ['sourceWayRef', 'direction', 'start', 'end'])
        _finite(s['start'])
        if s['sourceWayRef'] != d['sourceWayRef'] or s['direction'] != 'original-node-order' or s['start'] != 0:
            raise ValueError('global source stationing')
        if s['end'] is not None:
            _finite(s['end'])
            if s['end'] <= 0:
                raise ValueError('station end')
        _strings(d['profileEvidenceRefs']); _strings(d['boundaryRefs'])
        if any(r not in evidence for r in d['profileEvidenceRefs']):
            raise ValueError('unknown profile evidence reference')
        a = d['ownerAssociation']; _object(a, ['sourceOwnerId', 'physicalLayer', 'recipeRef'])
        if a['sourceOwnerId'] is not None:
            _text(a['sourceOwnerId'])
        if a['physicalLayer'] is not None:
            _integer(a['physicalLayer'])
        if a['recipeRef'] is not None and a['recipeRef'] not in descriptors:
            raise ValueError('unknown recipe reference')
    boundaries = _index(spec['boundaries'], 2048)
    for b in boundaries.values():
        _object(b, ['id', 'sourceFeatureRef', 'geometrySha256', 'retainedSide', 'lowerSide', 'topDomainId', 'bottomDomainId', 'stationKnots', 'topEvidenceRefs', 'bottomEvidenceRefs', 'associationEvidenceRefs', 'endpointAttachmentRefs'])
        if b['sourceFeatureRef'] not in ways or ways[b['sourceFeatureRef']]['sourceTags'].get('barrier') != 'retaining_wall' or b['geometrySha256'] != ways[b['sourceFeatureRef']]['geometrySha256'] or b['retainedSide'] != 'left' or b['lowerSide'] != 'right':
            raise ValueError('literal wall source/orientation binding')
        for k in ('topDomainId', 'bottomDomainId'):
            if b[k] is not None and b[k] not in domains:
                raise ValueError('unknown boundary domain reference')
        knots = _array(b['stationKnots'], 8192)
        for n in knots:
            _finite(n)
        if knots and (knots[0] != 0 or any(a >= c for a, c in zip(knots, knots[1:]))):
            raise ValueError('global station knots')
        for k in ('topEvidenceRefs', 'bottomEvidenceRefs', 'associationEvidenceRefs', 'endpointAttachmentRefs'):
            _strings(b[k]); pool = evidence if k in ('topEvidenceRefs', 'bottomEvidenceRefs') else descriptors
            if any(r not in pool for r in b[k]):
                raise ValueError('unknown boundary evidence reference')
    if any(r not in boundaries for d in domains.values() for r in d['boundaryRefs']):
        raise ValueError('unknown domain boundary reference')
    for r in _array(order['relations'], 8192):
        _object(r, ['lower', 'upper', 'evidenceRefs']); _strings(r['evidenceRefs'])
        if r['lower'] not in order['nodes'] or r['upper'] not in order['nodes'] or any(v not in descriptors for v in r['evidenceRefs']):
            raise ValueError('unknown order reference')
    for r in _array(order['unknownRelations'], 8192):
        _object(r, ['a', 'b', 'reason', 'missingEvidence']); _text(r['reason']); _strings(r['missingEvidence'])
        if r['a'] not in order['nodes'] or r['b'] not in order['nodes']:
            raise ValueError('unknown unresolved order node')
    for c in _array(spec['connections'], 8192):
        _object(c, ['sourceNodeRef', 'incidentDomains', 'kind', 'evidenceRefs']); _text(c['sourceNodeRef']); _strings(c['incidentDomains']); _strings(c['evidenceRefs'])
        if c['kind'] not in ('same-physical-node', 'separated-crossing') or any(r not in domains for r in c['incidentDomains']) or any(r not in descriptors for r in c['evidenceRefs']):
            raise ValueError('unknown connection reference/kind')
    p = spec['protection']; _object(p, ['nativeManifestRef', 'expectedNativeCounts', 'nativeIdentityRefs', 'vasSourceMapRef', 'vasBoundaryOwnerRefs', 'impactEvidenceRef'])
    _object(p['expectedNativeCounts'], ['penteli', 'megara'])
    if p['expectedNativeCounts'] != counts:
        raise ValueError('native count override')
    _strings(p['nativeIdentityRefs'], 297); _strings(p['vasBoundaryOwnerRefs'])
    if any(r not in native for r in p['nativeIdentityRefs']) or any(p[k] is not None and p[k] not in descriptors for k in ('nativeManifestRef', 'impactEvidenceRef')):
        raise ValueError('unknown protection reference')
    if p['vasSourceMapRef'] is not None and p['vasSourceMapRef'] != vas['sourceMapSha256']:
        raise ValueError('Vas source map changed')
    scope = spec['sourceScope']; _object(scope, ['familyRefs', 'completeness', 'closureEvidenceRefs', 'affectedCells']); _strings(scope['familyRefs']); _strings(scope['closureEvidenceRefs'])
    if scope['completeness'] not in ('incomplete', 'metadata-declared-complete') or any(r not in descriptors and r not in ways for r in scope['familyRefs']) or any(r not in descriptors for r in scope['closureEvidenceRefs']) or scope['affectedCells'] is not None:
        raise ValueError('unproven physical scope/cell claim')
    return ways, evidence, domains, boundaries, descriptors, native, vas


def analyze_domain_plan(spec, inventory):
    """Analyze declarations only. Never choose or generate an elevation."""
    ways, evidence, domains, boundaries, descriptors, native, vas = _validate(spec, inventory)
    missing, conflicts = [], []
    def miss(path, reason):
        if len(missing) + len(conflicts) >= 2048:
            raise ValueError('analysis issue graph cap')
        missing.append(dict(path=path, reason=reason, requiredEvidenceKind='reviewed-source-evidence'))
    def conflict(code, ids):
        if len(missing) + len(conflicts) >= 2048:
            raise ValueError('analysis issue graph cap')
        conflicts.append(dict(code=code, ids=ids, evidenceRefs=[]))
    for field in ('sourceWays', 'domains', 'boundaries'):
        if not spec[field]:
            miss(field, 'empty analysis scope')
    for key, e in evidence.items():
        prefix = 'evidence.' + key
        for k in ('sourceRef', 'uncertainty', 'observations'):
            if e[k] is None or e[k] == []:
                miss(prefix + '.' + k, 'missing evidence')
        if e['verticalDatum'] == 'unknown':
            miss(prefix + '.verticalDatum', 'unknown datum; no conversion')
        if e['uncertainty'] is not None and e['uncertainty']['provenanceRef'] is None:
            miss(prefix + '.uncertainty.provenanceRef', 'missing uncertainty provenance')
        fields = {'measured': ['primaryProfileRef', 'referenceHeightDefinition'],
                  'DEM-observed-outside': ['rasterSha256', 'product', 'epoch', 'crs', 'transform', 'pixelWindow', 'featureMaskSha256', 'classificationRef', 'interpolationMethod', 'surveyedGround'],
                  'model-inferred': ['inferencePolicyRef', 'constraintInputRefs', 'notSurveyed']}[e['kind']]
        for k in fields:
            if k not in e['metadata'] or e['metadata'][k] is None or e['metadata'][k] == []:
                miss(prefix + '.metadata.' + k, 'missing kind-specific evidence')
    order = spec['physicalOrder']; outgoing = {n: set() for n in order['nodes']}
    for r in order['relations']:
        outgoing[r['lower']].add(r['upper'])
        if not r['evidenceRefs']:
            miss('physicalOrder.relations', 'missing ordering evidence')
    def reaches(a, b):
        todo, seen = list(outgoing[a]), set()
        while todo:
            q = todo.pop()
            if q == b:
                return True
            if q not in seen:
                seen.add(q); todo.extend(outgoing[q])
        return False
    if any(reaches(n, n) for n in outgoing):
        conflict('ORDER_CYCLE', order['nodes'])
    for r in order['unknownRelations']:
        miss('physicalOrder.' + r['a'] + '>' + r['b'], 'unresolved ordering')
    native_owners = {o for n in native.values() for o in n['ownerRefs']}
    for key, d in domains.items():
        if d.get('role') is None:
            miss('domains.' + key + '.role', 'missing explicit semantic role')
        for field in ('sourceOwnerId', 'physicalLayer', 'recipeRef'):
            if d['ownerAssociation'][field] is None:
                miss('domains.' + key + '.ownerAssociation.' + field, 'missing explicit association')
        if not d['profileEvidenceRefs'] or d['stationing']['end'] is None:
            miss('domains.' + key + '.profile', 'missing source-global profile')
        owner = d['ownerAssociation']['sourceOwnerId']
        if owner in native_owners:
            conflict('PROTECTED_NATIVE_TOUCH', [key, owner])
        if owner in vas['boundaryOwnerRefs']:
            conflict('PROTECTED_VAS_BOUNDARY', [key, owner])
    for key, b in boundaries.items():
        for field in ('topDomainId', 'bottomDomainId', 'stationKnots', 'topEvidenceRefs', 'bottomEvidenceRefs', 'associationEvidenceRefs', 'endpointAttachmentRefs'):
            if b[field] is None or b[field] == []:
                miss('boundaries.' + key + '.' + field, 'missing wall association/profile')
        if b['topDomainId'] is None or b['bottomDomainId'] is None:
            continue
        top, bottom = domains[b['topDomainId']], domains[b['bottomDomainId']]
        # Boundary kind is bound above to literal barrier=retaining_wall.
        # Role compatibility is independent of names and numeric elevations.
        for side, domain, allowed in [('top', top, ('wall-crown', 'retained-ground')),
                                      ('bottom', bottom, ('wall-toe', 'lower-road'))]:
            if domain.get('role') is not None and domain['role'] not in allowed:
                conflict('WALL_ROLE_MISMATCH', [key, side, domain['id'], domain['role']])
        if top['id'] == bottom['id']:
            conflict('CONTINUOUS_ZERO', [key]); continue
        if not reaches(bottom['physicalOrderNode'], top['physicalOrderNode']):
            conflict('AMBIGUOUS_ORDER', [key])
        if b['stationKnots'] and any(d['stationing']['end'] is not None and b['stationKnots'][-1] != d['stationing']['end'] for d in (top, bottom)):
            conflict('GLOBAL_PROFILE_EXTENT_MISMATCH', [key])
        for role, d in (('top', top), ('bottom', bottom)):
            if set(b[role + 'EvidenceRefs']) != set(d['profileEvidenceRefs']):
                conflict('PROFILE_ASSOCIATION_MISMATCH', [key, role])
        if len(b['topEvidenceRefs']) != 1 or len(b['bottomEvidenceRefs']) != 1:
            miss('boundaries.' + key, 'single explicit profile per side required'); continue
        a, c = evidence[b['topEvidenceRefs'][0]], evidence[b['bottomEvidenceRefs'][0]]
        if a['verticalDatum'] != c['verticalDatum']:
            conflict('DATUM_MISMATCH', [key]); continue
        aa = {o['station']: o['interval'] for o in a['observations'] or []}
        cc = {o['station']: o['interval'] for o in c['observations'] or []}
        if set(aa) != set(b['stationKnots']) or set(cc) != set(b['stationKnots']):
            miss('boundaries.' + key + '.stationKnots', 'profile coverage incomplete')
        for station in sorted(set(aa) & set(cc)):
            t, lo = aa[station], cc[station]
            if t == lo and t[0] == t[1]:
                conflict('CONTINUOUS_ZERO', [key])
            elif t[1] < lo[0]:
                conflict('INVERTED_PROFILE', [key])
            elif t[0] <= lo[1]:
                conflict('UNDERCONSTRAINED_INTERVAL', [key])
    pair_claims, pair_conflicts, separated_pairs, components = {}, set(), {}, {}
    pair_work = pair_units = 0
    def component(node, domain):
        parents = components.setdefault(node, {})
        parents.setdefault(domain, domain)
        root = domain
        while parents[root] != root:
            root = parents[root]
        while parents[domain] != domain:
            parent = parents[domain]
            parents[domain] = root
            domain = parent
        return root
    for c in spec['connections']:
        # Bound pair expansion BEFORE sorting, allocating keys or walking pairs.
        count = len(c['incidentDomains'])
        pair_work += count * (count - 1) // 2
        if pair_work > 8192:
            raise ValueError('connection pair work cap')
        ids = sorted(c['incidentDomains'], key=lambda v: v.encode('utf-16-be'))
        for i, a in enumerate(ids):
            for b in ids[i+1:]:
                pair_units += sum(len(v.encode('utf-16-be')) // 2 for v in (c['sourceNodeRef'], a, b))
                if pair_units > MAX_STRING_UNITS:
                    raise ValueError('connection pair key cap')
                key = (c['sourceNodeRef'], a, b)
                previous = pair_claims.get(key)
                if c['kind'] == 'same-physical-node':
                    left, right = component(c['sourceNodeRef'], a), component(c['sourceNodeRef'], b)
                    components[c['sourceNodeRef']][right] = left
                else:
                    separated_pairs[key] = None
                if previous is not None and previous != c['kind'] and key not in pair_conflicts:
                    conflict('CONNECTION_RELATION_CONFLICT', list(key))
                    pair_conflicts.add(key)
                if previous is None:
                    pair_claims[key] = c['kind']
        if not c['evidenceRefs']:
            miss('connections.' + c['sourceNodeRef'], 'missing connection evidence')
        if c['kind'] == 'same-physical-node' and len({domains[d]['physicalOrderNode'] for d in c['incidentDomains']}) > 1:
            conflict('CROSS_LAYER_NODE', c['incidentDomains'])
    # Equality is transitive at this source node; separated claims cannot split
    # a same-node equivalence component assembled through overlapping records.
    for key in separated_pairs:
        node, a, b = key
        if component(node, a) == component(node, b) and key not in pair_conflicts:
            conflict('CONNECTION_RELATION_CONFLICT', list(key))
            pair_conflicts.add(key)
    p = spec['protection']
    for field in ('nativeManifestRef', 'vasSourceMapRef', 'impactEvidenceRef'):
        if p[field] is None:
            miss('protection.' + field, 'missing preservation evidence')
    if set(p['nativeIdentityRefs']) != set(native):
        miss('protection.nativeIdentityRefs', 'all 297 original identities required')
    if set(p['vasBoundaryOwnerRefs']) != set(vas['boundaryOwnerRefs']):
        conflict('VAS_BOUNDARY_INVENTORY_MISMATCH', ['protection'])
    scope = spec['sourceScope']
    if scope['completeness'] != 'metadata-declared-complete' or not scope['closureEvidenceRefs'] or not scope['familyRefs']:
        miss('sourceScope', 'complete families/closure evidence unavailable')
    return dict(schemaVersion=1, kind='unverified-source-domain-plan',
                sourceSpecSha256=hashlib.sha256(canonical_plan_bytes(spec)).hexdigest(),
                inventorySha256=hashlib.sha256(canonical_plan_bytes(inventory)).hexdigest(),
                releaseEligible=False, physicalConstructionEligible=False,
                evidenceState='declared-unverified', status='blocked' if missing or conflicts else 'contract-consistent',
                sourceSpec=copy.deepcopy(spec), missingFields=missing, conflicts=conflicts,
                scope=dict(affectedCells=None, completePhysicalScope=False), requiredFutureProofs=REQUIRED_PROOFS.copy())
