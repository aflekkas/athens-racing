"""Entirely synthetic metadata fixtures; never read OSM, DEM, profiles or cells."""
import copy
import hashlib
import json
import math
import unittest
from structure_domains import analyze_domain_plan, canonical_plan_bytes, projected_left_normal


def fixture():
    h = lambda n: hashlib.sha256(str(n).encode()).hexdigest()
    way = dict(id='fixture:wall', version=1, timestamp='2026-01-01T00:00:00Z', sourceSha256=h('source'), nodeRefsSha256=h('41,42'), geometrySha256=h('synthetic-line'), wayOrientation='original-node-order', sourceTags={'barrier':'retaining_wall','layer':'1','name':'Δοκιμή'})
    native = [dict(id='fixture:native:'+str(i), region='penteli' if i<225 else 'megara', world='fixture-native', revision='fixture-revision', cell=[i,1000], sha256=h(i), bytes=100, ownerRefs=['fixture:protected-owner:'+str(i)]) for i in range(297)]
    descriptors = [dict(id='fixture:'+n,sha256=h(n),kind='synthetic',authority='declared-unverified') for n in ['receipt','profile','uncertainty','recipe','association','attachment','order','native-manifest','impact','closure','policy','mask','family']]
    vas = dict(sourceMapSha256=h('vas'),boundaryOwnerRefs=['fixture:vas-boundary'],stateHashes={k:h(k) for k in ['classes','widths','ccw','planes','profiles','outerBand']})
    inventory = dict(schemaVersion=1,kind='declared-source-inventory',sourceWays=[copy.deepcopy(way)],evidenceDescriptors=descriptors,protectedNative=native,protectedVas=vas)
    evidence = [dict(id=role,kind='measured',sourceRef='fixture:receipt',units='m',verticalDatum='EGM2008',uncertainty=dict(lowerMetres=0,upperMetres=0,meaning='interval includes uncertainty',provenanceRef='fixture:uncertainty'),observations=[dict(station=s,interval=[y,y]) for s in [0,2]],metadata=dict(primaryProfileRef='fixture:profile',referenceHeightDefinition='synthetic absolute crown/toe, never a real survey')) for role,y in [('top',6),('bottom',0)]]
    domains = [dict(id=role,role='wall-crown' if role=='top' else 'wall-toe',sourceWayRef=way['id'],physicalOrderNode=role,stationing=dict(sourceWayRef=way['id'],direction='original-node-order',start=0,end=2),profileEvidenceRefs=[role],ownerAssociation=dict(sourceOwnerId='fixture:'+role,physicalLayer=1 if role=='top' else 0,recipeRef='fixture:recipe'),boundaryRefs=['fixture:boundary']) for role in ['top','bottom']]
    boundary = dict(id='fixture:boundary',sourceFeatureRef=way['id'],geometrySha256=way['geometrySha256'],retainedSide='left',lowerSide='right',topDomainId='top',bottomDomainId='bottom',stationKnots=[0,2],topEvidenceRefs=['top'],bottomEvidenceRefs=['bottom'],associationEvidenceRefs=['fixture:association'],endpointAttachmentRefs=['fixture:attachment'])
    spec = dict(schemaVersion=1,kind='source-domain-spec',mode='source-only',releaseEligible=False,sourceWays=[way],evidence=evidence,domains=domains,boundaries=[boundary],physicalOrder=dict(nodes=['top','bottom'],relations=[dict(lower='bottom',upper='top',evidenceRefs=['fixture:order'])],unknownRelations=[]),connections=[],protection=dict(nativeManifestRef='fixture:native-manifest',expectedNativeCounts=dict(penteli=225,megara=72),nativeIdentityRefs=[n['id'] for n in native],vasSourceMapRef=vas['sourceMapSha256'],vasBoundaryOwnerRefs=vas['boundaryOwnerRefs'].copy(),impactEvidenceRef='fixture:impact'),sourceScope=dict(familyRefs=['fixture:family'],completeness='metadata-declared-complete',closureEvidenceRefs=['fixture:closure'],affectedCells=None))
    return spec, inventory


def variants():
    """Each case is rechecked independently by the Node reader."""
    result = []
    def add(name, change):
        spec, inv = fixture(); change(spec, inv); result.append((name, spec, inv))
    add('distinct synthetic domains', lambda s,i: None)
    add('continuous zero', lambda s,i: [o.update(interval=[0,0]) for o in s['evidence'][0]['observations']])
    add('uncertain intervals', lambda s,i: [o.update(interval=[-1,7]) for o in s['evidence'][0]['observations']])
    add('inversion', lambda s,i: [o.update(interval=[-4,-2]) for o in s['evidence'][0]['observations']])
    add('ambiguous order', lambda s,i: s['physicalOrder'].update(relations=[]))
    add('cycle', lambda s,i: s['physicalOrder']['relations'].append(dict(lower='top',upper='bottom',evidenceRefs=['fixture:order'])))
    add('missing association', lambda s,i: s['boundaries'][0].update(topDomainId=None))
    add('missing datum', lambda s,i: s['evidence'][0].update(verticalDatum='unknown'))
    add('mixed datum', lambda s,i: s['evidence'][0].update(verticalDatum='EVRS2000'))
    add('native protected', lambda s,i: s['domains'][0]['ownerAssociation'].update(sourceOwnerId=i['protectedNative'][0]['ownerRefs'][0]))
    add('Vas protected', lambda s,i: s['domains'][0]['ownerAssociation'].update(sourceOwnerId='fixture:vas-boundary'))
    add('native incomplete refs', lambda s,i: s['protection']['nativeIdentityRefs'].pop())
    add('Vas boundary changed', lambda s,i: s['protection'].update(vasBoundaryOwnerRefs=[]))
    add('missing impact', lambda s,i: s['protection'].update(impactEvidenceRef=None))
    add('incomplete family', lambda s,i: s['sourceScope'].update(completeness='incomplete',closureEvidenceRefs=[]))
    add('missing uncertainty', lambda s,i: s['evidence'][0].update(uncertainty=None))
    add('missing policy', lambda s,i: s['evidence'][0].update(kind='model-inferred',metadata=dict(inferencePolicyRef=None,constraintInputRefs=['fixture:receipt'],notSurveyed=True)))
    add('missing DEM mask', lambda s,i: s['evidence'][0].update(kind='DEM-observed-outside',metadata=dict(rasterSha256='a'*64,product='synthetic DSM',epoch='2000',crs='EPSG:4326',transform=[1,0,0,0,-1,0],pixelWindow=[0,0,2,2],featureMaskSha256=None,classificationRef='fixture:mask',interpolationMethod='declared only',surveyedGround=False)))
    add('unknown relation', lambda s,i: s['physicalOrder']['unknownRelations'].append(dict(a='top',b='bottom',reason='missing order source',missingEvidence=['actual-profile'])))
    add('cross-layer junction', lambda s,i: s['connections'].append(dict(sourceNodeRef='fixture:n41',incidentDomains=['top','bottom'],kind='same-physical-node',evidenceRefs=['fixture:order'])))
    add('numeric binary64', lambda s,i: s['evidence'][0]['observations'][0].update(interval=[-0.0,1e-7]))
    return result


def review39_cases():
    """Role and per-source-node unordered-pair regressions; all synthetic."""
    cases=[]
    def add(name,change,status='blocked',code=None,connections=False):
        s,i=fixture()
        if connections:
            for key in ['a','b','c','d']:
                domain=copy.deepcopy(s['domains'][1]);domain.update(id=key,boundaryRefs=[])
                domain['ownerAssociation']['sourceOwnerId']='fixture:'+key
                s['domains'].append(domain)
        change(s);cases.append((name,s,i,status,code))
    def claim(ids,kind,node='fixture:n41'):
        return dict(sourceNodeRef=node,incidentDomains=ids,kind=kind,evidenceRefs=['fixture:order'])
    add('exact swapped wall roles',lambda s:[s['domains'][0].update(role='wall-toe'),s['domains'][1].update(role='wall-crown')],code='WALL_ROLE_MISMATCH')
    add('exact same and separated pair',lambda s:s.update(connections=[claim(['a','b'],'same-physical-node'),claim(['b','a'],'separated-crossing')]),code='CONNECTION_RELATION_CONFLICT',connections=True)
    for top in ['wall-crown','retained-ground']:
        for bottom in ['wall-toe','lower-road']:
            add('legitimate '+top+'/'+bottom,lambda s,t=top,b=bottom:[s['domains'][0].update(role=t),s['domains'][1].update(role=b)],status='contract-consistent')
    for side,role in [(0,'wall-toe'),(1,'wall-crown'),(0,'deck-top'),(1,'deck-underside')]:
        add('wrong side '+str(side)+' '+role,lambda s,n=side,r=role:s['domains'][n].update(role=r),code='WALL_ROLE_MISMATCH')
    add('missing explicit role',lambda s:s['domains'][0].update(role=None))
    add('omitted role',lambda s:s['domains'][1].pop('role'))
    def renamed(s):
        s['domains'][0]['id']='opaque-domain-z';s['domains'][1]['id']='opaque-domain-a'
        s['boundaries'][0].update(topDomainId='opaque-domain-z',bottomDomainId='opaque-domain-a')
    add('independent domain names',renamed,status='contract-consistent')
    for reverse_claims in [False,True]:
        for reverse_ids in [False,True]:
            def change(s,rc=reverse_claims,ri=reverse_ids):
                a=['a','b','c'];b=['d','c','b']
                rows=[claim(a[::-1] if ri else a,'same-physical-node'),claim(b[::-1] if ri else b,'separated-crossing')]
                s['connections']=rows[::-1] if rc else rows
            add('overlap permutations '+str((reverse_claims,reverse_ids)),change,code='CONNECTION_RELATION_CONFLICT',connections=True)
    add('duplicate contradiction',lambda s:s.update(connections=[claim(['a','b'],'same-physical-node'),claim(['b','a'],'separated-crossing'),claim(['a','b'],'separated-crossing')]),code='CONNECTION_RELATION_CONFLICT',connections=True)
    add('transitive shared contradiction',lambda s:s.update(connections=[claim(['a','b'],'same-physical-node'),claim(['b','c'],'same-physical-node'),claim(['a','c'],'separated-crossing')]),code='CONNECTION_RELATION_CONFLICT',connections=True)
    add('transitive reversed claims',lambda s:s.update(connections=[claim(['c','a'],'separated-crossing'),claim(['c','b'],'same-physical-node'),claim(['b','a'],'same-physical-node')]),code='CONNECTION_RELATION_CONFLICT',connections=True)
    add('transitive shared legitimate',lambda s:s.update(connections=[claim(['a','b'],'same-physical-node'),claim(['b','c'],'same-physical-node'),claim(['c','a'],'same-physical-node')]),status='contract-consistent',connections=True)
    add('different-node chains legitimate',lambda s:s.update(connections=[claim(['a','b'],'same-physical-node'),claim(['b','c'],'same-physical-node','fixture:n42'),claim(['c','a'],'separated-crossing')]),status='contract-consistent',connections=True)
    controls=[('duplicate same', [claim(['a','b'],'same-physical-node'),claim(['b','a'],'same-physical-node')]),('duplicate separated',[claim(['a','b'],'separated-crossing'),claim(['b','a'],'separated-crossing')]),('consistent overlap',[claim(['a','b','c'],'same-physical-node'),claim(['d','c','b'],'same-physical-node')]),('one-domain overlap',[claim(['a','b','c'],'same-physical-node'),claim(['c','d'],'separated-crossing')]),('different source nodes',[claim(['a','b'],'same-physical-node'),claim(['b','a'],'separated-crossing','fixture:n42')]),('disjoint pairs',[claim(['a','b'],'same-physical-node'),claim(['c','d'],'separated-crossing')])]
    for name,rows in controls:
        add(name,lambda s,r=rows:s.update(connections=r),status='contract-consistent',connections=True)
    return cases


def pair_cap_spec(key_units=False):
    s,i=fixture();ids=[]
    for n in range(20 if key_units else 130):
        key=('domain:'+str(n)).ljust(500,'x') if key_units else 'extra:'+str(n)
        d=copy.deepcopy(s['domains'][1]);d.update(id=key,boundaryRefs=[])
        d['ownerAssociation']['sourceOwnerId']='fixture:extra:'+str(n)
        s['domains'].append(d);ids.append(key)
    s['connections']=[dict(sourceNodeRef='n'*500 if key_units else 'fixture:cap-node',incidentDomains=ids,kind='separated-crossing',evidenceRefs=['fixture:order'])]
    return s,i


class DomainTests(unittest.TestCase):
    def test_review39_exact_swapped_roles(self):
        _,s,i,_,code=review39_cases()[0];p=analyze_domain_plan(s,i)
        self.assertEqual(p['status'],'blocked');self.assertIn(code,[c['code'] for c in p['conflicts']])

    def test_review39_exact_contradictory_pair(self):
        _,s,i,_,code=review39_cases()[1];p=analyze_domain_plan(s,i)
        self.assertEqual(p['status'],'blocked');self.assertIn(code,[c['code'] for c in p['conflicts']])

    def test_review39_roles_permutations_overlaps_duplicates_and_legitimate_controls(self):
        for name,s,i,status,code in review39_cases():
            with self.subTest(name=name):
                p=analyze_domain_plan(s,i);self.assertEqual(p['status'],status)
                if code:self.assertIn(code,[c['code'] for c in p['conflicts']])
                self.assertIs(p['releaseEligible'],False);self.assertIs(p['physicalConstructionEligible'],False)
                self.assertEqual(p['sourceSpec']['domains'],s['domains'])
                if name=='duplicate contradiction':self.assertEqual(sum(c['code']=='CONNECTION_RELATION_CONFLICT' for c in p['conflicts']),1)
                if name.startswith('overlap permutations'):
                    self.assertIn(['fixture:n41','b','c'],[c['ids'] for c in p['conflicts'] if c['code']=='CONNECTION_RELATION_CONFLICT'])
                if name in ('missing explicit role','omitted role'):self.assertTrue(any(m['path'].endswith('.role') for m in p['missingFields']))

    def test_review39_derived_pair_expansion_is_bounded_before_key_allocation(self):
        for key_units,message in [(False,'pair work cap'),(True,'pair key cap')]:
            s,i=pair_cap_spec(key_units)
            with self.subTest(key_units=key_units),self.assertRaisesRegex(ValueError,message):analyze_domain_plan(s,i)

    def test_distinct_metadata_never_physical(self):
        s,i=fixture();p=analyze_domain_plan(s,i)
        self.assertEqual(p['status'],'contract-consistent')
        self.assertIs(p['releaseEligible'],False);self.assertIs(p['physicalConstructionEligible'],False)
        self.assertEqual(p['evidenceState'],'declared-unverified');self.assertIsNone(p['scope']['affectedCells'])
        s['evidence'][0]['observations'][0]['interval'][0]=999
        self.assertEqual(p['sourceSpec']['evidence'][0]['observations'][0]['interval'][0],6)
        self.assertFalse(p['scope']['completePhysicalScope']);self.assertEqual(p['sourceSpec']['sourceWays'][0]['sourceTags']['layer'],'1')

    def test_all_negative_variants_block(self):
        for name,s,i in variants()[1:]:
            with self.subTest(name=name):self.assertEqual(analyze_domain_plan(s,i)['status'],'blocked')

    def test_orientation_is_original_negative_north(self):
        self.assertEqual(projected_left_normal(1,0),(0,-1));self.assertEqual(projected_left_normal(-1,0),(0,1));self.assertEqual(projected_left_normal(0,-1),(-1,0))
        with self.assertRaises(ValueError):projected_left_normal(0,0)

    def test_source_reversal_version_hash_malformed(self):
        for field,value in [('nodeRefsSha256','f'*64),('version',2),('sourceSha256','x'),('wayOrientation','reversed')]:
            s,i=fixture();s['sourceWays'][0][field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):analyze_domain_plan(s,i)

    def test_unknown_fields_units_flags_refs_and_layer_metres_reject(self):
        changes=[lambda s,i:s.update(physicalConstructionEligible=True),lambda s,i:s.update(releaseEligible=0),lambda s,i:s['evidence'][0].update(units='feet'),lambda s,i:s['domains'][0]['profileEvidenceRefs'].append('unknown'),lambda s,i:s['sourceWays'][0]['sourceTags'].update(layer=1),lambda s,i:s['domains'][0]['ownerAssociation'].update(physicalLayer=1.5),lambda s,i:s.update(schemaVersion=True)]
        for change in changes:
            s,i=fixture();change(s,i)
            with self.assertRaises(ValueError):analyze_domain_plan(s,i)

    def test_protected297_and_vas_original_inventory_required(self):
        s,i=fixture();i['protectedNative'].pop()
        with self.assertRaises(ValueError):analyze_domain_plan(s,i)
        s,i=fixture();s['protection']['vasSourceMapRef']='f'*64
        with self.assertRaises(ValueError):analyze_domain_plan(s,i)
        for k in ['classes','widths','ccw','planes','profiles','outerBand']:
            s,i=fixture();i['protectedVas']['stateHashes'][k]='not-a-hash'
            with self.subTest(k=k),self.assertRaises(ValueError):analyze_domain_plan(s,i)

    def test_scope_cannot_claim_cells_or_adoption(self):
        s,i=fixture();s['sourceScope']['affectedCells']=[[12,-14]]
        with self.assertRaises(ValueError):analyze_domain_plan(s,i)
        s,i=fixture();s['evidence'][0]['kind']='model-inferred';s['evidence'][0]['metadata']={'notSurveyed':False}
        with self.assertRaises(ValueError):analyze_domain_plan(s,i)

    def test_canonical_exact_numbers_signed_zero_and_exponents(self):
        self.assertEqual(canonical_plan_bytes(1.0),b'1');self.assertEqual(canonical_plan_bytes(-0.0),b'-0.0')
        for value in [0.1,1e-7,1e20,5e-324,float.fromhex('0x1.fffffffffffffp+1023'),-1.2345678901234567]:
            raw=canonical_plan_bytes(value);back=json.loads(raw)
            self.assertEqual(float(back).hex(),value.hex());self.assertNotIn(b'e',raw.lower())
        for value in [float('nan'),float('inf'),2**53,{'x':object()}]:
            with self.assertRaises(ValueError):canonical_plan_bytes(value)

    def test_unicode_control_and_cycle_caps(self):
        self.assertEqual(canonical_plan_bytes({'😀':'Δ\n'}),b'{"\\ud83d\\ude00":"\\u0394\\n"}')
        for value in ['\ud800','x'*2049,list(range(8193)),{'__proto__':1}]:
            with self.assertRaises(ValueError):canonical_plan_bytes(value)
        v=[];v.append(v)
        with self.assertRaises(ValueError):canonical_plan_bytes(v)
        v=0
        for _ in range(18):v=[v]
        with self.assertRaises(ValueError):canonical_plan_bytes(v)

    def test_unknown_family_duplicate_native_and_extent_are_not_silently_accepted(self):
        s,i=fixture();s['sourceScope']['familyRefs']=['unknown']
        with self.assertRaises(ValueError):analyze_domain_plan(s,i)
        s,i=fixture();i['protectedNative'][1]['cell']=i['protectedNative'][0]['cell'].copy()
        with self.assertRaises(ValueError):analyze_domain_plan(s,i)
        s,i=fixture();s['domains'][0]['stationing']['end']=3
        self.assertIn('GLOBAL_PROFILE_EXTENT_MISMATCH',[c['code'] for c in analyze_domain_plan(s,i)['conflicts']])

    def test_generated_issue_budget_rejects_without_truncation(self):
        s,i=fixture()
        for n in range(160):
            s['evidence'].append(dict(id='missing:'+str(n),kind='DEM-observed-outside',sourceRef=None,units='m',verticalDatum='unknown',uncertainty=None,observations=None,metadata={}))
        with self.assertRaisesRegex(ValueError,'issue graph cap'):analyze_domain_plan(s,i)

    def test_numeric_interval_is_preserved_not_midpoint_selected(self):
        s,i=fixture();s['evidence'][0]['observations'][0]['interval']=[0.1,7.000000000000001];p=analyze_domain_plan(s,i)
        self.assertEqual(p['sourceSpec']['evidence'][0]['observations'][0]['interval'],[0.1,7.000000000000001])
        self.assertFalse(any(k in p for k in ['height','y','certificate','mesh']))


if __name__=='__main__':unittest.main()
