#!/usr/bin/env python3
"""Import the supplied Thai asset records and reference PDFs into SQLite.

The source database is a local test artifact. Do not commit the generated .sqlite3
file or point a public demo service at it. Original workbook cells are retained
once in source_row_records.raw_data_json and linked to normalized assets; scanned
register fields are supplied via a separate JSON file to preserve provenance.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import re
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Any

VERSION = "1.1"
HERE = Path(__file__).resolve().parent
SCHEMA = HERE / "schema.sql"
ARCHIVE_NAME = "ครุภัณฑ์แยกประเภท.rar"
SCOPE = "ข้อมูลตัวอย่างจากเอกสารที่ผู้ใช้แนบ; ตรวจสอบกับต้นฉบับก่อนใช้งานจริง"

# The 19 supplied workbooks share one 31-column header except for the software
# workbook, which may have headings or use a legacy positional layout.
# Prefer actual headings whenever present; this fallback preserves legacy order;
# unmapped/raw cells remain available in source_row_records and source_columns.
SOFTWARE_COLUMNS = {
    0: ("ลำดับ", "source_row_number"),
    1: ("บำรุงรักษา", "maintenance_status"),
    2: ("คอลัมน์เดิม 03", "unmapped_03"),
    3: ("เลขครุภัณฑ์", "code"),
    4: ("สถานะครุภัณฑ์", "asset_status"),
    5: ("กลุ่มครุภัณฑ์", "group_name"),
    6: ("แบบ/ลักษณะ", "detail"),
    7: ("ชนิดครุภัณฑ์", "asset_type"),
    8: ("ประเภทครุภัณฑ์", "asset_type_detail"),
    9: ("ปีงบที่ได้มา", "fiscal_year_th"),
    10: ("เลขที่ GFMIS", "gfmis_no"),
    11: ("เลขที่ PO", "po_no"),
    12: ("รุ่น", "model"),
    13: ("ฝ่าย/สาย รับผิดชอบ", "responsible_unit"),
    14: ("หมายเลขเครื่อง (Serial Number)", "serial_number"),
    15: ("รายละเอียดครุภัณฑ์", "description"),
    16: ("หน่วยงาน/กอง", "department"),
    17: ("สถานที่ตั้ง", "location"),
    18: ("วันที่ได้มา", "acquisition_date"),
    19: ("วันที่ส่งมอบ", "delivery_date"),
    20: ("วิธีการได้มา", "acquisition_method"),
    21: ("อายุการใช้งาน", "useful_life_years"),
    22: ("ราคาทุน", "purchase_price"),
    23: ("มูลค่าเสื่อม", "depreciation_value"),
    24: ("มูลค่าเสื่อมสะสม", "accumulated_depreciation"),
    25: ("มูลค่าคงเหลือ", "net_book_value"),
    26: ("วันคงเหลือ", "remaining_days"),
    27: ("ครุภัณฑ์เช่ายืม", "is_loaned"),
    28: ("ราคาเช่า-ยืม", "loan_price"),
    29: ("เลขใบส่งของ", "delivery_note_no"),
    30: ("วันที่แก้ไขล่าสุด", "latest_update"),
}

HEADER_TO_FIELD = {
    "ลำดับ": "source_row_number",
    "บำรุงรักษา": "maintenance_status",
    "เลขครุภัณฑ์": "code",
    "สถานะครุภัณฑ์": "asset_status",
    "หน่วยงาน/กอง": "department",
    "สถานที่ตั้ง": "location",
    "กลุ่มครุภัณฑ์": "group_name",
    "แบบ/ลักษณะ": "detail",
    "ปีงบที่ได้มา": "fiscal_year_th",
    "วันที่ได้มา": "acquisition_date",
    "เลขครุภัณฑ์เดิม": "old_asset_code",
    "ราคาทุน": "purchase_price",
    "เลขที่ GFMIS": "gfmis_no",
    "เลขที่ PO": "po_no",
    "รุ่น": "model",
    "ฝ่าย/สาย รับผิดชอบ": "responsible_unit",
    "รายละเอียดครุภัณฑ์": "description",
    "ชนิดครุภัณฑ์": "asset_type",
    "ประเภทครุภัณฑ์": "asset_type_detail",
    "วันที่ส่งมอบ": "delivery_date",
    "วิธีการได้มา": "acquisition_method",
    "อายุการใช้งาน": "useful_life_years",
    "มูลค่าเสื่อม": "depreciation_value",
    "มูลค่าเสื่อมสะสม": "accumulated_depreciation",
    "มูลค่าคงเหลือ": "net_book_value",
    "วันที่ปัจจุบัน": "valuation_date",
    "วันคงเหลือ": "remaining_days",
    "ครุภัณฑ์เช่ายืม": "is_loaned",
    "ราคาเช่า-ยืม": "loan_price",
    "วันที่แก้ไขล่าสุด": "latest_update",
    "เลขใบส่งของ": "delivery_note_no",
    "หมายเลขเครื่อง (Serial Number)": "serial_number",
}

CATEGORY_POLICY_RULES = {
    "ครุภัณฑ์งานบ้านงานครัว.xls": ["14"],
    "ครุภัณฑ์ดนตรีนาฏศิลป์.xls": ["16"],
    "ครุภัณฑ์ไฟฟ้าและวิทยุ (เครื่องกำเนิดไฟฟ้า).xls": ["5.2"],
    "ครุภัณฑ์ไฟฟ้าและวิทยุ.xls": ["5.1"],
    "ครุภัณฑ์ยานพาหนะและขนส่ง.xls": ["4"],
    "ครุภัณฑ์โรงงาน.xls": ["8.1", "8.2"],
    "ครุภัณฑ์วิทยาศาสตร์และการแพทย์.xls": ["11"],
    "ครุภัณฑ์สำนักงาน (ลิฟต์).xls": ["3.1"],
    "ครุภัณฑ์สำนักงาน.xls": ["3"],
    "สินทรัพย์ software.xlsx": ["20"],
    "อาคารถาวร.xls": ["1"],
    "อาคารประโยชน์อื่นๆ.xls": ["2.2.1", "2.2.2"],
    "อาคารพักอาศัย.xls": ["1"],
    "อาคารสำนักงาน.xls": ["1"],
    "ครุภัณฑ์ก่อสร้าง.xls": ["9.1", "9.2"],
    "ครุภัณฑ์การศึกษา.xls": ["13"],
    "ครุภัณฑ์กีฬาและกายภาพ.xls": ["15"],
    "ครุภัณฑ์คอมพิวเตอร์.xls": ["12"],
    "ครุภัณฑ์โฆษณาและเผยแพร่.xls": ["6"],
}


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return str(int(value))
    return str(value).replace("\u00a0", " ").strip()


def number(value: Any) -> float | None:
    text = clean_text(value).replace(",", "").replace("บาท", "").strip()
    if not text or text in {"-", "—", "ไม่มี", "ไม่ระบุ"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def integer(value: Any) -> int | None:
    result = number(value)
    return int(result) if result is not None and result.is_integer() else None


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=clean_text)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def add_source(db: sqlite3.Connection, path: Path, *, title: str, kind: str,
               scope: str = SCOPE, method: str = "", container: str = "",
               notes: str = "") -> int:
    digest = sha256(path) if path.exists() and path.is_file() else ""
    db.execute(
        "INSERT OR IGNORE INTO source_documents(filename,title,media_type,source_kind,source_scope,sha256,container_filename,extraction_method,notes) VALUES(?,?,?,?,?,?,?,?,?)",
        (path.name, title, "application/pdf" if path.suffix.lower() == ".pdf" else "application/octet-stream",
         kind, scope, digest, container, method, notes),
    )
    row = db.execute("SELECT id FROM source_documents WHERE filename=? AND sha256=?", (path.name, digest)).fetchone()
    return int(row[0])


def pdf_extraction_method() -> str:
    return "pdftotext -layout" if shutil.which("pdftotext") else "pypdf layout"


def extract_pdf_pages(path: Path) -> list[str]:
    if shutil.which("pdftotext"):
        proc = subprocess.run(["pdftotext", "-layout", str(path), "-"], check=True, capture_output=True)
        text = proc.stdout.decode("utf-8", errors="replace")
        pages = text.split("\f")
        if pages and not pages[-1].strip():
            pages.pop()  # Remove the final separator, not physical blank pages.
        return pages
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("กรุณาติดตั้งตัวนำเข้าด้วย python -m pip install -r requirements-import.txt") from exc
    return [page.extract_text(extraction_mode="layout") or "" for page in PdfReader(path).pages]


def parse_policy_rules(pages: list[str], source_id: int, db: sqlite3.Connection) -> list[dict[str, Any]]:
    rules: dict[str, dict[str, Any]] = {}
    rx = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$")
    for page_no, page in enumerate(pages, 1):
        for line in page.splitlines():
            match = rx.match(line)
            if not match:
                continue
            rule_no, category, years, rate = match.groups()
            category = re.sub(r"\s+", " ", category).strip(" .·–-")
            if len(category) < 3:
                continue
            rules[rule_no] = {
                "rule_no": rule_no,
                "category_name": category,
                "useful_life_years": float(years),
                "annual_rate_percent": float(rate),
                "source_page": page_no,
                "raw_text": line.strip(),
                "scope": "สำนักงานปลัดกระทรวงสาธารณสุข (ตามเอกสารแนบ)",
                "note": "",
            }
    # The scanned/text table contains special cases that do not carry both
    # numeric columns on the row; keep them explicit instead of inventing rates.
    if "2.3" not in rules:
        rules["2.3"] = {
            "rule_no": "2.3", "category_name": "งานต่อเติมอาคาร",
            "useful_life_years": None, "annual_rate_percent": None,
            "source_page": 1, "raw_text": "งานต่อเติมอาคาร — ส่งหนังสือหารือเป็นรายกรณี",
            "scope": "สำนักงานปลัดกระทรวงสาธารณสุข (ตามเอกสารแนบ)",
            "note": "ส่งหนังสือหารือเป็นรายกรณี; ไม่มีอัตราตายตัวในตาราง",
        }
    if "3.1" not in rules:
        rules["3.1"] = {
            "rule_no": "3.1", "category_name": "ลิฟต์ (กรณีเปลี่ยนแทน/สินทรัพย์ย่อย)",
            "useful_life_years": 12.0, "annual_rate_percent": 8.0,
            "source_page": 1, "raw_text": "ลิฟต์ (สินทรัพย์ย่อย) 12 8",
            "scope": "สำนักงานปลัดกระทรวงสาธารณสุข (ตามเอกสารแนบ)",
            "note": "ใช้เมื่อเป็นกรณีเปลี่ยนแทนและบันทึกเป็นสินทรัพย์ย่อยตามเอกสารแนบ",
        }
    db.executemany(
        "INSERT OR IGNORE INTO depreciation_policies(source_document_id,rule_no,category_name,useful_life_years,annual_rate_percent,scope,note,source_page,raw_text) VALUES(?,?,?,?,?,?,?,?,?)",
        [(source_id, r["rule_no"], r["category_name"], r["useful_life_years"], r["annual_rate_percent"], r["scope"], r["note"], r["source_page"], r["raw_text"]) for r in rules.values()],
    )
    return list(rules.values())


def parse_fsn_pages(pages: list[str], source_id: int, db: sqlite3.Connection) -> int:
    row_count = 0
    full_code_rx = re.compile(r"(?<!\d)(\d{4}-\d{3}-\d{4})(?!\d)")
    two_code_rx = re.compile(r"(?<!\d)(\d{4})\s+([0-9]{4})(?!\d)")
    group_rx = re.compile(r"กลุ่ม\s*ที่\s*([0-9]{1,3})")
    for page_no, page in enumerate(pages, 1):
        db.execute("INSERT OR IGNORE INTO source_document_pages(source_document_id,page_no,extracted_text,extraction_method) VALUES(?,?,?,?)", (source_id, page_no, page, pdf_extraction_method()))
        db.execute("INSERT OR IGNORE INTO fsn_manual_pages(source_document_id,page_no,extracted_text,extraction_method) VALUES(?,?,?,?)", (source_id, page_no, page, pdf_extraction_method()))
        lines = [re.sub(r"\s+", " ", line).strip() for line in page.splitlines()]
        group_no = ""
        group_title = ""
        for i, line in enumerate(lines):
            gm = group_rx.search(line)
            if gm:
                group_no = gm.group(1)
                group_title = line[gm.end():].strip(" :.-")
            fm = full_code_rx.search(line)
            if fm:
                code = fm.group(1)
                name = line[:fm.start()].strip(" .:-")
                name = re.sub(r"^\d+[.)]?\s*", "", name)
                if not name and i:
                    name = lines[i - 1]
                parts = code.split("-")
                db.execute("INSERT OR IGNORE INTO fsn_catalog_items(source_document_id,source_page,group_no,group_title,category_code,type_code,item_name,canonical_fsn_code,raw_line) VALUES(?,?,?,?,?,?,?,?,?)", (source_id, page_no, group_no, group_title, parts[0], parts[1], name, code, line))
                row_count += db.execute("SELECT changes()").fetchone()[0]
                continue
            tm = two_code_rx.search(line)
            if tm:
                category_code, type_code = tm.groups()
                name = line[:tm.start()].strip(" .:-")
                name = re.sub(r"^\d+[.)]?\s*", "", name)
                if not name and i:
                    name = lines[i - 1]
                if len(name) < 2 or any(x in name.lower() for x in ("ประเภท", "ชนิด", "หมายเลข")):
                    continue
                db.execute("INSERT OR IGNORE INTO fsn_catalog_items(source_document_id,source_page,group_no,group_title,category_code,type_code,item_name,canonical_fsn_code,raw_line) VALUES(?,?,?,?,?,?,?,?,?)", (source_id, page_no, group_no, group_title, category_code, type_code, name, "", line))
                row_count += db.execute("SELECT changes()").fetchone()[0]
    return row_count


def read_xls(path: Path) -> tuple[list[str], list[tuple[int, dict[str, Any]]]]:
    try:
        import xlrd
    except ImportError as exc:
        raise SystemExit("ต้องติดตั้ง xlrd ก่อน: python3 -m pip install xlrd openpyxl") from exc
    book = xlrd.open_workbook(str(path), on_demand=True)
    sheet = book.sheet_by_index(0)
    header_row = 0
    for r in range(min(sheet.nrows, 8)):
        values = [clean_text(sheet.cell_value(r, c)) for c in range(sheet.ncols)]
        if "เลขครุภัณฑ์" in values and sum(bool(v) for v in values) >= 8:
            header_row = r
            break
    headers = [clean_text(sheet.cell_value(header_row, c)) or f"คอลัมน์_{c+1:02d}" for c in range(sheet.ncols)]
    rows: list[tuple[int, dict[str, Any]]] = []
    for r in range(header_row + 1, sheet.nrows):
        raw: dict[str, Any] = {}
        nonempty = False
        for c, header in enumerate(headers):
            cell = sheet.cell(r, c)
            value: Any = cell.value
            if cell.ctype == xlrd.XL_CELL_DATE and value not in (None, ""):
                try:
                    value = xlrd.xldate_as_datetime(value, book.datemode).date().isoformat()
                except Exception:
                    value = clean_text(value)
            elif cell.ctype == xlrd.XL_CELL_NUMBER:
                value = int(value) if float(value).is_integer() else float(value)
            else:
                value = clean_text(value)
            if value not in (None, ""):
                nonempty = True
            raw[header] = value
        if nonempty:
            rows.append((r + 1, raw))
    book.release_resources()
    return headers, rows


def read_xlsx_software(path: Path) -> tuple[list[str], list[tuple[int, dict[str, Any]]]]:
    try:
        import openpyxl
    except ImportError as exc:
        raise SystemExit("ต้องติดตั้ง openpyxl ก่อน: python3 -m pip install xlrd openpyxl") from exc
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = book.worksheets[0]
    headers = [SOFTWARE_COLUMNS.get(i, (f"คอลัมน์_{i+1:02d}", ""))[0] for i in range(sheet.max_column)]
    # Prefer actual workbook headings over the legacy positional fallback.
    for values in sheet.iter_rows(min_row=1, max_row=8, values_only=True):
        labels=[clean_text(v) for v in values]
        if "เลขครุภัณฑ์" in labels and sum(v in HEADER_TO_FIELD for v in labels)>=8:
            headers=[v or f"คอลัมน์_{i+1:02d}" for i,v in enumerate(labels)]
            break
    rows: list[tuple[int, dict[str, Any]]] = []
    for row_no, values in enumerate(sheet.iter_rows(values_only=True), 1):
        if not any(v is not None and clean_text(v) for v in values):
            continue
        raw: dict[str, Any] = {}
        for i, value in enumerate(values):
            header = headers[i] if i < len(headers) else f"คอลัมน์_{i+1:02d}"
            raw[header] = value.isoformat() if isinstance(value, (dt.datetime, dt.date)) else value
        rows.append((row_no, raw))
    book.close()
    return headers, rows


def canonical(raw: dict[str, Any], software: bool = False) -> dict[str, Any]:
    if software and not any(k in raw for k in ("เลขครุภัณฑ์เดิม", "วันที่ปัจจุบัน")):
        return {field: raw.get(header, "") for header, field in SOFTWARE_COLUMNS.values()}
    result: dict[str, Any] = {}
    for header, value in raw.items():
        key = HEADER_TO_FIELD.get(header.strip())
        if key:
            result[key] = value
    return result


def create_unit(db: sqlite3.Connection, org_id: int, name: str, unit_type: str, source_id: int) -> int | None:
    name = clean_text(name)
    if not name:
        return None
    existing = db.execute("SELECT id FROM org_units WHERE organization_id=? AND parent_unit_id IS NULL AND name=? AND unit_type=? ORDER BY id LIMIT 1", (org_id, name, unit_type)).fetchone()
    if existing:
        return int(existing[0])
    db.execute("INSERT OR IGNORE INTO org_units(organization_id,parent_unit_id,name,unit_type,source_document_id) VALUES(?,NULL,?,?,?)", (org_id, name, unit_type, source_id))
    row = db.execute("SELECT id FROM org_units WHERE organization_id=? AND parent_unit_id IS NULL AND name=? AND unit_type=?", (org_id, name, unit_type)).fetchone()
    return int(row[0]) if row else None


def create_category(db: sqlite3.Connection, path: Path, source_id: int) -> int:
    name = path.stem.strip()
    db.execute("INSERT OR IGNORE INTO asset_categories(category_name,source_workbook,source_document_id) VALUES(?,?,?)", (name, path.name, source_id))
    return int(db.execute("SELECT id FROM asset_categories WHERE source_workbook=? AND category_name=?", (path.name, name)).fetchone()[0])


def policy_candidates(db: sqlite3.Connection, category_id: int, raw: dict[str, Any], category_file: str) -> list[int]:
    rule_nos = CATEGORY_POLICY_RULES.get(category_file, [])
    if not rule_nos:
        return []
    placeholders = ",".join("?" for _ in rule_nos)
    rows = db.execute(f"SELECT id,rule_no,useful_life_years FROM depreciation_policies WHERE rule_no IN ({placeholders})", rule_nos).fetchall()
    for row in rows:
        db.execute("INSERT OR IGNORE INTO asset_category_policy_links(category_id,policy_id,match_note) VALUES(?,?,?)", (category_id, row["id"], "จับคู่ตามหมวด workbook; อายุรายการใช้เลือกกฎย่อยเมื่อทำได้"))
    life = number(raw.get("useful_life_years"))
    if life is not None:
        matches = [r["id"] for r in rows if r["useful_life_years"] is not None and abs(float(r["useful_life_years"]) - life) < 0.001]
        if len(matches) == 1:
            return matches
    return [int(r["id"]) for r in rows] if len(rows) == 1 else []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook-dir", type=Path, required=True, help="โฟลเดอร์ที่แตก workbook จาก RAR แล้ว")
    parser.add_argument("--archive", type=Path, help="RAR ต้นฉบับ (ใช้บันทึก hash/ที่มาเท่านั้น)")
    parser.add_argument("--fsn-manual", type=Path, required=True, help="คู่มือการออกเลขครุภัณฑ์.pdf")
    parser.add_argument("--depreciation-pdf", type=Path, help="ตารางอายุและอัตราค่าเสื่อม.pdf (ไม่ระบุจะไม่นำเข้าหรือเดากฎค่าเสื่อม)")
    parser.add_argument("--register-pdf", type=Path, help="ทะเบียนคุม PDF ต้นฉบับ")
    parser.add_argument("--register-json", type=Path, help="JSON ที่ตรวจทานข้อมูลจากหน้าแบบฟอร์มสแกนแล้ว (ไม่บังคับ)")
    parser.add_argument("--db", type=Path, required=True, help="ปลายทาง SQLite; ใช้ path นอก web root")
    parser.add_argument("--replace", action="store_true", help="อนุญาตลบไฟล์ฐานข้อมูลปลายทางเดิมก่อนนำเข้า")
    args = parser.parse_args()

    workbook_dir = args.workbook_dir.expanduser().resolve()
    db_path = args.db.expanduser().resolve()
    for required in (args.fsn_manual, args.depreciation_pdf, args.register_json):
        if required is not None and not required.exists():
            parser.error(f"ไม่พบไฟล์: {required}")
    workbooks = sorted([p for p in workbook_dir.iterdir() if p.suffix.lower() in {".xls", ".xlsx"}])
    if not workbooks:
        parser.error("ไม่พบ workbook .xls หรือ .xlsx ในโฟลเดอร์ที่ระบุ")
    if args.register_pdf and not args.register_json:
        parser.error("การเชื่อมข้อมูลทะเบียน PDF ต้องมี --register-json ที่ตรวจทานแล้ว")
    if db_path.exists() and not args.replace:
        parser.error(f"ฐานข้อมูลปลายทางมีอยู่แล้ว: {db_path}; เลือก path ใหม่หรือระบุ --replace อย่างชัดเจน")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(db_path) + suffix)
        if sidecar.exists():
            sidecar.unlink()

    try:
        import xlrd  # noqa: F401
        import openpyxl  # noqa: F401
    except ImportError as exc:
        raise SystemExit("ต้องติดตั้ง dependencies: python3 -m pip install xlrd openpyxl") from exc

    with sqlite3.connect(db_path) as db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(SCHEMA.read_text(encoding="utf-8"))
        db.execute("BEGIN IMMEDIATE")
        start = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

        # Sources: archive container, 19 workbooks and three user-supplied PDFs.
        archive_path = args.archive.expanduser().resolve() if args.archive else workbook_dir.parent / ARCHIVE_NAME
        archive_id = add_source(db, archive_path, title="แฟ้มรวมรายการครุภัณฑ์แยกประเภท", kind="archive", method="แตก archive แล้วนำเข้า workbook แยกไฟล์", notes="บันทึก metadata เท่านั้น; ไม่เก็บไฟล์ RAR ในฐานข้อมูล")
        workbook_sources: dict[str, int] = {}
        for path in workbooks:
            workbook_sources[path.name] = add_source(db, path, title=path.stem, kind="workbook", container=ARCHIVE_NAME, method="xlrd/openpyxl; เก็บค่าใน raw_data_json")
        fsn_path = args.fsn_manual.expanduser().resolve()
        register_data = json.loads(args.register_json.read_text(encoding="utf-8")) if args.register_json else {}
        fsn_source = add_source(db, fsn_path, title="คู่มือการออกเลขครุภัณฑ์", kind="fsn_manual", method=pdf_extraction_method(), notes="เก็บข้อความรายหน้าและรหัสตามต้นฉบับ ไม่สร้างเลขแทนช่องที่ไม่มี")
        reg_source = None
        if args.register_json:
            register_path = args.register_pdf.expanduser().resolve() if args.register_pdf else Path(register_data.get("source_pdf", "")).expanduser().resolve()
            if not register_path.is_file():
                raise ValueError("ไม่พบ PDF ทะเบียนต้นฉบับสำหรับข้อมูล JSON")
            reg_source = add_source(db, register_path, title="ทะเบียนคุมทรัพย์สิน", kind="asset_register", method=register_data.get("extraction_method", "manual visual OCR"), notes="ข้อมูลที่ตรวจทานจากเอกสารสแกน")
        organization_name = clean_text(register_data.get("organization_name")) or "หน่วยงาน (ยังไม่ระบุชื่อ)"
        db.execute("INSERT OR IGNORE INTO organizations(name,code,source_document_id) VALUES(?,?,?)", (organization_name, "", reg_source or archive_id))
        org_id = int(db.execute("SELECT id FROM organizations WHERE name=? AND code=''", (organization_name,)).fetchone()[0])
        rules = []
        if args.depreciation_pdf:
            dep_path = args.depreciation_pdf.expanduser().resolve()
            dep_source = add_source(db, dep_path, title="ตารางอายุและอัตราค่าเสื่อม", kind="depreciation_policy", method=pdf_extraction_method(), notes="ตรวจขอบเขตบังคับใช้จากเอกสารต้นฉบับ")
            dep_pages = extract_pdf_pages(dep_path)
            for page_no, page in enumerate(dep_pages, 1):
                db.execute("INSERT OR IGNORE INTO source_document_pages(source_document_id,page_no,extracted_text,extraction_method) VALUES(?,?,?,?)", (dep_source, page_no, page, pdf_extraction_method()))
            rules = parse_policy_rules(dep_pages, dep_source, db)
        policy_ids = {r["rule_no"]: int(db.execute("SELECT id FROM depreciation_policies WHERE source_document_id=? AND rule_no=?", (dep_source, r["rule_no"])).fetchone()[0]) for r in rules}

        fsn_pages = extract_pdf_pages(fsn_path)
        fsn_items = parse_fsn_pages(fsn_pages, fsn_source, db)

        # Create one category for every workbook, with possible policy links.
        categories: dict[str, int] = {}
        for path in workbooks:
            category_id = create_category(db, path, workbook_sources[path.name])
            categories[path.name] = category_id
            for rule_no in CATEGORY_POLICY_RULES.get(path.name, []):
                if rule_no in policy_ids:
                    db.execute("INSERT OR IGNORE INTO asset_category_policy_links(category_id,policy_id,match_note) VALUES(?,?,?)", (category_id, policy_ids[rule_no], "จับคู่จากชื่อหมวด workbook กับหมวดในตารางแนบ; เป็นแนวทางทดลอง"))

        total_assets = 0
        total_source_rows = 0
        code_asset_ids: dict[str, list[int]] = {}
        now = dt.datetime.now().astimezone().isoformat(timespec="seconds")
        for path in workbooks:
            source_id = workbook_sources[path.name]
            category_id = categories[path.name]
            software = path.name.lower() == "สินทรัพย์ software.xlsx"
            headers, rows = read_xlsx_software(path) if software else read_xls(path)
            for idx, header in enumerate(headers):
                positional = software and not any(h in headers for h in ("เลขครุภัณฑ์เดิม", "วันที่ปัจจุบัน"))
                field = SOFTWARE_COLUMNS.get(idx, (header, ""))[1] if positional else HEADER_TO_FIELD.get(header.strip(), "")
                note = "ตำแหน่งคอลัมน์จากรูปแบบ workbook software ที่ไม่มีแถวหัวตาราง" if positional else "จับคู่ตามชื่อหัวคอลัมน์"
                db.execute("INSERT OR IGNORE INTO source_columns(source_document_id,column_no,source_header,canonical_field,mapping_note) VALUES(?,?,?,?,?)", (source_id, idx + 1, header, field, note))

            for source_row_no, raw in rows:
                total_source_rows += 1
                norm = canonical(raw, software)
                code = clean_text(norm.get("code"))
                if code == "เลขครุภัณฑ์" and sum(clean_text(v) in HEADER_TO_FIELD for v in raw.values()) >= 8:
                    db.execute("INSERT INTO source_row_records(source_document_id,source_row_no,record_kind,raw_data_json) VALUES(?,?,?,?)", (source_id, source_row_no, "header", json_text(raw)))
                    continue
                description = clean_text(norm.get("description"))
                detail = clean_text(norm.get("detail"))
                asset_type = clean_text(norm.get("asset_type_detail")) or clean_text(norm.get("asset_type"))
                name = description or detail or asset_type or clean_text(norm.get("group_name")) or path.stem
                raw_json = json_text(raw)
                if not code and not (description or detail or asset_type):
                    db.execute("INSERT INTO source_row_records(source_document_id,source_row_no,record_kind,raw_data_json) VALUES(?,?,?,?)", (source_id, source_row_no, "unmapped", raw_json))
                    continue

                department_name = clean_text(norm.get("department"))
                responsible_name = clean_text(norm.get("responsible_unit"))
                dept_id = create_unit(db, org_id, department_name, "department", source_id)
                responsible_id = create_unit(db, org_id, responsible_name, "responsible_unit", source_id)
                linked_rules = policy_candidates(db, category_id, norm, path.name)
                policy_id = linked_rules[0] if len(linked_rules) == 1 else None
                values = (
                    name, detail, code, path.stem, clean_text(norm.get("location")) or responsible_name or department_name,
                    "", "ทะเบียนแล้ว", "▤", now, "นำเข้าจาก workbook", now,
                    source_id, source_row_no, org_id, dept_id, responsible_id, category_id,
                    clean_text(norm.get("old_asset_code")), clean_text(norm.get("maintenance_status")), clean_text(norm.get("asset_status")), asset_type,
                    "", "", "", "", None, "", "", "",
                    "", None, policy_id,
                    None, None, None,
                    "", None, clean_text(norm.get("is_loaned")),
                    None, clean_text(norm.get("latest_update")), "", "{}",
                )
                cur = db.execute("""INSERT INTO assets(
                    name,detail,code,group_name,location,acquired_year,status,icon,created_at,created_by,updated_at,
                    source_document_id,source_row_no,organization_id,department_unit_id,responsible_unit_id,category_id,
                    old_asset_code,maintenance_status,asset_status_source,asset_type,fiscal_year_th,acquisition_date,delivery_date,
                    acquisition_method,purchase_price,gfmis_no,po_no,model,serial_number,useful_life_years,depreciation_policy_id,
                    depreciation_value,accumulated_depreciation,net_book_value,valuation_date,remaining_days,is_loaned,loan_price,
                    latest_update,delivery_note_no,raw_data_json)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", values)
                asset_id = int(cur.lastrowid)
                total_assets += 1
                if code:
                    code_asset_ids.setdefault(code, []).append(asset_id)
                db.execute("INSERT INTO source_row_records(source_document_id,source_row_no,record_kind,asset_id,raw_data_json) VALUES(?,?,?,?,?)", (source_id, source_row_no, "asset", asset_id, raw_json))

                acq_fields = [norm.get(k) for k in ("fiscal_year_th", "acquisition_date", "delivery_date", "purchase_price", "gfmis_no", "po_no", "acquisition_method", "model", "serial_number", "delivery_note_no")]
                if any(clean_text(v) for v in acq_fields):
                    db.execute("INSERT INTO asset_acquisitions(asset_id,source_document_id,fiscal_year_th,acquired_on,delivered_on,document_no,gfmis_no,po_no,acquisition_method,unit_price,total_price,model,serial_number,raw_data_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (asset_id, source_id, clean_text(norm.get("fiscal_year_th")), clean_text(norm.get("acquisition_date")), clean_text(norm.get("delivery_date")), clean_text(norm.get("delivery_note_no")), clean_text(norm.get("gfmis_no")), clean_text(norm.get("po_no")), clean_text(norm.get("acquisition_method")), number(norm.get("purchase_price")), number(norm.get("purchase_price")), clean_text(norm.get("model")), clean_text(norm.get("serial_number")), "{}"))
                depreciation_fields = [norm.get(k) for k in ("useful_life_years", "depreciation_value", "accumulated_depreciation", "net_book_value", "remaining_days")]
                if any(clean_text(v) for v in depreciation_fields):
                    db.execute("INSERT INTO asset_depreciation_snapshots(asset_id,source_document_id,policy_id,period_date,useful_life_years,monthly_depreciation,accumulated_depreciation,net_book_value,remaining_days,raw_data_json) VALUES(?,?,?,?,?,?,?,?,?,?)", (asset_id, source_id, policy_id, clean_text(norm.get("valuation_date")), number(norm.get("useful_life_years")), number(norm.get("depreciation_value")), number(norm.get("accumulated_depreciation")), number(norm.get("net_book_value")), integer(norm.get("remaining_days")), "{}"))

        # Match asset references from the FSN manual only when a full documented
        # 4-3-4 code equals the code or its first three segments; no fuzzy joins.
        fsn_rows = db.execute("SELECT id,canonical_fsn_code FROM fsn_catalog_items WHERE canonical_fsn_code<>''").fetchall()
        fsn_by_code = {r["canonical_fsn_code"]: int(r["id"]) for r in fsn_rows}
        for asset_code, ids in code_asset_ids.items():
            pieces = asset_code.split("-")
            candidate = "-".join(pieces[:3]) if len(pieces) >= 3 else asset_code
            fsn_id = fsn_by_code.get(asset_code) or fsn_by_code.get(candidate)
            if fsn_id:
                for asset_id in ids:
                    method = "exact" if asset_code in fsn_by_code else "documented_4-3-4_prefix"
                    db.execute("INSERT OR IGNORE INTO asset_fsn_matches(asset_id,fsn_catalog_item_id,match_method,matched_code) VALUES(?,?,?,?)", (asset_id, fsn_id, method, candidate))
                    db.execute("UPDATE assets SET fsn_catalog_item_id=? WHERE id=?", (fsn_id, asset_id))

        if reg_source is not None:
            # Link the scanned asset-control-register example to the matching imported asset.
            match_code = clean_text(register_data.get("asset_code"))
            matching_ids = code_asset_ids.get(match_code, [])
            if not matching_ids:
                db.execute("INSERT INTO import_warnings(source_document_id,severity,warning_code,message,source_page) VALUES(?,?,?,?,?)", (reg_source, "error", "REGISTER_ASSET_NOT_MATCHED", "ไม่พบรหัสจากทะเบียน PDF ใน workbook; รายละเอียดทะเบียนถูกเก็บไว้แต่ไม่มี asset_id", register_data.get("source_page", 1)))
            else:
                asset_id = matching_ids[0]
                if len(matching_ids) > 1:
                    db.execute("INSERT INTO import_warnings(source_document_id,asset_id,severity,warning_code,message,source_page) VALUES(?,?,?,?,?,?)", (reg_source, asset_id, "review", "DUPLICATE_ASSET_CODE", "พบรหัสซ้ำใน workbook; ผูกทะเบียนกับแถวแรกและเก็บทุกรายการไว้แยกกัน", register_data.get("source_page", 1)))
                reg_acq = db.execute("INSERT INTO asset_acquisitions(asset_id,source_document_id,fiscal_year_th,acquired_on,document_no,gfmis_no,po_no,fund_type,acquisition_method,quantity,unit_price,total_price,vendor_name,vendor_address,vendor_phone,model,serial_number,warranty_end,raw_data_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (asset_id, reg_source, clean_text(register_data.get("fiscal_year_th")), clean_text(register_data.get("acquired_on_iso")), clean_text(register_data.get("document_no")), clean_text(register_data.get("gfmis_no")), clean_text(register_data.get("po_no")), clean_text(register_data.get("fund_type")), clean_text(register_data.get("acquisition_method")), number(register_data.get("quantity")), number(register_data.get("unit_price")), number(register_data.get("total_price")), clean_text(register_data.get("vendor_name")), clean_text(register_data.get("vendor_address")), clean_text(register_data.get("vendor_phone")), clean_text(register_data.get("model")), clean_text(register_data.get("serial_number")), clean_text(register_data.get("warranty_end_original")), json_text(register_data)))
                acq_id = int(reg_acq.lastrowid)
                db.execute("INSERT INTO asset_register_details(asset_id,source_document_id,acquisition_id,organization_name,department_name,asset_type,asset_code_printed,description,model,location,vendor_name,vendor_address,vendor_phone,gfmis_no,po_no,serial_number,warranty_end,fiscal_year_th,fund_type,acquisition_method,raw_data_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (asset_id, reg_source, acq_id, organization_name, clean_text(register_data.get("department_name")), clean_text(register_data.get("asset_type")), match_code, clean_text(register_data.get("description")), clean_text(register_data.get("model")), clean_text(register_data.get("location")), clean_text(register_data.get("vendor_name")), clean_text(register_data.get("vendor_address")), clean_text(register_data.get("vendor_phone")), clean_text(register_data.get("gfmis_no")), clean_text(register_data.get("po_no")), clean_text(register_data.get("serial_number")), clean_text(register_data.get("warranty_end_original")), clean_text(register_data.get("fiscal_year_th")), clean_text(register_data.get("fund_type")), clean_text(register_data.get("acquisition_method")), json_text(register_data)))
                dep_policy = policy_ids.get("11")
                db.execute("INSERT INTO asset_depreciation_snapshots(asset_id,source_document_id,policy_id,period_date,useful_life_years,monthly_depreciation,annual_depreciation,accumulated_depreciation,net_book_value,raw_data_json) VALUES(?,?,?,?,?,?,?,?,?,?)", (asset_id, reg_source, dep_policy, "", number(register_data.get("useful_life_years")), number(register_data.get("monthly_depreciation_source_value")), number(register_data.get("annual_depreciation_source_value")), number(register_data.get("accumulated_depreciation_source_value")), number(register_data.get("net_book_value_source_value")), "{}"))
                db.execute("INSERT INTO import_warnings(source_document_id,asset_id,severity,warning_code,message,source_page) VALUES(?,?,?,?,?,?)", (reg_source, asset_id, "review", "SCANNED_REGISTER_VALUES", clean_text(register_data.get("notes")), register_data.get("source_page", 1)))

        # Private-database sticker defaults follow the ITAM template model:
        # mm canvas, absolute-positioned text/QR/rect elements and one label/page.
        default_template = {
            "id": "gov-asset-default-75x36", "name": "ฉลากครุภัณฑ์มาตรฐาน 75.2 × 36 มม.",
            "canvas": {"width": 75.2, "height": 36, "unit": "mm"}, "overflow": "clip",
            "elements": [
                {"id":"e1","type":"rect","x":0,"y":0,"width":75.2,"height":5,"background":"#123d56","zIndex":0},
                {"id":"e2","type":"text","x":2,"y":1,"width":71,"height":3,"content":"{{orgName}}","fontSize":7,"fontWeight":700,"color":"#ffffff","align":"left","zIndex":1},
                {"id":"e3","type":"text","x":2,"y":7,"width":48,"height":4,"content":"{{AssetNo}}","fontSize":11,"fontWeight":800,"color":"#123d56","align":"left","zIndex":1},
                {"id":"e4","type":"text","x":2,"y":12,"width":48,"height":7,"content":"{{AssetName}}","fontSize":7,"fontWeight":600,"color":"#243746","align":"left","zIndex":1},
                {"id":"e5","type":"text","x":2,"y":21,"width":48,"height":4,"content":"{{Location}}","fontSize":6,"fontWeight":500,"color":"#526574","align":"left","zIndex":1},
                {"id":"e6","type":"qr","x":54,"y":8,"width":18,"height":18,"content":"{{QrUrl}}","zIndex":2}
            ]
        }
        db.execute("INSERT OR IGNORE INTO sticker_templates(id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active) VALUES(?,?,?,?,?,?,?,1)", (default_template["id"], default_template["name"], 1, 75.2, 36, "clip", json_text(default_template["elements"])))
        db.execute("INSERT OR REPLACE INTO sticker_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)", ("orgName", organization_name))

        # Keep all extracted depreciation and FSN page text as source evidence.
        # Record a manifest without including sensitive cell values in stdout.
        reg_link_count = len(matching_ids[:1]) if reg_source is not None and matching_ids else 0
        # FTS triggers indexed every source-row insert during import.
        db.execute("INSERT OR IGNORE INTO schema_migrations(name) VALUES('source-row-trigram-fts-v1')")
        db.execute("INSERT INTO import_runs(dataset_name,importer_version,source_file_count,asset_record_count,fsn_item_count,depreciation_rule_count,register_link_count,started_at,completed_at,notes) VALUES(?,?,?,?,?,?,?,?,?,?)", ("government-asset-prototype", VERSION, len(workbooks) + 2 + bool(args.depreciation_pdf) + bool(args.register_json), total_assets, fsn_items, len(rules), reg_link_count, start, dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "ข้อมูลดิบเก็บครั้งเดียวใน source_row_records.raw_data_json; PDF ทะเบียนเป็น OCR ที่ตรวจทานด้วยภาพ; ไม่ใช่ข้อมูล production"))
        db.commit()
        db.execute("PRAGMA optimize")
        summary = {
            "database": str(db_path),
            "workbooks": len(workbooks),
            "source_rows": total_source_rows,
            "asset_records": total_assets,
            "unique_asset_codes": int(db.execute("SELECT COUNT(DISTINCT code) FROM assets WHERE code<>''").fetchone()[0]),
            "duplicate_asset_code_rows": int(db.execute("SELECT COUNT(*) FROM assets WHERE code<>''").fetchone()[0] - db.execute("SELECT COUNT(DISTINCT code) FROM assets WHERE code<>''").fetchone()[0]),
            "fsn_catalog_items": int(db.execute("SELECT COUNT(*) FROM fsn_catalog_items").fetchone()[0]),
            "fsn_linked_assets": int(db.execute("SELECT COUNT(DISTINCT asset_id) FROM asset_fsn_matches").fetchone()[0]),
            "depreciation_rules": int(db.execute("SELECT COUNT(*) FROM depreciation_policies").fetchone()[0]),
            "register_asset_links": int(db.execute("SELECT COUNT(*) FROM asset_register_details").fetchone()[0]),
            "acquisition_records": int(db.execute("SELECT COUNT(*) FROM asset_acquisitions").fetchone()[0]),
            "depreciation_snapshots": int(db.execute("SELECT COUNT(*) FROM asset_depreciation_snapshots").fetchone()[0]),
            "foreign_key_violations": len(db.execute("PRAGMA foreign_key_check").fetchall()),
        }
    # checkpoint WAL so the delivered database is a single portable file.
    with sqlite3.connect(db_path) as final_db:
        final_db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        final_db.execute("VACUUM")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
