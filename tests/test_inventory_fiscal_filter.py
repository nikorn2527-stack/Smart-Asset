import sqlite3
from urllib.parse import urlencode

from test_smart_workflow import HTTPFixture


class InventoryFiscalFilter(HTTPFixture):
    def test_multiple_years_and_unassigned_year_are_filterable(self):
        ids = [self.asset(f'FISCAL-{index}') for index in range(3)]
        with sqlite3.connect(self.db) as db:
            db.execute("UPDATE assets SET fiscal_year_th='2568', acquired_year='' WHERE id=?", (ids[0],))
            db.execute("UPDATE assets SET fiscal_year_th='2567', acquired_year='' WHERE id=?", (ids[1],))
            db.execute("UPDATE assets SET fiscal_year_th='', acquired_year='' WHERE id=?", (ids[2],))
            db.execute("INSERT INTO asset_acquisitions(asset_id,fiscal_year_th) VALUES(?,?)", (ids[1], '2569'))

        selected = urlencode([('fiscalYear', '2568'), ('fiscalYear', '2569')])
        result = self.call('/api/inventory?' + selected)
        self.assertEqual({item['id'] for item in result['items']}, {ids[0], ids[1]})
        self.assertEqual(result['total'], 2)

        unassigned = self.call('/api/inventory?fiscalYear=__unassigned__')
        unassigned_ids = {item['id'] for item in unassigned['items']}
        self.assertIn(ids[2], unassigned_ids)
        self.assertNotIn(ids[0], unassigned_ids)
        self.assertNotIn(ids[1], unassigned_ids)

        facets = self.call('/api/inventory/facets')['fiscalYears']
        counts = {item['value']: item['count'] for item in facets}
        self.assertEqual(counts['2569'], 1)
        self.assertEqual(counts['2568'], 1)
        self.assertGreaterEqual(counts['__unassigned__'], 1)

    def test_multiple_inventory_filters_use_or_within_and_across_groups(self):
        categories = self.call('/api/catalog/categories')
        self.assertGreaterEqual(len(categories), 2)
        ids = [self.asset(f'FILTER-{index}') for index in range(3)]
        self.call('/api/inventory')
        with sqlite3.connect(self.db) as db:
            db.execute("UPDATE assets SET category_id=?,status='พร้อมใช้',building='อาคาร A',floor='ชั้น 1',room='ห้อง A' WHERE id=?", (categories[0]['id'], ids[0]))
            db.execute("UPDATE assets SET category_id=?,status='รอตรวจสอบ',building='อาคาร B',floor='ชั้น 2',room='ห้อง B' WHERE id=?", (categories[1]['id'], ids[1]))
            db.execute("UPDATE assets SET category_id=?,status='ไม่อนุมัติ',building='อาคาร C',floor='ชั้น 3',room='ห้อง C' WHERE id=?", (categories[0]['id'], ids[2]))

        selected = urlencode([
            ('category', str(categories[0]['id'])), ('category', str(categories[1]['id'])),
            ('status', 'พร้อมใช้'), ('status', 'รอตรวจสอบ'),
            ('building', 'อาคาร A'), ('building', 'อาคาร B'),
            ('floor', 'ชั้น 1'), ('floor', 'ชั้น 2'),
            ('room', 'ห้อง A'), ('room', 'ห้อง B'),
        ])
        result = self.call('/api/inventory?' + selected)
        self.assertEqual({item['id'] for item in result['items']}, set(ids[:2]))
        self.assertEqual(result['total'], 2)
