"""Relational inventory, source lookup, register, and ITAM-style sticker APIs."""
from __future__ import annotations

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


def _inventory_select() -> str:
    return """SELECT a.id,a.name,a.detail,a.code,a.group_name,a.location,a.acquired_year,a.status,a.icon,a.created_at,a.created_by,a.category_id,
        a.fsn_code,a.old_asset_code,a.maintenance_status,a.asset_status_source,a.asset_type,a.fiscal_year_th,a.acquisition_date,a.delivery_date,
        a.acquisition_method,a.purchase_price,a.gfmis_no,a.po_no,a.model,a.serial_number,a.useful_life_years,a.depreciation_policy_id,
        a.depreciation_value,a.accumulated_depreciation,a.net_book_value,a.valuation_date,a.remaining_days,a.is_loaned,a.loan_price,
        a.latest_update,a.delivery_note_no,a.source_document_id,a.source_row_no,a.numbering_account_id,a.branch_id,a.numbering_profile_id,
        c.category_name,account.name AS account_name,branch.name AS branch_name,org.name AS organization_name,dept.name AS department_name,responsible.name AS responsible_unit,
        reg.description AS register_description,reg.asset_type AS register_asset_type,reg.model AS register_model,
        reg.location AS register_location,reg.vendor_name,reg.vendor_address,reg.vendor_phone,
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
        (SELECT id FROM asset_register_details r2 WHERE r2.asset_id=a.id ORDER BY r2.id DESC LIMIT 1) AS register_id
      FROM assets a
      LEFT JOIN asset_profiles profile ON profile.asset_id=a.id
      LEFT JOIN asset_categories c ON c.id=a.category_id
      LEFT JOIN organizations org ON org.id=a.organization_id
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
    return {
        "id": row["id"], "name": name, "detail": row["detail"] or row["register_description"] or "",
        "code": row["code"], "group": row["category_name"] or row["group_name"], "location": location,
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
        "netBookValue": row["linked_net_book_value"], "hasRegister": bool(row["register_id"]),
        "sourceDocumentId": row["source_document_id"], "sourceRowNo": row["source_row_no"],
    }


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
    text = _one(query, "q").strip()
    if text:
        like = f"%{text}%"
        searchable = ["a.fsn_code", "a.name", "a.detail", "a.code", "a.old_asset_code", "a.group_name", "a.location", "a.gfmis_no", "a.po_no", "a.model", "a.serial_number", "a.asset_type", "c.category_name", "org.name", "dept.name", "responsible.name", "account.name", "branch.name"]
        searchable_terms = [f"COALESCE({column},'') LIKE ?" for column in searchable]
        searchable_terms.append("EXISTS(SELECT 1 FROM asset_register_details rr WHERE rr.asset_id=a.id AND (rr.vendor_name LIKE ? OR rr.description LIKE ?))")
        values.extend([like] * len(searchable))
        values.extend([like, like])
        if len(text) >= 3:
            searchable_terms.append("a.id IN (SELECT sr.asset_id FROM source_row_search fts JOIN source_row_records sr ON sr.id=fts.rowid WHERE fts.raw_data_json LIKE ?)")
            values.append(like)
        terms.append("(" + " OR ".join(searchable_terms) + ")")
    status = _one(query, "status")
    if status and status != "all":
        terms.append("a.status=?")
        values.append(status)
    category = _one(query, "category")
    if category:
        try:
            terms.append("a.category_id=?")
            values.append(int(category))
        except ValueError:
            terms.append("c.category_name LIKE ?")
            values.append(f"%{category}%")
    if _one(query,"hasRegister").lower() in {"1","true","yes"}:
        terms.append("EXISTS(SELECT 1 FROM asset_register_details rr WHERE rr.asset_id=a.id)")
    return (" WHERE " + " AND ".join(terms) if terms else ""), values


def inventory(db: sqlite3.Connection, query: dict) -> dict[str, Any]:
    where, values = _where(query)
    total = int(db.execute("SELECT COUNT(*) FROM assets a LEFT JOIN asset_categories c ON c.id=a.category_id LEFT JOIN organizations org ON org.id=a.organization_id LEFT JOIN org_units dept ON dept.id=a.department_unit_id LEFT JOIN org_units responsible ON responsible.id=a.responsible_unit_id" + where, values).fetchone()[0])
    limit, offset = _safe_limit(query), _safe_offset(query)
    rows = db.execute(_inventory_select() + where + " ORDER BY CASE WHEN a.code='' THEN 1 ELSE 0 END,a.code,a.id LIMIT ? OFFSET ?", (*values, limit, offset)).fetchall()
    return {"items": [_inventory_item(row) for row in rows], "total": total, "limit": limit, "offset": offset}


def asset_detail(db: sqlite3.Connection, asset_id: int) -> dict[str, Any] | None:
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


def _read_template(db: sqlite3.Connection, template_id: str | None = None) -> sqlite3.Row | None:
    if template_id:
        return db.execute("SELECT * FROM sticker_templates WHERE id=?", (template_id,)).fetchone()
    return db.execute("SELECT * FROM sticker_templates ORDER BY is_active DESC,is_default DESC,created_at,id LIMIT 1").fetchone()


def _default_template() -> dict[str, Any]:
    return {"id":"gov-asset-default-75x36","name":"ฉลากครุภัณฑ์มาตรฐาน 75.2 × 36 มม.","isDefault":True,"canvas":{"width":75.2,"height":36,"unit":"mm"},"overflow":"clip","elements":[
        {"id":"e1","type":"rect","x":0,"y":0,"width":75.2,"height":5,"background":"#123d56","zIndex":0},
        {"id":"e2","type":"text","x":2,"y":1,"width":71,"height":3,"content":"{{orgName}}","fontSize":7,"fontWeight":700,"color":"#ffffff","align":"left","zIndex":1},
        {"id":"e3","type":"text","x":2,"y":7,"width":48,"height":4,"content":"{{AssetNo}}","fontSize":11,"fontWeight":800,"color":"#123d56","align":"left","zIndex":1},
        {"id":"e4","type":"text","x":2,"y":12,"width":48,"height":7,"content":"{{AssetName}}","fontSize":7,"fontWeight":600,"color":"#243746","align":"left","zIndex":1},
        {"id":"e5","type":"text","x":2,"y":21,"width":48,"height":4,"content":"{{Location}}","fontSize":6,"fontWeight":500,"color":"#526574","align":"left","zIndex":1},
        {"id":"e6","type":"qr","x":54,"y":8,"width":18,"height":18,"content":"{{QrUrl}}","zIndex":2}]}


def ensure_default_template(db: sqlite3.Connection) -> None:
    if db.execute("SELECT COUNT(*) FROM sticker_templates").fetchone()[0]:
        return
    tpl = _default_template()
    db.execute("INSERT OR IGNORE INTO sticker_templates(id,name,is_default,canvas_width_mm,canvas_height_mm,overflow,elements_json,is_active) VALUES(?,?,?,?,?,?,?,1)", (tpl["id"],tpl["name"],1,tpl["canvas"]["width"],tpl["canvas"]["height"],tpl["overflow"],json.dumps(tpl["elements"],ensure_ascii=False)))


def sticker_settings(db: sqlite3.Connection) -> dict[str, str]:
    stored = {row["key"]: row["value"] for row in db.execute("SELECT key,value FROM sticker_settings")}
    org = db.execute("SELECT name FROM organizations ORDER BY id LIMIT 1").fetchone()
    return {
        "companyName": stored.get("companyName", "หน่วยงานภาครัฐ"),
        "orgName": stored.get("orgName", branding(db)["organization"]),
        "AssetTerminology": stored.get("AssetTerminology", "ครุภัณฑ์"),
        "footerNote": stored.get("footerNote", "เอกสารต้นแบบเพื่อทดลอง"),
        "hotline": stored.get("hotline", ""), "lineOA": stored.get("lineOA", ""),
    }


def _asset_for_sticker(db: sqlite3.Connection, asset_id: int, origin: str = "") -> dict[str, Any] | None:
    row = db.execute(_inventory_select() + " WHERE a.id=?", (asset_id,)).fetchone()
    if not row:
        return None
    item = _inventory_item(row)
    item.update({"AssetNo": row["code"], "AssetName": item["name"], "AssetSiteCode": row["code"],
                 "Serial": row["linked_serial_number"] or "", "Type": row["register_asset_type"] or row["asset_type"] or row["category_name"] or "",
                 "Brand":"", "Model":row["linked_model"] or "", "Building":"", "Floor":"", "Room":"",
                 "Department":row["department_name"] or row["responsible_unit"] or "", "DepartmentCode":"",
                 "Location":item["location"], "Site":row["organization_name"] or "", "ContractNo":row["linked_po_no"] or "",
                 "Vendor":row["vendor_name"] or "", "DeviceStatus":row["status"], "CurrentAssignee":"",
                 "WarrantyEnd":row["warranty_end"] or "", "PurchaseDate":row["linked_acquired_on"] or "",
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


def render_sticker(template: dict[str, Any], asset: dict[str, Any], settings: dict[str, str]) -> str:
    canvas = template["canvas"]
    width, height = _style_num(canvas.get("width"),75.2), _style_num(canvas.get("height"),36)
    overflow = "visible" if template.get("overflow") == "visible" else "hidden"
    values = {**settings, **asset, "AssetTerminology":settings.get("AssetTerminology","ครุภัณฑ์")}
    nodes: list[str] = []
    for element in sorted(template.get("elements",[]), key=lambda el: _style_num(el.get("zIndex"),0)):
        kind = element.get("type")
        if kind not in ELEMENT_TYPES:
            continue
        x,y,w,h = (_style_num(element.get(key),0) for key in ("x","y","width","height"))
        opacity = max(0,min(1,_style_num(element.get("opacity"),1)))
        rotate = _style_num(element.get("rotation"),0)
        styles = [f"position:absolute",f"left:{x:g}mm",f"top:{y:g}mm",f"width:{w:g}mm",f"height:{h:g}mm",f"z-index:{int(_style_num(element.get('zIndex'),0))}",f"opacity:{opacity:g}","box-sizing:border-box",f"transform:rotate({rotate:g}deg)","transform-origin:center center"]
        if kind == "rect":
            background = str(element.get("background") or "transparent")
            border = str(element.get("border") or "none")
            radius = max(0,_style_num(element.get("borderRadius"),0))
            styles += [f"background:{background}",f"border:{border}",f"border-radius:{radius:g}mm"]
            nodes.append(f'<div class="sticker-node sticker-rect" style="{html.escape(";".join(styles),quote=True)}"></div>')
        elif kind == "qr":
            qr_text = _substitute(str(element.get("content") or "{{QrUrl}}"), values) or str(asset.get("code") or "")
            src = _qr_data_uri(qr_text)
            styles += ["display:flex","align-items:center","justify-content:center","background:#fff"]
            nodes.append(f'<div class="sticker-node sticker-qr" style="{html.escape(";".join(styles),quote=True)}"><img alt="QR" src="{html.escape(src,quote=True)}" style="width:100%;height:100%;object-fit:contain"></div>')
        elif kind == "image":
            src = str(element.get("source") or element.get("content") or "")
            src = _substitute(src,values)
            if not (src.startswith("https://") or src.startswith("data:image/")):
                src = ""
            styles += ["object-fit:contain"]
            nodes.append(f'<img class="sticker-node" alt="" src="{html.escape(src,quote=True)}" style="{html.escape(";".join(styles),quote=True)}">')
        else:
            text = _substitute(str(element.get("content") or ""), values)
            font_size = max(1,min(72,_style_num(element.get("fontSize"),7)))
            font_weight = int(max(100,min(900,_style_num(element.get("fontWeight"),500))))
            color = str(element.get("color") or "#172b3a")
            align = element.get("align") if element.get("align") in {"left","center","right"} else "left"
            valign = element.get("valign") if element.get("valign") in {"top","center","bottom"} else "top"
            styles += ["display:flex",f"align-items:{'flex-start' if valign=='top' else 'center' if valign=='center' else 'flex-end'}",f"justify-content:{'flex-start' if align=='left' else 'center' if align=='center' else 'flex-end'}",f"text-align:{align}",f"font-size:{font_size:g}pt",f"font-weight:{font_weight}",f"color:{color}","font-family:Tahoma,Arial,sans-serif","line-height:1.12","white-space:pre-wrap","word-break:break-word","overflow:hidden"]
            nodes.append(f'<div class="sticker-node sticker-text" style="{html.escape(";".join(styles),quote=True)}">{html.escape(text)}</div>')
    return f'<div class="sticker-page" style="width:{width:g}mm;height:{height:g}mm;position:relative;overflow:{overflow};background:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact">{"".join(nodes)}</div>'


def print_document(labels: list[str], template: dict[str, Any]) -> str:
    width = _style_num(template["canvas"].get("width"),75.2)
    height = _style_num(template["canvas"].get("height"),36)
    pages = "".join(f'<section class="sticker-sheet">{label}</section>' for label in labels)
    return f'''<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>พิมพ์สติกเกอร์ครุภัณฑ์</title><style>
@page{{size:{width:g}mm {height:g}mm;margin:0}}*{{box-sizing:border-box}}html,body{{margin:0;padding:0;background:#fff;color:#111;font-family:Tahoma,Arial,sans-serif}}.sticker-sheet{{width:{width:g}mm;height:{height:g}mm;break-after:page;page-break-after:always;overflow:hidden}}.sticker-sheet:last-child{{break-after:auto;page-break-after:auto}}.sticker-page{{break-inside:avoid;page-break-inside:avoid}}@media screen{{body{{padding:16px;background:#eef2f4}}.sticker-sheet{{margin:0 auto 16px;box-shadow:0 1px 8px #0002}}}}@media print{{html,body{{width:{width:g}mm;margin:0;padding:0}}}}
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
    template_row=_read_template(db,str(body.get("templateId") or body.get("template_id") or "") or None)
    if not template_row:
        ensure_default_template(db)
        template_row=_read_template(db)
    template=_template_dict(template_row)
    settings=sticker_settings(db)
    width,height=template["canvas"]["width"],template["canvas"]["height"]
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
        rendered.append(render_sticker(template,item,settings))
    return {"jobId":job_id,"count":len(rendered),"template":template,"html":print_document(rendered,template)}


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
    if method=="GET" and path=="/api/register/featured":
        row=db.execute("SELECT asset_id FROM asset_register_details ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            row=db.execute("SELECT id AS asset_id FROM assets ORDER BY id LIMIT 1").fetchone()
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
        return [dict(row) for row in db.execute("SELECT id,filename,title,source_kind AS sourceKind,source_scope AS sourceScope,extraction_method AS extractionMethod,notes FROM source_documents ORDER BY id")]
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
        allowed={"companyName","orgName","AssetTerminology","footerNote","hotline","lineOA"}
        for key,value in body.items():
            if key in allowed:
                db.execute("INSERT INTO sticker_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",(key,str(value)[:300]))
        return sticker_settings(db)
    if method=="POST" and path in {"/api/sticker/render","/api/sticker/bulk-render","/api/sticker/print"}:
        result=_make_print_job(db,body)
        return result
    return None
