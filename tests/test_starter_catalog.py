"""The shipped classification pack must work before importing any real assets."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import server
from numbering import category_codes, get_catalog, next_code, valid_for_category
from starter_catalog import PACK, MIGRATION, seed


class StarterCatalog(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'new.sqlite3'
        with patch.object(server,'DB_PATH',self.path):server.initialize()
        self.db=sqlite3.connect(self.path);self.db.row_factory=sqlite3.Row

    def tearDown(self):
        self.db.close()
        try:
            self.temp.cleanup()
        except Exception:
            pass

    def office(self):
        return self.db.execute("SELECT id FROM asset_categories WHERE category_name='ครุภัณฑ์สำนักงาน' ORDER BY id LIMIT 1").fetchone()[0]

    def test_ready_catalogue_without_importing_assets(self):
        data=get_catalog(self.db,{'categoryId':[str(self.office())]})
        self.assertGreater(data['total'],100)
        self.assertGreater(data['starterTypeCount'],100)
        self.assertEqual(data['coverage']['registerRows'],0)
        self.assertTrue(any('เก้าอี้' in item['name'] for item in data['types']))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM assets').fetchone()[0],len(server.SAMPLE_ASSETS))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starter_catalog_rows').fetchone()[0],3279)
        self.assertEqual(self.db.execute('SELECT COUNT(DISTINCT category_id) FROM starter_catalog_rows').fetchone()[0],19)
        for item in data['items']:
            self.assertTrue(valid_for_category(self.db,self.office(),item['code']))
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_startup_is_idempotent_and_preserves_existing_edits_and_assets(self):
        category=self.office();assets=[tuple(row) for row in self.db.execute('SELECT id,code,name FROM assets ORDER BY id')]
        self.db.execute("UPDATE asset_categories SET notes='คู่มือที่หน่วยงานแก้เอง',is_active=0,category_name='ชื่อหมวดที่หน่วยงานแก้เอง',source_workbook='ครุภัณฑ์สำนักงาน.xls' WHERE id=?",(category,))
        self.db.execute('DELETE FROM schema_migrations WHERE name=?',(MIGRATION,));self.db.commit()
        seed(self.db);seed(self.db)
        self.assertEqual(tuple(self.db.execute('SELECT notes,is_active FROM asset_categories WHERE id=?',(category,)).fetchone()),('คู่มือที่หน่วยงานแก้เอง',0))
        self.assertEqual(self.db.execute('SELECT category_name FROM asset_categories WHERE id=?',(category,)).fetchone()[0],'ชื่อหมวดที่หน่วยงานแก้เอง')
        self.assertIsNone(self.db.execute("SELECT id FROM asset_categories WHERE category_name='ครุภัณฑ์สำนักงาน'").fetchone())
        self.assertEqual([tuple(row) for row in self.db.execute('SELECT id,code,name FROM assets ORDER BY id')],assets)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM starter_catalog_rows').fetchone()[0],3279)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM source_documents WHERE source_kind='classification_starter'").fetchone()[0],19)

    def test_numbering_respects_original_register_floor_and_newer_local_records(self):
        code,floor=self.db.execute('SELECT fsn_code,sequence_floor FROM starter_number_floors ORDER BY sequence_floor DESC LIMIT 1').fetchone()
        self.assertEqual(next_code(self.db,code),f'{code}-{floor+1:04d}')
        self.db.execute('INSERT INTO assets(name,code) VALUES(?,?)',('ทะเบียนที่เพิ่มใหม่',f'{code}-{floor+10:04d}/1'))
        self.assertEqual(next_code(self.db,code),f'{code}-{floor+11:04d}')

    def test_source_types_without_complete_number_remain_visible_for_review(self):
        category=self.db.execute("SELECT id FROM asset_categories WHERE category_name='ครุภัณฑ์วิทยาศาสตร์และการแพทย์'").fetchone()[0]
        data=get_catalog(self.db,{'categoryId':[str(category)]})
        unresolved=[item for item in data['types'] if not item['codes']]
        self.assertEqual(len(unresolved),3)
        self.assertIn('เครื่องอบความร้อนคลื่นสั้น',[item['name'] for item in unresolved])
        self.assertNotIn('',[item['code'] for item in data['items']])
        aliases=next(item for item in data['items'] if len(item['typeNames'])>1)
        self.assertGreater(len(aliases['typeNames']),1)

    def test_export_whitelists_classification_and_never_copies_asset_fields(self):
        root=Path(self.temp.name);source=root/'private.sqlite3'
        with sqlite3.connect(source) as db:
            db.execute('CREATE TABLE asset_categories(id,category_name,source_workbook)')
            db.execute('CREATE TABLE assets(id,category_id,asset_type,code,name,detail,contact)')
            db.execute("INSERT INTO asset_categories VALUES(1,'ครุภัณฑ์สำนักงาน','สำนักงาน.xls')")
            db.execute("INSERT INTO assets VALUES(1,1,'ตู้เอกสาร','7110-002-0001-0050','PRIVATE-NAME','PRIVATE-DETAIL','PRIVATE-CONTACT')")
            db.execute("INSERT INTO assets VALUES(2,1,'ชนิดยังไม่มีเลข','OLD/2569','PRIVATE-NAME-2','PRIVATE-DETAIL-2','PRIVATE-CONTACT-2')")
        spec=importlib.util.spec_from_file_location('build_starter',Path(__file__).resolve().parents[1]/'scripts/build-classification-catalog.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        exported=module.build(source);serialized=json.dumps(exported,ensure_ascii=False)
        self.assertNotIn('PRIVATE-',serialized)
        self.assertNotIn('7110-002-0001-0050',serialized)
        self.assertEqual(exported['sequenceFloors'],{'7110-002-0001':50})
        self.assertEqual(exported['summary']['typesWithoutFullCode'],1)
        pack=json.loads(PACK.read_text(encoding='utf-8'))
        self.assertEqual(pack['summary']['categories'],19)
        self.assertEqual(pack['summary']['categoryCodes'],1918)
        self.assertEqual(sum(len(t['codes']) for c in pack['categories'] for t in c['types']),3276)


try:
    from test_smart_workflow import HTTPFixture
except ModuleNotFoundError:
    from tests.test_smart_workflow import HTTPFixture
from urllib.parse import urlencode


class StarterHTTP(HTTPFixture):
    def test_choose_existing_source_type_and_register_without_import(self):
        categories=self.call('/api/catalog/categories')
        office=next(row['id'] for row in categories if row['name']=='ครุภัณฑ์สำนักงาน')
        data=self.call('/api/catalog/numbering?'+urlencode({'categoryId':office}))
        kind=next(item for item in data['types'] if item['name']=='เก้าอี้ทุกชนิด')
        code=kind['codes'][0]
        before=self.call('/api/catalog/numbering?'+urlencode({'categoryId':office,'code':code}))
        payload={'name':'เก้าอี้ที่ซื้อเพิ่ม','categoryId':office,'assetType':kind['name'],'fsnCode':code}
        self.call('/api/assets',{**payload,'assetType':'ชนิดที่ไม่ได้อยู่กับเลขนี้'},expected=400)
        created=self.call('/api/assets',payload,expected=201)
        self.assertEqual(created['code'],before['nextCode'])
        self.assertEqual(created['assetType'],kind['name'])
        self.assertEqual(created['fsnCode'],code)
        after=self.call('/api/catalog/numbering?'+urlencode({'categoryId':office,'code':code}))
        self.assertNotEqual(after['nextCode'],created['code'])
        self.assertEqual(len(self.call('/api/assets')),len(server.SAMPLE_ASSETS)+1)
