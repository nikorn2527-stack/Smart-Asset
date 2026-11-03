from test_smart_workflow import HTTPFixture


class TicketTracking(HTTPFixture):
    def test_print_tracking_link_is_stable_and_only_exposes_public_status(self):
        asset_id = self.asset('TRACK-001')
        ticket = self.call('/api/tickets', {
            'assetId': asset_id,
            'assetName': 'ชื่อนี้ใช้ยืนยันกับทะเบียน',
            'issue': 'รายละเอียดภายในที่ไม่ควรแสดง',
            'requester': 'ผู้แจ้งส่วนตัว',
            'contact': 'เบอร์ส่วนตัว',
            'urgency': 'ปกติ',
            'reporterNote': 'หมายเหตุภายใน',
        }, expected=201)

        self.call(f"/api/tickets/{ticket['id']}/tracking-link", {'actor': 'ผู้แจ้ง'}, method='POST', expected=403)
        link = self.call(f"/api/tickets/{ticket['id']}/tracking-link", {'actor': 'เจ้าหน้าที่พัสดุ'}, method='POST')
        same_link = self.call(f"/api/tickets/{ticket['id']}/tracking-link", {'actor': 'เจ้าหน้าที่พัสดุ'}, method='POST')

        self.assertEqual(link['url'], same_link['url'])
        self.assertRegex(link['url'], r'/r/[A-Za-z0-9_-]{32}$')
        self.assertTrue(link['qrImage'].startswith('data:image/svg+xml;base64,'))
        token = link['url'].rsplit('/', 1)[1]
        public = self.call(f'/api/tracking/{token}')

        self.assertEqual(public['ticketNo'], ticket['ticketNo'])
        self.assertEqual(public['status'], ticket['status'])
        self.assertTrue(public['events'])
        self.assertEqual(set(public), {'ticketNo', 'assetName', 'assetCode', 'status', 'createdAt', 'updatedAt', 'events'})
        self.assertNotIn('ผู้แจ้งส่วนตัว', str(public))
        self.assertNotIn('เบอร์ส่วนตัว', str(public))
        self.assertNotIn('หมายเหตุภายใน', str(public))
        self.assertFalse(any('action' in event or 'actor' in event or 'note' in event for event in public['events']))

        self.call(f'/api/tracking/{token}/action', {'action': 'confirm'}, method='POST', expected=404)
        self.assertIn(b'/scan.js?v=17', self.call(f'/r/{token}'))

    def test_tracking_link_requires_existing_ticket(self):
        self.call('/api/tickets/999999/tracking-link', {'actor': 'เจ้าหน้าที่พัสดุ'}, method='POST', expected=404)
