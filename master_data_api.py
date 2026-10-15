"""Editable master-data endpoints for asset categories and depreciation policies."""
from __future__ import annotations

import json
import math
import re
import sqlite3
from typing import Any


def _one(query: dict, key: str, default: str = "") -> str:
    value = query.get(key, default)
    return str(value[0] if isinstance(value, list) and value else value)


def _text(value: Any, label: str, limit: int, required: bool = True) -> str:
    result = " ".join(str(value or "").strip().split())
    if required and not result:
        raise ValueError(f"กรุณาระบุ{label}")
    if len(result) > limit:
        raise ValueError(f"{label}ยาวเกิน {limit} ตัวอักษร")
    return result


def _number(value: Any, label: str, maximum: float, required: bool = False) -> float | None:
    if value is None or str(value).strip() == "":
        if required:
            raise ValueError(f"กรุณาระบุ{label}")
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label}ต้องเป็นตัวเลข")
    if not math.isfinite(result) or not 0 <= result <= maximum:
        raise ValueError(f"{label}ต้องอยู่ระหว่าง 0 ถึง {maximum:g}")
    return round(result, 4)


def _active_filter(query: dict, alias: str) -> str:
    include = _one(query, "include_inactive").lower() in {"1", "true", "yes"}
    return "" if include else f"WHERE {alias}.is_active=1"


def _categories(db: sqlite3.Connection, query: dict) -> list[dict[str, Any]]:
    where = _active_filter(query, "c")
    rows = db.execute(f"""SELECT c.id,c.category_name AS name,c.source_workbook AS source,c.notes,
        c.parent_category_id AS parentCategoryId,p.category_name AS parentName,
        c.is_active AS isActive,c.updated_at AS updatedAt,
        (SELECT COUNT(*) FROM assets a WHERE a.category_id=c.id) AS linkedAssets,
        (SELECT COUNT(*) FROM asset_category_policy_links l WHERE l.category_id=c.id) AS linkedPolicies
        FROM asset_categories c LEFT JOIN asset_categories p ON p.id=c.parent_category_id
        {where} ORDER BY c.is_active DESC,c.category_name,c.id""").fetchall()
    return [{**dict(row), "isActive": bool(row["isActive"])} for row in rows]


def _policies(db: sqlite3.Connection, query: dict) -> dict[str, Any]:
    where = _active_filter(query, "p")
    rows = db.execute(f"""SELECT p.id,p.rule_no AS ruleNo,p.category_name AS category,
        p.useful_life_years AS years,p.annual_rate_percent AS annualRate,
        p.calculation_method AS calculationMethod,p.residual_value_percent AS residualValuePercent,
        p.scope,p.note,p.source_page AS sourcePage,p.is_active AS isActive,p.updated_at AS updatedAt,
        (SELECT group_concat(c.category_name,' / ') FROM asset_category_policy_links l
         JOIN asset_categories c ON c.id=l.category_id WHERE l.policy_id=p.id) AS linkedCategoryNames
        FROM depreciation_policies p {where}
        ORDER BY p.is_active DESC,CAST(p.rule_no AS REAL),p.rule_no,p.category_name,p.id""").fetchall()
    items = []
    for row in rows:
        item = {**dict(row), "isActive": bool(row["isActive"])}
        if item["years"] is None and item["annualRate"] is None:
            item["calculationMethod"] = "case_by_case"
        item["categoryIds"] = [int(link[0]) for link in db.execute(
            "SELECT category_id FROM asset_category_policy_links WHERE policy_id=? ORDER BY category_id", (row["id"],)
        )]
        items.append(item)
    return {"items": items, "total": len(items)}


def _links(db: sqlite3.Connection, raw: Any) -> list[int]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("รูปแบบรายการหมวดที่เชื่อมไม่ถูกต้อง")
    try:
        ids = list(dict.fromkeys(int(value) for value in raw))
    except (TypeError, ValueError):
        raise ValueError("รายการหมวดที่เชื่อมไม่ถูกต้อง")
    if ids:
        marks = ",".join("?" for _ in ids)
        found = int(db.execute(f"SELECT COUNT(*) FROM asset_categories WHERE id IN ({marks})", ids).fetchone()[0])
        if found != len(ids):
            raise ValueError("ไม่พบหมวดที่เลือกเชื่อมกับหลักเกณฑ์")
    return ids


def _policy_fields(db: sqlite3.Connection, body: dict) -> tuple:
    rule_no = _text(body.get("ruleNo"), "รหัส/ลำดับหลักเกณฑ์", 80)
    category = _text(body.get("categoryName", body.get("category")), "ชื่อประเภททรัพย์สิน", 300)
    method = _text(body.get("calculationMethod", "annual_rate"), "วิธีคำนวณ", 32)
    if method not in {"annual_rate", "useful_life", "case_by_case"}:
        raise ValueError("วิธีคำนวณไม่รองรับ")
    years = _number(body.get("years", body.get("usefulLifeYears")), "อายุการใช้งาน (ปี)", 300)
    rate = _number(body.get("annualRate", body.get("annualRatePercent")), "อัตราค่าเสื่อมต่อปี (%)", 100)
    residual = _number(body.get("residualValuePercent", 0), "มูลค่าคงเหลือ (%)", 100) or 0.0
    if method == "case_by_case":
        years, rate, residual = None, None, 0.0
    elif method == "useful_life":
        if not years or years <= 0:
            raise ValueError("วิธีเส้นตรงต้องระบุอายุการใช้งานมากกว่า 0 ปี")
        rate = round((100 - residual) / years, 4)
    elif rate is None:
        if not years or years <= 0:
            raise ValueError("ระบุอัตราต่อปี หรือระบุอายุเพื่อคำนวณอัตราเริ่มต้น")
        rate = round(100 / years, 4)
    scope = _text(body.get("scope", ""), "ขอบเขตการใช้", 300, required=False)
    note = _text(body.get("note", ""), "หมายเหตุ", 1200, required=False)
    category_ids = _links(db, body.get("categoryIds"))
    return rule_no, category, years, rate, method, residual, scope, note, category_ids


def _snapshot_category(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "name": row["category_name"], "notes": row["notes"], "parentCategoryId": row["parent_category_id"], "isActive": bool(row["is_active"])}


def _snapshot_policy(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "ruleNo": row["rule_no"], "category": row["category_name"], "years": row["useful_life_years"], "annualRate": row["annual_rate_percent"], "calculationMethod": row["calculation_method"], "residualValuePercent": row["residual_value_percent"], "isActive": bool(row["is_active"])}


def _event(db: sqlite3.Connection, entity_type: str, entity_id: int, actor: str, action: str, before: dict | None, after: dict | None) -> None:
    db.execute(
        "INSERT INTO master_data_events(entity_type,entity_id,actor,action,before_json,after_json) VALUES(?,?,?,?,?,?)",
        (entity_type, entity_id, actor, action, json.dumps(before or {}, ensure_ascii=False), json.dumps(after or {}, ensure_ascii=False)),
    )


def _save_category(db: sqlite3.Connection, body: dict, category_id: int | None = None):
    name = _text(body.get("name"), "ชื่อหมวด", 300)
    notes = _text(body.get("notes", ""), "หมายเหตุ", 1000, required=False)
    parent = body.get("parentCategoryId") or None
    if parent is not None:
        try:
            parent = int(parent)
        except (TypeError, ValueError):
            raise ValueError("หมวดแม่ไม่ถูกต้อง")
        if parent == category_id:
            raise ValueError("หมวดไม่สามารถเป็นหมวดแม่ของตัวเอง")
        if not db.execute("SELECT 1 FROM asset_categories WHERE id=? AND is_active=1", (parent,)).fetchone():
            raise ValueError("ไม่พบหมวดแม่ที่เลือก")
    actor = _text(body.get("actor", "เจ้าหน้าที่พัสดุ"), "ผู้บันทึก", 120)
    if category_id is None:
        cur = db.execute("INSERT INTO asset_categories(category_name,source_workbook,parent_category_id,notes,is_active,updated_at) VALUES(?,?,?,?,1,CURRENT_TIMESTAMP)", (name, "", parent, notes))
        new_id = int(cur.lastrowid)
        after = {"id": new_id, "name": name, "notes": notes, "parentCategoryId": parent, "isActive": True}
        _event(db, "category", new_id, actor, "create", None, after)
        return after, 201
    current = db.execute("SELECT * FROM asset_categories WHERE id=?", (category_id,)).fetchone()
    if not current:
        return {"error": "ไม่พบหมวดนี้"}, 404
    before = _snapshot_category(current)
    is_active = int(bool(body.get("isActive", current["is_active"])))
    db.execute("UPDATE asset_categories SET category_name=?,parent_category_id=?,notes=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (name, parent, notes, is_active, category_id))
    after = {"id": category_id, "name": name, "notes": notes, "parentCategoryId": parent, "isActive": bool(is_active)}
    _event(db, "category", category_id, actor, "restore" if is_active and not current["is_active"] else "update", before, after)
    return after


def _deactivate_category(db: sqlite3.Connection, category_id: int, body: dict):
    current = db.execute("SELECT * FROM asset_categories WHERE id=?", (category_id,)).fetchone()
    if not current:
        return {"error": "ไม่พบหมวดนี้"}, 404
    before = _snapshot_category(current)
    actor = _text(body.get("actor", "เจ้าหน้าที่พัสดุ"), "ผู้บันทึก", 120)
    after = {**before, "isActive": False}
    db.execute("UPDATE asset_categories SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?", (category_id,))
    _event(db, "category", category_id, actor, "delete", before, after)
    return after


def _save_policy(db: sqlite3.Connection, body: dict, policy_id: int | None = None):
    rule_no, category, years, rate, method, residual, scope, note, category_ids = _policy_fields(db, body)
    actor = _text(body.get("actor", "เจ้าหน้าที่พัสดุ"), "ผู้บันทึก", 120)
    if policy_id is None:
        cur = db.execute("INSERT INTO depreciation_policies(rule_no,category_name,useful_life_years,annual_rate_percent,scope,note,calculation_method,residual_value_percent,is_active,updated_at) VALUES(?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP)", (rule_no, category, years, rate, scope, note, method, residual))
        policy_id = int(cur.lastrowid)
        action = "create"
        before = None
    else:
        current = db.execute("SELECT * FROM depreciation_policies WHERE id=?", (policy_id,)).fetchone()
        if not current:
            return {"error": "ไม่พบหลักเกณฑ์ค่าเสื่อมนี้"}, 404
        before = _snapshot_policy(current)
        is_active = int(bool(body.get("isActive", current["is_active"])))
        db.execute("UPDATE depreciation_policies SET rule_no=?,category_name=?,useful_life_years=?,annual_rate_percent=?,scope=?,note=?,calculation_method=?,residual_value_percent=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (rule_no, category, years, rate, scope, note, method, residual, is_active, policy_id))
        db.execute("DELETE FROM asset_category_policy_links WHERE policy_id=?", (policy_id,))
        action = "restore" if is_active and not current["is_active"] else "update"
    for category_id in category_ids:
        db.execute("INSERT INTO asset_category_policy_links(category_id,policy_id,match_note) VALUES(?,?,?)", (category_id, policy_id, "กำหนดจากหน้าจัดการหลักเกณฑ์"))
    is_active = True if before is None else bool(body.get("isActive", True))
    after = {"id": policy_id, "ruleNo": rule_no, "category": category, "years": years, "annualRate": rate, "calculationMethod": method, "residualValuePercent": residual, "categoryIds": category_ids, "isActive": is_active}
    _event(db, "depreciation_policy", policy_id, actor, action, before, after)
    return (after, 201) if before is None else after


def _deactivate_policy(db: sqlite3.Connection, policy_id: int, body: dict):
    current = db.execute("SELECT * FROM depreciation_policies WHERE id=?", (policy_id,)).fetchone()
    if not current:
        return {"error": "ไม่พบหลักเกณฑ์ค่าเสื่อมนี้"}, 404
    before = _snapshot_policy(current)
    actor = _text(body.get("actor", "เจ้าหน้าที่พัสดุ"), "ผู้บันทึก", 120)
    after = {**before, "isActive": False}
    db.execute("UPDATE depreciation_policies SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?", (policy_id,))
    _event(db, "depreciation_policy", policy_id, actor, "delete", before, after)
    return after


def _handle_routes(db: sqlite3.Connection, method: str, path: str, query: dict, body: dict):
    """Return None for paths not handled by the master-data subsystem."""
    if path == "/api/catalog/categories":
        if method == "GET":
            return _categories(db, query)
        if method == "POST":
            return _save_category(db, body)
    match = re.fullmatch(r"/api/catalog/categories/(\d+)", path)
    if match:
        category_id = int(match.group(1))
        if method == "PUT":
            return _save_category(db, body, category_id)
        if method == "DELETE":
            return _deactivate_category(db, category_id, body)
    if path == "/api/catalog/depreciation":
        if method == "GET":
            return _policies(db, query)
        if method == "POST":
            return _save_policy(db, body)
    match = re.fullmatch(r"/api/catalog/depreciation/(\d+)", path)
    if match:
        policy_id = int(match.group(1))
        if method == "PUT":
            return _save_policy(db, body, policy_id)
        if method == "DELETE":
            return _deactivate_policy(db, policy_id, body)
    return None


def handle(db: sqlite3.Connection, method: str, path: str, query: dict, body: dict):
    is_master_path = path.startswith("/api/catalog/categories") or path.startswith("/api/catalog/depreciation")
    if is_master_path and method in {"POST", "PUT", "DELETE"}:
        db.execute("BEGIN IMMEDIATE")
        try:
            result = _handle_routes(db, method, path, query, body)
            db.commit()
            return result
        except Exception:
            db.rollback()
            raise
    return _handle_routes(db, method, path, query, body)
