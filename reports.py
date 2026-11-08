"""Operational reports with CSV/XLSX export, scoped to the caller's organization and branch."""
from __future__ import annotations

import csv
import io
import re
from urllib.parse import quote

import ticket_items
from qr_smart import fail, now_iso

PREVIEW_ROWS = 200
PRINT_ROWS = 5000
CLOSED = ("ปิดงาน", "ยกเลิก", "ไม่อนุมัติ")
ACCOUNT_LABELS = {"MEDCENTER": "ศูนย์แพทย์", "SURIN": "โรงพยาบาลสุรินทร์"}
MOVE_LABELS = {"intake": "รับเข้าดูแล", "assign": "มอบผู้รับผิดชอบ", "loan": "ยืม", "issue": "เบิก", "return": "คืน", "relocate": "ย้ายที่ตั้ง"}
LOAN_LABELS = {"loaned": "ถูกยืม", "issued": "ถูกเบิกใช้"}


def _scope(db, alias="a"):
    return __import__("access_control").scope_sql(db, alias)


def _dates(query, column):
    clauses, params = [], []
    start, end = _one(query, "from"), _one(query, "to")
    for value, op in ((start, ">="), (end, "<=")):
        if value:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                fail("รูปแบบวันที่ต้องเป็น ปปปป-ดด-วว")
            clauses.append(f"substr({column},1,10){op}?")
            params.append(value)
    return clauses, params


def _one(query, key):
    value = (query or {}).get(key, "")
    if isinstance(value, list):
        value = value[0] if value else ""
    return str(value or "").strip()[:120]


def _account_rows(db):
    ctx = getattr(db, "access", None)
    if ctx and ctx.get("accountId") is not None:
        account_ids = [ctx["accountId"]]
    elif ctx and not (ctx.get("canViewAll") or ctx.get("isAdmin")):
        account_ids = sorted({m["account_id"] for m in ctx.get("memberships", [])})
    else:
        account_ids = None
    if account_ids == []:
        return []
    where, params = ["is_active=1"], []
    if account_ids is not None:
        where.append("id IN (" + ",".join("?" for _ in account_ids) + ")")
        params.extend(account_ids)
    rows = db.execute(
        "SELECT id,name,code FROM asset_accounts WHERE " + " AND ".join(where), params
    ).fetchall()
    accounts = []
    branch_id = ctx.get("branchId") if ctx else None
    for row in rows:
        asset_where = ["numbering_account_id=?"]
        asset_params = [row["id"]]
        if branch_id is not None:
            asset_where.append("branch_id=?")
            asset_params.append(branch_id)
        count = db.execute(
            "SELECT COUNT(*) FROM assets WHERE " + " AND ".join(asset_where), asset_params
        ).fetchone()[0]
        accounts.append({
            "id": row["id"], "name": row["name"], "code": row["code"],
            "label": ACCOUNT_LABELS.get(row["code"], row["name"]), "count": count,
        })
    return sorted(accounts, key=lambda account: (-account["count"], account["id"]))


def _selected_account(db, query):
    accounts = _account_rows(db)
    raw = _one(query, "accountId")
    if not raw:
        ctx = getattr(db, "access", None)
        current = ctx.get("accountId") if ctx else None
        selected = next((account for account in accounts if account["id"] == current), None)
        selected = selected or (accounts[0] if accounts else None)
    else:
        if not raw.isdigit():
            fail("บัญชีข้อมูลไม่ถูกต้อง")
        selected = next((account for account in accounts if account["id"] == int(raw)), None)
        if selected is None:
            fail("ไม่มีสิทธิ์เข้าถึงบัญชีข้อมูลนี้", 403)
    if selected is None:
        fail("ไม่พบบัญชีข้อมูลสำหรับรายงาน", 404)
    return selected["id"]


def _account_where(db, query, alias="a"):
    return f"{alias}.numbering_account_id=?", [_selected_account(db, query)]


def _asset_filter(db, query):
    account_clause, account_params = _account_where(db, query)
    where, params = [_scope(db), account_clause], account_params
    for key, column in (("status", "a.status"), ("group", "a.group_name")):
        if _one(query, key):
            where.append(f"{column}=?")
            params.append(_one(query, key))
    if _one(query, "location"):
        where.append("a.location LIKE ? ESCAPE '!'")
        params.append("%" + re.sub(r"([!%_])", r"!\1", _one(query, "location")) + "%")
    department_id = _one(query, "departmentUnitId")
    if department_id:
        if not department_id.isdigit():
            fail("หน่วยงานไม่ถูกต้อง")
        exists = db.execute(
            "SELECT 1 FROM assets a JOIN org_units u ON u.id=a.department_unit_id WHERE "
            + _scope(db) + " AND a.numbering_account_id=? AND u.id=? LIMIT 1",
            [_selected_account(db, query), int(department_id)],
        ).fetchone()
        if not exists:
            fail("ไม่พบหน่วยงานในบัญชีข้อมูลนี้", 400)
        where.append("a.department_unit_id=?")
        params.append(int(department_id))
    return where, params


def _department_rows(db, query):
    account_clause, account_params = _account_where(db, query)
    return [
        {"id": row["id"], "name": row["name"]}
        for row in db.execute(
            "SELECT DISTINCT u.id,u.name FROM assets a "
            "JOIN org_units u ON u.id=a.department_unit_id WHERE "
            + _scope(db) + " AND " + account_clause
            + " AND trim(u.name)<>'' ORDER BY u.name COLLATE NOCASE,u.id",
            account_params,
        ).fetchall()
    ]


def _asset_select():
    return (
        "SELECT a.code,a.name,a.group_name,COALESCE(dept.name,''),a.location,a.status,"
        "a.fiscal_year_th,a.acquisition_date,a.purchase_price "
        "FROM assets a LEFT JOIN org_units dept ON dept.id=a.department_unit_id WHERE "
    )


def _asset_columns():
    return ["เลขครุภัณฑ์", "ชื่อรายการ", "หมวด", "หน่วยงาน", "ที่ตั้ง", "สถานะ", "ปีงบประมาณ", "วันที่ได้มา", "ราคาซื้อ (บาท)"]


def _assets(db, query):
    where, params = _asset_filter(db, query)
    rows = db.execute(
        _asset_select() + " AND ".join(where) + " ORDER BY a.code,a.id", params).fetchall()
    return _asset_columns(), [list(r[:7]) + [str(r[7] or "")[:10]] + [r[8]] for r in rows], f"ทั้งหมด {len(rows):,} รายการ"


def _assets_preview(db, query, limit):
    where, params = _asset_filter(db, query)
    total = db.execute("SELECT COUNT(*) FROM assets a WHERE " + " AND ".join(where), params).fetchone()[0]
    rows = db.execute(
        _asset_select() + " AND ".join(where) + " ORDER BY a.code,a.id LIMIT ?", [*params, limit]).fetchall()
    preview = [list(r[:7]) + [str(r[7] or "")[:10]] + [r[8]] for r in rows]
    cols = _asset_columns()
    return cols, preview, f"ทั้งหมด {total:,} รายการ", total


def _by_location(db, query):
    account_clause, account_params = _account_where(db, query)
    rows = db.execute(
        "SELECT CASE WHEN a.location='' THEN '(ไม่ระบุที่ตั้ง)' ELSE a.location END,COUNT(*),"
        "COALESCE(SUM(a.status='ชำรุด'),0) FROM assets a WHERE " + _scope(db) + " AND " + account_clause
        + " GROUP BY 1 ORDER BY 2 DESC,1", account_params).fetchall()
    return ["ที่ตั้ง", "จำนวนครุภัณฑ์", "ชำรุด"], [list(r) for r in rows], f"{len(rows):,} ที่ตั้ง"


def _ticket_filters(db, query):
    account_id = _selected_account(db, query)
    where, params = [
        _scope_ticket(db),
        "(a.numbering_account_id=? OR (t.asset_id IS NULL AND t.location_point_id IS NOT NULL AND "
        "EXISTS(SELECT 1 FROM service_locations s WHERE s.id=t.location_point_id AND s.account_id=?)))",
    ], [account_id, account_id]
    clauses, dparams = _dates(query, "t.created_at")
    where += clauses
    params += dparams
    if _one(query, "status"):
        where.append("t.status=?")
        params.append(_one(query, "status"))
    return where, params


def _scope_ticket(db):
    from qr_smart import ticket_scope_sql
    return ticket_scope_sql(db)


def _repairs(db, query):
    where, params = _ticket_filters(db, query)
    rows = db.execute(
        "SELECT t.ticket_no,t.asset_code,t.asset_name,t.location,t.issue,t.urgency,t.status,t.requester,t.assigned_to,"
        "CASE WHEN t.requires_external THEN 'ช่างภายนอก' ELSE 'ช่างภายใน' END,t.estimate_cost,t.actual_cost,"
        "substr(t.created_at,1,10),substr(t.closed_at,1,10) FROM tickets t LEFT JOIN assets a ON a.id=t.asset_id WHERE "
        + " AND ".join(where) + " ORDER BY t.id DESC", params).fetchall()
    cols = ["เลขที่ใบแจ้ง", "เลขครุภัณฑ์", "ชื่อรายการ", "ที่ตั้ง", "อาการ", "ความเร่งด่วน", "สถานะ", "ผู้แจ้ง", "ผู้รับผิดชอบ", "ประเภทช่าง", "ประเมิน (บาท)", "ค่าใช้จ่ายจริง (บาท)", "วันที่แจ้ง", "วันที่ปิดงาน"]
    return cols, [list(r) for r in rows], f"ทั้งหมด {len(rows):,} ใบแจ้ง"


def _repair_summary(db, query):
    where, params = _ticket_filters(db, query)
    rows = db.execute(
        "SELECT t.status,COUNT(*),COALESCE(SUM(t.estimate_cost),0),COALESCE(SUM(t.actual_cost),0),"
        "COALESCE(SUM(t.requires_external),0) FROM tickets t LEFT JOIN assets a ON a.id=t.asset_id WHERE "
        + " AND ".join(where) + " GROUP BY t.status ORDER BY 2 DESC", params).fetchall()
    total = sum(r[1] for r in rows)
    cost = sum(r[3] for r in rows if r[0] not in ("ยกเลิก", "ไม่อนุมัติ"))
    cols = ["สถานะ", "จำนวนใบแจ้ง", "ประเมินรวม (บาท)", "ค่าใช้จ่ายจริงรวม (บาท)", "ใช้ช่างภายนอก (ใบ)"]
    return cols, [list(r) for r in rows], f"รวม {total:,} ใบ · ค่าใช้จ่ายจริง {cost:,.2f} บาท"


def _loans(db, query):
    today = now_iso()[:10]
    account_clause, account_params = _account_where(db, query)
    rows = db.execute(
        "SELECT a.code,a.name,c.loan_status,c.custodian,c.due_at,c.location_text FROM asset_custody_state c JOIN assets a ON a.id=c.asset_id "
        "WHERE c.loan_status IN ('loaned','issued') AND " + _scope(db) + " AND " + account_clause
        + " ORDER BY c.due_at='' ,c.due_at,a.id", account_params).fetchall()
    out = [[r[0], r[1], LOAN_LABELS.get(r[2], r[2]), r[3], r[4], "เกินกำหนด" if r[4] and r[4] < today else "ปกติ", r[5]] for r in rows]
    late = sum(1 for r in out if r[5] == "เกินกำหนด")
    return ["เลขครุภัณฑ์", "ชื่อรายการ", "ประเภท", "ผู้ยืม/ผู้เบิก", "กำหนดคืน", "สถานะกำหนดคืน", "ที่ตั้ง"], out, f"ค้างคืน {len(out):,} รายการ · เกินกำหนด {late:,}"


def _movements(db, query):
    account_clause, account_params = _account_where(db, query)
    where, params = [_scope(db), account_clause], account_params
    clauses, dparams = _dates(query, "m.created_at")
    where += clauses
    params += dparams
    if _one(query, "kind") in MOVE_LABELS:
        where.append("m.kind=?")
        params.append(_one(query, "kind"))
    rows = db.execute(
        "SELECT substr(m.created_at,1,16),a.code,a.name,m.kind,m.actor,m.from_location,m.to_location,m.from_custodian,m.to_custodian,m.note "
        "FROM asset_movements m JOIN assets a ON a.id=m.asset_id WHERE " + " AND ".join(where)
        + " ORDER BY m.id DESC", params).fetchall()
    out = [[r[0].replace("T", " "), r[1], r[2], MOVE_LABELS.get(r[3], r[3]), *r[4:]] for r in rows]
    cols = ["วันเวลา", "เลขครุภัณฑ์", "ชื่อรายการ", "รายการ", "ผู้บันทึก", "จากที่ตั้ง", "ไปที่ตั้ง", "จากผู้ดูแล", "ไปผู้ดูแล", "หมายเหตุ"]
    return cols, out, f"ทั้งหมด {len(out):,} รายการ"


def _repair_items(db, query):
    where, params = [_scope_ticket(db)], []
    clauses, dparams = _dates(query, "w.created_at")
    where += clauses
    params += dparams
    if _one(query, "itemKind") in ticket_items.KINDS:
        where.append("w.kind=?")
        params.append(_one(query, "itemKind"))
    rows = db.execute(
        "SELECT t.ticket_no,t.asset_code,t.asset_name,w.kind,w.name,w.qty,w.unit,w.unit_cost,ROUND(w.qty*w.unit_cost,2),w.source,w.vendor,w.vendor_contact,w.status,substr(w.created_at,1,10) "
        "FROM ticket_work_items w JOIN tickets t ON t.id=w.ticket_id LEFT JOIN assets a ON a.id=t.asset_id WHERE "
        + " AND ".join(where) + " ORDER BY w.id DESC", params).fetchall()
    status = {"requested": "ขอดำเนินการ", "approved": "อนุมัติแล้ว", "received": "รับของ/ดำเนินการแล้ว", "cancelled": "ยกเลิก"}
    out = [[r[0], r[1], r[2], ticket_items.KINDS[r[3]], r[4], r[5], r[6], r[7], r[8], ticket_items.SOURCES.get(r[9], r[9]), r[10], r[11], status.get(r[12], r[12]), r[13]] for r in rows]
    total = sum(r[8] for r in rows if r[12] != "cancelled")
    cols = ["เลขที่ใบแจ้ง", "เลขครุภัณฑ์", "ชื่อรายการ", "ประเภท", "รายการ", "จำนวน", "หน่วย", "ราคาต่อหน่วย", "รวม (บาท)", "แหล่งที่มา", "ช่างนอก/ร้าน", "ติดต่อ", "สถานะ", "วันที่ขอ"]
    return cols, out, f"{len(out):,} รายการ · มูลค่ารวมที่ไม่ยกเลิก {total:,.2f} บาท"


REPORTS = {
    "assets": {"title": "ทะเบียนครุภัณฑ์", "desc": "รายการครุภัณฑ์ตามหน่วยงาน หมวด ที่ตั้ง และสถานะ", "filters": ["departmentUnitId", "status", "group", "location"], "run": _assets, "preview": _assets_preview},
    "by-location": {"title": "ครุภัณฑ์แยกตามที่ตั้ง", "desc": "จำนวนครุภัณฑ์และรายการชำรุดต่อที่ตั้ง", "filters": [], "run": _by_location},
    "repairs": {"title": "รายการงานซ่อม", "desc": "ใบแจ้งซ่อม ผู้รับผิดชอบ ประเภทช่าง และค่าใช้จ่าย", "filters": ["from", "to", "status"], "run": _repairs},
    "repair-summary": {"title": "สรุปงานซ่อมตามสถานะ", "desc": "จำนวนและค่าใช้จ่ายงานซ่อมแยกตามสถานะ", "filters": ["from", "to"], "run": _repair_summary},
    "repair-items": {"title": "อะไหล่ วัสดุ และช่างนอกในงานซ่อม", "desc": "รายการที่ผูกกับใบแจ้งซ่อม พร้อมมูลค่าและผู้รับจ้างภายนอก", "filters": ["from", "to", "itemKind"], "run": _repair_items},
    "loans": {"title": "ครุภัณฑ์ที่ยืม/เบิกค้างคืน", "desc": "รายการที่ยังไม่คืนและเกินกำหนด", "filters": [], "run": _loans},
    "movements": {"title": "ประวัติการเคลื่อนไหวและการย้ายที่ตั้ง", "desc": "รับเข้า ยืม เบิก คืน และย้ายที่ตั้งด้วย QR", "filters": ["from", "to", "kind"], "run": _movements},
}


def catalog(db):
    accounts = _account_rows(db)
    ctx = getattr(db, "access", None)
    current = ctx.get("accountId") if ctx else None
    default = next((account["id"] for account in accounts if account["id"] == current), None)
    default = default or (accounts[0]["id"] if accounts else None)
    return {
        "items": [{"id": k, "title": v["title"], "description": v["desc"], "filters": v["filters"]} for k, v in REPORTS.items()],
        "accounts": accounts,
        "defaultAccountId": default,
    }


def run_report(db, report_id, query, limit=PREVIEW_ROWS):
    spec = REPORTS.get(report_id)
    if not spec:
        fail("ไม่พบรายงานนี้", 404)
    if limit is not None and "preview" in spec:
        columns, rows, summary, total = spec["preview"](db, query, limit)
    else:
        columns, rows, summary = spec["run"](db, query)
        total = len(rows)
        rows = rows[:limit] if limit is not None else rows
    account_id = _selected_account(db, query)
    account = next(account for account in _account_rows(db) if account["id"] == account_id)
    return {"id": report_id, "title": spec["title"], "columns": columns, "rows": rows, "total": total, "summary": summary,
            "account": account, "truncated": total > len(rows), "generatedAt": now_iso()}


def build_print_data(db, report_id, query):
    ctx = getattr(db, "access", None)
    if ctx and not (ctx.get("isAdmin") or ctx["permissions"].get("export")):
        fail("ไม่ได้รับสิทธิ์ส่งออกหรือพิมพ์", 403)
    spec = REPORTS.get(report_id)
    if not spec:
        fail("ไม่พบรายงานนี้", 404)
    # Browsers freeze when asked to lay out tens of thousands of rows, so printing is capped.
    result = run_report(db, report_id, query, limit=PRINT_ROWS)
    result["printLimit"] = PRINT_ROWS
    return result


def _safe(value):
    if value is None:
        return ""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def build_export(db, report_id, fmt, query):
    ctx = getattr(db, "access", None)
    if ctx and not (ctx.get("isAdmin") or ctx["permissions"].get("export")):
        fail("ไม่ได้รับสิทธิ์ส่งออกหรือพิมพ์", 403)
    spec = REPORTS.get(report_id)
    if not spec:
        fail("ไม่พบรายงานนี้", 404)
    columns, export_rows, _ = spec["run"](db, query)
    rows = [[_safe(v) for v in row] for row in export_rows]
    account_id = _selected_account(db, query)
    account = next(account for account in _account_rows(db) if account["id"] == account_id)
    name = f"{spec['title']}-{account['code']}-{now_iso()[:10]}"
    if fmt == "csv":
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(columns)
        writer.writerows(rows)
        return ("\ufeff" + out.getvalue()).encode("utf-8"), "text/csv; charset=utf-8", name + ".csv"
    if fmt == "xlsx":
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = spec["title"][:31]
        ws.append(columns)
        for row in rows:
            ws.append(row)
        for col in ws.columns:
            ws.column_dimensions[col[0].column_letter].width = min(48, max(10, max(len(str(c.value or "")) for c in col[:200]) + 2))
        ws.freeze_panes = "A2"
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name + ".xlsx"
    fail("รูปแบบไฟล์ต้องเป็น csv หรือ xlsx")


def content_disposition(filename):
    ascii_name = re.sub(r"[^A-Za-z0-9._-]", "_", filename)
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


def handle(db, method, path, query):
    if method != "GET":
        return None
    if path == "/api/reports":
        return catalog(db)
    if path == "/api/reports/filters/departments":
        return {"items": _department_rows(db, query)}
    match = re.fullmatch(r"/api/reports/([a-z-]+)/print-data", path)
    if match:
        return build_print_data(db, match[1], query)
    match = re.fullmatch(r"/api/reports/([a-z-]+)", path)
    if match:
        return run_report(db, match[1], query)
    return None
