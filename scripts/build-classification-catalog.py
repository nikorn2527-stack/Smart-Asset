"""Build a classification-only starter pack. Never export individual asset rows."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import re
import sqlite3

PATTERN = re.compile(r'([0-9]{4}-[0-9]{3}-[0-9]{4})-([0-9]+)(?:[/\.].*)?')


def build(database):
    db = sqlite3.connect(Path(database).resolve().as_uri()+'?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        categories=[];floors={};recognized=0
        for category in db.execute('SELECT id,category_name,source_workbook FROM asset_categories ORDER BY category_name'):
            types=defaultdict(set)
            for row in db.execute('SELECT asset_type,code FROM assets WHERE category_id=? ORDER BY id', (category['id'],)):
                name=' '.join((row['asset_type'] or '').split())
                codes=types[name]
                match=PATTERN.fullmatch(row['code'] or '')
                if match:
                    codes.add(match[1]);recognized+=1
                    floors[match[1]]=max(floors.get(match[1],0),int(match[2]))
            categories.append({'name':category['category_name'], 'source':Path(category['source_workbook']).name,
                               'types':[{'name':name,'codes':sorted(codes)} for name,codes in sorted(types.items())]})
        return {'version':1,'sourceArchive':'ครุภัณฑ์แยกประเภท.rar',
                'fields':['หมวดจากไฟล์แยกประเภท','ชนิดครุภัณฑ์','เลขจำแนก 3 ชุดแรก','ลำดับสูงสุดเดิม'],
                'categories':categories,'sequenceFloors':dict(sorted(floors.items())),
                'summary':{'categories':len(categories),'categoryTypes':sum(len(c['types']) for c in categories),
                           'categoryCodes':sum(len({code for t in c['types'] for code in t['codes']}) for c in categories),
                           'typeCodeLinks':sum(len(t['codes']) for c in categories for t in c['types']),
                           'typesWithoutFullCode':sum(not t['codes'] for c in categories for t in c['types']),
                           'recognizedSourceNumbers':recognized}}
    finally:
        db.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args();data=build(args.database)
    Path(args.output).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(data['summary'],ensure_ascii=False))
