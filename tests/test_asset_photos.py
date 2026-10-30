import base64
import struct
import unittest
import zlib

from test_smart_workflow import HTTPFixture, OFFICER


def png(width=2, height=2):
    raw = b''.join(b'\x00' + b'\xff\x00\x00' * width for _ in range(height))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def data_url(raw, mime='image/png'):
    return f'data:{mime};base64,' + base64.b64encode(raw).decode()


class AssetPhotos(HTTPFixture):
    def test_upload_list_primary_remove_and_inventory_thumbnail(self):
        asset_id = self.asset('PHOTO-0001')
        self.assertEqual(self.call(f'/api/assets/{asset_id}/photos')['items'], [])

        first = self.call(f'/api/assets/{asset_id}/photos', {'image': data_url(png()), 'actor': OFFICER, 'width': 2, 'height': 2}, expected=201)
        self.assertTrue(first['isPrimary'])
        second = self.call(f'/api/assets/{asset_id}/photos', {'image': data_url(png(3, 3)), 'thumb': data_url(png()), 'actor': 'ช่าง'}, expected=201)
        self.assertFalse(second['isPrimary'])

        image = self.call(first['url'])
        self.assertTrue(image.startswith(b'\x89PNG'))
        self.assertTrue(self.call(second['thumbUrl']).startswith(b'\x89PNG'))

        listed = self.call(f'/api/inventory?q=PHOTO-0001')['items'][0]
        self.assertEqual(listed['photoUrl'], first['thumbUrl'])

        after = self.call(f'/api/assets/{asset_id}/photos/{second["id"]}/primary', {'actor': OFFICER})
        self.assertEqual(after['items'][0]['id'], second['id'])
        after = self.call(f'/api/assets/{asset_id}/photos/{second["id"]}/remove', {'actor': OFFICER})
        self.assertEqual([p['id'] for p in after['items']], [first['id']])
        self.assertTrue(after['items'][0]['isPrimary'])
        self.call(second['url'], expected=404)

        actions = [e['action'] for e in self.smart(asset_id)['events']]
        self.assertIn('เพิ่มรูปครุภัณฑ์', actions)
        self.assertIn('ลบรูปครุภัณฑ์', actions)

    def test_rejects_requester_and_files_that_are_not_images(self):
        asset_id = self.asset('PHOTO-0002')
        self.call(f'/api/assets/{asset_id}/photos', {'image': data_url(png()), 'actor': 'ผู้แจ้ง'}, expected=403)
        self.call(f'/api/assets/{asset_id}/photos', {'image': data_url(b'<script>alert(1)</script>'), 'actor': OFFICER}, expected=400)
        self.call(f'/api/assets/{asset_id}/photos', {'image': 'data:text/html;base64,PGI+', 'actor': OFFICER}, expected=400)
        self.call('/api/assets/999999/photos', expected=404)

    def test_public_scan_payload_has_no_photo_or_private_fields(self):
        asset_id = self.asset('PHOTO-0003')
        self.call(f'/api/assets/{asset_id}/photos', {'image': data_url(png()), 'actor': OFFICER}, expected=201)
        token = self.smart(asset_id)['qrUrl'].rsplit('/', 1)[1]
        scan = self.call(f'/api/scan/{token}')
        self.assertNotIn('custodian', scan)
        self.assertNotIn('photoUrl', scan)


class PublicRegisterFields(HTTPFixture):
    def test_scan_lists_every_filled_source_column_in_file_order(self):
        import json
        import sqlite3
        asset_id = self.asset('FIELDS-0001')
        raw = {'ลำดับ': '3708', 'วันที่ปัจจุบัน': 2028, 'ราคาทุน': 4400, 'รุ่น': 'welco 5 ฟุต', 'เลขที่ PO': '25012021-0001',
               'กลุ่มครุภัณฑ์': 'ครุภัณฑ์สำนักงาน', 'วันที่ได้มา': '2021-01-11T00:00:00', 'เลขที่ GFMIS': '', 'วันคงเหลือ': 0}
        with sqlite3.connect(self.db) as db:
            doc = db.execute("INSERT INTO source_documents(filename,sha256) VALUES('DurableGoodList.xls','t')").lastrowid
            db.execute("INSERT INTO source_row_records(source_document_id,source_row_no,record_kind,asset_id,raw_data_json) VALUES(?,?,?,?,?)",
                       (doc, 1, 'asset', asset_id, json.dumps(raw, ensure_ascii=False)))
        token = self.smart(asset_id)['qrUrl'].rsplit('/', 1)[1]
        fields = self.call(f'/api/scan/{token}')['fields']
        self.assertEqual([f['label'] for f in fields], ['กลุ่มครุภัณฑ์', 'เลขที่ PO', 'รุ่น', 'วันที่ได้มา', 'ราคาทุน', 'วันคงเหลือ'])
        self.assertEqual(next(f for f in fields if f['label'] == 'ราคาทุน')['kind'], 'money')
        self.assertEqual(next(f for f in fields if f['label'] == 'วันที่ได้มา')['kind'], 'date')


if __name__ == '__main__':
    unittest.main()
