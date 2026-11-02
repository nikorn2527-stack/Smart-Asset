import json
import sqlite3
import unittest

from unittest.mock import patch

from asset_api import (
    _default_70x36_template,
    _preset_large_templates,
    ensure_default_template,
    render_sticker,
    save_template,
    sticker_settings,
)


class DefaultStickerTemplateTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.execute('''CREATE TABLE sticker_templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            canvas_width_mm REAL NOT NULL,
            canvas_height_mm REAL NOT NULL,
            overflow TEXT NOT NULL,
            elements_json TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )''')
        self.db.execute('CREATE TABLE sticker_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL)')

    def tearDown(self):
        self.db.close()

    def test_promotes_the_neutral_70_by_36_template_over_legacy_default(self):
        self.db.execute(
            '''INSERT INTO sticker_templates
               (id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active)
               VALUES(?,?,?,?,?,?,?,1)''',
            ('medcenter-brother-36mm-70x36',
             'ฉลากครุภัณฑ์ ศูนย์แพทยศาสตรศึกษาชั้นคลินิกฯ (Brother 36mm — 70 × 36 มม.)',
             1, 70, 36, 'clip', '[]'),
        )

        ensure_default_template(self.db)

        new_default = self.db.execute(
            'SELECT * FROM sticker_templates WHERE id=?', ('gov-asset-default-70x36',)
        ).fetchone()
        legacy = self.db.execute(
            'SELECT * FROM sticker_templates WHERE id=?', ('medcenter-brother-36mm-70x36',)
        ).fetchone()
        self.assertEqual(new_default['name'], 'ฉลากครุภัณฑ์ 70 × 36 มม.')
        self.assertEqual((new_default['is_default'], new_default['is_active']), (1, 1))
        self.assertEqual((legacy['is_default'], legacy['is_active']), (0, 0))
        self.assertEqual(legacy['name'], 'ฉลากเดิม 70 × 36 มม.')
        self.assertEqual(
            [template['name'] for template in _preset_large_templates()],
            ['ป้าย QR A6 · 105 × 148 มม.', 'ป้าย QR A4 · 210 × 297 มม.'],
        )
        elements = json.loads(new_default['elements_json'])
        self.assertFalse(any('{{Location}}' in element.get('content', '') for element in elements))
        self.assertTrue(any('{{AssetNo}}' in element.get('content', '') for element in elements))
        by_id = {element['id']: element for element in elements}
        self.assertEqual(by_id['default-logo']['source'], '/assets/medcenter-logo.png')
        self.assertEqual(
            by_id['default-org-th']['content'],
            'ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์',
        )
        self.assertEqual(
            by_id['default-org-en']['content'],
            'MEDICAL EDUCATION CENTER OF SURIN HOSPITAL',
        )
        self.assertEqual(
            by_id['default-address']['content'],
            'ที่อยู่: 68 ถ.หลักเมือง ต.ในเมือง อ.เมืองสุรินทร์ จ.สุรินทร์ 32000 โทร 044-518-937',
        )
        self.assertEqual(by_id['default-org-th']['width'], by_id['default-address']['width'])
        self.assertEqual(by_id['default-org-en']['width'], by_id['default-address']['width'])
        self.assertEqual(by_id['default-category-label']['content'], 'ประเภทครุภัณฑ์ :')
        self.assertEqual(by_id['default-name']['content'], '{{AssetName}}')
        self.assertEqual(by_id['default-name']['fontSize'], 5.8)
        self.assertEqual(by_id['default-code']['letterSpacing'], 0.2)
        self.assertEqual(by_id['default-date']['content'], '{{AcquisitionDate}}')
        self.assertEqual(by_id['default-qr']['content'], '{{QrUrl}}')
        self.assertEqual(
            (by_id['default-qr']['x'], by_id['default-qr']['y'],
             by_id['default-qr']['width'], by_id['default-qr']['height']),
            (57.4, 21.3, 11.5, 11.5),
        )
        self.assertFalse(any(element['id'] == 'default-address-2' for element in elements))
        header_rows = [by_id[element_id] for element_id in (
            'default-org-th', 'default-org-en', 'default-address',
        )]
        self.assertEqual([element['align'] for element in header_rows], ['left'] * 3)
        self.assertEqual([element['x'] for element in header_rows], [18.8] * 3)
        self.assertEqual([element['width'] for element in header_rows], [48.5] * 3)
        self.assertEqual([element['lineHeight'] for element in header_rows], [1.35] * 3)
        self.assertTrue(all(
            element['lineHeight'] == 1.35 for element in elements if element['type'] == 'text'
        ))
        self.assertGreaterEqual(
            by_id['default-category-label']['y'],
            by_id['default-address']['y'] + by_id['default-address']['height'],
        )
        self.assertGreaterEqual(
            by_id['default-code-label']['y'],
            by_id['default-category-label']['y'] + by_id['default-category-label']['height'],
        )
        self.assertGreaterEqual(
            by_id['default-name']['height'],
            3 * by_id['default-name']['fontSize'] * 25.4 / 72 * 1.35,
        )
        self.assertEqual(by_id['default-name']['width'], 39.5)
        self.assertLessEqual(
            by_id['default-name']['x'] + by_id['default-name']['width'],
            by_id['default-qr']['x'],
        )
        self.assertGreaterEqual(
            by_id['default-date']['y'],
            by_id['default-name']['y'] + by_id['default-name']['height'],
        )

    def test_renders_thai_combining_marks_and_template_line_height(self):
        template = _default_70x36_template()
        text = 'ครุภัณฑ์สำนักงาน ตั้งอยู่ที่ชั้นล่าง'
        rendered = render_sticker(
            template,
            {'AssetName': text, 'AssetNo': '7440-001-0068-0235', 'Category': 'ครุภัณฑ์'},
            {
                'orgName': 'หน่วยงานอื่น',
                'companyName': 'OTHER ORGANIZATION',
                'companyAddress': 'ที่อยู่จากการตั้งค่า',
                'companyPhone': '000',
            },
        )

        self.assertIn(text, rendered)
        self.assertEqual(rendered.count('line-height:1.35'), 12)
        self.assertIn('letter-spacing:0.2mm', rendered)
        self.assertIn('font-size:5.8pt', rendered)
        self.assertIn('ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์', rendered)
        self.assertIn('MEDICAL EDUCATION CENTER OF SURIN HOSPITAL', rendered)
        self.assertIn(
            'ที่อยู่: 68 ถ.หลักเมือง ต.ในเมือง อ.เมืองสุรินทร์ จ.สุรินทร์ 32000 โทร 044-518-937',
            rendered,
        )
        self.assertNotIn('OTHER ORGANIZATION', rendered)
        self.assertNotIn('ที่อยู่จากการตั้งค่า', rendered)

    def test_keeps_a_custom_active_template_when_adding_default(self):
        self.db.execute(
            '''INSERT INTO sticker_templates
               (id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active)
               VALUES(?,?,?,?,?,?,?,1)''',
            ('custom-label', 'แบบที่หน่วยงานเลือก', 1, 70, 36, 'clip', '[]'),
        )

        ensure_default_template(self.db)

        active = self.db.execute(
            'SELECT id FROM sticker_templates WHERE is_active=1'
        ).fetchall()
        new_default = self.db.execute(
            'SELECT is_default,is_active FROM sticker_templates WHERE id=?',
            ('gov-asset-default-70x36',),
        ).fetchone()
        self.assertEqual([row['id'] for row in active], ['custom-label'])
        self.assertEqual((new_default['is_default'], new_default['is_active']), (1, 0))

    def test_prefills_sample_thai_and_english_organization_names(self):
        with patch('asset_api.branding', return_value={'organization': 'หน่วยงานตัวอย่าง'}):
            settings = sticker_settings(self.db)

        self.assertEqual(settings['orgName'], 'ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์')
        self.assertEqual(settings['companyName'], 'MEDICAL EDUCATION CENTER OF SURIN HOSPITAL')

        self.db.executemany(
            'INSERT INTO sticker_settings(key,value) VALUES(?,?)',
            [
                ('orgName', 'ชื่อหน่วยงานที่กำหนดเอง'),
                ('companyName', 'CUSTOM ENGLISH ORGANIZATION'),
            ],
        )
        with patch('asset_api.branding', return_value={'organization': 'หน่วยงานตัวอย่าง'}):
            customized = sticker_settings(self.db)
        self.assertEqual(customized['orgName'], 'ชื่อหน่วยงานที่กำหนดเอง')
        self.assertEqual(customized['companyName'], 'CUSTOM ENGLISH ORGANIZATION')

    def test_migrates_the_previous_default_layout_without_changing_user_text(self):
        elements = json.loads(json.dumps(_default_70x36_template()['elements']))
        by_id = {element['id']: element for element in elements}
        for element in elements:
            element.pop('lineHeight', None)
        by_id['default-org-th']['content'] = '{{orgName}}'
        by_id['default-org-th'].update(height=3.4, fontSize=7.2)
        by_id['default-org-en']['content'] = '{{companyName}}'
        by_id['default-org-en'].update(y=5.2, height=2.8, fontSize=6.2)
        by_id['default-address'].update(
            content='{{companyAddress}}', y=8.4, height=2.0, fontSize=5.8,
        )
        by_id['default-header-rule']['y'] = 8.15
        elements.append({
            'id': 'default-address-2',
            'type': 'text',
            'x': 18.8,
            'y': 10.4,
            'width': 48.5,
            'y': 10.4,
            'height': 1.8,
            'content': '{{companyAddress2}} โทร {{companyPhone}}',
            'fontSize': 5.8,
        })
        by_id['default-category-label']['y'] = 14.0
        by_id['default-category-label']['height'] = 3.4
        by_id['default-category'].update(x=36.0, y=14.0)
        by_id['default-code-label'].update(x=2.4, y=17.8)
        by_id['default-code'].update(x=16.4, y=17.8, width=32.5)
        by_id['default-name-label'].update(y=21.9, height=3.8)
        by_id['default-name'].update(x=16.4, y=21.9, width=32.5, height=7.2, fontSize=6.8)
        by_id['default-date-label']['y'] = 29.4
        by_id['default-date'].update(y=29.4, width=32.5)
        by_id['default-footer'].update(y=33.2, height=2.5)
        by_id['default-name']['content'] = '{{AssetName}}'
        self.db.execute(
            '''INSERT INTO sticker_templates
               (id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active)
               VALUES(?,?,?,?,?,?,?,1)''',
            ('gov-asset-default-70x36', 'ฉลากครุภัณฑ์มาตรฐาน (70 × 36 มม.)',
             1, 70, 36, 'clip', json.dumps(elements, ensure_ascii=False)),
        )

        ensure_default_template(self.db)

        saved = self.db.execute(
            'SELECT elements_json FROM sticker_templates WHERE id=?',
            ('gov-asset-default-70x36',),
        ).fetchone()
        migrated = {element['id']: element for element in json.loads(saved['elements_json'])}
        self.assertEqual(
            migrated['default-address']['content'],
            'ที่อยู่: 68 ถ.หลักเมือง ต.ในเมือง อ.เมืองสุรินทร์ จ.สุรินทร์ 32000 โทร 044-518-937',
        )
        self.assertEqual(
            migrated['default-org-th']['content'],
            'ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์',
        )
        self.assertEqual(
            migrated['default-org-en']['content'],
            'MEDICAL EDUCATION CENTER OF SURIN HOSPITAL',
        )
        self.assertNotIn('default-address-2', migrated)
        self.assertEqual(migrated['default-name']['content'], '{{AssetName}}')
        self.assertEqual((migrated['default-name']['y'], migrated['default-name']['height']), (20.3, 8.4))
        self.assertEqual(migrated['default-name']['fontSize'], 5.8)
        self.assertEqual(migrated['default-name']['lineHeight'], 1.35)
        self.assertEqual((migrated['default-address']['y'], migrated['default-address']['height']), (9.0, 2.3))
        self.assertEqual(migrated['default-header-rule']['y'], 8.75)
        self.assertEqual(migrated['default-category-label']['y'], 12.0)
        self.assertEqual(migrated['default-org-th']['height'], 3.6)
        self.assertEqual(migrated['default-org-th']['fontSize'], 6.2)
        self.assertEqual(migrated['default-org-en']['y'], 5.5)
        self.assertEqual(migrated['default-org-en']['fontSize'], 5.8)
        self.assertEqual(migrated['default-footer']['y'], 32.8)

    def test_migrates_address_position_from_previous_single_line_header(self):
        elements = json.loads(json.dumps(_default_70x36_template()['elements']))
        by_id = {element['id']: element for element in elements}
        for element in elements:
            element.pop('lineHeight', None)
        by_id['default-address'].update(y=8.4, height=2.0)
        by_id['default-header-rule']['y'] = 8.15
        self.db.execute(
            '''INSERT INTO sticker_templates
               (id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active)
               VALUES(?,?,?,?,?,?,?,1)''',
            ('gov-asset-default-70x36', 'ฉลากครุภัณฑ์มาตรฐาน (70 × 36 มม.)',
             1, 70, 36, 'clip', json.dumps(elements, ensure_ascii=False)),
        )

        ensure_default_template(self.db)

        saved = self.db.execute(
            'SELECT elements_json FROM sticker_templates WHERE id=?',
            ('gov-asset-default-70x36',),
        ).fetchone()
        migrated = {element['id']: element for element in json.loads(saved['elements_json'])}
        address = migrated['default-address']
        rule = migrated['default-header-rule']
        self.assertEqual((address['y'], address['height']), (9.0, 2.3))
        self.assertEqual(rule['y'] + rule['height'], 8.95)
        self.assertGreaterEqual(address['y'], rule['y'] + rule['height'])
        self.assertEqual(migrated['default-org-th']['fontSize'], 6.2)
        self.assertEqual(migrated['default-org-en']['fontSize'], 5.8)
        self.assertEqual(
            migrated['default-org-th']['content'],
            'ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์',
        )
        self.assertEqual(
            migrated['default-org-en']['content'],
            'MEDICAL EDUCATION CENTER OF SURIN HOSPITAL',
        )
        self.assertEqual(
            migrated['default-address']['content'],
            'ที่อยู่: 68 ถ.หลักเมือง ต.ในเมือง อ.เมืองสุรินทร์ จ.สุรินทร์ 32000 โทร 044-518-937',
        )

    def test_header_migration_preserves_user_entered_static_text(self):
        elements = json.loads(json.dumps(_default_70x36_template()['elements']))
        by_id = {element['id']: element for element in elements}
        by_id['default-org-th']['content'] = 'ข้อความไทยที่ผู้ใช้กำหนดเอง'
        by_id['default-org-en']['content'] = 'CUSTOM ENGLISH HEADER'
        by_id['default-address']['content'] = 'ที่อยู่ที่ผู้ใช้กำหนดเอง'
        self.db.execute(
            '''INSERT INTO sticker_templates
               (id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active)
               VALUES(?,?,?,?,?,?,?,1)''',
            ('gov-asset-default-70x36', 'ฉลากครุภัณฑ์มาตรฐาน (70 × 36 มม.)',
             1, 70, 36, 'clip', json.dumps(elements, ensure_ascii=False)),
        )

        ensure_default_template(self.db)

        saved = self.db.execute(
            'SELECT elements_json FROM sticker_templates WHERE id=?',
            ('gov-asset-default-70x36',),
        ).fetchone()
        migrated = {element['id']: element for element in json.loads(saved['elements_json'])}
        self.assertEqual(migrated['default-org-th']['content'], 'ข้อความไทยที่ผู้ใช้กำหนดเอง')
        self.assertEqual(migrated['default-org-en']['content'], 'CUSTOM ENGLISH HEADER')
        self.assertEqual(migrated['default-address']['content'], 'ที่อยู่ที่ผู้ใช้กำหนดเอง')

    def test_migrates_default_asset_code_spacing_without_overwriting_custom_spacing(self):
        elements = json.loads(json.dumps(_default_70x36_template()['elements']))
        by_id = {element['id']: element for element in elements}
        by_id['default-code'].pop('letterSpacing')
        self.db.execute(
            '''INSERT INTO sticker_templates
               (id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active)
               VALUES(?,?,?,?,?,?,?,1)''',
            ('gov-asset-default-70x36', 'ฉลากครุภัณฑ์มาตรฐาน (70 × 36 มม.)',
             1, 70, 36, 'clip', json.dumps(elements, ensure_ascii=False)),
        )

        ensure_default_template(self.db)
        saved = self.db.execute(
            'SELECT elements_json FROM sticker_templates WHERE id=?',
            ('gov-asset-default-70x36',),
        ).fetchone()
        migrated = {element['id']: element for element in json.loads(saved['elements_json'])}
        self.assertEqual(migrated['default-code']['letterSpacing'], 0.2)

        migrated['default-code']['letterSpacing'] = 0.35
        self.db.execute(
            'UPDATE sticker_templates SET elements_json=? WHERE id=?',
            (json.dumps(list(migrated.values()), ensure_ascii=False), 'gov-asset-default-70x36'),
        )
        ensure_default_template(self.db)
        saved = self.db.execute(
            'SELECT elements_json FROM sticker_templates WHERE id=?',
            ('gov-asset-default-70x36',),
        ).fetchone()
        persisted = {element['id']: element for element in json.loads(saved['elements_json'])}
        self.assertEqual(persisted['default-code']['letterSpacing'], 0.35)

    def test_shortens_existing_builtin_template_names_but_preserves_custom_names(self):
        default = _default_70x36_template()
        default['name'] = 'ฉลากครุภัณฑ์มาตรฐาน (70 × 36 มม.)'
        large_presets = _preset_large_templates()
        old_names = {
            'medcenter-qr-wall-a6': 'ป้าย QR Smart ติดจุดสังเกต / ผนังห้อง (A6 — 105 × 148 มม.)',
            'medcenter-qr-poster-a4': 'ป้าย QR Smart เต็มแผ่น A4 — อุปกรณ์บนฝ้า/เพดาน/สแกนระยะไกล (210 × 297 มม.)',
        }
        rows = [(
            default['id'], default['name'], 1, 70, 36, 'clip',
            json.dumps(default['elements'], ensure_ascii=False), 1,
        )]
        for template in large_presets:
            rows.append((
                template['id'], old_names[template['id']], 0,
                template['canvas']['width'], template['canvas']['height'],
                template['overflow'], json.dumps(template['elements'], ensure_ascii=False), 0,
            ))
        rows.append((
            'medcenter-brother-36mm-70x36',
            'ฉลากครุภัณฑ์รุ่นก่อน (70 × 36 มม.)',
            0, 70, 36, 'clip', '[]', 0,
        ))
        self.db.executemany(
            '''INSERT INTO sticker_templates
               (id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active)
               VALUES(?,?,?,?,?,?,?,?)''',
            rows,
        )
        self.db.execute(
            '''INSERT INTO sticker_templates
               (id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active)
               VALUES(?,?,?,?,?,?,?,0)''',
            ('custom-label', 'แบบเฉพาะของหน่วยงาน', 0, 70, 36, 'clip', '[]'),
        )

        ensure_default_template(self.db)

        names = {
            row['id']: row['name']
            for row in self.db.execute('SELECT id,name FROM sticker_templates')
        }
        self.assertEqual(names['gov-asset-default-70x36'], 'ฉลากครุภัณฑ์ 70 × 36 มม.')
        self.assertEqual(names['medcenter-brother-36mm-70x36'], 'ฉลากเดิม 70 × 36 มม.')
        self.assertEqual(names['medcenter-qr-wall-a6'], 'ป้าย QR A6 · 105 × 148 มม.')
        self.assertEqual(names['medcenter-qr-poster-a4'], 'ป้าย QR A4 · 210 × 297 มม.')
        self.assertEqual(names['custom-label'], 'แบบเฉพาะของหน่วยงาน')

    def test_rejects_duplicate_template_names(self):
        self.db.execute(
            '''INSERT INTO sticker_templates
               (id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active)
               VALUES(?,?,?,?,?,?,?,0)''',
            ('existing-template', 'ฉลากหลัก', 0, 70, 36, 'clip', '[]'),
        )

        result, status = save_template(self.db, {
            'template': {
                **_default_70x36_template(),
                'id': 'new-template',
                'name': '  ฉลากหลัก  ',
            },
            'isActive': True,
        })

        self.assertEqual(status, 409)
        self.assertIn('ตั้งชื่อให้ต่างกัน', result['error'])
        self.assertEqual(
            self.db.execute(
                'SELECT is_active FROM sticker_templates WHERE id=?',
                ('existing-template',),
            ).fetchone()['is_active'],
            0,
        )


if __name__ == '__main__':
    unittest.main()
