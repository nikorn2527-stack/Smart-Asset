"""In-app Smart Asset AI Assistant: local NLU search, synonyms, reports, supply, PM/audit, repair prefill, and UI automation."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
import sqlite3
from urllib.parse import urlencode

import reports
from access_control import document_scope_sql, scope_sql
from asset_api import _fiscal_year_expression, expand_search_terms
from governance import GovernanceError
from qr_smart import ticket_scope_sql

TH_TZ = timezone(timedelta(hours=7))

STATUS_KEYWORDS = (
    ("ยังไม่จำหน่าย", "active_only"),
    ("ไม่รวมจำหน่าย", "active_only"),
    ("พร้อมใช้", "พร้อมใช้"),
    ("รอตรวจสอบ", "รอตรวจสอบ"),
    ("สำรวจแล้ว", "สำรวจแล้ว"),
    ("รออนุมัติ", "รออนุมัติ"),
    ("ทะเบียนแล้ว", "ทะเบียนแล้ว"),
    ("ไม่อนุมัติ", "ไม่อนุมัติ"),
    ("จำหน่ายแล้ว", "จำหน่ายแล้ว"),
)

TICKET_STATUS_KEYWORDS = (
    "รออนุมัติค่าใช้จ่ายจริง",
    "รอแก้ไขค่าใช้จ่าย",
    "รอผู้แจ้งยืนยัน",
    "รับแจ้งใหม่",
    "รออนุมัติ",
    "รอมอบหมาย",
    "กำลังซ่อม",
    "รออะไหล่",
    "ปิดงาน",
    "ไม่อนุมัติ",
    "ยกเลิก",
)

VIEW_KEYWORDS = (
    ("ผู้ใช้งานและสิทธิ์", "settings", "ตั้งค่าระบบ · ผู้ใช้งานและสิทธิ์", {"settingsTab": "access"}),
    ("ผู้ใช้งาน", "settings", "ตั้งค่าระบบ · ผู้ใช้งานและสิทธิ์", {"settingsTab": "access"}),
    ("กำหนดสิทธิ์", "settings", "ตั้งค่าระบบ · ผู้ใช้งานและสิทธิ์", {"settingsTab": "access"}),
    ("สิทธิ์ผู้ใช้", "settings", "ตั้งค่าระบบ · ผู้ใช้งานและสิทธิ์", {"settingsTab": "access"}),
    ("line oa", "settings", "ตั้งค่าระบบ · เชื่อมต่อ LINE OA", {"settingsTab": "line"}),
    ("เชื่อมต่อ line", "settings", "ตั้งค่าระบบ · เชื่อมต่อ LINE OA", {"settingsTab": "line"}),
    ("หน่วยงานและแบรนด์", "settings", "ตั้งค่าระบบ · ข้อมูลหน่วยงานและแบรนด์", {"settingsTab": "branding"}),
    ("ข้อมูลหน่วยงาน", "settings", "ตั้งค่าระบบ · ข้อมูลหน่วยงานและแบรนด์", {"settingsTab": "branding"}),
    ("โลโก้", "settings", "ตั้งค่าระบบ · ข้อมูลหน่วยงานและแบรนด์", {"settingsTab": "branding"}),
    ("แบรนด์", "settings", "ตั้งค่าระบบ · ข้อมูลหน่วยงานและแบรนด์", {"settingsTab": "branding"}),
    ("เกณฑ์และแจ้งเตือน", "settings", "ตั้งค่าระบบ · เกณฑ์และแจ้งเตือน", {"settingsTab": "workflow"}),
    ("วงเงินอนุมัติ", "settings", "ตั้งค่าระบบ · เกณฑ์และแจ้งเตือน", {"settingsTab": "workflow"}),
    ("เทมเพลตฉลาก", "stickers", "ตั้งค่าเทมเพลตฉลาก / สติกเกอร์", {}),
    ("ตั้งค่าฉลาก", "stickers", "ตั้งค่าเทมเพลตฉลาก / สติกเกอร์", {}),
    ("พิมพ์ฉลาก", "stickers", "ตั้งค่าเทมเพลตฉลาก / สติกเกอร์", {}),
    ("สติกเกอร์", "stickers", "ตั้งค่าเทมเพลตฉลาก / สติกเกอร์", {}),
    ("ฉลาก", "stickers", "ตั้งค่าเทมเพลตฉลาก / สติกเกอร์", {}),
    ("location qr", "qr-smart", "QR Smart / จุดบริการ", {}),
    ("qr smart", "qr-smart", "QR Smart / จุดบริการ", {}),
    ("จุดบริการ", "qr-smart", "QR Smart / จุดบริการ", {}),
    ("ทะเบียนคุม", "register", "เอกสารทะเบียนคุมทรัพย์สิน", {}),
    ("working sheet", "survey", "สำรวจและออกเลข", {}),
    ("สำรวจและออกเลข", "survey", "สำรวจและออกเลข", {}),
    ("สำรวจ", "survey", "สำรวจและออกเลข", {}),
    ("จัดการเลขครุภัณฑ์", "numbering", "จัดการเลขครุภัณฑ์", {}),
    ("เลขครุภัณฑ์", "numbering", "จัดการเลขครุภัณฑ์", {}),
    ("หมวดและเอกสารอ้างอิง", "codes", "หมวดและเอกสารอ้างอิง", {}),
    ("รหัส fsn", "codes", "หมวดและเอกสารอ้างอิง", {}),
    ("fsn", "codes", "หมวดและเอกสารอ้างอิง", {}),
    ("ภาพรวม", "dashboard", "ภาพรวมระบบ", {}),
    ("แดชบอร์ด", "dashboard", "ภาพรวมระบบ", {}),
    ("dashboard", "dashboard", "ภาพรวมระบบ", {}),
    ("รับเข้า", "supply", "1. รับเข้าและตรวจรับ", {}),
    ("ตรวจรับ", "supply", "1. รับเข้าและตรวจรับ", {}),
    ("ทะเบียน", "assets", "2. ทะเบียนครุภัณฑ์", {}),
    ("ครุภัณฑ์", "assets", "2. ทะเบียนครุภัณฑ์", {}),
    ("ตรวจนับ", "work", "3. ตรวจนับและ PM", {}),
    ("pm", "work", "3. ตรวจนับและ PM", {}),
    ("บำรุงรักษา", "work", "3. ตรวจนับและ PM", {}),
    ("แจ้งซ่อม", "repairs", "4. แจ้งซ่อมและบริการ", {}),
    ("งานซ่อม", "repairs", "4. แจ้งซ่อมและบริการ", {}),
    ("อนุมัติใบเบิก", "approvals", "ศูนย์รออนุมัติ · ใบเบิก/จัดสรร", {"approvalTab": "supply"}),
    ("อนุมัติครุภัณฑ์", "approvals", "ศูนย์รออนุมัติ · ครุภัณฑ์ใหม่", {"approvalTab": "assets"}),
    ("ศูนย์รออนุมัติ", "approvals", "ศูนย์รออนุมัติ", {}),
    ("อนุมัติ", "approvals", "ศูนย์รออนุมัติ", {}),
    ("รายงาน", "reports", "รายงานและส่งออก", {}),
    ("ส่งออก", "reports", "รายงานและส่งออก", {}),
    ("ค่าเสื่อม", "depreciation", "ค่าเสื่อมราคา", {}),
    ("ตั้งค่า", "settings", "ตั้งค่าระบบ", {}),
)

CATEGORY_ALIASES = (
    ("งานบ้านงานครัว", "ครุภัณฑ์งานบ้านงานครัว"),
    ("ครัว", "ครุภัณฑ์งานบ้านงานครัว"),
    ("งานบ้าน", "ครุภัณฑ์งานบ้านงานครัว"),
    ("ดนตรี", "ครุภัณฑ์ดนตรีนาฏศิลป์"),
    ("เครื่องกำเนิดไฟฟ้า", "ครุภัณฑ์ไฟฟ้าและวิทยุ (เครื่องกำเนิดไฟฟ้า)"),
    ("ไฟฟ้า", "ครุภัณฑ์ไฟฟ้าและวิทยุ"),
    ("วิทยุ", "ครุภัณฑ์ไฟฟ้าและวิทยุ"),
    ("ยานพาหนะ", "ครุภัณฑ์ยานพาหนะและขนส่ง"),
    ("รถ", "ครุภัณฑ์ยานพาหนะและขนส่ง"),
    ("โรงงาน", "ครุภัณฑ์โรงงาน"),
    ("วิทยาศาสตร์", "ครุภัณฑ์วิทยาศาสตร์และการแพทย์"),
    ("การแพทย์", "ครุภัณฑ์วิทยาศาสตร์และการแพทย์"),
    ("แพทย์", "ครุภัณฑ์วิทยาศาสตร์และการแพทย์"),
    ("ลิฟต์", "ครุภัณฑ์สำนักงาน (ลิฟต์)"),
    ("สำนักงาน", "ครุภัณฑ์สำนักงาน"),
    ("ซอฟต์แวร์", "สินทรัพย์ software"),
    ("software", "สินทรัพย์ software"),
    ("ก่อสร้าง", "ครุภัณฑ์ก่อสร้าง"),
    ("การศึกษา", "ครุภัณฑ์การศึกษา"),
    ("กีฬา", "ครุภัณฑ์กีฬาและกายภาพ"),
    ("คอมพิวเตอร์", "ครุภัณฑ์คอมพิวเตอร์"),
    ("คอม", "ครุภัณฑ์คอมพิวเตอร์"),
    ("โฆษณา", "ครุภัณฑ์โฆษณาและเผยแพร่"),
    ("โสต", "ครุภัณฑ์โฆษณาและเผยแพร่"),
)

SYMPTOM_WORDS = (
    "ไม่เย็น",
    "ไม่ทำงาน",
    "เปิดไม่ติด",
    "เสีย",
    "พัง",
    "น้ำหยด",
    "รั่ว",
    "ซึม",
    "ดับ",
    "ช็อต",
    "ค้าง",
    "แตก",
    "ร้าว",
    "หลุด",
    "ขัดข้อง",
    "พิมพ์ไม่ออก",
    "กระดาษติด",
    "จอฟ้า",
    "จอดำ",
    "ไม่มีภาพ",
    "ไม่มีเสียง",
    "เสียงดัง",
    "สั่น",
    "ร้อน",
    "เหม็นไหม้",
    "ไฟไม่เข้า",
)


def _like_pattern(term: str) -> str:
    escaped = term.replace("!", "!!").replace("%", "!%").replace("_", "!_")
    return f"%{escaped}%"


def _fmt_money(amount) -> str:
    try:
        val = float(amount or 0)
    except (TypeError, ValueError):
        val = 0.0
    return f"{val:,.2f} บาท"


def _parse_opt_id(value) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    raw = str(value).strip()
    if re.fullmatch(r"[0-9]+", raw):
        num = int(raw)
        return num if num > 0 else None
    return None


def _optional_scope_clause(alias: str = "a", account_id=None, branch_id=None) -> tuple[list[str], list]:
    clauses: list[str] = []
    params: list = []
    aid = _parse_opt_id(account_id)
    if aid is not None:
        clauses.append(f"{alias}.numbering_account_id = ?")
        params.append(aid)
    raw_branch = "" if branch_id is None else str(branch_id).strip()
    if raw_branch == "__unassigned__":
        clauses.append(f"COALESCE({alias}.branch_id, 0) = 0")
    else:
        bid = _parse_opt_id(branch_id)
        if bid is not None:
            clauses.append(f"{alias}.branch_id = ?")
            params.append(bid)
    return clauses, params


def _extract_status(prompt: str) -> tuple[str, str]:
    cleaned = prompt
    for phrase, code in STATUS_KEYWORDS:
        if phrase in cleaned:
            cleaned = cleaned.replace(phrase, " ", 1)
            return code, cleaned
    return "all", cleaned


def _extract_ticket_status(prompt: str) -> tuple[str, str]:
    cleaned = prompt
    for st in TICKET_STATUS_KEYWORDS:
        if st in cleaned:
            cleaned = cleaned.replace(st, " ", 1)
            return st, cleaned
    return "", cleaned


def _extract_category(db: sqlite3.Connection, prompt: str, account_id=None) -> tuple[str | None, str | None, str]:
    aid = _parse_opt_id(account_id)
    rows = db.execute(
        """
        SELECT c.id,
               COALESCE(NULLIF(TRIM(l.name), ''), c.category_name) AS label,
               c.category_name
        FROM asset_categories c
        LEFT JOIN account_category_labels l ON l.category_id = c.id AND l.account_id = ?
        WHERE c.is_active = 1
        ORDER BY LENGTH(label) DESC, c.id ASC
        """,
        (aid,),
    ).fetchall()

    for r in rows:
        for candidate in (r["label"], r["category_name"]):
            if candidate and candidate in prompt:
                return str(r["id"]), r["label"] or r["category_name"], prompt.replace(candidate, " ", 1)

    m = re.search(r"(?:หมวดหมู่|หมวด|กลุ่ม)\s*([^\s,]+)", prompt)
    if m:
        phrase_full = m.group(0)
        token = m.group(1)
        token_low = token.casefold()
        for alias, target_cat_name in CATEGORY_ALIASES:
            if alias in token_low:
                for r in rows:
                    if target_cat_name == r["category_name"] or target_cat_name in (r["label"] or ""):
                        return str(r["id"]), r["label"] or r["category_name"], prompt.replace(phrase_full, " ", 1)
        for r in rows:
            if token_low in (r["category_name"] or "").casefold() or token_low in (r["label"] or "").casefold():
                return str(r["id"]), r["label"] or r["category_name"], prompt.replace(phrase_full, " ", 1)

    return None, None, prompt


def _extract_fiscal_year(prompt: str) -> tuple[str | None, str]:
    patterns = (
        r"(?:ปีงบประมาณ|ปีงบ|ประจำปี|พ\.ศ\.)\s*(25\d{2}|20\d{2}|\d{2})(?=\D|$)",
        r"(?:^|\s)ปี\s*(25\d{2})(?=\D|$)",
    )
    for pat in patterns:
        m = re.search(pat, prompt)
        if m:
            raw = m.group(1)
            val = int(raw)
            if 50 <= val <= 99:
                fy = str(2500 + val)
            elif 2000 <= val <= 2099:
                fy = str(val + 543)
            else:
                fy = raw
            return fy, (prompt[:m.start()] + " " + prompt[m.end():]).strip()
    return None, prompt


def _norm_space(s: str) -> str:
    return re.sub(r"\s+", "", (s or "").strip()).casefold()


def _extract_location(
    db: sqlite3.Connection, prompt: str, account_id=None, branch_id=None
) -> tuple[dict[str, str], str]:
    clauses = [scope_sql(db, "a")]
    ext_clauses, ext_params = _optional_scope_clause("a", account_id, branch_id)
    where = " AND ".join(clauses + ext_clauses)

    found: dict[str, str] = {}
    remaining = prompt

    def _match_from_list(candidates: list[str], prefix_pat: str) -> str | None:
        nonlocal remaining
        m = re.search(prefix_pat, remaining)
        if m:
            tok = m.group(1).strip()
            tok_norm = _norm_space(tok)
            pref_norm = _norm_space(m.group(0))
            for cand in candidates:
                cn = _norm_space(cand)
                if cn == pref_norm or cn == tok_norm or (len(tok_norm) >= 2 and cn.endswith(tok_norm)):
                    remaining = (remaining[:m.start()] + " " + remaining[m.end():]).strip()
                    return cand
        rem_norm = _norm_space(remaining)
        for cand in candidates:
            if len(cand.strip()) < 3:
                continue
            if cand in remaining:
                remaining = remaining.replace(cand, " ", 1).strip()
                return cand
            # Match e.g. "อาคาร1" against "อาคาร 1" cleanly when literal prefix matches
            spaced = re.sub(r"\s+", r"\\s*", re.escape(cand.strip()))
            ms = re.search(spaced, remaining, flags=re.IGNORECASE)
            if ms and len(cand.strip()) >= 4 and _norm_space(cand) in rem_norm:
                remaining = (remaining[:ms.start()] + " " + remaining[ms.end():]).strip()
                return cand
        return None

    buildings = [
        r[0]
        for r in db.execute(
            f"SELECT DISTINCT TRIM(a.building) AS b FROM assets a WHERE {where} AND TRIM(COALESCE(a.building,'')) != '' ORDER BY LENGTH(b) DESC LIMIT 120",
            ext_params,
        ).fetchall()
    ]
    b_match = _match_from_list(buildings, r"(?:อาคาร|ตึก)\s*([^\s,]+)")
    if b_match:
        found["building"] = b_match

    floors = [
        r[0]
        for r in db.execute(
            f"SELECT DISTINCT TRIM(a.floor) AS f FROM assets a WHERE {where} AND TRIM(COALESCE(a.floor,'')) != '' ORDER BY LENGTH(f) DESC LIMIT 60",
            ext_params,
        ).fetchall()
    ]
    f_match = _match_from_list(floors, r"ชั้น\s*([^\s,]+)")
    if f_match:
        found["floor"] = f_match

    rooms = [
        r[0]
        for r in db.execute(
            f"SELECT DISTINCT TRIM(COALESCE(NULLIF(a.room,''), NULLIF(a.sub_unit,''))) AS rm FROM assets a WHERE {where} AND TRIM(COALESCE(NULLIF(a.room,''), NULLIF(a.sub_unit,''))) != '' ORDER BY LENGTH(rm) DESC LIMIT 200",
            ext_params,
        ).fetchall()
    ]
    r_match = _match_from_list(rooms, r"ห้อง\s*([^\s,]+)")
    if r_match:
        found["room"] = r_match

    return found, remaining


def _extract_keyword(prompt: str) -> str:
    text = re.sub(r"^\s*(?:มี|หาของ)\s*", "", prompt.strip())
    noise = (
        r"(?:ช่วย|กรุณา|รบกวน|"
        r"(?:^|\s)ขอ(?![งบดยม])|"
        r"อยากได้|อยากดู|"
        r"(?:^|\s)เปิดดู|(?:^|\s)เปิดหน้า|(?:^|\s)เปิด|"
        r"(?:^|\s)ดู(?=(?:\s|$|รายการ|ข้อมูล|หน้า|ให้|ซิ|หน่อย))|"
        r"(?:^|\s)(?:ค้นหา|ค้น|หา(?![รบงยด]))|"
        r"กรองข้อมูล|กรอง|แสดงผล|แสดง|"
        r"ไปที่หน้า|ไปที่|ไปหน้า|"
        r"สรุปยอด|สรุป|ยอดรวม|ทั้งหมด|จำนวน|"
        r"กี่รายการ|กี่ชิ้น|กี่เครื่อง|กี่อัน|กี่ตัว|กี่ชุด|กี่บาท|กี่ใบ|กี่งาน|"
        r"เท่าไหร่|เท่าไร|อะไรบ้าง|บ้าง|มูลค่า|รายการ|ข้อมูล|ครุภัณฑ์|สถานะ|"
        r"รายงาน|ส่งออก|export|csv|excel|xlsx|"
        r"ให้หน่อย|ให้ที|หน่อยครับ|หน่อยค่ะ|หน่อย|ครับ|ค่ะ|เลย|เอาเฉพาะ|เฉพาะ|ในระบบ)"
    )
    text = re.sub(noise, " ", text, flags=re.IGNORECASE)
    text = re.sub(r"^(?:ที่|ใน|ของ|หมวดหมู่|หมวด|ห้อง|อาคาร|ตึก|ชั้น)\s+", "", text.strip())
    text = re.sub(r"\s+", " ", text).strip(" :-,.?!")
    return text


def _extract_repair_keyword(prompt: str) -> str:
    cleaned = re.sub(
        r"(?:ใบงานซ่อม|ใบแจ้งซ่อม|งานซ่อม|แจ้งซ่อม|ค้างซ่อม|ค้างดำเนินการ|ค้างอยู่|ticket|กี่งาน|มีอะไรบ้าง|อะไรบ้าง)",
        " ",
        prompt,
        flags=re.IGNORECASE,
    )
    return _extract_keyword(cleaned)


def _extract_date_range(prompt: str) -> tuple[str, str, str]:
    now = datetime.now(TH_TZ).date()
    if "วันนี้" in prompt:
        day = now.isoformat()
        return day, day, prompt.replace("วันนี้", " ", 1)
    if "เดือนนี้" in prompt:
        start = now.replace(day=1).isoformat()
        return start, now.isoformat(), prompt.replace("เดือนนี้", " ", 1)
    if "เดือนที่แล้ว" in prompt or "เดือนก่อน" in prompt:
        first_this = now.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        first_prev = last_prev.replace(day=1)
        cleaned = prompt.replace("เดือนที่แล้ว", " ", 1).replace("เดือนก่อน", " ", 1)
        return first_prev.isoformat(), last_prev.isoformat(), cleaned
    if "7 วัน" in prompt or "สัปดาห์นี้" in prompt:
        start = (now - timedelta(days=7)).isoformat()
        cleaned = prompt.replace("7 วัน", " ", 1).replace("สัปดาห์นี้", " ", 1)
        return start, now.isoformat(), cleaned
    if "ปีนี้" in prompt:
        start = now.replace(month=1, day=1).isoformat()
        return start, now.isoformat(), prompt.replace("ปีนี้", " ", 1)
    return "", "", prompt


def _asset_where(
    db: sqlite3.Connection,
    q: str,
    status: str,
    category_id: str | None = None,
    building: str | None = None,
    floor: str | None = None,
    room: str | None = None,
    fiscal_year: str | None = None,
    account_id=None,
    branch_id=None,
) -> tuple[str, list]:
    clauses = [scope_sql(db, "a")]
    params: list = []

    ext_clauses, ext_params = _optional_scope_clause("a", account_id, branch_id)
    clauses.extend(ext_clauses)
    params.extend(ext_params)

    if status == "active_only":
        clauses.append("COALESCE(a.status,'') != 'จำหน่ายแล้ว'")
    elif status and status != "all":
        clauses.append("a.status = ?")
        params.append(status)

    if category_id and re.fullmatch(r"[0-9]+", str(category_id).strip()):
        clauses.append("a.category_id = ?")
        params.append(int(str(category_id).strip()))
    if building:
        clauses.append("a.building = ?")
        params.append(building)
    if floor:
        clauses.append("a.floor = ?")
        params.append(floor)
    if room == "__unassigned__":
        clauses.append("(TRIM(COALESCE(a.room,'')) = '' AND TRIM(COALESCE(a.sub_unit,'')) = '')")
    elif room:
        clauses.append("(a.room = ? OR a.sub_unit = ?)")
        params.extend([room, room])
    if fiscal_year:
        clauses.append(f"{_fiscal_year_expression()} = ?")
        params.append(fiscal_year)

    if q:
        terms, _ = expand_search_terms(q)
        term_blocks = []
        for term in terms or [q]:
            like = _like_pattern(term)
            term_blocks.append(
                "("
                "COALESCE(a.code,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(a.fsn_code,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(a.old_asset_code,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(a.name,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(a.group_name,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(a.location,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(a.building,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(a.floor,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(a.room,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(a.sub_unit,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(a.model,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(a.serial_number,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(a.detail,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(a.notes,'') LIKE ? ESCAPE '!'"
                ")"
            )
            params.extend([like] * 14)
        clauses.append("(" + " OR ".join(term_blocks) + ")")

    return " AND ".join(clauses), params


def _can_export(db) -> bool:
    ctx = getattr(db, "access", None)
    if not ctx:
        return True
    return bool(ctx.get("isAdmin") or ctx.get("permissions", {}).get("export"))


def _handle_help() -> dict:
    return {
        "reply": (
            "ผมเป็นผู้ช่วยอัจฉริยะ Smart Asset สามารถค้นหา สรุปยอด เปิดหน้า และกรอกข้อมูลล่วงหน้าให้คุณได้ครับ เช่น:\n"
            "• ค้นหา & กรอง: **\"หาแอร์\"**, **\"หาคอมพิวเตอร์ ชั้น 2 สถานะ พร้อมใช้\"**, **\"ครุภัณฑ์ที่ยังไม่ระบุห้อง\"**\n"
            "• เปิดรายงานพร้อมตั้งตัวกรอง: **\"เปิดรายงานงานซ่อม กำลังซ่อม เดือนนี้\"**\n"
            "• ช่วยกรอกแจ้งซ่อม: **\"แจ้งซ่อม แอร์ อาการ ไม่เย็น ด่วน\"**\n"
            "• ลงทะเบียน/รับเข้า/PM: **\"เพิ่มครุภัณฑ์ เครื่องพิมพ์\"**, **\"งานตรวจนับและ PM\"**, **\"เปิดหน้าตั้งค่า ผู้ใช้งาน\"**"
        ),
        "stats": [],
        "items": [],
        "uiAction": None,
    }


def _handle_depreciation(db: sqlite3.Connection, auto_apply: bool = False, account_id=None, branch_id=None) -> dict:
    ext_clauses, ext_params = _optional_scope_clause("a", account_id, branch_id)
    where = " AND ".join([scope_sql(db, "a")] + ext_clauses)
    row = db.execute(
        f"""
        SELECT
          COUNT(*) AS cnt,
          COALESCE(SUM(COALESCE(a.purchase_price,0)),0) AS cost,
          COALESCE(SUM(COALESCE(a.accumulated_depreciation,0)),0) AS accum,
          COALESCE(SUM(COALESCE(a.net_book_value,0)),0) AS nbv
        FROM assets a
        WHERE {where} AND COALESCE(a.status,'') != 'จำหน่ายแล้ว'
        """,
        ext_params,
    ).fetchone()
    return {
        "reply": (
            f"สรุปค่าเสื่อมราคาครุภัณฑ์ที่ยังไม่จำหน่าย (**{int(row['cnt'] or 0):,} รายการ**):\n"
            f"• ราคาทุนรวม: **{_fmt_money(row['cost'])}**\n"
            f"• ค่าเสื่อมสะสม: **{_fmt_money(row['accum'])}**\n"
            f"• มูลค่าสุทธิตามบัญชี (NBV): **{_fmt_money(row['nbv'])}**"
        ),
        "stats": [
            {"label": "ราคาทุนรวม", "value": _fmt_money(row["cost"])},
            {"label": "มูลค่าสุทธิ (NBV)", "value": _fmt_money(row["nbv"])},
        ],
        "items": [],
        "uiAction": {
            "type": "switch_view",
            "view": "depreciation",
            "autoApply": auto_apply,
            "label": "เปิดหน้าค่าเสื่อมราคา",
        },
    }


def _handle_report(db: sqlite3.Connection, prompt: str, auto_apply: bool, account_id=None, branch_id=None) -> dict:
    if "ค่าเสื่อม" in prompt:
        return _handle_depreciation(
            db,
            auto_apply=auto_apply and ("เปิด" in prompt or "ไปที่" in prompt or "ไปหน้า" in prompt),
            account_id=account_id,
            branch_id=branch_id,
        )

    if any(w in prompt for w in ("ที่ตั้ง", "สถานที่", "ห้อง", "อาคาร")):
        report_id = "by-location"
    elif any(w in prompt for w in ("อะไหล่", "ช่างนอก", "วัสดุซ่อม")):
        report_id = "repair-items"
    elif "สรุป" in prompt and "ซ่อม" in prompt:
        report_id = "repair-summary"
    elif "ซ่อม" in prompt:
        report_id = "repairs"
    elif any(w in prompt for w in ("ยืม", "เบิก", "ค้างคืน")):
        report_id = "loans"
    elif any(w in prompt for w in ("เคลื่อนไหว", "ย้าย")):
        report_id = "movements"
    else:
        report_id = "assets"

    allowed = set(reports.REPORTS.get(report_id, {}).get("filters", []))
    filters: dict[str, str] = {}
    cleaned = prompt
    if "from" in allowed or "to" in allowed:
        dt_from, dt_to, cleaned = _extract_date_range(cleaned)
        if dt_from and "from" in allowed:
            filters["from"] = dt_from
        if dt_to and "to" in allowed:
            filters["to"] = dt_to

    if "status" in allowed:
        if report_id == "repairs":
            st, cleaned = _extract_ticket_status(cleaned)
            if st:
                filters["status"] = st
        else:
            st, cleaned = _extract_status(cleaned)
            if st and st not in ("all", "active_only"):
                filters["status"] = st

    if "group" in allowed:
        _cid, cat_name, cleaned = _extract_category(db, cleaned, account_id=account_id)
        if cat_name:
            filters["group"] = cat_name

    if "kind" in allowed:
        for th_word, move_code in (("รับเข้า", "intake"), ("มอบ", "assign"), ("ยืม", "loan"), ("เบิก", "issue"), ("คืน", "return"), ("ย้าย", "relocate")):
            if th_word in cleaned:
                filters["kind"] = move_code
                break

    if "itemKind" in allowed:
        for th_word, kind_code in (("อะไหล่", "part"), ("วัสดุ", "material"), ("ช่างนอก", "external_service")):
            if th_word in cleaned:
                filters["itemKind"] = kind_code
                break

    aid = _parse_opt_id(account_id)
    run_q = {**filters}
    if aid is not None:
        run_q["accountId"] = str(aid)

    data = reports.run_report(db, report_id, run_q, limit=1)
    title = data["title"]
    total = int(data.get("total", 0))
    summary = data.get("summary")
    stats = [{"label": "รายการในรายงาน", "value": f"{total:,}"}]
    if isinstance(summary, dict):
        for k, v in list(summary.items())[:2]:
            stats.append({"label": str(k), "value": f"{v:,}" if isinstance(v, int) else (_fmt_money(v) if isinstance(v, float) else str(v))})
    summary_line = f"\n{summary}" if isinstance(summary, str) and summary.strip() else ""

    downloads = []
    if _can_export(db):
        qs = f"?{urlencode(run_q)}" if run_q else ""
        downloads = [
            {"label": f"ดาวน์โหลด CSV ({title})", "url": f"/api/reports/{report_id}/export.csv{qs}"},
            {"label": f"ดาวน์โหลด Excel ({title})", "url": f"/api/reports/{report_id}/export.xlsx{qs}"},
        ]
        note = "กดดาวน์โหลดไฟล์ CSV / Excel ด้านล่าง หรือเปิดดูในหน้ารายงานที่ตั้งตัวกรองไว้ให้แล้วได้ทันทีครับ"
    else:
        note = "(บัญชีของคุณยังไม่มีสิทธิ์ส่งออกไฟล์ จึงแสดงเฉพาะยอดสรุป)"

    return {
        "reply": f"รายงาน **{title}**: พบทั้งหมด **{total:,} รายการ**{summary_line}\n{note}",
        "stats": stats,
        "items": [],
        "downloads": downloads,
        "uiAction": {
            "type": "open_report",
            "view": "reports",
            "reportId": report_id,
            "filters": filters,
            "accountId": aid,
            "autoApply": auto_apply and ("เปิด" in prompt or "ไปที่" in prompt or "ไปหน้า" in prompt or bool(re.match(r"^\s*(?:ดู|แสดง)", prompt))),
            "label": f"เปิดรายงาน {title}" + (" (ตั้งตัวกรองไว้ให้แล้ว)" if filters else ""),
        },
    }


def _handle_supply(db: sqlite3.Connection, prompt: str, auto_apply: bool, account_id=None) -> dict:
    ctx = getattr(db, "access", None)
    if ctx and ctx.get("accountId") is None and not (ctx.get("canViewAll") or ctx.get("isAdmin")):
        where = "1=0"
        params: list = []
    else:
        where = document_scope_sql(db, "s")
        params = []
        aid = _parse_opt_id(account_id)
        if aid is not None:
            where += " AND s.account_id = ?"
            params.append(aid)

    doc_kind = ""
    if any(w in prompt for w in ("รับเข้า", "ตรวจรับ", "ใบรับ")):
        doc_kind = "receipt"
    elif any(w in prompt for w in ("เบิก", "จัดสรร", "ใบเบิก")):
        doc_kind = "issue"
    elif "ส่งคืน" in prompt or "ใบคืน" in prompt:
        doc_kind = "return"

    create_kind = ""
    if any(w in prompt for w in ("สร้างใบ", "ทำใบ", "เพิ่มใบ", "เปิดฟอร์มรับเข้า", "เปิดฟอร์มเบิก")):
        create_kind = doc_kind or ("issue" if "เบิก" in prompt else "receipt")

    kind_filter = " AND s.kind = ?" if doc_kind else ""
    q_params = [*params, doc_kind] if doc_kind else params

    counts = db.execute(
        f"SELECT COALESCE(NULLIF(TRIM(s.status),''),'draft') AS st, COUNT(*) AS cnt FROM supply_documents s WHERE {where}{kind_filter} GROUP BY st ORDER BY cnt DESC",
        q_params,
    ).fetchall()
    rows = db.execute(
        f"SELECT s.id, s.kind, s.number, s.status, s.created_at FROM supply_documents s WHERE {where}{kind_filter} ORDER BY s.id DESC LIMIT 6",
        q_params,
    ).fetchall()
    total = sum(int(r["cnt"]) for r in counts)
    breakdown = " · ".join(f"{r['st']} {int(r['cnt']):,}" for r in counts) or "ยังไม่มีเอกสารรับเข้า/เบิก"
    kind_th = {"receipt": "รับเข้า", "issue": "เบิก/จัดสรร", "return": "ส่งคืน"}
    kind_label = f" ({kind_th.get(doc_kind, '')})" if doc_kind else ""
    reply = f"เอกสารรับเข้าและเบิกจัดสรร{kind_label}: ทั้งหมด **{total:,} ฉบับ**\n{breakdown}"
    if create_kind:
        reply += f"\nเปิดหน้าสำหรับสร้างเอกสาร**{kind_th.get(create_kind, '')}** รอไว้ให้แล้วครับ"

    return {
        "reply": reply,
        "stats": [{"label": "เอกสารทั้งหมด", "value": f"{total:,}"}],
        "items": [
            {
                "kind": "supply",
                "id": r["id"],
                "code": r["number"] or f"#{r['id']}",
                "title": kind_th.get(r["kind"], r["kind"] or "เอกสาร"),
                "meta": f"{r['status']} · {r['created_at']}",
            }
            for r in rows
        ],
        "uiAction": {
            "type": "open_supply",
            "view": "supply",
            "kind": doc_kind,
            "createKind": create_kind,
            "autoApply": auto_apply or bool(create_kind),
            "label": f"เปิดฟอร์มสร้างเอกสาร{kind_th.get(create_kind, '')}" if create_kind else "เปิดหน้ารับเข้าและตรวจรับ",
        },
    }


def _handle_work(db: sqlite3.Connection, prompt: str, auto_apply: bool, account_id=None, branch_id=None) -> dict:
    low = prompt.casefold()
    ext_clauses, ext_params = _optional_scope_clause("a", account_id, branch_id)
    where_clauses = [scope_sql(db, "a")] + ext_clauses

    work_kind = ""
    if any(w in low for w in ("pm", "บำรุงรักษา")):
        work_kind = "pm"
    elif "ตรวจนับ" in prompt:
        work_kind = "inventory"

    if work_kind:
        where_clauses.append("p.kind = ?")
        ext_params.append(work_kind)

    where = " AND ".join(where_clauses)
    row = db.execute(
        f"""
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN w.status != 'completed' AND w.due_on < date('now') THEN 1 ELSE 0 END) AS overdue,
          SUM(CASE WHEN w.status != 'completed' THEN 1 ELSE 0 END) AS open_cnt
        FROM scheduled_work w
        LEFT JOIN work_plans p ON p.id = w.plan_id
        JOIN assets a ON a.id = w.asset_id
        WHERE {where}
        """,
        ext_params,
    ).fetchone()
    extra_open = " AND w.due_on < date('now')" if "เกินกำหนด" in prompt else ""
    rows = db.execute(
        f"""
        SELECT w.id, w.due_on, w.status, w.assignee, a.code, a.name
        FROM scheduled_work w
        LEFT JOIN work_plans p ON p.id = w.plan_id
        JOIN assets a ON a.id = w.asset_id
        WHERE {where} AND w.status != 'completed'{extra_open}
        ORDER BY w.due_on ASC, w.id DESC
        LIMIT 6
        """,
        ext_params,
    ).fetchall()

    total = int(row["total"] or 0)
    open_cnt = int(row["open_cnt"] or 0)
    overdue = int(row["overdue"] or 0)
    create_plan = bool(any(w in prompt for w in ("สร้างแผน", "เพิ่มแผน")))
    kind_label = " · แผน PM" if work_kind == "pm" else (" · ตรวจนับ" if work_kind == "inventory" else "")

    return {
        "reply": f"งานตรวจนับและ PM{kind_label}: ทั้งหมด **{total:,} รายการ** (ค้างดำเนินการ **{open_cnt:,}** · เกินกำหนด **{overdue:,}**)",
        "stats": [
            {"label": "ค้างดำเนินการ", "value": f"{open_cnt:,}"},
            {"label": "เกินกำหนด", "value": f"{overdue:,}"},
        ],
        "items": [
            {
                "kind": "work",
                "id": r["id"],
                "code": r["code"] or f"งาน #{r['id']}",
                "title": r["name"] or "ตรวจนับ / PM",
                "meta": f"กำหนด {r['due_on'] or '-'} · {r['status']} · {r['assignee'] or 'ยังไม่ระบุผู้รับผิดชอบ'}",
            }
            for r in rows
        ],
        "uiAction": {
            "type": "open_work",
            "view": "work",
            "kind": work_kind,
            "openNewPlan": create_plan,
            "autoApply": auto_apply or create_plan,
            "label": "เปิดฟอร์มสร้างแผนตรวจนับ / PM" if create_plan else "เปิดหน้าตรวจนับและ PM",
        },
    }


def _handle_summary(
    db: sqlite3.Connection,
    raw_q: str,
    display_q: str,
    status: str,
    cat_id: str | None,
    cat_name: str | None,
    loc_filters: dict[str, str],
    fiscal_year: str | None,
    auto_apply: bool,
    account_id=None,
    branch_id=None,
) -> dict:
    where, params = _asset_where(
        db,
        raw_q,
        status,
        category_id=cat_id,
        building=loc_filters.get("building"),
        floor=loc_filters.get("floor"),
        room=loc_filters.get("room"),
        fiscal_year=fiscal_year,
        account_id=account_id,
        branch_id=branch_id,
    )
    all_statuses = db.execute(
        f"SELECT COALESCE(NULLIF(TRIM(a.status),''),'ไม่ระบุ') AS s, COUNT(*) AS cnt, COALESCE(SUM(COALESCE(a.purchase_price,0)),0) AS cost FROM assets a WHERE {where} GROUP BY s ORDER BY cnt DESC",
        params,
    ).fetchall()
    total = sum(int(r["cnt"] or 0) for r in all_statuses)
    total_cost = sum(float(r["cost"] or 0) for r in all_statuses)
    by_status = all_statuses[:6]
    by_group = db.execute(
        f"SELECT COALESCE(NULLIF(TRIM(a.group_name),''),'ไม่ระบุหมวด') AS g, COUNT(*) AS cnt FROM assets a WHERE {where} GROUP BY g ORDER BY cnt DESC LIMIT 5",
        params,
    ).fetchall()

    scope_note = []
    if display_q:
        scope_note.append(f'คำค้น "{display_q}"')
    if cat_name:
        scope_note.append(f"หมวด {cat_name}")
    for key in ("building", "floor", "room"):
        if loc_filters.get(key):
            scope_note.append(loc_filters[key])
    if fiscal_year:
        scope_note.append(f"ปีงบ {fiscal_year}")
    if status and status != "all":
        scope_note.append(f"สถานะ {status}")
    heading = "สรุปยอดครุภัณฑ์" + (f" ({', '.join(scope_note)})" if scope_note else "ในขอบเขตของคุณ")

    lines = [f"{heading}: **{total:,} รายการ** · มูลค่ารวม **{_fmt_money(total_cost)}**"]
    if by_status:
        lines.append("แยกตามสถานะ: " + " · ".join(f"{r['s']} {int(r['cnt']):,}" for r in by_status))
    if by_group:
        lines.append("หมวดหลัก: " + " · ".join(f"{r['g']} ({int(r['cnt']):,})" for r in by_group))

    has_filters = bool(display_q or status != "all" or cat_id or fiscal_year or loc_filters)
    if not has_filters:
        ext_clauses, ext_params = _optional_scope_clause("a", account_id, branch_id)
        t_where = ticket_scope_sql(db)
        t_params: list = []
        aid = _parse_opt_id(account_id)
        if aid is not None:
            t_where += " AND (a.numbering_account_id=? OR (t.asset_id IS NULL AND t.location_point_id IS NOT NULL AND EXISTS(SELECT 1 FROM service_locations s WHERE s.id=t.location_point_id AND s.account_id=?)))"
            t_params = [aid, aid]
        open_tickets = db.execute(
            f"SELECT COUNT(*) FROM tickets t LEFT JOIN assets a ON a.id=t.asset_id WHERE {t_where} AND t.status != 'ปิดงาน'",
            t_params,
        ).fetchone()[0]
        a_where = " AND ".join([scope_sql(db, "a")] + ext_clauses)
        loaned = db.execute(
            f"SELECT COUNT(*) FROM asset_custody_state c JOIN assets a ON a.id=c.asset_id WHERE {a_where} AND c.loan_status IN ('loaned','issued')",
            ext_params,
        ).fetchone()[0]
        lines.append(f"งานซ่อมค้าง: **{int(open_tickets):,} งาน** · กำลังยืม/เบิก: **{int(loaned):,} รายการ**")

    return {
        "reply": "\n".join(lines),
        "stats": [
            {"label": "จำนวนรายการ", "value": f"{total:,}"},
            {"label": "มูลค่ารวม", "value": _fmt_money(total_cost)},
        ],
        "items": [],
        "uiAction": {
            "type": "filter_assets",
            "view": "assets",
            "q": display_q,
            "status": status,
            "categoryId": cat_id or "",
            "building": loc_filters.get("building") or "",
            "floor": loc_filters.get("floor") or "",
            "room": loc_filters.get("room") or "",
            "fiscalYear": fiscal_year or "",
            "autoApply": auto_apply and has_filters,
            "label": "เปิดดูรายการที่กรองในทะเบียน",
        },
    }


def _handle_prefill_repair(db: sqlite3.Connection, prompt: str, account_id=None, branch_id=None) -> dict:
    urgency = "ปกติ"
    text = prompt
    for label, pat in (("เร่งด่วนมาก", r"เร่งด่วนมาก|ด่วนมาก|ด่วนที่สุด"), ("เร่งด่วน", r"เร่งด่วน|ด่วน")):
        m = re.search(pat, text)
        if m:
            urgency = label
            text = (text[:m.start()] + " " + text[m.end():]).strip()
            break

    text = re.sub(
        r"^\s*(?:ช่วย|กรุณา|รบกวน|ขอ|อยาก)?(?:เปิดแจ้งซ่อม|เปิดใบแจ้งซ่อม|สร้างใบแจ้งซ่อม|เปิด\s*ticket|แจ้งซ่อม)\s*",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()

    issue_text = ""
    asset_part = text
    m_issue = re.search(r"(?:อาการ|ปัญหา|พบว่า|สาเหตุ)\s*[:\-]?\s*(.+)$", text)
    if m_issue:
        asset_part = text[:m_issue.start()].strip()
        issue_text = m_issue.group(1).strip()
    else:
        for sym in SYMPTOM_WORDS:
            idx = text.find(sym)
            if idx != -1:
                asset_part = text[:idx].strip()
                issue_text = text[idx:].strip()
                break

    loc_filters, asset_clean = _extract_location(db, asset_part, account_id=account_id, branch_id=branch_id)
    asset_q = _extract_keyword(asset_clean) or asset_clean.strip()
    _terms, display_q = expand_search_terms(asset_q)

    rows = []
    if asset_q or loc_filters:
        where, params = _asset_where(
            db,
            asset_q,
            "active_only",
            building=loc_filters.get("building"),
            floor=loc_filters.get("floor"),
            room=loc_filters.get("room"),
            account_id=account_id,
            branch_id=branch_id,
        )
        rows = db.execute(
            f"SELECT a.id, a.code, a.name, a.status, a.location, a.room FROM assets a WHERE {where} ORDER BY a.id DESC LIMIT 5",
            params,
        ).fetchall()

    matched = rows[0] if rows else None
    reply_parts = ["เปิดฟอร์มแจ้งซ่อมและกรอกข้อมูลรอไว้ให้แล้วครับ:"]
    if matched:
        reply_parts.append(f"• ครุภัณฑ์: **{matched['code']} · {matched['name']}**")
    elif display_q:
        reply_parts.append(f"• คำค้นครุภัณฑ์: **{display_q}** (ยังไม่พบรายการตรงทันที กรุณาเลือกจากช่องค้นหา)")
    if issue_text:
        reply_parts.append(f"• อาการที่แจ้ง: **{issue_text}**")
    reply_parts.append(f"• ความเร่งด่วน: **{urgency}** · ตรวจสอบความถูกต้องแล้วกดยืนยันส่งได้เลยครับ")

    return {
        "reply": "\n".join(reply_parts),
        "stats": [
            {"label": "ความเร่งด่วน", "value": urgency},
            {"label": "พบครุภัณฑ์ตรงกัน", "value": f"{len(rows):,}"},
        ],
        "items": [
            {
                "kind": "asset",
                "id": r["id"],
                "code": r["code"] or f"#{r['id']}",
                "title": r["name"] or "-",
                "meta": f"{r['status'] or '-'} · {r['room'] or r['location'] or '-'}",
            }
            for r in rows
        ],
        "uiAction": {
            "type": "prefill_repair",
            "view": "repairs",
            "assetId": matched["id"] if matched else None,
            "assetCode": matched["code"] if matched else "",
            "assetName": matched["name"] if matched else display_q,
            "assetLocation": matched["location"] if matched else "",
            "assetQuery": matched["code"] if matched else display_q,
            "issue": issue_text,
            "urgency": urgency,
            "autoApply": True,
            "label": "เปิดฟอร์มแจ้งซ่อม (กรอกข้อมูลให้แล้ว)",
        },
    }


def _handle_repairs(db: sqlite3.Connection, prompt: str, auto_apply: bool, account_id=None) -> dict:
    ticket_status, cleaned = _extract_ticket_status(prompt)
    raw_q = _extract_repair_keyword(cleaned)
    terms, display_q = expand_search_terms(raw_q)

    t_where = ticket_scope_sql(db)
    params: list = []
    extra = ""
    aid = _parse_opt_id(account_id)
    if aid is not None:
        extra += (
            " AND (a.numbering_account_id=? OR (t.asset_id IS NULL AND t.location_point_id IS NOT NULL AND "
            "EXISTS(SELECT 1 FROM service_locations s WHERE s.id=t.location_point_id AND s.account_id=?)))"
        )
        params.extend([aid, aid])
    if ticket_status:
        extra += " AND t.status = ?"
        params.append(ticket_status)
    if raw_q:
        term_clauses = []
        for term in terms or [raw_q]:
            like = _like_pattern(term)
            term_clauses.append(
                "(COALESCE(t.ticket_no,'') LIKE ? ESCAPE '!' OR COALESCE(t.asset_name,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(t.asset_code,'') LIKE ? ESCAPE '!' OR COALESCE(t.issue,'') LIKE ? ESCAPE '!' OR "
                "COALESCE(t.location,'') LIKE ? ESCAPE '!')"
            )
            params.extend([like] * 5)
        extra += " AND (" + " OR ".join(term_clauses) + ")"

    counts = db.execute(
        f"SELECT COALESCE(NULLIF(TRIM(t.status),''),'ไม่ระบุ') AS s, COUNT(*) AS cnt FROM tickets t LEFT JOIN assets a ON a.id=t.asset_id WHERE {t_where}{extra} GROUP BY s ORDER BY cnt DESC",
        params,
    ).fetchall()
    row_status_filter = "" if ticket_status else " AND t.status != 'ปิดงาน'"
    open_rows = db.execute(
        f"SELECT t.id, t.ticket_no, t.asset_code, t.asset_name, t.issue, t.status, t.urgency FROM tickets t LEFT JOIN assets a ON a.id=t.asset_id WHERE {t_where}{extra}{row_status_filter} ORDER BY t.id DESC LIMIT 6",
        params,
    ).fetchall()

    total_all = sum(int(r["cnt"]) for r in counts)
    open_cnt = sum(int(r["cnt"]) for r in counts if r["s"] != "ปิดงาน")
    summary = " · ".join(f"{r['s']} {int(r['cnt']):,}" for r in counts) or "ยังไม่มีรายการแจ้งซ่อม"
    notes = [x for x in (display_q, f"สถานะ {ticket_status}" if ticket_status else "") if x]
    reply = f"สรุปงานแจ้งซ่อม{' (' + ' · '.join(notes) + ')' if notes else ''}: ทั้งหมด **{total_all:,} งาน** (ค้างดำเนินการ **{open_cnt:,} งาน**)\n{summary}"
    items = [
        {
            "kind": "ticket",
            "id": r["id"],
            "code": r["ticket_no"] or f"#{r['id']}",
            "title": r["asset_name"] or r["asset_code"] or "แจ้งซ่อม",
            "meta": f"{r['status']} · {r['issue'] or '-'}",
        }
        for r in open_rows
    ]
    has_filter = bool(display_q or ticket_status)
    return {
        "reply": reply,
        "stats": [
            {"label": "งานซ่อมทั้งหมด", "value": f"{total_all:,}"},
            {"label": "ค้างดำเนินการ", "value": f"{open_cnt:,}"},
        ],
        "items": items,
        "uiAction": {
            "type": "filter_repairs",
            "view": "repairs",
            "q": display_q,
            "status": ticket_status or "all",
            "autoApply": auto_apply,
            "label": "เปิดหน้าแจ้งซ่อมและตั้งตัวกรองให้แล้ว" if has_filter else "ไปที่หน้าแจ้งซ่อมและบริการ",
        },
    }


def _handle_prefill_asset(db: sqlite3.Connection, prompt: str, account_id=None, branch_id=None) -> dict:
    ctx = getattr(db, "access", None)
    if ctx and not (ctx.get("isAdmin") or ctx.get("permissions", {}).get("create")):
        return {
            "reply": "บัญชีของคุณยังไม่มีสิทธิ์ลงทะเบียนครุภัณฑ์ใหม่ครับ",
            "stats": [],
            "items": [],
            "uiAction": None,
        }

    text = re.sub(
        r"^\s*(?:ช่วย|กรุณา|รบกวน|ขอ|อยาก)?(?:เพิ่มครุภัณฑ์|ลงทะเบียนครุภัณฑ์|บันทึกครุภัณฑ์|สร้างครุภัณฑ์)\s*",
        "",
        prompt,
    ).strip()

    price = ""
    m_price = re.search(r"(?:ราคา|มูลค่า)?\s*(\d[\d,]*(?:\.\d+)?)\s*บาท", text)
    if m_price:
        price = m_price.group(1).replace(",", "")
        text = (text[:m_price.start()] + " " + text[m_price.end():]).strip()

    fiscal_year, text = _extract_fiscal_year(text)
    cat_id, cat_name, text = _extract_category(db, text, account_id=account_id)
    loc_filters, text = _extract_location(db, text, account_id=account_id, branch_id=branch_id)
    loc_text = " · ".join(v for v in (loc_filters.get("building"), loc_filters.get("floor"), loc_filters.get("room")) if v)

    name_clean = _extract_keyword(text) or text.strip()
    _terms, name_display = expand_search_terms(name_clean)

    summary_lines = ["เปิดฟอร์มลงทะเบียนครุภัณฑ์และกรอกข้อมูลเบื้องต้นรอไว้ให้แล้วครับ:"]
    if name_display:
        summary_lines.append(f"• ชื่อรายการ: **{name_display}**")
    if cat_name:
        summary_lines.append(f"• หมวดหมู่: **{cat_name}**")
    if loc_text:
        summary_lines.append(f"• สถานที่ตั้ง: **{loc_text}**")
    if price:
        summary_lines.append(f"• ราคา: **{price} บาท**")

    return {
        "reply": "\n".join(summary_lines),
        "stats": [],
        "items": [],
        "uiAction": {
            "type": "prefill_asset",
            "view": "assets",
            "categoryId": cat_id or "",
            "name": name_display,
            "location": loc_text,
            "purchasePrice": price,
            "fiscalYear": fiscal_year or "",
            "autoApply": True,
            "label": "เปิดฟอร์มลงทะเบียนครุภัณฑ์",
        },
    }


def _handle_custody(db: sqlite3.Connection, auto_apply: bool, account_id=None, branch_id=None) -> dict:
    ext_clauses, ext_params = _optional_scope_clause("a", account_id, branch_id)
    a_scope = " AND ".join([scope_sql(db, "a")] + ext_clauses)
    rows = db.execute(
        f"""
        SELECT a.id, a.code, a.name, c.custodian, c.location_text, c.loan_status, c.due_at
        FROM asset_custody_state c
        JOIN assets a ON a.id = c.asset_id
        WHERE {a_scope} AND c.loan_status IN ('loaned', 'issued')
        ORDER BY CASE WHEN c.due_at != '' AND c.due_at < date('now') THEN 0 ELSE 1 END, c.updated_at DESC
        LIMIT 8
        """,
        ext_params,
    ).fetchall()
    cnt_row = db.execute(
        f"""
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN c.due_at != '' AND c.due_at < date('now') THEN 1 ELSE 0 END) AS overdue
        FROM asset_custody_state c
        JOIN assets a ON a.id = c.asset_id
        WHERE {a_scope} AND c.loan_status IN ('loaned', 'issued')
        """,
        ext_params,
    ).fetchone()
    total = int(cnt_row["total"] or 0)
    overdue = int(cnt_row["overdue"] or 0)
    reply = f"ครุภัณฑ์ที่ถูกยืม/เบิกใช้อยู่ตอนนี้: **{total:,} รายการ**" + (f" (เกินกำหนดคืน **{overdue:,} รายการ**)" if overdue else "")
    items = [
        {
            "kind": "asset",
            "id": r["id"],
            "code": r["code"] or f"#{r['id']}",
            "title": r["name"] or "-",
            "meta": f"{'ถูกยืม' if r['loan_status'] == 'loaned' else 'ถูกเบิก'} · {r['custodian'] or '-'}" + (f" · กำหนดคืน {r['due_at']}" if r["due_at"] else ""),
        }
        for r in rows
    ]
    return {
        "reply": reply,
        "stats": [
            {"label": "กำลังยืม/เบิก", "value": f"{total:,}"},
            {"label": "เกินกำหนดคืน", "value": f"{overdue:,}"},
        ],
        "items": items,
        "uiAction": {
            "type": "switch_view",
            "view": "assets",
            "autoApply": auto_apply,
            "label": "เปิดหน้าทะเบียนครุภัณฑ์",
        },
    }


def _handle_missing(db: sqlite3.Connection, kind: str, auto_apply: bool = False, account_id=None, branch_id=None) -> dict:
    ext_clauses, ext_params = _optional_scope_clause("a", account_id, branch_id)
    a_scope = " AND ".join([scope_sql(db, "a")] + ext_clauses)
    if kind == "photo":
        cond = "NOT EXISTS (SELECT 1 FROM asset_photos p WHERE p.asset_id = a.id AND p.removed_at IS NULL)"
        label = "ครุภัณฑ์ที่ยังไม่มีรูปภาพ"
        ui_action = {
            "type": "switch_view",
            "view": "assets",
            "autoApply": False,
            "label": "ไปหน้าทะเบียนครุภัณฑ์",
        }
    else:
        cond = "(TRIM(COALESCE(a.location,'')) = '' AND TRIM(COALESCE(a.building,'')) = '' AND TRIM(COALESCE(a.room,'')) = '')"
        label = "ครุภัณฑ์ที่ยังไม่ระบุสถานที่/ห้อง"
        ui_action = {
            "type": "filter_assets",
            "view": "assets",
            "q": "",
            "status": "all",
            "room": "__unassigned__",
            "autoApply": auto_apply,
            "label": "กรองรายการที่ยังไม่ระบุห้องในทะเบียน",
        }

    total = db.execute(f"SELECT COUNT(*) FROM assets a WHERE {a_scope} AND {cond}", ext_params).fetchone()[0]
    rows = db.execute(
        f"SELECT a.id, a.code, a.name, a.status, a.location FROM assets a WHERE {a_scope} AND {cond} ORDER BY a.id DESC LIMIT 6",
        ext_params,
    ).fetchall()
    return {
        "reply": f"{label}: พบ **{int(total):,} รายการ** (แสดงตัวอย่าง {len(rows)} รายการล่าสุด)",
        "stats": [{"label": label, "value": f"{int(total):,}"}],
        "items": [
            {
                "kind": "asset",
                "id": r["id"],
                "code": r["code"] or f"#{r['id']}",
                "title": r["name"] or "-",
                "meta": f"{r['status'] or '-'} · {r['location'] or 'ยังไม่ระบุสถานที่'}",
            }
            for r in rows
        ],
        "uiAction": ui_action,
    }


def _handle_asset_search(
    db: sqlite3.Connection,
    raw_q: str,
    display_q: str,
    status: str,
    cat_id: str | None,
    cat_name: str | None,
    loc_filters: dict[str, str],
    fiscal_year: str | None,
    auto_apply: bool,
    account_id=None,
    branch_id=None,
) -> dict:
    where, params = _asset_where(
        db,
        raw_q,
        status,
        category_id=cat_id,
        building=loc_filters.get("building"),
        floor=loc_filters.get("floor"),
        room=loc_filters.get("room"),
        fiscal_year=fiscal_year,
        account_id=account_id,
        branch_id=branch_id,
    )
    cnt_row = db.execute(
        f"SELECT COUNT(*) AS cnt, COALESCE(SUM(COALESCE(a.purchase_price,0)),0) AS total_cost FROM assets a WHERE {where}",
        params,
    ).fetchone()
    total = int(cnt_row["cnt"] or 0)
    total_cost = float(cnt_row["total_cost"] or 0)
    rows = db.execute(
        f"SELECT a.id, a.code, a.name, a.status, a.location, a.room, a.purchase_price FROM assets a WHERE {where} ORDER BY a.id DESC LIMIT 6",
        params,
    ).fetchall()

    desc = []
    if display_q:
        desc.append(f'"{display_q}" (จาก "{raw_q}")' if raw_q and raw_q != display_q else f'"{display_q}"')
    if cat_name:
        desc.append(f"หมวด {cat_name}")
    for key in ("building", "floor", "room"):
        if loc_filters.get(key):
            desc.append(loc_filters[key])
    if fiscal_year:
        desc.append(f"ปีงบ {fiscal_year}")
    if status and status != "all":
        desc.append(f"สถานะ {status}")
    label = " · ".join(desc) or "ทั้งหมด"
    reply = f"ค้นหา/กรอง ({label}): พบ **{total:,} รายการ** · มูลค่ารวม **{_fmt_money(total_cost)}**"
    if total == 0:
        reply += "\nลองใช้คำค้นที่สั้นลง เช่น ชื่อครุภัณฑ์ เลขครุภัณฑ์ หรือชื่อห้องครับ"

    return {
        "reply": reply,
        "stats": [
            {"label": "พบรายการ", "value": f"{total:,}"},
            {"label": "มูลค่ารวม", "value": _fmt_money(total_cost)},
        ],
        "items": [
            {
                "kind": "asset",
                "id": r["id"],
                "code": r["code"] or f"#{r['id']}",
                "title": r["name"] or "-",
                "meta": f"{r['status'] or '-'} · {r['room'] or r['location'] or '-'}",
            }
            for r in rows
        ],
        "uiAction": {
            "type": "filter_assets",
            "view": "assets",
            "q": display_q,
            "status": status,
            "categoryId": cat_id or "",
            "building": loc_filters.get("building") or "",
            "floor": loc_filters.get("floor") or "",
            "room": loc_filters.get("room") or "",
            "fiscalYear": fiscal_year or "",
            "autoApply": auto_apply,
            "label": "กรองรายการนี้ในตารางทะเบียน",
        },
    }


def run_query(db: sqlite3.Connection, prompt_raw: str, account_id=None, branch_id=None) -> dict:
    if prompt_raw is None:
        prompt = ""
    elif not isinstance(prompt_raw, str):
        raise GovernanceError("กรุณาส่งคำถามเป็นข้อความ", 400)
    else:
        prompt = prompt_raw.strip()
    if not prompt:
        raise GovernanceError("กรุณาพิมพ์คำถามหรือคำสั่งที่ต้องการ", 400)
    if len(prompt) > 500:
        raise GovernanceError("คำสั่งยาวเกิน 500 ตัวอักษร", 400)

    low = prompt.casefold()
    auto_apply = any(
        w in prompt for w in ("กรอง", "เปิด", "ไปที่", "ไปหน้า", "แสดง", "เพิ่มครุภัณฑ์", "ลงทะเบียนครุภัณฑ์", "สร้างแผน", "สร้างใบ")
    ) or bool(re.match(r"^\s*(?:หา(?!ของ\s)|ดู|ค้นหา|เช็ค|ตรวจ)", prompt))

    # 0. Help / capabilities
    if low in ("help", "?", "ช่วย") or any(w in low for w in ("ทำอะไรได้บ้าง", "ช่วยอะไรได้", "ตัวอย่างคำสั่ง", "วิธีใช้ผู้ช่วย")):
        return _handle_help()

    # 1. Explicit navigation command (only when short nav and not requesting report/export/prefill)
    has_report_kw = any(w in low for w in ("รายงาน", "ส่งออก", "export", "csv", "excel", "xlsx", "ค่าเสื่อม"))
    has_prefill_kw = "อาการ" in prompt or "ด่วน" in prompt or any(w in prompt for w in ("สร้าง", "เพิ่ม", "สถานะ", "กรอง"))
    if any(prompt.startswith(p) for p in ("เปิดหน้า", "ไปหน้า", "ไปที่")) and not has_report_kw and not has_prefill_kw:
        ctx = getattr(db, "access", None)
        perms = (ctx or {}).get("permissions", {})
        is_admin = bool((ctx or {}).get("isAdmin"))
        for kw, view_id, view_title, extra in VIEW_KEYWORDS:
            if kw in low:
                if ctx and view_id in ("settings", "qr-smart") and not (is_admin or perms.get("manage")):
                    return {
                        "reply": f"บัญชีของคุณยังไม่มีสิทธิ์เข้าถึงหน้า **{view_title}** ครับ",
                        "stats": [],
                        "items": [],
                        "uiAction": None,
                    }
                if ctx and view_id == "approvals" and not (is_admin or perms.get("approve")):
                    return {
                        "reply": f"บัญชีของคุณยังไม่มีสิทธิ์อนุมัติในหน้า **{view_title}** ครับ",
                        "stats": [],
                        "items": [],
                        "uiAction": None,
                    }
                return {
                    "reply": f"เปิดหน้า **{view_title}** ให้เรียบร้อยครับ",
                    "stats": [],
                    "items": [],
                    "uiAction": {
                        "type": "switch_view",
                        "view": view_id,
                        **extra,
                        "autoApply": True,
                        "label": f"เปิดหน้า {view_title}",
                    },
                }

    # 2. Reports / Export / Depreciation
    if has_report_kw:
        return _handle_report(db, prompt, auto_apply, account_id=account_id, branch_id=branch_id)

    # 3. Create / prefill asset registration
    if any(w in prompt for w in ("เพิ่มครุภัณฑ์", "ลงทะเบียนครุภัณฑ์", "บันทึกครุภัณฑ์", "สร้างครุภัณฑ์")):
        return _handle_prefill_asset(db, prompt, account_id=account_id, branch_id=branch_id)

    # 4. Supply / Receive / Issue
    if any(w in prompt for w in ("รับเข้า", "ตรวจรับ", "เบิกจัดสรร", "เอกสารพัสดุ", "ใบรับ", "ใบเบิก", "สร้างใบรับ", "สร้างใบเบิก")):
        return _handle_supply(db, prompt, auto_apply, account_id=account_id)

    # 5. PM / Audit work
    if any(w in low for w in ("ตรวจนับ", "บำรุงรักษา", "รอบตรวจ", "แผนงาน", "สร้างแผน")) or re.search(r"\bpm\b", low):
        return _handle_work(db, prompt, auto_apply, account_id=account_id, branch_id=branch_id)

    # 6. Missing photo / missing location checks
    if any(w in prompt for w in ("ไม่มีรูป", "ยังไม่มีรูป", "ไม่มีภาพ", "ยังไม่มีภาพ")):
        return _handle_missing(db, "photo", auto_apply=auto_apply, account_id=account_id, branch_id=branch_id)
    if any(w in prompt for w in ("ไม่มีห้อง", "ไม่มีสถานที่", "ไม่มีที่ตั้ง", "ยังไม่ระบุสถานที่", "ยังไม่ระบุห้อง")):
        return _handle_missing(db, "location", auto_apply=auto_apply, account_id=account_id, branch_id=branch_id)

    # 7. Borrow / custody / overdue
    if any(w in prompt for w in ("ถูกยืม", "ยืมอยู่", "ยืม-คืน", "ยืมคืน", "เกินกำหนด", "กำลังเบิก")):
        return _handle_custody(db, auto_apply, account_id=account_id, branch_id=branch_id)

    # 8. Repair / tickets (new repair prefill vs repair search/filter)
    if any(w in low for w in ("แจ้งซ่อม", "งานซ่อม", "ค้างซ่อม", "ใบงานซ่อม", "เปิดticket", "ticket")):
        is_query = any(w in prompt for w in ("กี่งาน", "ค้าง", "มีงานซ่อม", "ดูงานซ่อม", "รายการแจ้งซ่อม", "สถานะ", "กรอง", "ค้นหา")) or prompt in ("แจ้งซ่อม", "งานซ่อม")
        if not is_query and (
            re.match(r"^\s*(?:ช่วย|กรุณา|รบกวน|ขอ|อยาก)?(?:เปิดแจ้งซ่อม|เปิดใบแจ้งซ่อม|สร้างใบแจ้งซ่อม|เปิด\s*ticket|แจ้งซ่อม)", low)
            or "อาการ" in prompt
            or "ด่วน" in prompt
            or any(sym in prompt for sym in SYMPTOM_WORDS)
        ):
            return _handle_prefill_repair(db, prompt, account_id=account_id, branch_id=branch_id)
        return _handle_repairs(db, prompt, auto_apply, account_id=account_id)

    # 9. Extract structured filters + keyword for summary or search/filter
    status, without_status = _extract_status(prompt)
    cat_id, cat_name, without_cat = _extract_category(db, without_status, account_id=account_id)
    fiscal_year, without_fy = _extract_fiscal_year(without_cat)
    loc_filters, without_loc = _extract_location(db, without_fy, account_id=account_id, branch_id=branch_id)
    raw_q = _extract_keyword(without_loc)
    _terms, display_q = expand_search_terms(raw_q)

    if any(w in prompt for w in ("สรุป", "ยอดรวม", "ทั้งหมด", "กี่รายการ", "กี่ชิ้น", "มูลค่า", "ภาพรวม")):
        return _handle_summary(
            db,
            raw_q,
            display_q,
            status,
            cat_id,
            cat_name,
            loc_filters,
            fiscal_year,
            auto_apply,
            account_id=account_id,
            branch_id=branch_id,
        )

    return _handle_asset_search(
        db,
        raw_q,
        display_q,
        status,
        cat_id,
        cat_name,
        loc_filters,
        fiscal_year,
        auto_apply,
        account_id=account_id,
        branch_id=branch_id,
    )


def handle_assistant(db, method: str, path: str, query: dict, body: dict):
    if method == "GET" and path == "/api/assistant/capabilities":
        return {
            "ok": True,
            "mode": "local-smart-query",
            "examples": [
                "หาแอร์",
                "สรุปยอดครุภัณฑ์ทั้งหมด",
                "เปิดรายงานงานซ่อม",
                "สรุปค่าเสื่อมราคา",
                "งานซ่อมค้างอยู่กี่งาน",
                "แจ้งซ่อม แอร์ อาการ ไม่เย็น ด่วน",
                "งานตรวจนับและ PM",
                "กรองครุภัณฑ์สถานะ พร้อมใช้",
                "ครุภัณฑ์ที่ยังไม่ระบุห้อง",
            ],
        }
    if method == "POST" and path == "/api/assistant/query":
        if not isinstance(body, dict):
            raise GovernanceError("รูปแบบข้อมูลไม่ถูกต้อง", 400)
        return run_query(
            db,
            body.get("prompt", ""),
            account_id=body.get("accountId"),
            branch_id=body.get("branchId"),
        )
    return None
