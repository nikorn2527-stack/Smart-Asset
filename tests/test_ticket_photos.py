from test_asset_photos import data_url, png
from test_smart_workflow import HTTPFixture


class TicketPhotos(HTTPFixture):
    def test_create_ticket_with_photos_and_read_each_size(self):
        asset_id = self.asset('TICKET-PHOTO-001')
        ticket = self.call('/api/tickets', {
            'assetId': asset_id,
            'assetName': 'ชื่อไม่ใช้แทนข้อมูลทะเบียน',
            'issue': 'มีรอยแตก',
            'requester': 'ผู้ทดสอบ',
            'photos': [{
                'image': data_url(png(3, 2)),
                'thumb': data_url(png()),
                'width': 3,
                'height': 2,
            }],
        }, expected=201)
        self.assertEqual(len(ticket['photos']), 1)
        photo = ticket['photos'][0]
        self.assertEqual(ticket['assetName'], 'เครื่องทดสอบ')
        self.assertTrue(self.call(photo['url']).startswith(b'\x89PNG'))
        self.assertTrue(self.call(photo['thumbUrl']).startswith(b'\x89PNG'))

        detail = self.call(f"/api/tickets/{ticket['id']}")
        self.assertEqual(detail['photos'], ticket['photos'])
        self.call(f"/api/tickets/{ticket['id']}/photos/999999/full", expected=404)

    def test_rejects_invalid_or_excessive_photos_without_creating_ticket(self):
        asset_id = self.asset('TICKET-PHOTO-002')
        body = {
            'assetId': asset_id,
            'assetName': 'ทดสอบ',
            'issue': 'ทดสอบรูป',
            'requester': 'ผู้ทดสอบ',
            'photos': [{'image': data_url(b'<script>'), 'thumb': data_url(png())}],
        }
        before = len(self.call('/api/tickets'))
        self.call('/api/tickets', body, expected=400)
        oversized = data_url(b'\x89PNG\r\n\x1a\n' + b'x' * 2_500_001)
        self.call('/api/tickets', {**body, 'photos': [{'image': oversized, 'thumb': data_url(png())}]}, expected=400)
        valid = {'image': data_url(png()), 'thumb': data_url(png())}
        self.call('/api/tickets', {**body, 'photos': [valid] * 6}, expected=400)
        self.assertEqual(len(self.call('/api/tickets')), before)


if __name__ == '__main__':
    import unittest
    unittest.main()
