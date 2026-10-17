"""Category guidance must retain paragraphs and remain within the existing field limit."""
import test_smart_workflow as fixture


class CategoryGuides(fixture.HTTPFixture):
    def test_multiline_guidance_survives_create_update_and_read(self):
        created=self.call('/api/catalog/categories',{'name':'หมวด   คู่มือ','notes':'รวม:  อุปกรณ์ตัวอย่าง\r\n\r\nไม่รวม: หมวดอื่น\r\nอ้างอิง: <b>ข้อความ</b>','actor':fixture.OFFICER},expected=201)
        self.assertEqual(created['name'],'หมวด คู่มือ')
        self.assertEqual(created['notes'],'รวม: อุปกรณ์ตัวอย่าง\n\nไม่รวม: หมวดอื่น\nอ้างอิง: <b>ข้อความ</b>')
        guide=created['notes']+'\nผู้ทบทวน: เจ้าหน้าที่'
        updated=self.call('/api/catalog/categories/'+str(created['id']),{**created,'notes':guide,'actor':fixture.OFFICER},method='PUT')
        self.assertEqual(updated['notes'],guide)
        saved=next(row for row in self.call('/api/catalog/categories') if row['id']==created['id'])
        self.assertEqual(saved['notes'],guide)

    def test_guide_limit_still_rejects_oversized_input(self):
        before=len(self.call('/api/catalog/categories'))
        self.call('/api/catalog/categories',{'name':'หมวดไม่ควรถูกบันทึก','notes':'ก'*1001,'actor':fixture.OFFICER},expected=400)
        self.assertEqual(len(self.call('/api/catalog/categories')),before)
