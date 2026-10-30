import sqlite3
import unittest
import uuid
from datetime import date, timedelta

from test_smart_workflow import HTTPFixture, OFFICER

SHOWCASE = '/api/dashboard/showcase'
ORDER = '/api/assets/featured/order'


class DashboardFeatured(HTTPFixture):
    def pin(self, asset_id, note='', actor=OFFICER, expected=201):
        return self.call(f'/api/assets/{asset_id}/featured', {'note': note, 'actor': actor}, expected=expected)

    def unpin(self, asset_id, actor=OFFICER, expected=200):
        return self.call(f'/api/assets/{asset_id}/featured/remove', {'actor': actor}, expected=expected)

    def featured_ids(self):
        return [item['id'] for item in self.call(SHOWCASE)['featured']]

    def test_pin_note_reorder_unpin_and_history(self):
        a, b, c = self.asset('FEAT-0001'), self.asset('FEAT-0002'), self.asset('FEAT-0003')
        first = self.pin(a, 'หุ่นฝึกใส่ท่อช่วยหายใจ สำหรับนักศึกษาแพทย์ปี 4')
        self.assertEqual([i['id'] for i in first['items']], [a])
        self.assertTrue(first['state']['pinned'])
        self.pin(b)
        self.pin(c, 'เครื่องจำลองสถานการณ์')
        self.assertEqual(self.featured_ids(), [a, b, c])
        card = self.call(SHOWCASE)['featured'][0]
        self.assertEqual(card['note'], 'หุ่นฝึกใส่ท่อช่วยหายใจ สำหรับนักศึกษาแพทย์ปี 4')
        self.assertEqual(card['pinnedBy'], OFFICER)
        self.assertIn(card['state'], ('ready', 'pending', 'other', 'repair', 'loaned', 'issued'))

        reordered = self.call(ORDER, {'assetIds': [c, a, b], 'actor': OFFICER})
        self.assertEqual([i['id'] for i in reordered['items']], [c, a, b])
        self.assertEqual(self.featured_ids(), [c, a, b])

        edited = self.pin(a, 'ใช้ในห้องฝึกทักษะ', expected=200)
        self.assertEqual(edited['state']['note'], 'ใช้ในห้องฝึกทักษะ')
        state = self.call(f'/api/assets/{a}/featured')
        self.assertEqual((state['pinned'], state['note'], state['max']), (True, 'ใช้ในห้องฝึกทักษะ', 12))

        after = self.unpin(b)
        self.assertEqual([i['id'] for i in after['items']], [c, a])
        self.assertFalse(after['state']['pinned'])
        self.unpin(b, expected=404)
        self.call(ORDER, {'assetIds': [a, b], 'actor': OFFICER}, expected=404)
        self.call(ORDER, {'assetIds': [a, a], 'actor': OFFICER}, expected=400)
        self.pin(a, 'x' * 201, expected=400)

        actions = [e['action'] for e in self.smart(b)['events']]
        self.assertIn('ปักหมุดอุปกรณ์เด่น', actions)
        self.assertIn('เลิกปักหมุดอุปกรณ์เด่น', actions)
        for asset_id in (a, c):
            self.unpin(asset_id)

    def test_requester_and_anonymous_cannot_change_pins(self):
        asset_id = self.asset('FEAT-0101')
        self.pin(asset_id, actor='ผู้แจ้ง', expected=403)
        self.pin(asset_id, actor='', expected=403)
        self.pin(asset_id)
        self.unpin(asset_id, actor='ผู้แจ้ง', expected=403)
        self.call(ORDER, {'assetIds': [asset_id], 'actor': 'ผู้แจ้ง'}, expected=403)
        self.call('/api/assets/999999/featured', {'actor': OFFICER}, expected=404)
        self.unpin(asset_id)

    def test_cap_at_twelve_pins(self):
        ids = [self.asset(f'FEAT-CAP-{i:02d}') for i in range(13)]
        try:
            for asset_id in ids[:12]:
                self.pin(asset_id)
            self.pin(ids[12], expected=409)
            self.assertEqual(len(self.featured_ids()), 12)
        finally:
            for asset_id in ids[:12]:
                self.unpin(asset_id, expected=200)

    def test_today_work_counts_and_ordering(self):
        asset_id = self.asset('TODAY-0001')
        before = self.call(SHOWCASE)['todayWork']
        today = date.today()
        with sqlite3.connect(self.db) as db:
            def ticket(status, created):
                db.execute("INSERT INTO tickets(ticket_no,asset_id,asset_name,location,issue,requester,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
                           ('T-' + uuid.uuid4().hex[:10], asset_id, 'เครื่องทดสอบ', 'ห้อง A', 'เสีย', 'ผู้แจ้ง', status, created))
            ticket('กำลังซ่อม', '2020-01-01 08:00:00')
            ticket('รับแจ้งใหม่', '2026-01-01 08:00:00')
            ticket('รออนุมัติ', '2021-01-01 08:00:00')
            ticket('ปิดงาน', '2019-01-01 08:00:00')
            plan = db.execute("INSERT INTO work_plans(kind,name,schedule_mode,interval_days,next_due,assignment_mode,assignees_json,created_at,created_by) "
                              "VALUES('pm','PM ทดสอบ','manual',30,?,'manual','[\"ช่าง\"]',?,?)", (today.isoformat(), today.isoformat(), OFFICER)).lastrowid
            for due, status in ((today - timedelta(days=3), 'pending'), (today, 'in_progress'), (today + timedelta(days=2), 'pending'), (today - timedelta(days=9), 'completed')):
                db.execute("INSERT INTO scheduled_work(plan_id,asset_id,due_on,assignee,status) VALUES(?,?,?,?,?)", (plan, asset_id, due.isoformat(), 'ช่าง', status))
            db.execute("INSERT OR REPLACE INTO asset_custody_state(asset_id,custodian,loan_status,due_at) VALUES(?,?,?,?)",
                       (asset_id, 'นศพ. ทดสอบ', 'loaned', (today - timedelta(days=4)).isoformat()))

        work = self.call(SHOWCASE)['todayWork']
        self.assertEqual(work['approvals']['tickets'] - before['approvals']['tickets'], 1)
        self.assertEqual(work['approvals']['total'], work['approvals']['tickets'] + work['approvals']['assets'])
        self.assertEqual(work['repairs']['total'] - before['repairs']['total'], 3)
        self.assertEqual(work['repairs']['byStatus'].get('รับแจ้งใหม่', 0) - before['repairs']['byStatus'].get('รับแจ้งใหม่', 0), 1)
        self.assertEqual(work['repairs']['items'][0]['status'], 'รับแจ้งใหม่')
        self.assertNotIn('ปิดงาน', {i['status'] for i in work['repairs']['items']})
        self.assertEqual(work['maintenance']['total'] - before['maintenance']['total'], 2)
        self.assertEqual(work['maintenance']['overdue'] - before['maintenance']['overdue'], 1)
        late = next(i for i in work['maintenance']['items'] if i['assetId'] == asset_id)
        self.assertEqual((late['daysLate'], late['kind'], late['planName']), (3, 'pm', 'PM ทดสอบ'))
        self.assertEqual(work['overdueLoans']['total'] - before['overdueLoans']['total'], 1)
        loan = next(i for i in work['overdueLoans']['items'] if i['assetId'] == asset_id)
        self.assertEqual((loan['daysLate'], loan['holder']), (4, 'นศพ. ทดสอบ'))


class AuthenticatedFeatured(HTTPFixture):
    auth_required = '1'

    @classmethod
    def setUpClass(cls):
        from test_access_control import Client
        super().setUpClass()
        cls.Client = Client
        cls.admin = Client(cls.base)
        cls.admin.call('/api/auth/setup', {'username': 'feat.admin', 'name': 'ผู้ดูแล', 'password': 'Test-only-pass-2026'})
        cls.admin.call('/api/auth/scope', {'accountId': None, 'branchId': None, 'actor': OFFICER})
        cls.aid = cls.admin.call('/api/governance/accounts', {'name': 'ศูนย์แพทย์ทดสอบ', 'code': uuid.uuid4().hex}, expected=201)['id']
        cls.other = cls.admin.call('/api/governance/accounts', {'name': 'องค์กรอื่น', 'code': uuid.uuid4().hex}, expected=201)['id']
        category = cls.admin.call('/api/catalog/categories')[0]['id']
        with sqlite3.connect(cls.db) as db:
            cls.mine, cls.foreign = [db.execute(
                "INSERT INTO assets(name,code,group_name,location,category_id,created_at,numbering_account_id,status) VALUES(?,?,'กลุ่ม','ศูนย์แพทย์',?,'2026-10-18',?,'ทะเบียนแล้ว')",
                (name, uuid.uuid4().hex, category, account)).lastrowid for name, account in (('หุ่นฝึก', cls.aid), ('ของอีกองค์กร', cls.other))]

    def login(self, actor, **permissions):
        name = 'feat.' + uuid.uuid4().hex[:10]
        self.admin.call('/api/auth/users', {'username': name, 'name': 'เจ้าหน้าที่', 'password': 'Test-only-pass-2026', 'globalRole': 'user',
                                            'memberships': [{'accountId': self.aid, 'branchId': None, 'permissions': {'view': True, **permissions}}]}, expected=201)
        client = self.Client(self.base)
        client.call('/api/auth/login', {'username': name, 'password': 'Test-only-pass-2026'})
        client.call('/api/auth/scope', {'accountId': self.aid, 'branchId': None, 'actor': actor})
        return client

    def test_staff_pin_inside_scope_and_viewer_is_refused(self):
        staff = self.login(OFFICER, edit=True)
        pinned = staff.call(f'/api/assets/{self.mine}/featured', {'note': 'ฝึกหัตถการ'}, expected=201)
        self.assertEqual([i['id'] for i in pinned['items']], [self.mine])
        staff.call(f'/api/assets/{self.foreign}/featured', {'note': ''}, expected=404)
        self.assertEqual([i['id'] for i in staff.call(ORDER, {'assetIds': [self.mine]})['items']], [self.mine])
        self.assertEqual([i['id'] for i in staff.call(SHOWCASE)['featured']], [self.mine])
        self.assertIn('todayWork', staff.call(SHOWCASE))

        viewer = self.login('ผู้แจ้ง')
        self.assertEqual([i['id'] for i in viewer.call(SHOWCASE)['featured']], [self.mine])
        viewer.call(f'/api/assets/{self.mine}/featured/remove', {}, expected=403)
        staff.call(f'/api/assets/{self.mine}/featured/remove', {})
        self.assertEqual(staff.call(SHOWCASE)['featured'], [])


if __name__ == '__main__':
    unittest.main()
