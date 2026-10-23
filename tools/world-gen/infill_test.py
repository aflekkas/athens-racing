"""Focused source-backed infill regressions: python tools/world-gen/infill_test.py."""
import json
from pathlib import Path
import tempfile
import sqlite3
import unittest
from shapely.geometry import box, mapping
from infill import SourceContext, lots_in, build
from model import building_height


def dense_rows(tags=None):
    # Dense, independent, actual-source building footprints around a free lot.
    return [(f'w{i}', box(x, z, x + 35, z + 35), dict(tags or {'building': 'yes'}))
            for i, (x, z) in enumerate(( (x,z) for x in range(-140,141,40)
                                         for z in range(-140,141,40)
                                         if abs(x)>40 or abs(z)>40))]


class InfillContextTests(unittest.TestCase):
    def setUp(self):
        self.lot = box(-6, -8, 6, 8)

    def test_dense_mapped_defaults_keep_existing_lots_and_floors(self):
        context = SourceContext(dense_rows())
        decision = context.decision(self.lot)
        self.assertTrue(decision['eligible'])
        self.assertGreater(decision['mappedCover'], .35)
        self.assertEqual(decision['storeys'], [4, 7])
        self.assertEqual(decision['explicitResidentialHeights'], 0)
        interior = box(-25,-25,25,25)
        self.assertEqual(lots_in(interior), lots_in(interior, context=context))

    def test_source_sparse_unknown_and_empty_residential_do_not_invent_bodies(self):
        sparse = [(f'w{i}', box(x, z, x+15, z+18), {'building':'yes'})
                  for i,(x,z) in enumerate(( (x,z) for x in range(-130,131,50)
                                            for z in range(-130,131,50)))]
        for rows in ([], sparse):
            context = SourceContext(rows)
            self.assertEqual(context.decision(self.lot)['reason'], 'source-sparse')
            self.assertEqual(lots_in(box(-25,-25,25,25), context=context), [])
        generated = [(i, g, dict(t, generated='yes')) for i,g,t in dense_rows()]
        self.assertFalse(SourceContext(generated).decision(self.lot)['eligible'])

    def test_mapped_green_is_excluded_even_in_dense_source_context(self):
        for tags in ({'leisure':'garden'}, {'leisure':'park'}, {'natural':'wood'}, {'landuse':'forest'}):
            context = SourceContext(dense_rows()+[('wgreen', self.lot, tags)])
            self.assertEqual(context.decision(self.lot)['reason'], 'mapped-green')
            self.assertFalse(context.decision(self.lot)['eligible'])

    def test_typed_low_rise_and_ancillary_roofs_do_not_justify_apartment_infill(self):
        self.assertEqual(SourceContext(dense_rows({'building':'house'})).decision(self.lot)['reason'], 'source-low-rise')
        roof = SourceContext(dense_rows({'building':'roof'})).decision(self.lot)
        self.assertFalse(roof['eligible'])
        self.assertEqual(roof['mappedBuildings'], 0)

    def test_representative_explicit_residential_heights_cap_inferred_scale(self):
        for tags in ({'building':'apartments','height':'9.6'}, {'building':'yes','building:levels':'2'}):
            d = SourceContext(dense_rows(tags)).decision(self.lot)
            self.assertTrue(d['eligible'])
            expected = 3 if 'height' in tags else 2
            self.assertEqual(d['storeys'], [expected, expected])
        hotel = dense_rows({'building':'hotel','building:levels':'2'})
        self.assertEqual(SourceContext(hotel).decision(self.lot)['storeys'], [4,7])
        few = dense_rows()
        few[0] = (few[0][0],few[0][1],{'building':'yes','height':'3.2'})
        self.assertEqual(SourceContext(few).decision(self.lot)['storeys'], [4,7])
        self.assertEqual(SourceContext(dense_rows()).decision(self.lot,(1,3))['storeys'], [1,3])

    def test_context_unions_overlap_and_is_independent_of_source_order(self):
        rows = dense_rows()
        a = SourceContext(rows).decision(self.lot)
        self.assertEqual(a, SourceContext(list(reversed(rows))).decision(self.lot))
        b = SourceContext(rows + [(i+'copy',g,t) for i,g,t in rows]).decision(self.lot)
        self.assertEqual(a['mappedCover'],b['mappedCover'])

    def test_roof_fallback_is_labelled_and_explicit_height_and_levels_win(self):
        self.assertEqual(building_height({'building':'roof'},'residential'), (3.2,'building-default'))
        self.assertEqual(building_height({'building':'roof','height':'7'},'residential'), (7,'height'))
        self.assertEqual(building_height({'building':'roof','height':'varies','building:levels':'2'},'residential'), (6.4,'levels'))
        self.assertEqual(building_height({'building':'yes'},'residential'), (9.6,'landuse-default'))
        self.assertEqual(building_height({'roof:shape':'flat','building':'yes'},'residential'), (9.6,'landuse-default'))

    def test_raw_sqlite_source_retains_tags_and_clean_default_is_not_height_evidence(self):
        with sqlite3.connect(':memory:') as db:
            db.executescript('CREATE TABLE features(id,kind,tags,geometry); CREATE VIRTUAL TABLE spatial USING rtree(rowid,minx,maxx,minz,maxz);')
            for i,g,t in dense_rows({'building':'apartments','building:levels':'2'}):
                cur=db.execute('INSERT INTO features VALUES(?,?,?,?)',(i,'building',json.dumps(t),g.wkb))
                a,b,c,d=g.bounds
                db.execute('INSERT INTO spatial VALUES(?,?,?,?,?)',(cur.lastrowid,a,c,b,d))
            self.assertEqual(SourceContext.from_database(db,(-300,-300,300,300)).decision(self.lot)['storeys'],[2,2])
        with sqlite3.connect(':memory:') as db:
            db.executescript('CREATE TABLE objects(id,kind,data); CREATE VIRTUAL TABLE spatial USING rtree(rowid,minx,maxx,minz,maxz);')
            for i,g,t in dense_rows():
                v={'parts':[{'footprint':list(g.exterior.coords),'height':9.6,'heightSource':'landuse-default'}]}
                cur=db.execute('INSERT INTO objects VALUES(?,?,?)',(i,'building',json.dumps(v)))
                a,b,c,d=g.bounds
                db.execute('INSERT INTO spatial VALUES(?,?,?,?,?)',(cur.lastrowid,a,c,b,d))
            decision=SourceContext.from_database(db,(-300,-300,300,300),clean=True).decision(self.lot)
            self.assertEqual(decision['explicitResidentialHeights'],0)
            self.assertEqual(decision['storeys'],[4,7])

    def test_build_uses_raw_context_and_records_only_eligible_generated_evidence(self):
        with tempfile.TemporaryDirectory(prefix='infill-test-') as tmp:
            root=Path(tmp)
            for name in ('plazas','lawns'):
                (root/(name+'.json')).write_text('{"plazas": []}')
            with sqlite3.connect(root/'clean.sqlite') as db:
                db.executescript('CREATE TABLE objects(id,kind,data); CREATE VIRTUAL TABLE spatial USING rtree(rowid,minx,maxx,minz,maxz);')
                features=[('landuse:wblock','landuse',{'tags':{'landuse':'residential'},'geometry':mapping(box(-30,-30,30,30))},box(-30,-30,30,30))]
                features += [(i,'building',{'parts':[{'footprint':list(g.exterior.coords),'height':9.6,'heightSource':'landuse-default'}]},g) for i,g,_ in dense_rows()]
                for i,kind,v,g in features:
                    cur=db.execute('INSERT INTO objects VALUES(?,?,?)',(i,kind,json.dumps(v)))
                    a,b,c,d=g.bounds
                    db.execute('INSERT INTO spatial VALUES(?,?,?,?,?)',(cur.lastrowid,a,c,b,d))
            with sqlite3.connect(root/'source.sqlite') as db:
                db.executescript('CREATE TABLE features(id,kind,tags,geometry); CREATE VIRTUAL TABLE spatial USING rtree(rowid,minx,maxx,minz,maxz);')
                for i,g,t in dense_rows():
                    cur=db.execute('INSERT INTO features VALUES(?,?,?,?)',(i,'building',json.dumps(t),g.wkb))
                    a,b,c,d=g.bounds
                    db.execute('INSERT INTO spatial VALUES(?,?,?,?,?)',(cur.lastrowid,a,c,b,d))
            before=(root/'clean.sqlite').read_bytes()
            result=build(root,root,root/'infill.sqlite',(-200,-200,200,200))
            self.assertGreater(result['stats']['lots'],0)
            self.assertEqual(result['policy']['minLocalCover'],.35)
            with sqlite3.connect(root/'infill.sqlite') as db:
                records=[json.loads(r[0]) for r in db.execute('SELECT data FROM objects')]
                self.assertEqual(len(records),result['stats']['lots'])
                self.assertTrue(all(v['generated'] and v['infillEvidence']['eligible'] and v['infillEvidence']['inferred'] for v in records))
            with sqlite3.connect(root/'source.sqlite') as db:
                db.execute('DELETE FROM features')
                db.execute('DELETE FROM spatial')
            sparse=build(root,root,root/'sparse.sqlite',(-200,-200,200,200))
            self.assertEqual(sparse['stats']['lots'],0)
            self.assertEqual((root/'clean.sqlite').read_bytes(),before)


if __name__ == '__main__':
    unittest.main()
