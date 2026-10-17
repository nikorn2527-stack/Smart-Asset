"""Import headings faithfully, retain headers, and never fabricate missing policies."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import import_sources

@unittest.skipUnless(importlib.util.find_spec('openpyxl') and importlib.util.find_spec('xlrd'),'optional source import dependencies not installed')
class SourceImport(unittest.TestCase):
    def test_actual_software_headers_override_legacy_positions(self):
        import openpyxl
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);inputs=root/'inputs';inputs.mkdir()
            book=openpyxl.Workbook();sheet=book.active
            headers=['ลำดับ','สถานะครุภัณฑ์','บำรุงรักษา','เลขครุภัณฑ์','เลขครุภัณฑ์เดิม','กลุ่มครุภัณฑ์','ประเภทครุภัณฑ์','ชนิดครุภัณฑ์','รายละเอียดครุภัณฑ์','ปีงบที่ได้มา','เลขที่ GFMIS','เลขที่ PO','เลขใบส่งของ','รุ่น','หมายเลขเครื่อง (Serial Number)','แบบ/ลักษณะ','ฝ่าย/สาย รับผิดชอบ','หน่วยงาน/กอง','วันที่ส่งมอบ','วันที่ได้มา','วิธีการได้มา','อายุการใช้งาน','ราคาทุน','มูลค่าเสื่อม','มูลค่าเสื่อมสะสม','มูลค่าคงเหลือ','วันที่ปัจจุบัน','วันคงเหลือ','ครุภัณฑ์เช่ายืม','ราคาเช่า-ยืม','วันที่แก้ไขล่าสุด']
            sheet.append(headers)
            record={'เลขครุภัณฑ์':'7110-002-0001-0001','เลขครุภัณฑ์เดิม':'OLD/1','รายละเอียดครุภัณฑ์':'รายการทดสอบ','รุ่น':'MODEL-A','หมายเลขเครื่อง (Serial Number)':'SERIAL-A','หน่วยงาน/กอง':'กองทดสอบ','ฝ่าย/สาย รับผิดชอบ':'ฝ่ายทดสอบ','วันที่ได้มา':'2020-01-01','วันที่ส่งมอบ':'2020-02-02','ราคาทุน':1200}
            sheet.append([record.get(h,'') for h in headers]);book.save(inputs/'สินทรัพย์ software.xlsx')
            source=root/'manual.pdf';source.write_bytes(b'test source fixture')
            archive=root/'source.rar';archive.write_bytes(b'test archive fixture')
            dest=root/'test.sqlite3'
            argv=['import_sources.py','--workbook-dir',str(inputs),'--archive',str(archive),'--fsn-manual',str(source),'--db',str(dest)]
            with patch.object(sys,'argv',argv),patch.object(import_sources,'extract_pdf_pages',return_value=['ตู้ทดสอบ 7110-002-0001']),contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(import_sources.main(),0)
            import server
            with patch.object(server,'DB_PATH',dest):
                server.initialize()
                server.initialize()
            with sqlite3.connect(dest) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM assets').fetchone()[0],1)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM source_row_records WHERE record_kind='header'").fetchone()[0],1)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM source_row_records').fetchone()[0],2)
                self.assertEqual(db.execute('SELECT old_asset_code FROM assets').fetchone()[0],'OLD/1')
                self.assertEqual(db.execute('SELECT model,serial_number,acquired_on,delivered_on FROM asset_acquisitions').fetchone(),('MODEL-A','SERIAL-A','2020-01-01','2020-02-02'))
                self.assertEqual(db.execute('SELECT COUNT(*) FROM depreciation_policies').fetchone()[0],0)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM tickets').fetchone()[0],0)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM survey_items').fetchone()[0],0)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM asset_register_details').fetchone()[0],0)
                template=json.loads(db.execute('SELECT elements_json FROM sticker_templates').fetchone()[0])
                self.assertEqual(next(e for e in template if e['type']=='qr')['content'],'{{QrUrl}}')
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
