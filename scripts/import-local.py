#!/usr/bin/env python3
"""Create a new private SQLite database from local workbooks and the FSN PDF."""
from __future__ import annotations

import argparse
from datetime import datetime
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


def choose_sources(folder: Path | None, pdf: Path | None) -> tuple[Path, Path]:
    if folder is not None and pdf is not None:
        return folder, pdf
    if sys.platform != 'win32':
        raise ValueError('ระบุ --workbook-dir และ --fsn-manual เมื่อไม่ได้ใช้ Windows')
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError as exc:
        raise ValueError('Python นี้ไม่มีหน้าต่างเลือกไฟล์ กรุณาระบุ --workbook-dir และ --fsn-manual') from exc
    window = tk.Tk()
    window.withdraw()
    try:
        if folder is None:
            selected = filedialog.askdirectory(parent=window, title='เลือกโฟลเดอร์ Excel ที่แตกจาก ครุภัณฑ์แยกประเภท.rar')
            if not selected:
                raise ValueError('ยกเลิกการเลือกโฟลเดอร์ ยังไม่มีการสร้างฐานข้อมูล')
            folder = Path(selected)
        if pdf is None:
            selected = filedialog.askopenfilename(parent=window, title='เลือก คู่มือ การออกเลขครุภัณฑ์.pdf', filetypes=[('PDF', '*.pdf')])
            if not selected:
                raise ValueError('ยกเลิกการเลือก PDF ยังไม่มีการสร้างฐานข้อมูล')
            pdf = Path(selected)
    finally:
        window.destroy()
    return folder, pdf


def workbook_folder(selected: Path) -> Path:
    selected = selected.expanduser().resolve()
    if not selected.is_dir():
        raise ValueError('ไม่พบโฟลเดอร์ Excel ที่เลือก')
    if any(p.is_file() and p.suffix.lower() in {'.xls', '.xlsx'} for p in selected.iterdir()):
        return selected
    parents = {p.parent for p in selected.rglob('*') if p.is_file() and p.suffix.lower() in {'.xls', '.xlsx'}}
    if len(parents) != 1:
        raise ValueError('กรุณาเลือกโฟลเดอร์ที่มี Excel ชุดเดียวกัน หากยังเป็น RAR ให้แตกไฟล์ก่อน')
    return parents.pop()


def ps_quote(value: str | Path) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbook-dir', type=Path)
    parser.add_argument('--fsn-manual', type=Path)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--db', type=Path, help='ฐานใหม่เท่านั้น ไม่เขียนทับไฟล์เดิม')
    parser.add_argument('--run', action='store_true', help='เปิดเซิร์ฟเวอร์ Local หลังนำเข้าสำเร็จ')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    try:
        if not 1 <= args.port <= 65535:
            raise ValueError('พอร์ตต้องอยู่ระหว่าง 1–65535')
        if args.run:
            with socket.socket() as sock:
                sock.settimeout(1)
                if sock.connect_ex(('127.0.0.1', args.port)) == 0:
                    raise ValueError(f'พอร์ต {args.port} ใช้อยู่ กรุณาหยุดเซิร์ฟเวอร์เดิมด้วย Ctrl+C แล้วรันใหม่')
        folder, pdf = choose_sources(args.workbook_dir, args.fsn_manual)
        folder = workbook_folder(folder)
        pdf = pdf.expanduser().resolve()
        if not pdf.is_file() or pdf.suffix.lower() != '.pdf':
            raise ValueError('ไม่พบไฟล์ PDF คู่มือที่เลือก')
        private_root = Path(os.environ.get('LOCALAPPDATA') or Path.home() / '.local' / 'share') / 'Smart-Asset'
        destination = (args.db or private_root / f'smart-asset-imported-{datetime.now():%Y%m%d-%H%M%S}-{uuid4().hex[:6]}.sqlite3').expanduser().resolve()
        if destination.exists():
            raise ValueError('ไฟล์ฐานปลายทางมีอยู่แล้ว กรุณาเลือกชื่อใหม่ ระบบจะไม่เขียนทับฐานเดิม')
        destination.parent.mkdir(parents=True, exist_ok=True)
        log = destination.with_suffix('.import.log')
        if log.exists():
            raise ValueError('ไฟล์บันทึกการนำเข้ามีอยู่แล้ว กรุณาเลือกชื่อฐานใหม่')
        command = [sys.executable, str(ROOT / 'import_sources.py'), '--workbook-dir', str(folder), '--fsn-manual', str(pdf), '--db', str(destination)]
        archive = args.archive
        if archive is None:
            archive = next((p for p in (folder / 'ครุภัณฑ์แยกประเภท.rar', folder.parent / 'ครุภัณฑ์แยกประเภท.rar') if p.is_file()), None)
        if archive is not None:
            if not archive.is_file():
                raise ValueError('ไม่พบ RAR ต้นฉบับที่ระบุ')
            command += ['--archive', str(archive.resolve())]
        count = sum(p.is_file() and p.suffix.lower() in {'.xls', '.xlsx'} for p in folder.iterdir())
        print(f'กำลังนำเข้า Excel {count} ไฟล์ อาจใช้เวลาหลายนาที กรุณารอ...', flush=True)
        with log.open('x', encoding='utf-8') as output:
            result = subprocess.run(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT,
                                    env={**os.environ, 'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'})
        if result.returncode:
            print(log.read_text(encoding='utf-8', errors='replace'))
            raise ValueError(f'นำเข้าไม่สำเร็จ ดูรายละเอียดที่ {log} ยังไม่ได้เปลี่ยนฐานที่แอปใช้งาน')
        with sqlite3.connect(destination) as db:
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or db.execute('PRAGMA foreign_key_check').fetchall():
                raise ValueError('ฐานไม่ผ่านการตรวจความสมบูรณ์ ยังไม่ได้เปิดใช้งาน')
            assets = db.execute('SELECT COUNT(*) FROM assets').fetchone()[0]
            source_rows = db.execute('SELECT COUNT(*) FROM source_row_records').fetchone()[0]
        print(f'สำเร็จ: ครุภัณฑ์ {assets:,} รายการ / แถวต้นทาง {source_rows:,} แถว', flush=True)
        print(f'ฐานข้อมูล: {destination}', flush=True)
        print('คำสั่งสำหรับเปิดฐานนี้ครั้งถัดไป:')
        print("$env:HOST = '127.0.0.1'")
        print(f"$env:PORT = '{args.port}'")
        print(f'$env:ASSET_DB_PATH = {ps_quote(destination)}')
        print(f'& {ps_quote(sys.executable)} {ps_quote(ROOT / "server.py")}', flush=True)
        if args.run:
            env = {**os.environ, 'ASSET_DB_PATH': str(destination), 'HOST': '127.0.0.1', 'PORT': str(args.port)}
            print(f'กำลังเปิดแอป Local ที่ http://127.0.0.1:{args.port} (หยุดด้วย Ctrl+C)', flush=True)
            return subprocess.call([sys.executable, str(ROOT / 'server.py')], cwd=ROOT, env=env)
        return 0
    except (ValueError, OSError) as exc:
        print(f'ไม่สำเร็จ: {exc}', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('\nหยุดการทำงานแล้ว')
        return 130


if __name__ == '__main__':
    raise SystemExit(main())
