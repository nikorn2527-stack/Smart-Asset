"""QR Smart: flags, location guest reports, screening, lifecycle, and public scan."""
import json
import sqlite3
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from qr_smart import DEFAULT_FLAGS
from test_access_control import Client
from test_smart_workflow import APPROVER, HTTPFixture, OFFICER, TECH


class QrSmart(HTTPFixture):
    def tearDown(self):
        current = self.call('/api/features')
        if current['flags'] != DEFAULT_FLAGS:
            self.call('/api/features', {'flags': dict(DEFAULT_FLAGS), 'revision': current['revision'], 'actor': OFFICER}, method='PUT')

    def uniq(self, prefix='QR'):
        return prefix + '-' + uuid.uuid4().hex[:10]

    def enable_location_and_borrow(self):
        current = self.call('/api/features')
        return self.call('/api/features', {'flags': {'locationQr': True, 'borrowIssueReturn': True}, 'revision': current['revision'], 'actor': OFFICER}, method='PUT')

    def location(self, name=None, **fields):
        body = {'kind': 'room', 'name': name or self.uniq('ห้อง'), 'publicName': fields.pop('publicName', None),
                'publicInfo': fields.pop('publicInfo', 'จุดบริการทดสอบ'), 'isActive': True, 'guestCanReportPlace': True,
                'code': fields.pop('code', self.uniq('LOC')), 'actor': OFFICER, **fields}
        if not body['publicName']:
            body['publicName'] = body['name']
        return self.call('/api/qr/locations', body, expected=201)

    def place_report(self, token, issue=None, expected=201, **extra):
        body = {'issue': issue or self.uniq('อาการ'), 'requester': 'ผู้มาเยือน', 'contact': '0800000000',
                'urgency': 'ปกติ', 'problemType': 'อื่นๆ', **extra}
        return self.call(f'/api/places/{token}/reports', body, expected=expected)

    def ticket_by_no(self, ticket_no):
        return next(t for t in self.call('/api/tickets') if t['ticketNo'] == ticket_no)

    def integrity(self):
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_existing_asset_qr_scan_hides_custodian_and_contact(self):
        public = self.call('/api/qr/public-config')
        self.assertEqual(public['flags']['assetQr'], True)
        self.assertEqual(public['flags']['locationQr'], False)
        self.assertNotIn('custodian', json.dumps(public))
        aid = self.asset(self.uniq('SCAN'))
        before = self.smart(aid)
        self.call(f'/api/assets/{aid}/smart', self.edit(before, custodian='ผู้ครอบครองลับ', serialNumber='SN-HIDE'), method='PUT')
        token = before['qrUrl'].rsplit('/', 1)[1]
        scan = self.call('/api/scan/' + token)
        self.assertEqual(scan['serialNumber'], 'SN-HIDE')
        self.assertNotIn('custodian', scan)
        self.assertNotIn('contact', scan)
        encoded = json.dumps(scan)
        self.assertNotIn('"custodian"', encoded)
        self.assertNotIn('"contact"', encoded)

    def test_guest_asset_repair_creates_ticket_and_ignores_forged_asset_id(self):
        aid = self.asset(self.uniq('REP'))
        token = self.smart(aid)['qrUrl'].rsplit('/', 1)[1]
        receipt = self.call(f'/api/scan/{token}/repairs', {
            'requester': 'ผู้ทดสอบ', 'contact': 'private-contact', 'issue': self.uniq('เปิดไม่ติด'),
            'assetId': 999, 'assetCode': 'forged'}, expected=201)
        ticket = self.smart(aid)['tickets'][0]
        self.assertEqual(ticket['assetId'], aid)
        self.assertNotEqual(ticket['assetCode'], 'forged')
        self.assertFalse(ticket['guestScreened'])
        self.assertTrue(ticket['provisional'])
        self.assertEqual(ticket['sourceChannel'], 'asset_qr')
        self.assertIn('receiptToken', receipt)
        self.call('/api/receipts/' + receipt['receiptToken'])

    def test_location_qr_disabled_until_features_enabled(self):
        flags = self.call('/api/features')
        self.assertEqual(flags['flags'], DEFAULT_FLAGS)
        self.assertFalse(flags['flags']['locationQr'])
        self.assertFalse(flags['flags']['borrowIssueReturn'])
        self.call('/api/qr/locations', {'kind': 'room', 'name': 'ยังไม่เปิด', 'publicName': 'ยังไม่เปิด', 'actor': OFFICER}, expected=403)
        self.call('/api/qr/locations', expected=403)
        self.call('/api/lifecycle/overdue', expected=403)
        saved = self.call('/api/features', {'flags': {'locationQr': True, 'borrowIssueReturn': True},
                                           'revision': flags['revision'], 'actor': OFFICER}, method='PUT')
        self.assertTrue(saved['flags']['locationQr'])
        self.assertTrue(saved['flags']['borrowIssueReturn'])
        self.assertTrue(saved['flags']['assetQr'])
        loc = self.location()
        token = loc['qrToken']
        self.call('/api/places/' + token)
        off = self.call('/api/features', {'flags': {'locationQr': False}, 'revision': saved['revision'], 'actor': OFFICER}, method='PUT')
        self.assertFalse(off['flags']['locationQr'])
        self.call('/api/places/' + token, expected=403)
        self.call('/api/qr/locations', expected=403)

    def test_location_token_stable_after_rename_and_inactive_blocks_reports(self):
        self.enable_location_and_borrow()
        loc = self.location(name='ห้องเดิม', publicName='ชื่อสาธารณะเดิม')
        token = loc['qrToken']
        lid = loc['id']
        renamed = self.call(f'/api/qr/locations/{lid}', {
            'kind': 'room', 'name': 'ห้องเปลี่ยนชื่อ', 'publicName': 'ชื่อสาธารณะใหม่',
            'publicInfo': loc.get('public_info', ''), 'isActive': True, 'guestCanReportPlace': True, 'actor': OFFICER,
        }, method='PUT')
        self.assertEqual(renamed['qrToken'], token)
        self.assertEqual(self.call(f'/api/qr/locations/{lid}')['qrToken'], token)
        public = self.call('/api/places/' + token)
        self.assertEqual(public['name'], 'ชื่อสาธารณะใหม่')
        self.assertTrue(public['active'])
        self.call(f'/api/qr/locations/{lid}', {
            'kind': 'room', 'name': 'ห้องเปลี่ยนชื่อ', 'publicName': 'ชื่อสาธารณะใหม่',
            'isActive': False, 'guestCanReportPlace': True, 'actor': OFFICER,
        }, method='PUT')
        inactive = self.call('/api/places/' + token)
        self.assertEqual(inactive['active'], False)
        self.assertFalse(inactive['canReportPlace'])
        self.place_report(token, expected=403)

    def test_guest_location_report_without_asset_and_allowlist(self):
        self.enable_location_and_borrow()
        loc = self.location()
        token = loc['qrToken']
        allowed = self.asset(self.uniq('OK'))
        other = self.asset(self.uniq('NO'))
        self.call(f'/api/qr/locations/{loc["id"]}/assets', {'assetIds': [allowed]}, method='PUT')
        place = self.call('/api/places/' + token)
        self.assertEqual([a['id'] for a in place['guestAssets']], [allowed])
        none = self.place_report(token, self.uniq('แจ้งพื้นที่'))
        self.assertTrue(none['receiptToken'])
        bare = self.ticket_by_no(none['ticketNo'])
        self.assertIsNone(bare['assetId'])
        self.assertFalse(bare['guestScreened'])
        self.assertEqual(bare['sourceChannel'], 'location_qr')
        self.place_report(token, self.uniq('ครุภัณฑ์นอกรายการ'), assetId=other, expected=403)
        picked = self.place_report(token, self.uniq('ครุภัณฑ์ในรายการ'), assetId=allowed)
        linked = self.ticket_by_no(picked['ticketNo'])
        self.assertEqual(linked['assetId'], allowed)

    def test_honeypot_website_field_rejected(self):
        self.enable_location_and_borrow()
        token = self.location()['qrToken']
        self.place_report(token, self.uniq('กับดัก'), website='https://spam.example', expected=400)
        self.place_report(token, self.uniq('กับดัก2'), companyUrl='http://bot', expected=400)

    def test_duplicate_issue_within_24h_conflict(self):
        self.enable_location_and_borrow()
        token = self.location()['qrToken']
        issue = self.uniq('อาการซ้ำ')
        self.place_report(token, issue)
        self.place_report(token, issue, expected=409)

    def test_guest_report_rate_limit(self):
        self.enable_location_and_borrow()
        token = self.location()['qrToken']
        for i in range(5):
            self.place_report(token, self.uniq(f'ครั้ง{i}'))
        self.place_report(token, self.uniq('ครั้งเกิน'), expected=429)

    def test_guest_ticket_cannot_assign_before_review(self):
        self.enable_location_and_borrow()
        token = self.location()['qrToken']
        created = self.place_report(token, self.uniq('คัดกรองก่อนมอบหมาย'))
        tid = self.ticket_by_no(created['ticketNo'])['id']
        self.assertFalse(self.call(f'/api/tickets/{tid}')['guestScreened'])
        self.call(f'/api/tickets/{tid}/action', {'action': 'assign', 'actor': OFFICER, 'assignedTo': 'ช่าง A'}, expected=409)
        self.call(f'/api/tickets/{tid}/action', {'action': 'approve', 'actor': APPROVER}, expected=409)
        self.action(tid, 'review', OFFICER)
        screened = self.call(f'/api/tickets/{tid}')
        self.assertTrue(screened['guestScreened'])
        self.assertEqual(screened['status'], 'รอมอบหมาย')
        self.call(f'/api/tickets/{tid}/action', {'action': 'assign', 'actor': TECH, 'assignedTo': 'ช่าง A'}, expected=403)
        assigned = self.action(tid, 'assign', OFFICER, assignedTo='ช่าง A')
        self.assertEqual(assigned['status'], 'กำลังซ่อม')
        self.assertEqual(assigned['assignedTo'], 'ช่าง A')

    def test_user_qr_report_can_be_dismissed_as_not_genuine(self):
        aid = self.asset(self.uniq('FAKE'))
        token = self.smart(aid)['qrUrl'].rsplit('/', 1)[1]
        receipt = self.call(f'/api/scan/{token}/repairs', {
            'requester': 'ผู้ทดสอบ', 'contact': '1', 'issue': self.uniq('อาจไม่จริง')}, expected=201)
        ticket = self.smart(aid)['tickets'][0]
        self.assertTrue(ticket['provisional'])
        dismissed = self.action(ticket['id'], 'dismiss', OFFICER, note='ทดลองกด ไม่ใช่เครื่องเสียจริง')
        self.assertEqual(dismissed['status'], 'ยกเลิก')
        self.assertFalse(dismissed['provisional'])
        tracked = self.call('/api/receipts/' + receipt['receiptToken'])
        self.assertEqual(tracked['status'], 'ยกเลิก')
        self.assertFalse(tracked['canConfirm'])

    def test_lifecycle_intake_loan_return_and_overdue(self):
        self.enable_location_and_borrow()
        aid = self.asset(self.uniq('LIFE'))
        taken = self.call(f'/api/lifecycle/assets/{aid}', {
            'kind': 'intake', 'actor': OFFICER, 'custodian': 'ผู้รับผิดชอบรับเข้า', 'location': 'คลังทดสอบ', 'condition': 'ดี',
        })
        self.assertEqual(taken['state']['loan_status'], 'available')
        self.assertEqual(taken['state']['custodian'], 'ผู้รับผิดชอบรับเข้า')
        repair = self.call('/api/tickets', {
            'assetId': aid, 'assetName': 'เครื่องทดสอบ', 'issue': self.uniq('ซ่อมค้าง'),
            'requester': 'เจ้าหน้าที่', 'contact': '1',
        }, expected=201)
        self.call(f'/api/lifecycle/assets/{aid}', {
            'kind': 'loan', 'actor': OFFICER, 'borrower': 'ผู้ยืม', 'dueAt': '2000-01-01',
        }, expected=409)
        self.action(repair['id'], 'cancel', OFFICER, note='ยกเลิกเพื่อทดสอบยืม')
        self.call(f'/api/lifecycle/assets/{aid}', {'kind': 'loan', 'actor': OFFICER, 'borrower': 'ผู้ยืม'}, expected=400)
        loaned = self.call(f'/api/lifecycle/assets/{aid}', {
            'kind': 'loan', 'actor': OFFICER, 'borrower': 'ผู้ยืมทดสอบ', 'dueAt': '2000-01-01', 'note': 'ยืมทดลอง',
        })
        self.assertEqual(loaned['state']['loan_status'], 'loaned')
        self.assertEqual(loaned['state']['due_at'], '2000-01-01')
        self.assertTrue(loaned['state']['overdue'])
        self.call(f'/api/lifecycle/assets/{aid}', {
            'kind': 'loan', 'actor': OFFICER, 'borrower': 'คนที่สอง', 'dueAt': '2000-01-02',
        }, expected=409)
        overdue = self.call('/api/lifecycle/overdue')
        self.assertTrue(any(item['assetId'] == aid and item['dueAt'] == '2000-01-01' for item in overdue['items']))
        returned = self.call(f'/api/lifecycle/assets/{aid}', {'kind': 'return', 'actor': OFFICER, 'custodian': 'ผู้รับคืน'})
        self.assertEqual(returned['state']['loan_status'], 'available')
        self.assertEqual(returned['state']['due_at'], '')
        self.assertFalse(returned['state']['overdue'])
        self.assertFalse(any(item['assetId'] == aid for item in self.call('/api/lifecycle/overdue')['items']))
        self.integrity()

    def test_features_wrong_revision_and_asset_qr_off(self):
        aid = self.asset(self.uniq('FLAG'))
        token = self.smart(aid)['qrUrl'].rsplit('/', 1)[1]
        self.call('/api/scan/' + token)
        current = self.call('/api/features')
        self.call('/api/features', {'flags': {'assetQr': False}, 'revision': current['revision'] + 9, 'actor': OFFICER}, method='PUT', expected=409)
        self.call('/api/features', {'flags': {'assetQr': False}, 'revision': current['revision'] - 1, 'actor': OFFICER}, method='PUT', expected=409)
        saved = self.call('/api/features', {'flags': {'assetQr': False}, 'revision': current['revision'], 'actor': OFFICER}, method='PUT')
        self.assertFalse(saved['flags']['assetQr'])
        self.call('/api/scan/' + token, expected=403)
        self.call(f'/api/scan/{token}/repairs', {'requester': 'ผู้ทดสอบ', 'contact': '1', 'issue': self.uniq('ปิด QR')}, expected=403)

    def test_location_and_asset_qr_pages_serve_scan_html(self):
        token = 'A' * 32
        self.assertIn('scan.js', self.call('/q/' + token).decode())
        self.assertIn('scan.js', self.call('/l/' + token).decode())
        aid = self.asset(self.uniq('PAGE'))
        real = self.smart(aid)['qrUrl'].rsplit('/', 1)[1]
        self.assertIn('scan.js', self.call('/q/' + real).decode())

    def test_module_flags_block_numbering_depreciation_and_repairs(self):
        current = self.call('/api/features')
        self.call('/api/features', {'flags': {'assetNumberGeneration': False, 'depreciation': False, 'repairManagement': False}, 'revision': current['revision'], 'actor': OFFICER}, method='PUT')
        category = self.call('/api/catalog/categories')[0]['id']
        self.call('/api/assets', {'name': 'ต้องมีเลขเดิม', 'categoryId': category}, expected=403)
        kept = self.call('/api/assets', {'name': 'รับเข้าเลขเดิม', 'code': self.uniq('KEEP'), 'categoryId': category, 'location': 'คลัง'}, expected=201)
        self.assertTrue(kept['code'])
        self.call('/api/catalog/depreciation', {'actor': OFFICER, 'ruleNo': self.uniq('D'), 'categoryName': 'ทดสอบ', 'years': 5, 'annualRate': 20, 'calculationMethod': 'annual_rate', 'categoryIds': [category]}, expected=403)
        self.call('/api/tickets', {'assetId': kept['id'], 'issue': 'ห้ามเมื่อปิดซ่อม', 'requester': 'ผู้ทดสอบ', 'contact': '1', 'urgency': 'ปกติ'}, expected=403)
        token = self.smart(kept['id'])['qrUrl'].rsplit('/', 1)[1]
        self.call(f'/api/scan/{token}/repairs', {'requester': 'ผู้ทดสอบ', 'contact': '1', 'issue': self.uniq('ปิดซ่อม')}, expected=403)

    def test_sqlite_integrity_after_flows(self):
        self.enable_location_and_borrow()
        aid = self.asset(self.uniq('INT'))
        token = self.smart(aid)['qrUrl'].rsplit('/', 1)[1]
        self.call(f'/api/scan/{token}/repairs', {'requester': 'ผู้ทดสอบ', 'contact': '1', 'issue': self.uniq('ตรวจฐาน')}, expected=201)
        loc = self.location()
        self.place_report(loc['qrToken'], self.uniq('ตรวจพื้นที่'))
        self.call(f'/api/lifecycle/assets/{aid}', {'kind': 'intake', 'actor': OFFICER, 'custodian': 'ผู้ดูแล'})
        self.integrity()


class QrSmartAuthRequired(HTTPFixture):
    auth_required = '1'

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = Client(cls.base)
        cls.admin.call('/api/auth/setup', {'username': 'qr.admin', 'name': 'ผู้ดูแล QR', 'password': 'Test-only-pass-2026'})

    def test_unauthenticated_cannot_read_staff_routes_but_public_scan_and_places_work(self):
        self.call('/api/tickets', expected=401)
        self.call('/api/lifecycle/assets/1', expected=401)
        category = self.admin.call('/api/catalog/categories')[0]['id']
        asset = self.admin.call('/api/assets', {'name': 'ครุภัณฑ์ล็อกอิน', 'code': 'AUTH-' + uuid.uuid4().hex[:8], 'categoryId': category, 'location': 'ห้องลับ'}, expected=201)
        smart = self.admin.call(f'/api/assets/{asset["id"]}/smart')
        scan_token = smart['qrUrl'].rsplit('/', 1)[1]
        scan = self.call('/api/scan/' + scan_token)
        self.assertEqual(scan['code'], asset['code'])
        self.assertNotIn('custodian', scan)
        feat = self.admin.call('/api/features')
        self.admin.call('/api/features', {'flags': {'locationQr': True}, 'revision': feat['revision']}, method='PUT')
        loc = self.admin.call('/api/qr/locations', {
            'kind': 'room', 'name': 'ห้องสาธารณะ', 'publicName': 'ห้องสาธารณะ', 'isActive': True, 'guestCanReportPlace': True,
        }, expected=201)
        place = self.call('/api/places/' + loc['qrToken'])
        self.assertTrue(place['active'])
        self.call('/api/tickets', expected=401)
        self.call(f'/api/lifecycle/assets/{asset["id"]}', expected=401)


if __name__ == '__main__':
    import unittest
    unittest.main()
