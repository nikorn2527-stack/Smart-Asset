"""Relational inventory, source lookup, register, and ITAM-style sticker APIs."""
from __future__ import annotations
from access_control import scope_sql

import base64
import html
import json
import re
import sqlite3
import time
from typing import Any
from master_data_api import handle as handle_master_data
from numbering import get_catalog, link_code
from catalog_guidance import handle as handle_guidance
from smart_assets import qr_url, branding
from asset_photos import primary_photo_sql

try:
    import qrcode
    from qrcode.image.svg import SvgPathImage
except ImportError:  # Printed QR will report a useful error if dependency is absent.
    qrcode = None
    SvgPathImage = None

MAX_PAGE_SIZE = 200
MAX_PRINT_BATCH = 500
ELEMENT_TYPES = {"text", "image", "qr", "rect"}


def _one(query: dict, key: str, default: str = "") -> str:
    value = query.get(key, default)
    return str(value[0] if isinstance(value, list) and value else value)


def _many(query: dict, key: str) -> list[str]:
    value = query.get(key, [])
    values = value if isinstance(value, list) else [value]
    return [str(item).strip() for item in values if str(item).strip()][:50]


def _fiscal_year_expression() -> str:
    return """COALESCE(
        NULLIF((SELECT x.fiscal_year_th FROM asset_acquisitions x WHERE x.asset_id=a.id ORDER BY x.id DESC LIMIT 1),''),
        NULLIF(a.fiscal_year_th,''),
        CAST(a.acquired_year AS TEXT),
        ''
    )"""


def _safe_limit(query: dict, default: int = 50) -> int:
    try:
        return max(1, min(MAX_PAGE_SIZE, int(_one(query, "limit", str(default)))))
    except (TypeError, ValueError):
        return default


def _safe_offset(query: dict) -> int:
    try:
        return max(0, int(_one(query, "offset", "0")))
    except (TypeError, ValueError):
        return 0


def _template_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "name": row["name"], "isDefault": bool(row["is_default"]),
        "canvas": {"width": row["canvas_width_mm"], "height": row["canvas_height_mm"], "unit": "mm"},
        "overflow": row["overflow"], "elements": json.loads(row["elements_json"] or "[]"),
        "isActive": bool(row["is_active"]), "createdAt": row["created_at"], "updatedAt": row["updated_at"],
    }


_LOCATION_BLD_FLR_SLASH = re.compile(r"(?:อาคาร|ตึก|อ\.?)\s*(\d+)\s*/\s*(\d+)")
_LOCATION_BLD = re.compile(r"(?:อาคาร|ตึก|อ\.)\s*([0-9]+(?:\s*ปี)?|ศูนย์แพทย[^\s,()]*|เฉลิมพระเกียรติ|อุบัติเหตุ|ผู้ป่วยนอก|อำนวยการ)")
_LOCATION_FLR = re.compile(r"ชั้น(?:ที่)?\s*([0-9]+|ใต้ดิน|ดาดฟ้า|ลอย|G|M)")
_LOCATION_ROOM = re.compile(r"(ห้อง[^\s,()]+(?:\s+[0-9A-Za-z/-]+)?)")


def _extract_location_parts(loc: str, detail: str = "") -> tuple[str, str, str, str]:
    text_src = (loc or "").strip()
    building = floor = room = sub_unit = ""
    slash = _LOCATION_BLD_FLR_SLASH.search(text_src)
    if slash:
        building = f"อาคาร {slash.group(1)}"
        floor = f"ชั้น {slash.group(2)}"
    else:
        bm = _LOCATION_BLD.search(text_src) or _LOCATION_BLD.search(detail or "")
        if bm:
            val = bm.group(1).strip()
            building = f"อาคาร{val}" if val.startswith("ศูนย์") else f"อาคาร {val}"
        fm = _LOCATION_FLR.search(text_src) or _LOCATION_FLR.search(detail or "")
        if fm:
            floor = f"ชั้น {fm.group(1).strip()}"
    rm = _LOCATION_ROOM.search(text_src) or _LOCATION_ROOM.search(detail or "")
    if rm:
        room = rm.group(1).strip()
    cleaned = text_src
    for rx in (_LOCATION_BLD_FLR_SLASH, _LOCATION_BLD, _LOCATION_FLR):
        cleaned = rx.sub("", cleaned)
    cleaned = re.sub(r"[\s,·/-]+", " ", cleaned).strip()
    if cleaned:
        sub_unit = cleaned[:120]
    return building, floor, room, sub_unit


def ensure_location_hierarchy(db: sqlite3.Connection) -> None:
    cols = {r[1] for r in db.execute("PRAGMA table_info(assets)")}
    for col in ("building", "floor", "room", "sub_unit"):
        if col not in cols:
            db.execute(f"ALTER TABLE assets ADD COLUMN {col} TEXT NOT NULL DEFAULT ''")
    db.execute("CREATE INDEX IF NOT EXISTS idx_assets_location_hierarchy ON assets(numbering_account_id,building,floor,room,sub_unit)")
    has_mig = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").fetchone()
    if has_mig and db.execute("SELECT 1 FROM schema_migrations WHERE name='asset-location-hierarchy-v1'").fetchone():
        return
    rows = db.execute("SELECT id,location,detail FROM assets WHERE building='' AND floor='' AND room='' AND sub_unit='' AND (location<>'' OR detail<>'')").fetchall()
    updates = []
    for r in rows:
        b, f, rm, su = _extract_location_parts(r[1] or "", r[2] or "")
        if b or f or rm or su:
            updates.append((b, f, rm, su, r[0]))
    if updates:
        db.executemany("UPDATE assets SET building=?,floor=?,room=?,sub_unit=? WHERE id=?", updates)
    if has_mig:
        db.execute("INSERT OR IGNORE INTO schema_migrations(name) VALUES('asset-location-hierarchy-v1')")


def _inventory_select() -> str:
    return """SELECT a.id,a.name,a.detail,a.code,a.group_name,a.location,a.building,a.floor,a.room,a.sub_unit,a.acquired_year,a.status,a.icon,a.created_at,a.created_by,a.category_id,
        a.fsn_code,a.old_asset_code,a.maintenance_status,a.asset_status_source,a.asset_type,a.fiscal_year_th,a.acquisition_date,a.delivery_date,
        a.acquisition_method,a.purchase_price,a.gfmis_no,a.po_no,a.model,a.serial_number,a.useful_life_years,a.depreciation_policy_id,
        a.depreciation_value,a.accumulated_depreciation,a.net_book_value,a.valuation_date,a.remaining_days,a.is_loaned,a.loan_price,
        a.latest_update,a.delivery_note_no,a.source_document_id,a.source_row_no,a.numbering_account_id,a.branch_id,a.numbering_profile_id,a.numbering_snapshot,a.depreciation_rule_snapshot,
        COALESCE(category_label.name,c.category_name) AS category_name,account.name AS account_name,branch.name AS branch_name,org.name AS organization_name,dept.name AS department_name,responsible.name AS responsible_unit,
        reg.description AS register_description,reg.asset_type AS register_asset_type,reg.model AS register_model,
        reg.location AS register_location,COALESCE(NULLIF(reg.vendor_name,''),acq.vendor_name) AS vendor_name,
        COALESCE(NULLIF(reg.vendor_address,''),acq.vendor_address) AS vendor_address,COALESCE(NULLIF(reg.vendor_phone,''),acq.vendor_phone) AS vendor_phone,
        COALESCE(profile.warranty_end,reg.warranty_end) AS warranty_end,
        COALESCE(NULLIF(reg.gfmis_no,''),NULLIF(acq.gfmis_no,''),a.gfmis_no) AS linked_gfmis_no,
        COALESCE(NULLIF(reg.po_no,''),NULLIF(acq.po_no,''),a.po_no) AS linked_po_no,
        COALESCE(profile.serial_number,NULLIF(reg.serial_number,''),NULLIF(acq.serial_number,''),a.serial_number) AS linked_serial_number,
        COALESCE(NULLIF(acq.fiscal_year_th,''),NULLIF(a.fiscal_year_th,''),a.acquired_year) AS linked_fiscal_year,
        COALESCE(NULLIF(acq.acquired_on,''),NULLIF(a.acquisition_date,'')) AS linked_acquired_on,
        COALESCE(NULLIF(acq.acquisition_method,''),NULLIF(a.acquisition_method,'')) AS linked_acquisition_method,
        COALESCE(acq.total_price,acq.unit_price,a.purchase_price) AS linked_purchase_price,
        COALESCE(NULLIF(acq.model,''),NULLIF(a.model,''),NULLIF(reg.model,'')) AS linked_model,
        COALESCE(dep.useful_life_years,a.useful_life_years) AS linked_useful_life_years,
        dep.monthly_depreciation,dep.annual_depreciation,
        COALESCE(dep.accumulated_depreciation,a.accumulated_depreciation) AS linked_accumulated_depreciation,
        COALESCE(dep.net_book_value,a.net_book_value) AS linked_net_book_value,
        COALESCE(NULLIF(reg.fund_type,''),NULLIF(acq.fund_type,'')) AS linked_fund_type,
        acq.document_no AS linked_document_no,acq.quantity AS linked_quantity,
        (SELECT id FROM asset_register_details r2 WHERE r2.asset_id=a.id ORDER BY r2.id DESC LIMIT 1) AS register_id,
        """ + primary_photo_sql("a") + """ AS photo_id
      FROM assets a
      LEFT JOIN asset_profiles profile ON profile.asset_id=a.id
      LEFT JOIN asset_categories c ON c.id=a.category_id
      LEFT JOIN organizations org ON org.id=a.organization_id
      LEFT JOIN account_category_labels category_label ON category_label.category_id=a.category_id AND category_label.account_id=a.numbering_account_id
      LEFT JOIN asset_accounts account ON account.id=a.numbering_account_id
      LEFT JOIN account_branches branch ON branch.id=a.branch_id
      LEFT JOIN org_units dept ON dept.id=a.department_unit_id
      LEFT JOIN org_units responsible ON responsible.id=a.responsible_unit_id
      LEFT JOIN asset_register_details reg ON reg.id=(SELECT id FROM asset_register_details r WHERE r.asset_id=a.id ORDER BY r.id DESC LIMIT 1)
      LEFT JOIN asset_acquisitions acq ON acq.id=(SELECT id FROM asset_acquisitions x WHERE x.asset_id=a.id ORDER BY x.id DESC LIMIT 1)
      LEFT JOIN asset_depreciation_snapshots dep ON dep.id=(SELECT id FROM asset_depreciation_snapshots d WHERE d.asset_id=a.id ORDER BY d.id DESC LIMIT 1)"""


def _inventory_item(row: sqlite3.Row) -> dict[str, Any]:
    location = row["location"] or row["register_location"] or row["responsible_unit"] or row["department_name"] or ""
    name = row["name"] or row["register_description"] or row["detail"] or ""
    keys = row.keys()
    building = row["building"] if "building" in keys else ""
    floor = row["floor"] if "floor" in keys else ""
    room = row["room"] if "room" in keys else ""
    sub_unit = row["sub_unit"] if "sub_unit" in keys else ""
    item = {
        "id": row["id"], "name": name, "detail": row["detail"] or row["register_description"] or "",
        "code": row["code"], "group": row["category_name"] or row["group_name"], "location": location,
        "building": building, "floor": floor, "room": room, "subUnit": sub_unit,
        "date": row["created_at"], "status": row["status"], "icon": row["icon"], "createdBy": row["created_by"],
        "accountName": row["account_name"], "branchName": row["branch_name"], "accountId": row["numbering_account_id"], "branchId": row["branch_id"], "profileId": row["numbering_profile_id"], "categoryId": row["category_id"], "fsnCode": row["fsn_code"], "assetType": row["register_asset_type"] or row["asset_type"],
        "organization": row["organization_name"] or "", "department": row["department_name"] or "",
        "responsibleUnit": row["responsible_unit"] or "", "gfmisNo": row["linked_gfmis_no"] or "",
        "poNo": row["linked_po_no"] or "", "serialNumber": row["linked_serial_number"] or "",
        "model": row["linked_model"] or "", "fiscalYear": row["linked_fiscal_year"] or "",
        "acquiredOn": row["linked_acquired_on"] or "", "acquisitionMethod": row["linked_acquisition_method"] or "",
        "purchasePrice": row["linked_purchase_price"], "fundType": row["linked_fund_type"] or "",
        "vendor": row["vendor_name"] or "", "warrantyEnd": row["warranty_end"] or "",
        "usefulLifeYears": row["linked_useful_life_years"], "monthlyDepreciation": row["monthly_depreciation"],
        "annualDepreciation": row["annual_depreciation"], "accumulatedDepreciation": row["linked_accumulated_depreciation"],
        "depreciationValue":row["depreciation_value"], "netBookValue": row["linked_net_book_value"], "hasRegister": bool(row["register_id"]),
        "sourceDocumentId": row["source_document_id"], "sourceRowNo": row["source_row_no"],
        "photoUrl": f"/api/assets/{row['id']}/photos/{row['photo_id']}/thumb" if row["photo_id"] else "",
    }

    numbering=json.loads(row["numbering_snapshot"] or '{}');changed=numbering.get('currentFields',{})
    overrides={'purchasePrice':('purchasePrice','purchase_price'),'acquisitionDate':('acquiredOn','acquisition_date'),'model':('model','model'),'gfmisNo':('gfmisNo','gfmis_no'),'poNo':('poNo','po_no'),'fiscalYear':('fiscalYear','fiscal_year_th'),'acquisitionMethod':('acquisitionMethod','acquisition_method'),'assetType':('assetType','asset_type')}
    for key,(target,column) in overrides.items():
        if changed.get(key):item[target]=row[column]
    from governance import calculate
    depreciation=json.loads(row['depreciation_rule_snapshot'] or '{}');policy=depreciation.get('policy')
    item['depreciationStartDate']=depreciation.get('startDate',item['acquiredOn'])
    estimate=calculate(policy,item['purchasePrice'],item['depreciationStartDate'])
    item['depreciationEstimate']=estimate if estimate['status']=='calculated' else None
    item['depreciationPolicyName']=policy.get('category_name','') if policy else ''
    return item


def _where(query: dict) -> tuple[str, list[Any]]:
    terms: list[str] = []
    values: list[Any] = []
    account = _one(query, "accountId")
    if account == "legacy": terms.append("a.numbering_account_id IS NULL")
    elif account:
        try: values.append(int(account)); terms.append("a.numbering_account_id=?")
        except ValueError: terms.append("0")
    branch = _one(query, "branchId")
    if branch:
        try: values.append(int(branch)); terms.append("a.branch_id=?")
        except ValueError: terms.append("0")
    for key, column in (("building", "a.building"), ("floor", "a.floor")):
        selected = _many(query, key)
        if selected:
            values_for_filter = [value for value in selected if value != "__unassigned__"]
            options = [f"{column} IN ({','.join('?' for _ in values_for_filter)})"] if values_for_filter else []
            values.extend(values_for_filter)
            if "__unassigned__" in selected:
                options.append(f"{column}=''")
            terms.append("(" + " OR ".join(options) + ")")
    rooms = _many(query, "room")
    if rooms:
        room_terms = []
        for room in rooms:
            if room == "__unassigned__":
                room_terms.append("(a.room='' AND a.sub_unit='')")
            else:
                room_terms.append("(a.room=? OR a.sub_unit=? OR a.location=?)")
                values.extend([room, room, room])
        terms.append("(" + " OR ".join(room_terms) + ")")
    text = _one(query, "q").strip()
    if text:
        like = f"%{text}%"
        searchable = ["a.fsn_code", "a.name", "a.detail", "a.code", "a.old_asset_code", "a.group_name", "a.location", "a.building", "a.floor", "a.room", "a.sub_unit", "a.gfmis_no", "a.po_no", "a.model", "a.serial_number", "a.asset_type", "c.category_name", "org.name", "dept.name", "responsible.name", "account.name", "branch.name", "category_label.name"]
        searchable_terms = [f"COALESCE({column},'') LIKE ?" for column in searchable]
        searchable_terms.append("EXISTS(SELECT 1 FROM asset_register_details rr WHERE rr.asset_id=a.id AND (rr.vendor_name LIKE ? OR rr.description LIKE ?))")
        values.extend([like] * len(searchable))
        values.extend([like, like])
        if len(text) >= 3:
            searchable_terms.append("a.id IN (SELECT sr.asset_id FROM source_row_search fts JOIN source_row_records sr ON sr.id=fts.rowid WHERE fts.raw_data_json LIKE ?)")
            values.append(like)
        terms.append("(" + " OR ".join(searchable_terms) + ")")
    statuses = [value for value in _many(query, "status") if value != "all"]
    if statuses:
        terms.append(f"a.status IN ({','.join('?' for _ in statuses)})")
        values.extend(statuses)
    categories = _many(query, "category")
    if categories:
        category_terms = []
        category_ids = []
        for category in categories:
            if category == "__unassigned__":
                category_terms.append("(a.category_id IS NULL AND COALESCE(a.group_name,'')='')")
                continue
            try:
                category_ids.append(int(category))
            except ValueError:
                category_terms.append("COALESCE(category_label.name,c.category_name,a.group_name) LIKE ?")
                values.append(f"%{category}%")
        if category_ids:
            category_terms.append(f"a.category_id IN ({','.join('?' for _ in category_ids)})")
            values.extend(category_ids)
        terms.append("(" + " OR ".join(category_terms) + ")")
    fiscal_years = _many(query, "fiscalYear")
    if fiscal_years:
        fiscal_year = _fiscal_year_expression()
        selected_years = [year for year in fiscal_years if year != "__unassigned__"]
        fiscal_terms = []
        if selected_years:
            fiscal_terms.append(f"{fiscal_year} IN ({','.join('?' for _ in selected_years)})")
            values.extend(selected_years)
        if "__unassigned__" in fiscal_years:
            fiscal_terms.append(f"{fiscal_year}=''")
        terms.append("(" + " OR ".join(fiscal_terms) + ")")
    if _one(query,"hasRegister").lower() in {"1","true","yes"}:
        terms.append("EXISTS(SELECT 1 FROM asset_register_details rr WHERE rr.asset_id=a.id)")
    return (" WHERE " + " AND ".join(terms) if terms else ""), values


def inventory(db: sqlite3.Connection, query: dict) -> dict[str, Any]:
    ensure_location_hierarchy(db)
    where, values = _where(query)
    total = int(db.execute("SELECT COUNT(*) FROM assets a LEFT JOIN asset_categories c ON c.id=a.category_id LEFT JOIN asset_accounts account ON account.id=a.numbering_account_id LEFT JOIN account_branches branch ON branch.id=a.branch_id LEFT JOIN account_category_labels category_label ON category_label.account_id=a.numbering_account_id AND category_label.category_id=a.category_id LEFT JOIN organizations org ON org.id=a.organization_id LEFT JOIN org_units dept ON dept.id=a.department_unit_id LEFT JOIN org_units responsible ON responsible.id=a.responsible_unit_id" + where, values).fetchone()[0])
    limit, offset = _safe_limit(query), _safe_offset(query)
    rows = db.execute(_inventory_select() + where + " ORDER BY CASE WHEN a.code='' THEN 1 ELSE 0 END,a.code,a.id LIMIT ? OFFSET ?", (*values, limit, offset)).fetchall()
    return {"items": [_inventory_item(row) for row in rows], "total": total, "limit": limit, "offset": offset}


def inventory_facets(db: sqlite3.Connection, query: dict) -> dict[str, Any]:
    ensure_location_hierarchy(db)
    scope = scope_sql(db, "a")
    account = _one(query, "accountId")
    args: list[Any] = []
    if account == "legacy":
        scope += " AND a.numbering_account_id IS NULL"
    elif account:
        try:
            args.append(int(account))
            scope += " AND a.numbering_account_id=?"
        except ValueError:
            scope += " AND 0"
    branch = _one(query, "branchId")
    if branch:
        try:
            args.append(int(branch))
            scope += " AND a.branch_id=?"
        except ValueError:
            scope += " AND 0"
    buildings = [{"name": r[0] or "__unassigned__", "count": r[1]} for r in db.execute(f"SELECT NULLIF(a.building,'') AS building, COUNT(*) AS cnt FROM assets a WHERE {scope} GROUP BY building ORDER BY cnt DESC, building LIMIT 100", args)]
    floors = [{"name": r[0] or "__unassigned__", "count": r[1]} for r in db.execute(f"SELECT NULLIF(a.floor,'') AS floor, COUNT(*) AS cnt FROM assets a WHERE {scope} GROUP BY floor ORDER BY cnt DESC, floor LIMIT 50", args)]
    rooms = [{"name": r[0] or "__unassigned__", "count": r[1]} for r in db.execute(f"SELECT COALESCE(NULLIF(a.room,''), NULLIF(a.sub_unit,'')) AS rm, COUNT(*) AS cnt FROM assets a WHERE {scope} GROUP BY rm ORDER BY cnt DESC, rm LIMIT 150", args)]
    fiscal_year = _fiscal_year_expression()
    fiscal_years = [{"value": r[0] or "__unassigned__", "count": r[1]} for r in db.execute(f"SELECT {fiscal_year} AS fiscal_year, COUNT(*) AS cnt FROM assets a WHERE {scope} GROUP BY fiscal_year ORDER BY CASE WHEN fiscal_year GLOB '[0-9]*' THEN CAST(fiscal_year AS INTEGER) END DESC, fiscal_year DESC LIMIT 50", args)]
    categories = [{"value": str(r[0]), "label": r[1], "count": r[2]} for r in db.execute(f"""SELECT a.category_id,COALESCE(label.name,c.category_name,a.group_name) AS category,COUNT(*) AS cnt
        FROM assets a LEFT JOIN asset_categories c ON c.id=a.category_id
        LEFT JOIN account_category_labels label ON label.category_id=a.category_id AND label.account_id=a.numbering_account_id
        WHERE {scope} GROUP BY a.category_id,category ORDER BY cnt DESC,category LIMIT 200""", args) if r[0] is not None]
    statuses = [{"value": r[0], "count": r[1]} for r in db.execute(f"SELECT a.status,COUNT(*) AS cnt FROM assets a WHERE {scope} GROUP BY a.status ORDER BY cnt DESC,a.status", args) if r[0]]
    return {"buildings": buildings, "floors": floors, "rooms": rooms, "fiscalYears": fiscal_years, "categories": categories, "statuses": statuses}


def bulk_update_location(db: sqlite3.Connection, body: dict) -> dict[str, Any] | tuple[dict[str, str], int]:
    ensure_location_hierarchy(db)
    raw_ids = body.get("assetIds") or []
    if not isinstance(raw_ids, list) or not raw_ids or len(raw_ids) > 500:
        return {"error": "กรุณาเลือกครุภัณฑ์ 1–500 รายการ"}, 400
    try:
        ids = [int(x) for x in raw_ids]
    except (TypeError, ValueError):
        return {"error": "รหัสครุภัณฑ์ไม่ถูกต้อง"}, 400
    building = str(body.get("building") or "").strip()[:120]
    floor = str(body.get("floor") or "").strip()[:60]
    room = str(body.get("room") or "").strip()[:120]
    sub_unit = str(body.get("subUnit") or "").strip()[:120]
    update_display = bool(body.get("updateLocationText", True))
    parts = [p for p in (building, floor, room, sub_unit) if p]
    composed_loc = " · ".join(parts)
    placeholders = ",".join("?" for _ in ids)
    scope = scope_sql(db, "assets")
    if update_display and composed_loc:
        cur = db.execute(f"UPDATE assets SET building=?,floor=?,room=?,sub_unit=?,location=?,updated_at=CURRENT_TIMESTAMP WHERE id IN ({placeholders}) AND {scope}", [building, floor, room, sub_unit, composed_loc, *ids])
    else:
        cur = db.execute(f"UPDATE assets SET building=?,floor=?,room=?,sub_unit=?,updated_at=CURRENT_TIMESTAMP WHERE id IN ({placeholders}) AND {scope}", [building, floor, room, sub_unit, *ids])
    return {"updated": cur.rowcount, "building": building, "floor": floor, "room": room, "subUnit": sub_unit}


def asset_detail(db: sqlite3.Connection, asset_id: int) -> dict[str, Any] | None:
    ensure_location_hierarchy(db)
    row = db.execute(_inventory_select() + " WHERE a.id=?", (asset_id,)).fetchone()
    return _inventory_item(row) if row else None


def asset_register(db: sqlite3.Connection, asset_id: int) -> dict[str, Any] | None:
    item = asset_detail(db, asset_id)
    if not item:
        return None
    register = db.execute("SELECT r.*,s.filename AS source_filename,s.source_scope FROM asset_register_details r LEFT JOIN source_documents s ON s.id=r.source_document_id WHERE r.asset_id=? ORDER BY r.id DESC LIMIT 1", (asset_id,)).fetchone()
    acquisitions = [dict(row) for row in db.execute("SELECT x.*,s.filename AS source_filename FROM asset_acquisitions x LEFT JOIN source_documents s ON s.id=x.source_document_id WHERE x.asset_id=? ORDER BY x.id", (asset_id,))]
    depreciation = [dict(row) for row in db.execute("SELECT d.*,p.rule_no,p.category_name AS policy_category,s.filename AS source_filename FROM asset_depreciation_snapshots d LEFT JOIN depreciation_policies p ON p.id=d.policy_id LEFT JOIN source_documents s ON s.id=d.source_document_id WHERE d.asset_id=? ORDER BY d.id", (asset_id,))]
    source_rows = [dict(row) for row in db.execute("SELECT r.source_row_no,r.record_kind,r.raw_data_json,s.filename AS source_filename FROM source_row_records r JOIN source_documents s ON s.id=r.source_document_id WHERE r.asset_id=? ORDER BY r.id", (asset_id,))]
    for row in source_rows:
        try:
            row["rawData"] = json.loads(row.pop("raw_data_json") or "{}")
        except json.JSONDecodeError:
            row["rawData"] = {}
    fsn_matches=[dict(row) for row in db.execute("SELECT f.category_code AS categoryCode,f.type_code AS typeCode,f.item_name AS name,f.canonical_fsn_code AS fullCode,m.match_method AS matchMethod,m.matched_code AS matchedCode FROM asset_fsn_matches m JOIN fsn_catalog_items f ON f.id=m.fsn_catalog_item_id WHERE m.asset_id=? ORDER BY f.id",(asset_id,))]
    return {"asset": item, "register": dict(register) if register else None, "acquisitions": acquisitions, "depreciationSnapshots": depreciation, "sourceRows": source_rows, "fsnMatches":fsn_matches}


ALLOWED_FONTS = {
    "Sarabun": "'Sarabun', Tahoma, sans-serif",
    "TH SarabunPSK": "'TH SarabunPSK', 'TH Sarabun New', 'Sarabun', sans-serif",
    "Angsana New": "'Angsana New', 'AngsanaUPC', 'Sarabun', serif",
    "Cordia New": "'Cordia New', 'CordiaUPC', 'Sarabun', sans-serif",
    "Prompt": "'Prompt', 'Sarabun', sans-serif",
    "Kanit": "'Kanit', 'Sarabun', sans-serif",
    "Tahoma": "Tahoma, Arial, sans-serif",
    "Arial": "Arial, Helvetica, sans-serif",
}
_TH_MONTHS = ("ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.")


def _format_thai_short_date(raw: Any) -> str:
    s = str(raw or "").strip()
    if not s or s.startswith(("1899-12-3", "1900-01-0")):
        return ""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if not m:
        return s
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if y < 1920 or not (1 <= mo <= 12):
        return ""
    th_y = y + 543 if y < 2400 else y
    return f"{d:02d}-{_TH_MONTHS[mo - 1]}-{th_y}"


def _read_template(db: sqlite3.Connection, template_id: str | None = None) -> sqlite3.Row | None:
    if template_id:
        return db.execute("SELECT * FROM sticker_templates WHERE id=?", (template_id,)).fetchone()
    return db.execute("SELECT * FROM sticker_templates ORDER BY is_active DESC,is_default DESC,created_at,id LIMIT 1").fetchone()


def _default_70x36_template() -> dict[str, Any]:
    return {
        "id": "gov-asset-default-70x36",
        "name": "ฉลากครุภัณฑ์ 70 × 36 มม.",
        "isDefault": True,
        "canvas": {"width": 70.0, "height": 36.0, "unit": "mm"},
        "overflow": "clip",
        "elements": [
            {"id": "default-logo", "type": "image", "x": 3.4, "y": 2.0, "width": 14.0, "height": 14.0, "source": "/assets/medcenter-logo.png", "zIndex": 2},
            {"id": "default-org-th", "type": "text", "x": 18.8, "y": 1.8, "width": 48.5, "height": 3.6, "content": "ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์", "fontSize": 6.2, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#111111", "align": "left", "valign": "center", "lineHeight": 1.35, "zIndex": 2},
            {"id": "default-org-en", "type": "text", "x": 18.8, "y": 5.5, "width": 48.5, "height": 3.1, "content": "MEDICAL EDUCATION CENTER OF SURIN HOSPITAL", "fontSize": 5.8, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#111111", "align": "left", "valign": "center", "lineHeight": 1.35, "zIndex": 2},
            {"id": "default-address", "type": "text", "x": 18.8, "y": 9.0, "width": 48.5, "height": 2.3, "content": "ที่อยู่: 68 ถ.หลักเมือง ต.ในเมือง อ.เมืองสุรินทร์ จ.สุรินทร์ 32000 โทร 044-518-937", "fontSize": 4.0, "fontWeight": 600, "fontFamily": "Sarabun", "color": "#222222", "align": "left", "valign": "center", "lineHeight": 1.35, "zIndex": 2},
            {"id": "default-header-rule", "type": "rect", "x": 18.8, "y": 8.75, "width": 48.5, "height": 0.2, "background": "#111111", "zIndex": 1},
            {"id": "default-category-label", "type": "text", "x": 19.0, "y": 12.0, "width": 20.0, "height": 3.4, "content": "ประเภทครุภัณฑ์ :", "fontSize": 6.6, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#111111", "align": "left", "valign": "center", "lineHeight": 1.35, "zIndex": 3},
            {"id": "default-category", "type": "text", "x": 44.0, "y": 12.0, "width": 24.0, "height": 3.4, "content": "{{Category}}", "fontSize": 6.6, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#111111", "align": "left", "valign": "center", "lineHeight": 1.35, "zIndex": 3},
            {"id": "default-code-label", "type": "text", "x": 19.0, "y": 16.2, "width": 20.0, "height": 3.8, "content": "เลขครุภัณฑ์ :", "fontSize": 6.8, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#111111", "align": "left", "valign": "center", "lineHeight": 1.35, "zIndex": 2},
            {"id": "default-code", "type": "text", "x": 41.0, "y": 16.2, "width": 27.0, "height": 3.8, "content": "{{AssetNo}}", "fontSize": 6.8, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#111111", "align": "left", "valign": "center", "lineHeight": 1.35, "letterSpacing": 0.2, "zIndex": 2},
            {"id": "default-name-label", "type": "text", "x": 2.4, "y": 20.3, "width": 14.0, "height": 3.4, "content": "ชื่อครุภัณฑ์ :", "fontSize": 6.8, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#111111", "align": "left", "valign": "center", "lineHeight": 1.35, "zIndex": 2},
            {"id": "default-name", "type": "text", "x": 16.4, "y": 20.3, "width": 39.5, "height": 8.4, "content": "{{AssetName}}", "fontSize": 5.8, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#111111", "align": "left", "valign": "top", "lineHeight": 1.35, "zIndex": 2},
            {"id": "default-date-label", "type": "text", "x": 2.4, "y": 29.0, "width": 14.0, "height": 3.6, "content": "วันที่ได้มา :", "fontSize": 6.8, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#111111", "align": "left", "valign": "center", "lineHeight": 1.35, "zIndex": 2},
            {"id": "default-date", "type": "text", "x": 16.4, "y": 29.0, "width": 39.5, "height": 3.6, "content": "{{AcquisitionDate}}", "fontSize": 6.8, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#111111", "align": "left", "valign": "center", "lineHeight": 1.35, "zIndex": 2},
            {"id": "default-footer", "type": "text", "x": 16.0, "y": 32.8, "width": 36.0, "height": 2.8, "content": "{{footerNote}} {{hotline}}", "fontSize": 5.4, "fontWeight": 600, "fontFamily": "Sarabun", "color": "#111111", "align": "center", "valign": "center", "lineHeight": 1.35, "zIndex": 2},
            {"id": "default-qr", "type": "qr", "x": 57.4, "y": 21.3, "width": 11.5, "height": 11.5, "content": "{{QrUrl}}", "zIndex": 3},
        ],
    }


def _default_template() -> dict[str, Any]:
    return {"id":"gov-asset-default-75x36","name":"ฉลากมาตรฐาน 75 × 36 มม.","isDefault":False,"canvas":{"width":75.2,"height":36,"unit":"mm"},"overflow":"clip","elements":[
        {"id":"e1","type":"rect","x":0,"y":0,"width":75.2,"height":5,"background":"#123d56","zIndex":0},
        {"id":"e2","type":"text","x":2,"y":1,"width":71,"height":3,"content":"{{orgName}}","fontSize":7,"fontWeight":700,"fontFamily":"Sarabun","color":"#ffffff","align":"left","zIndex":1},
        {"id":"e3","type":"text","x":2,"y":7,"width":48,"height":4,"content":"{{AssetNo}}","fontSize":11,"fontWeight":800,"fontFamily":"Sarabun","color":"#123d56","align":"left","zIndex":1},
        {"id":"e4","type":"text","x":2,"y":12,"width":48,"height":7,"content":"{{AssetName}}","fontSize":7,"fontWeight":600,"fontFamily":"Sarabun","color":"#243746","align":"left","zIndex":1},
        {"id":"e5","type":"text","x":2,"y":21,"width":48,"height":4,"content":"{{Location}}","fontSize":6,"fontWeight":500,"fontFamily":"Sarabun","color":"#526574","align":"left","zIndex":1},
        {"id":"e6","type":"qr","x":54,"y":8,"width":18,"height":18,"content":"{{QrUrl}}","zIndex":2}]}


def _migrate_default_70x36_template(db: sqlite3.Connection) -> None:
    row = db.execute(
        "SELECT is_default,elements_json FROM sticker_templates WHERE id=?",
        ("gov-asset-default-70x36",),
    ).fetchone()
    if not row or not row["is_default"]:
        return

    elements = json.loads(row["elements_json"])
    by_id = {element["id"]: element for element in elements}
    changed = False

    def update_legacy_element(
        element_id: str,
        expected: dict[str, Any],
        updates: dict[str, Any],
    ) -> None:
        nonlocal changed
        element = by_id.get(element_id)
        if element and all(element.get(key) == value for key, value in expected.items()):
            element.update(updates)
            changed = True

    address = by_id.get("default-address")
    address_is_legacy = address and all(
        address.get(key) == value
        for key, value in {
            "content": "{{companyAddress}}",
            "y": 8.4,
            "height": 2.0,
            "fontSize": 5.8,
        }.items()
    )
    if address_is_legacy:
        update_legacy_element(
            "default-address",
            {"content": "{{companyAddress}}"},
            {
                "content": "ที่อยู่: {{companyAddress}} {{companyAddress2}} โทร {{companyPhone}}",
                "height": 2.0,
                "fontSize": 4.0,
            },
        )
    address_2 = by_id.get("default-address-2")
    if address_is_legacy and address_2 and all(address_2.get(key) == value for key, value in {
        "content": "{{companyAddress2}} โทร {{companyPhone}}",
        "y": 10.4,
        "height": 1.8,
        "fontSize": 5.8,
    }.items()):
        elements.remove(address_2)
        changed = True

    legacy_geometry_updates = {
        "default-category-label": ({"y": 14.0}, {"x": 19.0, "y": 11.6, "width": 20.0}),
        "default-category": ({"x": 36.0, "y": 14.0}, {"x": 44.0, "y": 11.6, "width": 24.0}),
        "default-code-label": ({"x": 2.4, "y": 17.8}, {"x": 19.0, "y": 16.2, "width": 20.0}),
        "default-code": ({"x": 16.4, "y": 17.8}, {"x": 41.0, "y": 16.2, "width": 27.0}),
        "default-name-label": ({"y": 21.9, "height": 3.8}, {"y": 20.3, "height": 3.0}),
        "default-name": (
            {"x": 16.4, "y": 21.9, "width": 32.5, "height": 7.2, "fontSize": 6.8},
            {"y": 20.3, "width": 39.5, "height": 8.4, "fontSize": 5.2, "valign": "top"},
        ),
        "default-date-label": ({"y": 29.4}, {"y": 29.0}),
        "default-date": ({"y": 29.4, "width": 32.5}, {"y": 29.0, "width": 39.5}),
        "default-footer": ({"y": 33.2}, {"y": 32.3, "height": 2.5}),
    }
    for element_id, (expected, values) in legacy_geometry_updates.items():
        update_legacy_element(element_id, expected, values)

    updates = {
        "default-org-th": (
            {"content": "{{orgName}}", "height": 3.4, "fontSize": 7.2},
            {"height": 3.6, "fontSize": 6.2},
        ),
        "default-org-en": (
            {"content": "{{companyName}}", "y": 5.2, "height": 2.8, "fontSize": 6.2},
            {"y": 5.5, "height": 3.1, "fontSize": 5.8},
        ),
        "default-address": (
            {
                "content": "ที่อยู่: {{companyAddress}} {{companyAddress2}} โทร {{companyPhone}}",
                "y": 8.4,
                "height": 2.0,
            },
            {"y": 9.0, "height": 2.3},
        ),
        "default-header-rule": ({"y": 8.15}, {"y": 8.75}),
        "default-category-label": ({"y": 11.6}, {"y": 12.0}),
        "default-category": ({"y": 11.6}, {"y": 12.0}),
        "default-name-label": ({"height": 3.0}, {"height": 3.4}),
        "default-footer": ({"y": 32.3, "height": 2.5}, {"y": 32.8, "height": 2.8}),
    }
    for element_id, (expected, values) in updates.items():
        update_legacy_element(element_id, expected, values)

    static_header_geometry_updates = {
        "default-org-th": (
            {
                "content": "ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์",
                "height": 3.4,
                "fontSize": 7.2,
            },
            {"height": 3.6, "fontSize": 6.2},
        ),
        "default-org-en": (
            {
                "content": "MEDICAL EDUCATION CENTER OF SURIN HOSPITAL",
                "y": 5.2,
                "height": 2.8,
                "fontSize": 6.2,
            },
            {"y": 5.5, "height": 3.1, "fontSize": 5.8},
        ),
        "default-address": (
            {
                "content": "ที่อยู่: 68 ถ.หลักเมือง ต.ในเมือง อ.เมืองสุรินทร์ จ.สุรินทร์ 32000 โทร 044-518-937",
                "y": 8.4,
                "height": 2.0,
            },
            {"y": 9.0, "height": 2.3},
        ),
    }
    for element_id, (expected, values) in static_header_geometry_updates.items():
        update_legacy_element(element_id, expected, values)

    fixed_header_text = {
        "default-org-th": (
            {"{{orgName}}"},
            "ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์",
        ),
        "default-org-en": (
            {"{{companyName}}"},
            "MEDICAL EDUCATION CENTER OF SURIN HOSPITAL",
        ),
        "default-address": (
            {
                "{{companyAddress}}",
                "ที่อยู่: {{companyAddress}} {{companyAddress2}} โทร {{companyPhone}}",
            },
            "ที่อยู่: 68 ถ.หลักเมือง ต.ในเมือง อ.เมืองสุรินทร์ จ.สุรินทร์ 32000 โทร 044-518-937",
        ),
    }
    for element_id, (legacy_content, fixed_content) in fixed_header_text.items():
        element = by_id.get(element_id)
        if element and element.get("content") in legacy_content:
            element["content"] = fixed_content
            changed = True

    code = by_id.get("default-code")
    if (
        code
        and code.get("content") == "{{AssetNo}}"
        and code.get("x") == 41.0
        and code.get("y") == 16.2
        and code.get("width") == 27.0
        and code.get("fontSize") == 6.8
        and "letterSpacing" not in code
    ):
        code["letterSpacing"] = 0.2
        changed = True

    thai_text_elements = {
        "default-org-th": "ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์",
        "default-org-en": "MEDICAL EDUCATION CENTER OF SURIN HOSPITAL",
        "default-address": "ที่อยู่: 68 ถ.หลักเมือง ต.ในเมือง อ.เมืองสุรินทร์ จ.สุรินทร์ 32000 โทร 044-518-937",
        "default-category-label": "ประเภทครุภัณฑ์ :",
        "default-category": "{{Category}}",
        "default-code-label": "เลขครุภัณฑ์ :",
        "default-code": "{{AssetNo}}",
        "default-name-label": "ชื่อครุภัณฑ์ :",
        "default-name": "{{AssetName}}",
        "default-date-label": "วันที่ได้มา :",
        "default-date": "{{AcquisitionDate}}",
        "default-footer": "{{footerNote}} {{hotline}}",
    }
    for element_id, content in thai_text_elements.items():
        element = by_id.get(element_id)
        if element and element.get("content") == content and element.get("lineHeight", 1.12) == 1.12:
            element["lineHeight"] = 1.35
            changed = True

    name = by_id.get("default-name")
    if name and all(
        name.get(key) == value
        for key, value in {
            "content": "{{AssetName}}",
            "x": 16.4,
            "y": 20.3,
            "width": 39.5,
            "height": 8.4,
            "fontSize": 5.2,
            "lineHeight": 1.35,
        }.items()
    ):
        name["fontSize"] = 5.8
        changed = True

    if changed:
        db.execute(
            "UPDATE sticker_templates SET elements_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (json.dumps(elements, ensure_ascii=False), "gov-asset-default-70x36"),
        )


def _preset_large_templates() -> list[dict[str, Any]]:
    return [
        {
            "id": "medcenter-qr-wall-a6",
            "name": "ป้าย QR A6 · 105 × 148 มม.",
            "isDefault": False,
            "canvas": {"width": 105.0, "height": 148.0, "unit": "mm"},
            "overflow": "clip",
            "elements": [
                {"id": "a6-border", "type": "rect", "x": 3, "y": 3, "width": 99, "height": 142, "background": "#ffffff", "border": "1.5px solid #123d56", "borderRadius": 3, "zIndex": 0},
                {"id": "a6-logo", "type": "image", "x": 8, "y": 7, "width": 18, "height": 18, "source": "/assets/medcenter-logo.png", "zIndex": 2},
                {"id": "a6-org", "type": "text", "x": 28, "y": 8, "width": 70, "height": 10, "content": "ศูนย์แพทยศาสตรศึกษาชั้นคลินิก\nโรงพยาบาลสุรินทร์", "fontSize": 10, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#123d56", "align": "left", "zIndex": 2},
                {"id": "a6-qr", "type": "qr", "x": 20, "y": 30, "width": 65, "height": 65, "content": "{{QrUrl}}", "zIndex": 3},
                {"id": "a6-code", "type": "text", "x": 8, "y": 98, "width": 89, "height": 8, "content": "{{AssetNo}}", "fontSize": 14, "fontWeight": 800, "fontFamily": "Sarabun", "color": "#123d56", "align": "center", "zIndex": 2},
                {"id": "a6-name", "type": "text", "x": 8, "y": 107, "width": 89, "height": 12, "content": "{{AssetName}}", "fontSize": 11, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#172b3a", "align": "center", "zIndex": 2},
                {"id": "a6-loc", "type": "text", "x": 8, "y": 120, "width": 89, "height": 8, "content": "สถานที่ตั้ง: {{Location}}", "fontSize": 9, "fontWeight": 600, "fontFamily": "Sarabun", "color": "#475569", "align": "center", "zIndex": 2},
                {"id": "a6-hot", "type": "text", "x": 8, "y": 131, "width": 89, "height": 9, "content": "สแกน QR เพื่อตรวจสถานะ / แจ้งซ่อม (โทร 21202)", "fontSize": 9, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#0f6f6b", "align": "center", "zIndex": 2},
            ],
        },
        {
            "id": "medcenter-qr-poster-a4",
            "name": "ป้าย QR A4 · 210 × 297 มม.",
            "isDefault": False,
            "canvas": {"width": 210.0, "height": 297.0, "unit": "mm"},
            "overflow": "clip",
            "elements": [
                {"id": "a4-border", "type": "rect", "x": 8, "y": 8, "width": 194, "height": 281, "background": "#ffffff", "border": "2px solid #123d56", "borderRadius": 5, "zIndex": 0},
                {"id": "a4-head-bg", "type": "rect", "x": 8, "y": 8, "width": 194, "height": 38, "background": "#f0f9f8", "border": "none", "borderRadius": 5, "zIndex": 1},
                {"id": "a4-logo", "type": "image", "x": 16, "y": 12, "width": 28, "height": 28, "source": "/assets/medcenter-logo.png", "zIndex": 2},
                {"id": "a4-th", "type": "text", "x": 48, "y": 14, "width": 148, "height": 10, "content": "ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์", "fontSize": 16, "fontWeight": 800, "fontFamily": "Sarabun", "color": "#123d56", "align": "left", "zIndex": 2},
                {"id": "a4-en", "type": "text", "x": 48, "y": 25, "width": 148, "height": 8, "content": "Medical Education Center, Surin Hospital · โทร 044-518-937", "fontSize": 12, "fontWeight": 600, "fontFamily": "Sarabun", "color": "#334155", "align": "left", "zIndex": 2},
                {"id": "a4-qr", "type": "qr", "x": 40, "y": 54, "width": 130, "height": 130, "content": "{{QrUrl}}", "zIndex": 3},
                {"id": "a4-code", "type": "text", "x": 16, "y": 190, "width": 178, "height": 16, "content": "เลขครุภัณฑ์: {{AssetNo}}", "fontSize": 22, "fontWeight": 800, "fontFamily": "Sarabun", "color": "#123d56", "align": "center", "zIndex": 2},
                {"id": "a4-name", "type": "text", "x": 16, "y": 208, "width": 178, "height": 22, "content": "{{AssetName}}", "fontSize": 18, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#111827", "align": "center", "zIndex": 2},
                {"id": "a4-cat", "type": "text", "x": 16, "y": 232, "width": 178, "height": 12, "content": "ประเภท: {{Category}} · วันที่ได้มา: {{AcquisitionDate}}", "fontSize": 13, "fontWeight": 600, "fontFamily": "Sarabun", "color": "#334155", "align": "center", "zIndex": 2},
                {"id": "a4-loc", "type": "text", "x": 16, "y": 246, "width": 178, "height": 12, "content": "จุดติดตั้ง / สถานที่ตั้ง: {{Location}}", "fontSize": 13, "fontWeight": 600, "fontFamily": "Sarabun", "color": "#334155", "align": "center", "zIndex": 2},
                {"id": "a4-hot", "type": "text", "x": 16, "y": 264, "width": 178, "height": 16, "content": "📱 สแกน QR Code เพื่อตรวจสอบสถานะหรือแจ้งครุภัณฑ์ขัดข้อง (โทร 21202)", "fontSize": 14, "fontWeight": 700, "fontFamily": "Sarabun", "color": "#0f6f6b", "align": "center", "zIndex": 2},
            ],
        },
    ]


def ensure_default_template(db: sqlite3.Connection) -> None:
    count = db.execute("SELECT COUNT(*) FROM sticker_templates").fetchone()[0]
    default_tpl = _default_70x36_template()
    if count == 0:
        db.execute(
            "INSERT OR IGNORE INTO sticker_templates(id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active) VALUES(?,?,?,?,?,?,?,1)",
            (default_tpl["id"], default_tpl["name"], 1, default_tpl["canvas"]["width"], default_tpl["canvas"]["height"], default_tpl["overflow"], json.dumps(default_tpl["elements"], ensure_ascii=False)),
        )
        std_tpl = _default_template()
        db.execute(
            "INSERT OR IGNORE INTO sticker_templates(id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active) VALUES(?,?,?,?,?,?,?,0)",
            (std_tpl["id"], std_tpl["name"], 0, std_tpl["canvas"]["width"], std_tpl["canvas"]["height"], std_tpl["overflow"], json.dumps(std_tpl["elements"], ensure_ascii=False)),
        )
    elif not db.execute("SELECT 1 FROM sticker_templates WHERE id=?", (default_tpl["id"],)).fetchone():
        active = db.execute("SELECT id FROM sticker_templates WHERE is_active=1 ORDER BY updated_at DESC,id LIMIT 1").fetchone()
        activate_default = active is None or active["id"] in {"medcenter-brother-36mm-70x36", "gov-asset-default-75x36"}
        db.execute("UPDATE sticker_templates SET is_default=0")
        if activate_default:
            db.execute("UPDATE sticker_templates SET is_active=0")
        db.execute(
            "INSERT OR IGNORE INTO sticker_templates(id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active) VALUES(?,?,?,?,?,?,?,?)",
            (default_tpl["id"], default_tpl["name"], 1, default_tpl["canvas"]["width"], default_tpl["canvas"]["height"], default_tpl["overflow"], json.dumps(default_tpl["elements"], ensure_ascii=False), int(activate_default)),
        )
    db.execute(
        "UPDATE sticker_templates SET name=? WHERE id=? AND name=?",
        ("ฉลากเดิม 70 × 36 มม.", "medcenter-brother-36mm-70x36",
         "ฉลากครุภัณฑ์ ศูนย์แพทยศาสตรศึกษาชั้นคลินิกฯ (Brother 36mm — 70 × 36 มม.)"),
    )
    db.execute(
        "UPDATE sticker_templates SET name=? WHERE id=? AND name=?",
        ("ฉลากเดิม 70 × 36 มม.", "medcenter-brother-36mm-70x36",
         "ฉลากครุภัณฑ์รุ่นก่อน (70 × 36 มม.)"),
    )
    concise_names = {
        "gov-asset-default-70x36": (
            "ฉลากครุภัณฑ์มาตรฐาน (70 × 36 มม.)",
            default_tpl["name"],
        ),
        "gov-asset-default-75x36": (
            "ฉลากครุภัณฑ์มาตรฐาน 75.2 × 36 มม.",
            "ฉลากมาตรฐาน 75 × 36 มม.",
        ),
        "medcenter-qr-wall-a6": (
            "ป้าย QR Smart ติดจุดสังเกต / ผนังห้อง (A6 — 105 × 148 มม.)",
            "ป้าย QR A6 · 105 × 148 มม.",
        ),
        "medcenter-qr-poster-a4": (
            "ป้าย QR Smart เต็มแผ่น A4 — อุปกรณ์บนฝ้า/เพดาน/สแกนระยะไกล (210 × 297 มม.)",
            "ป้าย QR A4 · 210 × 297 มม.",
        ),
    }
    for template_id, (old_name, new_name) in concise_names.items():
        db.execute(
            "UPDATE sticker_templates SET name=? WHERE id=? AND name=?",
            (new_name, template_id, old_name),
        )
    _migrate_default_70x36_template(db)
    for preset in _preset_large_templates():
        if not db.execute("SELECT 1 FROM sticker_templates WHERE id=?", (preset["id"],)).fetchone():
            db.execute(
                "INSERT OR IGNORE INTO sticker_templates(id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active) VALUES(?,?,?,?,?,?,?,0)",
                (preset["id"], preset["name"], 0, preset["canvas"]["width"], preset["canvas"]["height"], preset["overflow"], json.dumps(preset["elements"], ensure_ascii=False)),
            )


def sticker_settings(db: sqlite3.Connection) -> dict[str, str]:
    stored = {row["key"]: row["value"] for row in db.execute("SELECT key,value FROM sticker_settings")}
    organization_name = stored.get("orgName", "")
    if not organization_name:
        organization_name = branding(db)["organization"]
    if organization_name == "หน่วยงานตัวอย่าง":
        organization_name = "ศูนย์แพทยศาสตรศึกษาชั้นคลินิก โรงพยาบาลสุรินทร์"
    return {
        "companyName": stored.get("companyName", "MEDICAL EDUCATION CENTER OF SURIN HOSPITAL"),
        "orgName": organization_name,
        "companyAddress": stored.get("companyAddress", "68 ถ.หลักเมือง ต.ในเมือง อ.เมืองสุรินทร์"),
        "companyAddress2": stored.get("companyAddress2", "จ.สุรินทร์ 32000"),
        "companyPhone": stored.get("companyPhone", "044-518-937"),
        "AssetTerminology": stored.get("AssetTerminology", "ครุภัณฑ์"),
        "footerNote": stored.get("footerNote", "**แจ้งครุภัณฑ์ขัดข้อง"),
        "hotline": stored.get("hotline", "21202**"), "lineOA": stored.get("lineOA", ""),
    }


def _asset_for_sticker(db: sqlite3.Connection, asset_id: int, origin: str = "") -> dict[str, Any] | None:
    ensure_location_hierarchy(db)
    row = db.execute(_inventory_select() + " WHERE a.id=?", (asset_id,)).fetchone()
    if not row:
        return None
    item = _inventory_item(row)
    acq_formatted = _format_thai_short_date(row["linked_acquired_on"])
    warranty_formatted = _format_thai_short_date(row["warranty_end"])
    item.update({"AssetNo": row["code"], "AssetName": item["name"], "AssetSiteCode": row["code"],
                 "Category": item["group"] or row["group_name"] or "", "Group": item["group"] or row["group_name"] or "",
                 "Serial": row["linked_serial_number"] or "", "Type": row["register_asset_type"] or row["asset_type"] or row["category_name"] or "",
                 "Brand":"", "Model":row["linked_model"] or "",
                 "Building": item.get("building") or "", "Floor": item.get("floor") or "", "Room": item.get("room") or "",
                 "Department":row["department_name"] or row["responsible_unit"] or "", "DepartmentCode":"",
                 "Location":item["location"], "Site":row["organization_name"] or "", "ContractNo":row["linked_po_no"] or "",
                 "Vendor":row["vendor_name"] or "", "DeviceStatus":row["status"], "CurrentAssignee":"",
                 "WarrantyEnd": warranty_formatted or (row["warranty_end"] or ""),
                 "AcquisitionDate": acq_formatted or (row["linked_acquired_on"] or ""),
                 "PurchaseDate": acq_formatted or (row["linked_acquired_on"] or ""),
                 "PurchasePrice":row["linked_purchase_price"] or "", "Ip":"", "Mac":"", "QrUrl":qr_url(db, asset_id, origin),
                 "LicenseCount":"", "LicenseList":""})
    return item


def _substitute(text: str, values: dict[str, Any]) -> str:
    return re.sub(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}", lambda m: str(values.get(m.group(1), "") or ""), text or "")


def _qr_data_uri(value: str) -> str:
    if not value:
        return ""
    if qrcode is None or SvgPathImage is None:
        raise RuntimeError("ยังไม่ได้ติดตั้ง qrcode; ติดตั้งด้วย pip install qrcode")
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=4, border=4)
    qr.add_data(value)
    qr.make(fit=True)
    svg = qr.make_image(image_factory=SvgPathImage).to_string(encoding="utf-8")
    return "data:image/svg+xml;base64," + base64.b64encode(svg).decode("ascii")


def _style_num(value: Any, default: float = 0) -> float:
    try:
        return max(-10000, min(10000, float(value)))
    except (TypeError, ValueError):
        return default


def render_sticker(template: dict[str, Any], asset: dict[str, Any], settings: dict[str, str], scale: float = 1.0) -> str:
    canvas = template["canvas"]
    width = _style_num(canvas.get("width"), 75.2) * scale
    height = _style_num(canvas.get("height"), 36) * scale
    overflow = "visible" if template.get("overflow") == "visible" else "hidden"
    values = {**settings, **asset, "AssetTerminology": settings.get("AssetTerminology", "ครุภัณฑ์")}
    nodes: list[str] = []
    for element in sorted(template.get("elements", []), key=lambda el: _style_num(el.get("zIndex"), 0)):
        kind = element.get("type")
        if kind not in ELEMENT_TYPES:
            continue
        x, y, w, h = (_style_num(element.get(key), 0) * scale for key in ("x", "y", "width", "height"))
        opacity = max(0, min(1, _style_num(element.get("opacity"), 1)))
        rotate = _style_num(element.get("rotation"), 0)
        styles = [f"position:absolute", f"left:{x:g}mm", f"top:{y:g}mm", f"width:{w:g}mm", f"height:{h:g}mm", f"z-index:{int(_style_num(element.get('zIndex'),0))}", f"opacity:{opacity:g}", "box-sizing:border-box", f"transform:rotate({rotate:g}deg)", "transform-origin:center center"]
        if kind == "rect":
            background = str(element.get("background") or "transparent")
            border = str(element.get("border") or "none")
            radius = max(0, _style_num(element.get("borderRadius"), 0) * scale)
            styles += [f"background:{background}", f"border:{border}", f"border-radius:{radius:g}mm"]
            nodes.append(f'<div class="sticker-node sticker-rect" style="{html.escape(";".join(styles),quote=True)}"></div>')
        elif kind == "qr":
            content = str(element.get("content") or "{{QrUrl}}")
            if re.search(r"\{\{\s*[Qq]rUrl\s*\}\}", content) and values.get("QrUrl"):
                qr_text = str(values["QrUrl"])
            else:
                qr_text = _substitute(content, values) or str(asset.get("code") or "")
            src = _qr_data_uri(qr_text)
            styles += ["display:flex", "align-items:center", "justify-content:center", "background:#fff"]
            nodes.append(f'<div class="sticker-node sticker-qr" style="{html.escape(";".join(styles),quote=True)}"><img alt="QR" src="{html.escape(src,quote=True)}" style="width:100%;height:100%;object-fit:contain"></div>')
        elif kind == "image":
            src = str(element.get("source") or element.get("content") or "")
            src = _substitute(src, values)
            if not (src.startswith("https://") or src.startswith("data:image/") or src.startswith("/assets/")):
                src = ""
            styles += ["object-fit:contain"]
            nodes.append(f'<img class="sticker-node" alt="" src="{html.escape(src,quote=True)}" style="{html.escape(";".join(styles),quote=True)}">')
        else:
            text = _substitute(str(element.get("content") or ""), values)
            font_size = max(1, min(180, _style_num(element.get("fontSize"), 7) * scale))
            font_weight = int(max(100, min(900, _style_num(element.get("fontWeight"), 500))))
            font_family_key = str(element.get("fontFamily") or "Sarabun")
            font_family_css = ALLOWED_FONTS.get(font_family_key, ALLOWED_FONTS["Sarabun"])
            color = str(element.get("color") or "#172b3a")
            align = element.get("align") if element.get("align") in {"left", "center", "right"} else "left"
            valign = element.get("valign") if element.get("valign") in {"top", "center", "bottom"} else "top"
            line_height = max(1.0, min(2.0, _style_num(element.get("lineHeight"), 1.12)))
            letter_spacing = max(-2.0, min(2.0, _style_num(element.get("letterSpacing"), 0)))
            styles += ["display:flex", f"align-items:{'flex-start' if valign=='top' else 'center' if valign=='center' else 'flex-end'}", f"justify-content:{'flex-start' if align=='left' else 'center' if align=='center' else 'flex-end'}", f"text-align:{align}", f"font-size:{font_size:g}pt", f"font-weight:{font_weight}", f"color:{color}", f"font-family:{font_family_css}", f"line-height:{line_height:g}", f"letter-spacing:{letter_spacing:g}mm", "white-space:pre-wrap", "word-break:break-word", "overflow:hidden"]
            nodes.append(f'<div class="sticker-node sticker-text" style="{html.escape(";".join(styles),quote=True)}">{html.escape(text)}</div>')
    return f'<div class="sticker-page" style="width:{width:g}mm;height:{height:g}mm;position:relative;overflow:{overflow};background:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact">{"".join(nodes)}</div>'


def print_document(labels: list[str], template: dict[str, Any], paper_layout: str = "label") -> str:
    width = _style_num(template["canvas"].get("width"), 75.2)
    height = _style_num(template["canvas"].get("height"), 36)
    font_links = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;600;700&family=Prompt:wght@400;600;700&family=Sarabun:wght@400;600;700;800&display=swap" rel="stylesheet">'
    if paper_layout == "a4-grid":
        cols = max(1, int(200 // max(10, width)))
        rows_per_page = max(1, int(285 // max(10, height)))
        per_page = max(1, cols * rows_per_page)
        sheets = []
        for i in range(0, len(labels), per_page):
            chunk = labels[i : i + per_page]
            cells = "".join(f'<div class="sticker-grid-cell">{lbl}</div>' for lbl in chunk)
            sheets.append(f'<section class="sticker-a4-sheet">{cells}</section>')
        return f'''<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>พิมพ์สติกเกอร์ครุภัณฑ์ (เรียงบน A4)</title>{font_links}<style>
@page{{size:210mm 297mm;margin:5mm}}*{{box-sizing:border-box}}html,body{{margin:0;padding:0;background:#fff;color:#111;font-family:'Sarabun',Tahoma,Arial,sans-serif}}.sticker-a4-sheet{{width:200mm;min-height:285mm;display:flex;flex-wrap:wrap;align-content:flex-start;gap:2mm;break-after:page;page-break-after:always}}.sticker-a4-sheet:last-child{{break-after:auto;page-break-after:auto}}.sticker-grid-cell{{border:0.25mm dashed #cbd5e1;break-inside:avoid;page-break-inside:avoid}}@media screen{{body{{padding:16px;background:#eef2f4}}.sticker-a4-sheet{{margin:0 auto 16px;padding:5mm;background:#fff;box-shadow:0 1px 8px #0002}}}}
</style></head><body>{"".join(sheets)}</body></html>'''
    pages = "".join(f'<section class="sticker-sheet">{label}</section>' for label in labels)
    return f'''<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>พิมพ์สติกเกอร์ครุภัณฑ์</title>{font_links}<style>
@page{{size:{width:g}mm {height:g}mm;margin:0}}*{{box-sizing:border-box}}html,body{{margin:0;padding:0;background:#fff;color:#111;font-family:'Sarabun',Tahoma,Arial,sans-serif}}.sticker-sheet{{width:{width:g}mm;height:{height:g}mm;break-after:page;page-break-after:always;overflow:hidden}}.sticker-sheet:last-child{{break-after:auto;page-break-after:auto}}.sticker-page{{break-inside:avoid;page-break-inside:avoid}}@media screen{{body{{padding:16px;background:#eef2f4}}.sticker-sheet{{margin:0 auto 16px;box-shadow:0 1px 8px #0002}}}}@media print{{html,body{{width:{width:g}mm;margin:0;padding:0}}}}
</style></head><body>{pages}</body></html>'''


def save_template(db: sqlite3.Connection, body: dict) -> dict[str, Any]:
    tpl = body.get("template") if isinstance(body.get("template"), dict) else body
    canvas = tpl.get("canvas") if isinstance(tpl.get("canvas"), dict) else {}
    width, height = _style_num(canvas.get("width"),75.2), _style_num(canvas.get("height"),36)
    if not (5 <= width <= 500 and 5 <= height <= 500):
        return {"error":"ขนาดกระดาษต้องอยู่ระหว่าง 5–500 มม."}, 400
    elements = tpl.get("elements", [])
    if not isinstance(elements,list) or len(elements)>80:
        return {"error":"เทมเพลตมีองค์ประกอบได้ไม่เกิน 80 รายการ"}, 400
    normalized=[]
    for idx,el in enumerate(elements):
        if not isinstance(el,dict) or el.get("type") not in ELEMENT_TYPES:
            return {"error":f"ชนิดองค์ประกอบลำดับ {idx+1} ไม่รองรับ"}, 400
        normalized.append({**el,"id":str(el.get("id") or f"el-{time.time_ns()}-{idx}"),"x":_style_num(el.get("x")),"y":_style_num(el.get("y")),"width":max(.2,_style_num(el.get("width"),5)),"height":max(.2,_style_num(el.get("height"),5))})
    template_id = str(tpl.get("id") or f"tpl-{time.time_ns()}")[:100]
    name = str(tpl.get("name") or "เทมเพลตใหม่").strip()[:120] or "เทมเพลตใหม่"
    duplicate = db.execute(
        "SELECT 1 FROM sticker_templates WHERE id != ? AND name = ? COLLATE NOCASE LIMIT 1",
        (template_id, name),
    ).fetchone()
    if duplicate:
        return {"error": "มีชื่อเทมเพลตนี้แล้ว กรุณาตั้งชื่อให้ต่างกัน"}, 409
    overflow = "visible" if tpl.get("overflow")=="visible" else "clip"
    active = bool(body.get("isActive",tpl.get("isActive",False)))
    if active:
        db.execute("UPDATE sticker_templates SET is_active=0")
    db.execute("""INSERT INTO sticker_templates(id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active,updated_at)
        VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET name=excluded.name,is_default=excluded.is_default,canvas_width_mm=excluded.canvas_width_mm,canvas_height_mm=excluded.canvas_height_mm,overflow=excluded.overflow,elements_json=excluded.elements_json,is_active=excluded.is_active,updated_at=CURRENT_TIMESTAMP""", (template_id,name,int(bool(tpl.get("isDefault"))),width,height,overflow,json.dumps(normalized,ensure_ascii=False),int(active)))
    row = db.execute("SELECT * FROM sticker_templates WHERE id=?",(template_id,)).fetchone()
    return _template_dict(row)


def _make_print_job(db: sqlite3.Connection, body: dict) -> dict[str, Any] | tuple[dict[str,str],int]:
    ids=body.get("assetIds",body.get("asset_ids",[]))
    if not ids and body.get("assetId") is not None:
        ids=[body.get("assetId")]
    if not ids and body.get("assetNo"):
        matches=db.execute("SELECT id FROM assets WHERE code=? ORDER BY id LIMIT 2",(str(body["assetNo"]),)).fetchall()
        if len(matches)>1: raise ValueError("เลขตรงหลายบัญชีหรือหลายชิ้น กรุณาเลือกด้วยรายการครุภัณฑ์")
        ids=[matches[0]["id"]] if matches else []
    if not isinstance(ids,list) or not ids:
        return {"error":"กรุณาเลือกครุภัณฑ์อย่างน้อย 1 รายการ"},400
    if len(ids)>MAX_PRINT_BATCH:
        return {"error":f"พิมพ์ครั้งละไม่เกิน {MAX_PRINT_BATCH} รายการ"},400
    try:
        ids=[int(value) for value in ids]
    except (ValueError,TypeError):
        return {"error":"รายการครุภัณฑ์ไม่ถูกต้อง"},400
    ensure_default_template(db)
    template_row=_read_template(db,str(body.get("templateId") or body.get("template_id") or "") or None)
    if not template_row:
        template_row=_read_template(db)
    template=_template_dict(template_row)
    paper_layout = str(body.get("paperLayout") or "label")
    scale = 1.0
    width, height = float(template["canvas"]["width"]), float(template["canvas"]["height"])
    target_dims = {"a4-full": (210.0, 297.0), "a5-full": (148.0, 210.0), "a6-full": (105.0, 148.0)}.get(paper_layout)
    if target_dims:
        tw, th = target_dims
        if width > height:
            tw, th = max(tw, th), min(tw, th)
        scale = min(tw / max(1.0, width), th / max(1.0, height))
        template = {**template, "canvas": {"width": round(width * scale, 1), "height": round(height * scale, 1), "unit": "mm"}}
        width, height = template["canvas"]["width"], template["canvas"]["height"]
    settings=sticker_settings(db)
    actor=str(body.get("requestedBy") or body.get("actor") or "ผู้ปฏิบัติงาน")[:120]
    selected=[]
    for asset_id in ids:
        item=_asset_for_sticker(db,asset_id,body.get("baseUrl", ""))
        if item:
            selected.append((asset_id,item))
    if not selected:
        return {"error":"ไม่พบครุภัณฑ์ที่เลือก"},404
    cur=db.execute("INSERT INTO sticker_print_jobs(template_id,item_count,canvas_width_mm,canvas_height_mm,requested_by) VALUES(?,?,?,?,?)",(template["id"],len(selected),width,height,actor))
    job_id=int(cur.lastrowid)
    rendered=[]
    for order,(asset_id,item) in enumerate(selected,1):
        db.execute("INSERT INTO sticker_print_job_items(print_job_id,asset_id,label_order) VALUES(?,?,?)",(job_id,asset_id,order))
        rendered.append(render_sticker(template,item,settings,scale=scale))
    return {"jobId":job_id,"count":len(rendered),"template":template,"html":print_document(rendered,template,paper_layout=paper_layout)}


def handle(db: sqlite3.Connection, method: str, path: str, query: dict, body: dict):
    """Return None for unrelated routes; otherwise return API payload/status."""
    try:
        master_data = handle_master_data(db, method, path, query, body)
    except ValueError as exc:
        return {"error": str(exc)}, 400
    if master_data is not None:
        return master_data
    wording=handle_guidance(db,method,path,query,body)
    if wording is not None:
        return wording
    if method=="GET" and path=="/api/inventory":
        return inventory(db,query)
    if method=="GET" and path=="/api/inventory/facets":
        return inventory_facets(db,query)
    if method=="POST" and path=="/api/inventory/bulk-location":
        return bulk_update_location(db,body)
    if method=="GET" and path=="/api/register/featured":
        row=db.execute("SELECT r.asset_id FROM asset_register_details r JOIN assets a ON a.id=r.asset_id WHERE "+scope_sql(db)+" ORDER BY r.id DESC LIMIT 1").fetchone()
        if not row:
            row=db.execute("SELECT id AS asset_id FROM assets a WHERE "+scope_sql(db)+" ORDER BY id LIMIT 1").fetchone()
        result=asset_register(db,int(row["asset_id"])) if row else None
        return result if result else ({"error":"ยังไม่มีรายการครุภัณฑ์ในฐานข้อมูล"},404)
    if method=="GET" and path=="/api/catalog/categories":
        return [dict(row) for row in db.execute("SELECT id,category_name AS name,source_workbook AS source,notes FROM asset_categories ORDER BY category_name")]
    if method=="GET" and path=="/api/catalog/numbering":
        return get_catalog(db,query)
    if method=="POST" and path=="/api/catalog/fsn/link":
        if body.get("actor") != "เจ้าหน้าที่พัสดุ":
            return {"error":"ใช้บทบาทเจ้าหน้าที่พัสดุเพื่อกำหนดรหัสของหมวด"},403
        if type(body.get('itemId')) is not int:
            return {"error":"กรุณาเลือกรหัสจากบัญชีหน่วยงาน"},400
        row=db.execute("SELECT f.id,f.canonical_fsn_code FROM fsn_catalog_items f JOIN source_documents s ON s.id=f.source_document_id WHERE f.id=? AND s.source_kind='agency_fsn'",(body['itemId'],)).fetchone()
        reference=str(body.get('reference') or '').strip()
        if not row or not reference or len(reference)>1000:
            return {"error":"เลือกรหัสบัญชีหน่วยงานและหลักฐานการใช้กับหมวดนี้"},400
        db.execute('BEGIN IMMEDIATE')
        try:
            link_code(db,body.get('categoryId'),row['canonical_fsn_code'],row['id'],reference,body['actor'])
        except ValueError as exc:
            return {"error":str(exc)},400
        return {"ok":True},201
    if method=="POST" and path=="/api/catalog/fsn":
        if body.get("actor") != "เจ้าหน้าที่พัสดุ":
            return {"error":"การเพิ่มบัญชีรหัสต้องใช้บทบาทเจ้าหน้าที่พัสดุในโหมดทดสอบ"},403
        code=str(body.get("code", "")).strip()
        name=" ".join(str(body.get("name", "")).split())
        reference=" ".join(str(body.get("reference", "")).split())
        if not re.fullmatch(r"[0-9]{4}-[0-9]{3}-[0-9]{4}",code):
            return {"error":"รหัส FSN ต้องเป็น 4-3-4 หลัก เช่น 7110-002-0001"},400
        if not name or len(name)>300 or not reference or len(reference)>1000:
            return {"error":"กรุณาระบุชื่อ/รายละเอียดไม่เกิน 300 ตัวอักษร และหลักฐานอ้างอิงไม่เกิน 1,000 ตัวอักษร"},400
        category_id=body.get('categoryId')
        if category_id is not None and (type(category_id) is not int or not db.execute("SELECT 1 FROM asset_categories WHERE id=? AND is_active=1",(category_id,)).fetchone()):
            return {"error":"กรุณาเลือกหมวดที่ใช้งานสำหรับรหัสนี้"},400
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM fsn_catalog_items f JOIN source_documents s ON s.id=f.source_document_id WHERE f.canonical_fsn_code=? AND s.source_kind='agency_fsn'",(code,)).fetchone():
            return {"error":"มีรหัส FSN นี้ในบัญชีหน่วยงานแล้ว ให้ใช้รหัสเดิมเมื่อเป็นคุณลักษณะเดียวกัน"},409
        db.execute("INSERT OR IGNORE INTO source_documents(filename,title,source_kind,source_scope,extraction_method) VALUES(?,?,?,?,?)",("agency-fsn-register","บัญชีรหัส FSN ที่หน่วยงานกำหนด","agency_fsn","กำหนดโดยเจ้าหน้าที่หน่วยงาน","บันทึกผ่านหน้าตั้งค่า"))
        source=db.execute("SELECT id FROM source_documents WHERE filename='agency-fsn-register' AND sha256='' ORDER BY id LIMIT 1").fetchone()[0]
        group,kind,description=code.split("-")
        cur=db.execute("INSERT INTO fsn_catalog_items(source_document_id,category_code,type_code,item_name,canonical_fsn_code,raw_line) VALUES(?,?,?,?,?,?)",(source,group,kind,name,code,json.dumps({"reference":reference,"actor":body["actor"]},ensure_ascii=False)))
        if category_id is not None:
            link_code(db,category_id,code,cur.lastrowid,reference,body['actor'])
        return {"id":cur.lastrowid,"fullCode":code,"name":name,"reference":reference,"categoryId":category_id},201
    if method=="GET" and path=="/api/catalog/fsn":
        q=_one(query,"q").strip();limit=_safe_limit(query);offset=_safe_offset(query)
        official=int(db.execute("SELECT COUNT(*) FROM fsn_catalog_items").fetchone()[0])
        if official==0:
            where=" WHERE r.type_name LIKE ? OR r.fsn_code LIKE ? OR c.category_name LIKE ?" if q else ""
            args=[f"%{q}%"]*3 if q else []
            total=int(db.execute("SELECT COUNT(*) FROM starter_catalog_rows r JOIN asset_categories c ON c.id=r.category_id"+where,args).fetchone()[0])
            rows=db.execute(
                """SELECT r.rowid AS id, NULL AS page, '' AS groupNo, c.category_name AS groupTitle,
                          r.type_name AS name, r.fsn_code AS fullCode, s.title AS sourceTitle, s.source_kind AS sourceKind
                   FROM starter_catalog_rows r
                   JOIN asset_categories c ON c.id=r.category_id
                   JOIN source_documents s ON s.id=r.source_document_id"""
                + where + " ORDER BY r.fsn_code, r.type_name LIMIT ? OFFSET ?",
                (*args, limit, offset),
            ).fetchall()
            items=[]
            for row in rows:
                item=dict(row)
                code=item.get("fullCode") or ""
                parts=code.split("-") if re.fullmatch(r"[0-9]{4}-[0-9]{3}-[0-9]{4}", code) else ["", "", ""]
                item["categoryCode"]=parts[0]
                item["typeCode"]=parts[1]
                item["reference"]=""
                items.append(item)
            return {"items":items,"total":total,"limit":limit,"offset":offset}
        where=" WHERE f.item_name LIKE ? OR f.category_code LIKE ? OR f.type_code LIKE ? OR f.canonical_fsn_code LIKE ?" if q else ""
        args=[f"%{q}%"]*4 if q else []
        total=int(db.execute("SELECT COUNT(*) FROM fsn_catalog_items f"+where,args).fetchone()[0])
        rows=db.execute("SELECT f.id,f.source_page AS page,f.group_no AS groupNo,f.group_title AS groupTitle,f.category_code AS categoryCode,f.type_code AS typeCode,f.item_name AS name,f.canonical_fsn_code AS fullCode,s.title AS sourceTitle,s.source_kind AS sourceKind,f.raw_line AS referenceData FROM fsn_catalog_items f JOIN source_documents s ON s.id=f.source_document_id"+where+" ORDER BY f.category_code,f.type_code,f.item_name LIMIT ? OFFSET ?",(*args,limit,offset)).fetchall()
        items=[]
        for row in rows:
            item=dict(row)
            raw=item.pop("referenceData")
            item["reference"]=json.loads(raw).get("reference", "") if item["sourceKind"]=="agency_fsn" else ""
            items.append(item)
        return {"items":items,"total":total,"limit":limit,"offset":offset}
    if method=="GET" and path=="/api/catalog/depreciation":
        rows=db.execute("SELECT id,rule_no AS ruleNo,category_name AS category,useful_life_years AS years,annual_rate_percent AS annualRate,scope,note,source_page AS sourcePage FROM depreciation_policies ORDER BY CAST(rule_no AS REAL),rule_no").fetchall()
        return {"items":[dict(row) for row in rows],"total":len(rows)}
    if method=="GET" and path=="/api/catalog/sources":
        return [dict(row) for row in db.execute("SELECT id,filename,title,source_kind AS sourceKind,source_scope AS sourceScope,extraction_method AS extractionMethod,notes FROM source_documents s WHERE s.source_kind IN ('fsn_manual','starter_catalog','reference') OR EXISTS(SELECT 1 FROM assets a WHERE a.source_document_id=s.id AND "+scope_sql(db)+") ORDER BY s.id")]
    match=re.fullmatch(r"/api/assets/(\d+)/register",path)
    if method=="GET" and match:
        result=asset_register(db,int(match.group(1)))
        return result if result else ({"error":"ไม่พบครุภัณฑ์"},404)
    if method=="GET" and path=="/api/sticker/templates":
        ensure_default_template(db)
        rows=[_template_dict(row) for row in db.execute("SELECT * FROM sticker_templates ORDER BY is_active DESC,is_default DESC,created_at,id")]
        active=next((item["id"] for item in rows if item["isActive"]),None)
        return {"templates":rows,"activeId":active}
    if method=="POST" and path=="/api/sticker/templates":
        result=save_template(db,body)
        return result
    if method=="GET" and path=="/api/sticker/settings":
        return sticker_settings(db)
    if method=="POST" and path=="/api/sticker/settings":
        allowed={"companyName","orgName","companyAddress","companyAddress2","companyPhone","AssetTerminology","footerNote","hotline","lineOA"}
        for key,value in body.items():
            if key in allowed:
                db.execute("INSERT INTO sticker_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",(key,str(value)[:300]))
        return sticker_settings(db)
    if method=="POST" and path in {"/api/sticker/render","/api/sticker/bulk-render","/api/sticker/print"}:
        result=_make_print_job(db,body)
        return result
    return None
