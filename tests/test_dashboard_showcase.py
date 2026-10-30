import unittest

from test_asset_photos import data_url, png
from test_smart_workflow import HTTPFixture, OFFICER

PATH = '/api/dashboard/showcase'


class DashboardShowcase(HTTPFixture):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        features = cls.call('/api/features')
        cls.call('/api/features', {'revision': features['revision'], 'flags': {'borrowIssueReturn': True}}, method='PUT')

    def move(self, asset_id, kind, **fields):
        return self.call(f'/api/lifecycle/assets/{asset_id}', {'kind': kind, 'actor': OFFICER, **fields})

    def center_asset(self, code):
        category = self.call('/api/catalog/categories')[0]['id']
        return self.call('/api/assets', {'name': 'หุ่นฝึกทักษะทางการแพทย์', 'code': code, 'categoryId': category,
                                         'location': 'ศูนย์แพทย์ ห้องฝึกทักษะ'}, expected=201)['id']

    def test_ranks_borrowed_assets_and_lists_current_loans(self):
        busy, issued, idle = self.asset('SHOW-0001'), self.asset('SHOW-0002'), self.asset('SHOW-0003')
        self.move(busy, 'loan', borrower='นศพ. ทดสอบ', dueAt='2026-01-05')
        self.move(busy, 'return')
        self.move(busy, 'loan', borrower='นศพ. ทดสอบ', dueAt='2020-01-01')
        self.move(issued, 'issue', recipient='หอผู้ป่วยอายุรกรรม')
        photo = self.call(f'/api/assets/{issued}/photos', {'image': data_url(png()), 'actor': OFFICER}, expected=201)

        data = self.call(PATH)
        self.assertTrue(data['borrowEnabled'])
        top = {item['id']: item for item in data['topBorrowed']}
        self.assertEqual(data['topBorrowed'][0]['id'], busy)
        self.assertEqual(top[busy]['borrowCount'], 2)
        self.assertEqual(top[busy]['state'], 'loaned')
        self.assertTrue(top[busy]['overdue'])
        self.assertEqual(top[issued]['state'], 'issued')
        self.assertEqual(top[issued]['photoUrl'], photo['thumbUrl'])
        self.assertEqual(top[issued]['fullPhotoUrl'], photo['url'])
        self.assertNotIn(idle, top)

        loans = data['onLoan']
        self.assertEqual(loans['total'], len(loans['items']))
        self.assertEqual(loans['overdue'], sum(item['overdue'] for item in loans['items']))
        mine = [item for item in loans['items'] if item['id'] in (busy, issued)]
        self.assertEqual([item['id'] for item in mine], [busy, issued])
        self.assertEqual(loans['items'][0]['id'], busy)
        self.assertEqual(mine[0]['holder'], 'นศพ. ทดสอบ')
        self.assertLess(mine[0]['daysLeft'], 0)
        self.assertIsNone(mine[1]['daysLeft'])

        self.assertEqual(data['recentPhotos']['items'][0]['id'], issued)
        self.assertEqual(data['recentPhotos']['items'][0]['photoUrl'], photo['thumbUrl'])

        counts = data['statusCounts']
        self.assertEqual(counts['loaned'] + counts['issued'], loans['total'])
        self.assertEqual(counts['total'], sum(counts[k] for k in ('ready', 'loaned', 'issued', 'repair', 'pending', 'other')))

    def test_center_focus_and_category_bubbles(self):
        center = self.center_asset('SHOW-C001')
        self.move(center, 'loan', borrower='อาจารย์แพทย์', dueAt='2099-01-01')
        other = self.asset('SHOW-C002')
        self.move(other, 'issue', recipient='งานพัสดุ')

        data = self.call(PATH + '?focus=center')
        self.assertEqual(data['focus'], 'center')
        self.assertGreaterEqual(data['center']['total'], 1)
        self.assertEqual(data['center']['categoriesScope'], 'center')
        self.assertTrue(data['center']['categories'])
        ids = {item['id'] for item in data['topBorrowed']}
        self.assertIn(center, ids)
        self.assertNotIn(other, ids)
        self.assertEqual(data['statusCounts']['total'], data['center']['total'])
        self.assertFalse(next(i for i in data['onLoan']['items'] if i['id'] == center)['overdue'])

    def test_rejects_writes_and_clamps_limits(self):
        self.call(PATH, {'actor': OFFICER}, expected=405)
        data = self.call(PATH + '?limit=999&photos=-4&days=abc')
        self.assertLessEqual(len(data['topBorrowed']), 24)
        self.assertEqual(data['windowDays'], 90)


if __name__ == '__main__':
    unittest.main()
