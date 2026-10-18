#!/usr/bin/env python3
"""Local-console recovery: passwords are entered interactively, never as arguments."""
import argparse,getpass,os,sqlite3,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from access_control import password_hash
from governance import GovernanceError
from backup_store import snapshot_database

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=('create-admin','reset-password'))
    parser.add_argument('--db',default=os.environ.get('ASSET_DB_PATH'))
    parser.add_argument('--username',required=True)
    parser.add_argument('--name')
    args=parser.parse_args()
    if not args.db or not Path(args.db).is_file():parser.error('ระบุ --db หรือ ASSET_DB_PATH ที่เป็นฐานเดิมซึ่งเริ่มเซิร์ฟเวอร์แล้ว')
    if not sys.stdin.isatty():parser.error('เปิดคำสั่งนี้ใน Terminal แบบโต้ตอบเพื่อกรอกรหัสผ่านอย่างปลอดภัย')
    username=args.username.strip().casefold()
    import re
    if not re.fullmatch(r'[a-z0-9ก-๙._@-]{3,80}',username):parser.error('ชื่อผู้ใช้ไม่ถูกต้อง')
    with sqlite3.connect(args.db) as db:
        db.row_factory=sqlite3.Row
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='app_users'").fetchone():parser.error('เริ่มเซิร์ฟเวอร์รุ่นใหม่หนึ่งครั้งก่อนใช้คำสั่งนี้')
        user=db.execute('SELECT id,revision FROM app_users WHERE username=?',(username,)).fetchone()
        if args.command=='create-admin' and user:parser.error('มีชื่อผู้ใช้นี้แล้ว ใช้ reset-password หากต้องการเปลี่ยนรหัสผ่าน')
        if args.command=='reset-password' and not user:parser.error('ไม่พบชื่อผู้ใช้')
    password=getpass.getpass('รหัสผ่านใหม่ (อย่างน้อย 10 ตัวอักษร): ')
    if password!=getpass.getpass('ยืนยันรหัสผ่านใหม่: '):parser.error('รหัสผ่านไม่ตรงกัน')
    try:hashed=password_hash(password)
    except (ValueError,GovernanceError):parser.error('รหัสผ่านไม่ถูกต้อง')
    snapshot_database(args.db,'before-console-user-change')
    with sqlite3.connect(args.db) as db:
        db.execute('PRAGMA foreign_keys=ON');db.execute('BEGIN IMMEDIATE')
        if args.command=='create-admin':
            if not args.name or len(args.name)>160:parser.error('ระบุ --name ความยาวไม่เกิน 160 ตัวอักษร')
            uid=db.execute("INSERT INTO app_users(username,name,password_hash,global_role) VALUES(?,?,?,'admin')",(username,args.name.strip(),hashed)).lastrowid
        else:
            uid=user['id'];db.execute('UPDATE app_users SET password_hash=?,revision=revision+1 WHERE id=?',(hashed,uid));db.execute('DELETE FROM app_sessions WHERE user_id=?',(uid,))
        db.execute('INSERT INTO account_events(actor,kind,entity_id,before_json,after_json) VALUES(?,?,?,?,?)',('local-console','user-recovery',uid,'{}','{"command":"'+args.command+'"}'))
    print('บันทึกแล้ว เข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่านที่ตั้งไว้')
    return 0
if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,GovernanceError,sqlite3.Error) as exc:print('ไม่สำเร็จ:',exc,file=sys.stderr);raise SystemExit(1)
