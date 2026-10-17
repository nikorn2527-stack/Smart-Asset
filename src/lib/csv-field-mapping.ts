// ============================================================
// CSV Field Mapping Layer
// ------------------------------------------------------------
// Maps column names exported from the 3 legacy Apps Script
// systems to the Prisma field names used by this Next.js app.
//
// Legacy systems (still in production):
//   1. IT-Asset-Management (Google Sheets, snake_case columns)
//   2. Services            (Google Sheets, JSON-in-cell storage)
//   3. Stock               (Google Sheets, PascalCase columns)
//
// Export flow: user downloads each sheet as CSV (UTF-8) from
// Google Sheets, then uploads to /api/import?source=apps-script-*
// ============================================================

// ── Helpers ────────────────────────────────────────────────────
// Lowercase + strip underscores so we can match "asset_no",
// "assetNo", "AssetNo" all to one canonical key.
export function normalizeKey(k: string): string {
  return k.trim().toLowerCase().replace(/[_\-\s]/g, '')
}

// ============================================================
// FIELD_MAPPINGS — { csvHeader: prismaField }
// CSV headers are the EXACT strings produced by Apps Script
// (case-sensitive as written in the old code) — but the lookup
// also falls back to a normalized form (see mapCsvRow).
// ============================================================
export const FIELD_MAPPINGS = {
  // ── IT-Asset: All_Devices sheet (28 cols, snake_case → camelCase) ──
  device: {
    asset_no: 'assetCode', // เลขทะเบียน → unique key
    device_type: 'type',
    serial: 'serialNumber',
    department_code: 'departmentCode',
    contract_no: 'contractNo', // สัญญาบำรุง → contractNo
    remote_id: 'remoteId',
    updated_at: 'updatedAt',
    updated_by: 'updatedBy',
    install_date: 'installDate', // วันติดตั้ง → installDate
    uninstall_date: 'uninstallDate', // วันถอดถอน → uninstallDate
    warranty_end: 'warrantyEnd',
    device_group: 'deviceGroup',
    cost_center: 'costCenter',
    meter_required: 'meterRequired',
    meter_mode: 'meterMode',
    asset_site_code: 'assetSiteCode', // รหัสประจำสาขา → assetSiteCode
    // direct 1:1 matches (no rename needed)
    brand: 'brand',
    model: 'model',
    status: 'status',
    site: 'site',
    department: 'department',
    location: 'location',
    building: 'building',
    floor: 'floor',
    ip: 'ip',
    mac: 'mac',
    remark: 'remark',
    vendor: 'vendor',
    // NOTE: device_type → type เพราะ "name" ไม่มีใน sheet เก่า
    // เราจะใช้ "{brand} {model}" เป็น name ในขั้นตอน import
  },

  // ── IT-Asset: Meter_Readings sheet (21 cols, snake_case) ──
  meterReading: {
    reading_id: 'id', // ใช้เป็น dedup key (string)
    asset_no: 'deviceId', // needs lookup by assetCode → Device.id
    reading_date: 'readingDate',
    reading_month: 'readingMonth',
    meter_bw: 'meterBw',
    meter_color: 'meterColor',
    pages_bw: 'pagesBw',
    pages_color: 'pagesColor',
    prev_meter_bw: 'prevMeterBw',
    prev_meter_color: 'prevMeterColor',
    reading_type: 'readingType',
    read_by: 'readBy',
    remark: 'remark',
    site_at_reading: 'siteAtReading',
    building_at_reading: 'buildingAtReading',
    floor_at_reading: 'floorAtReading',
    department_at_reading: 'departmentAtReading',
  },

  // ── IT-Asset: Location_History sheet (21 cols, PascalCase) ──
  deviceTransfer: {
    Log_ID: 'id',
    Asset_No: 'deviceId', // needs lookup by assetCode
    Move_Date: 'transferDate',
    From_Site: 'fromSite',
    To_Site: 'toSite',
    From_Department: 'fromDepartment',
    To_Department: 'toDepartment',
    From_DepartmentCode: 'fromDepartmentCode',
    To_DepartmentCode: 'toDepartmentCode',
    From_Building: 'fromBuilding',
    To_Building: 'toBuilding',
    From_Floor: 'fromFloor',
    To_Floor: 'toFloor',
    From_Location: 'fromLocation',
    To_Location: 'toLocation',
    Moved_By: 'movedBy',
    Remark: 'reason',
  },

  // ── IT-Asset: User_Permissions sheet (11 cols) → User ──
  user: {
    Email: 'email',
    Role: 'role',
    Active: 'active',
    Name: 'name',
    Username: 'username',
    PasswordHash: 'passwordHash',
    Remark: 'remark',
    UpdatedAt: 'updatedAt',
    LastLoginAt: 'lastLoginAt',
    Allowed_Sites: 'allowedSites',
  },

  // ── IT-Asset: App_Settings sheet (4 cols) → AppSetting ──
  appSetting: {
    Key: 'key',
    Value: 'value',
    Description: 'remark', // store description in remark-like field? skip on import
    UpdatedAt: 'updatedAt',
  },

  // ── IT-Asset: Master_Items sheet (10 cols) → MasterItem ──
  masterItem: {
    CategoryKey: 'category',
    ItemID: 'code',
    Value: 'label',
    GroupName: 'parentRef',
    ParentRef: 'parentRef',
    DisplayLabel: 'displayLabel',
    SiteCode: 'siteCode',
    AllowedSites: 'siteCode',
    Active: 'active',
    DepartmentCode: 'displayLabel', // ใส่ใน displayLabel เป็นข้อมูลเสริม
  },

  // ── IT-Asset: Site_Attributes sheet (6 cols) → Site + SiteRate ──
  site: {
    Site_Code: 'code',
    SiteName: 'name',
    LineOA: 'phone', // เก็บเบอร์ LINE OA ไว้ใน phone
    Hotline: 'phone',
    PaperRateBW: 'bwRate',
    PaperRateColor: 'colorRate',
  },

  // ── Stock: Products sheet (9 cols, PascalCase) ──
  stockItem: {
    ProductCode: 'productCode',
    ProductName: 'productName',
    CurrentStock: 'quantity',
    Unit: 'unit',
    UnitPrice: 'unitCost',
    TotalValue: '_skip', // computed field — recalc on import
    ReorderPoint: 'minQuantity',
    LastUpdated: 'updatedAt',
    Status: 'active', // Active → true, Inactive → false
  },

  // ── Stock: StockIn sheet (12 cols, PascalCase) → StockTransaction type=IN ──
  stockIn: {
    ReceiptNo: 'txnNumber',
    Date: 'txnDate',
    ProductCode: 'stockItemId', // needs lookup by productCode
    ProductName: '_skip', // ใช้ตอน validate เท่านั้น
    Quantity: 'quantity',
    Unit: '_skip',
    UnitPrice: 'cost',
    TotalValue: '_skip',
    Supplier: 'vendor',
    Receiver: 'performedBy',
    Remark: 'remark',
    PurchaseOrderNo: 'purchaseOrderId', // needs lookup by poNumber
  },

  // ── Stock: StockOut sheet (15 cols, PascalCase) → StockTransaction type=OUT ──
  stockOut: {
    IssueNo: 'txnNumber',
    Date: 'txnDate',
    ProductCode: 'stockItemId', // needs lookup
    ProductName: '_skip',
    Quantity: 'quantity',
    Unit: '_skip',
    // Preserve legacy semantics in their own normalized fields.
    Requester: 'requester',
    Department: 'department',
    Purpose: 'purpose',
    Approver: 'approver',
    ApprovedAt: 'approvedAt',
    processed_flag: 'processedFlag',
    line_no: 'lineNo',
    reason_reject: 'rejectReason',
    source_key: 'sourceKey',
    // Keep the legacy reference available for dual-number reconciliation.
    WorkOrderNo: 'workOrderNo',
    workOrderNo: 'workOrderNo',
    legacy_job_no: 'workOrderNo',
    legacy_job_number: 'workOrderNo',
    job_no: 'workOrderNo',
    job_number: 'workOrderNo',
    เลขที่งาน: 'workOrderNo',
    เลขงาน: 'workOrderNo',
    หมายเลขงาน: 'workOrderNo',
  },

  // ── Stock: PurchaseOrders sheet (13 cols) → PurchaseOrder + Items ──
  purchaseOrder: {
    PurchaseOrderNo: 'poNumber',
    OrderDate: 'orderDate',
    ProductCode: 'stockItemId', // needs lookup (line item)
    ProductName: '_skip',
    QuantityOrdered: 'quantityOrdered',
    Unit: '_skip',
    UnitPrice: 'unitPrice',
    TotalValue: 'totalValue',
    Supplier: 'supplier',
    Status: 'status',
    QuantityReceived: 'quantityReceived',
    QuantityRemaining: '_skip',
    CreatedBy: 'createdBy',
  },

  // ── Services: WorkOrder (JSON fields — exported as columns) ──
  //   The legacy Services app stores each WorkOrder as a JSON blob in
  //   a single cell. When exporting to CSV we flatten those JSON keys
  //   into columns. So the CSV headers here are the JSON field names.
  workOrder: {
    id: 'requestId', // ใช้เป็น dedup ID (legacy numeric id)
    // Preserve the legacy job identifier separately from the new system number.
    legacy_job_no: 'legacyJobNo',
    legacy_job_number: 'legacyJobNo',
    job_no: 'legacyJobNo',
    job_number: 'legacyJobNo',
    เลขที่งาน: 'legacyJobNo',
    เลขงาน: 'legacyJobNo',
    หมายเลขงาน: 'legacyJobNo',
    subject: 'subject',
    status: 'status', // needs value mapping (emoji → enum)
    building: 'building',
    location: 'location',
    details: 'details',
    external_meta: 'externalMeta',
    reporter_name: 'reporterName',
    request_id: 'requestId',
    tel: 'tel',
    employee_code: 'employeeCode',
    submission_source: 'submissionSource',
    pic_before: 'picBefore',
    pic_onsite: 'picOnsite',
    pic_after: 'picAfter',
    details_admin: 'detailsAdmin',
    date_admin: 'dateAdmin',
    accept_status: 'acceptStatus',
    edit_unlock_active: 'editUnlockActive',
    edit_unlock_by: 'editUnlockBy',
    edit_unlock_at: 'editUnlockAt',
    edit_unlock_note: 'editUnlockNote',
    work_completed_at: 'workCompletedAt',
    closed_at: 'closedAt',
    canceled_at: 'canceledAt',
    priority: 'priority',
    assigned_to: 'assignedTo',
    assigned_by: 'assignedBy',
    assigned_at: 'assignedAt',
    assignment_note: 'assignmentNote',
    trackable: 'trackable',
    created_at: 'createdAt',
    updated_at: 'updatedAt',
  },
} as const

// ============================================================
// STATUS_MAPPINGS — convert legacy status strings to enum values
// ============================================================
export const STATUS_MAPPINGS = {
  // Services WorkOrder statuses use Thai text with emoji prefix
  workOrder: {
    '🟠รอดำเนินการ': 'PENDING',
    '🔵สำรวจหน้างาน/แก้ไข': 'IN_PROGRESS',
    '🟡รอเบิกอะไหล่': 'WAITING_PARTS',
    '🟢จบงาน': 'COMPLETED',
    '⚫ยกเลิกงาน': 'CANCELLED',
    // English fallbacks (in case the user exported a normalized version)
    PENDING: 'PENDING',
    IN_PROGRESS: 'IN_PROGRESS',
    WAITING_PARTS: 'WAITING_PARTS',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    // Partial / loose matches
    รอดำเนินการ: 'PENDING',
    สำรวจหน้างาน: 'IN_PROGRESS',
    รอเบิกอะไหล่: 'WAITING_PARTS',
    จบงาน: 'COMPLETED',
    ยกเลิกงาน: 'CANCELLED',
    ยกเลิก: 'CANCELLED',
    DONE: 'COMPLETED',
    CLOSED: 'COMPLETED',
    CANCEL: 'CANCELLED',
  } as Record<string, string>,

  // Stock Products use Active/Inactive text
  stockItem: {
    Active: 'true',
    Inactive: 'false',
    active: 'true',
    inactive: 'false',
    TRUE: 'true',
    FALSE: 'false',
    '1': 'true',
    '0': 'false',
  } as Record<string, string>,

  // Legacy device statuses (snake_case) → our values
  device: {
    IN_USE: 'active',
    ACTIVE: 'active',
    SPARE: 'spare',
    REPAIR: 'repair',
    BROKEN: 'repair',
    DISPOSED: 'disposed',
    IN_STOCK: 'in_stock',
    STORED: 'in_stock',
    RETURNED: 'active',
  } as Record<string, string>,

  // PurchaseOrder statuses
  purchaseOrder: {
    Open: 'open',
    OPEN: 'open',
    Partial: 'partial',
    PARTIAL: 'partial',
    Received: 'received',
    RECEIVED: 'received',
    Cancelled: 'cancelled',
    CANCELLED: 'cancelled',
    closed: 'cancelled',
  } as Record<string, string>,
} as const

// ============================================================
// Template headers — EXACT column order from each legacy sheet
//   Used by the UI to (a) show required columns, (b) generate
//   downloadable CSV templates that match the old system.
// ============================================================
export const TEMPLATE_HEADERS = {
  // ── IT-Asset sheets ──
  'itam-device': [
    'asset_no',
    'device_type',
    'brand',
    'model',
    'serial',
    'building',
    'floor',
    'department',
    'location',
    'department_code',
    'status',
    'site',
    'contract_no',
    'ip',
    'mac',
    'remote_id',
    'updated_at',
    'updated_by',
    'remark',
    'vendor',
    'install_date',
    'uninstall_date',
    'warranty_end',
    'device_group',
    'cost_center',
    'meter_required',
    'meter_mode',
    'asset_site_code',
  ],
  'itam-meter': [
    'reading_id',
    'asset_no',
    'reading_date',
    'reading_month',
    'meter_bw',
    'meter_color',
    'pages_bw',
    'pages_color',
    'location_at_reading',
    'read_by',
    'remark',
    'prev_meter_bw',
    'prev_meter_color',
    'reading_type',
    'event_type',
    'event_id',
    'site_at_reading',
    'building_at_reading',
    'floor_at_reading',
    'department_at_reading',
    'department_code_at_reading',
  ],
  'itam-transfer': [
    'Log_ID',
    'Asset_No',
    'Move_Date',
    'Action',
    'From_Status',
    'To_Status',
    'From_Site',
    'From_AssetSiteCode',
    'From_Building',
    'From_Floor',
    'From_Department',
    'From_Location',
    'To_Site',
    'To_AssetSiteCode',
    'To_Building',
    'To_Floor',
    'To_Department',
    'To_Location',
    'Meter_Reading_ID',
    'Moved_By',
    'Remark',
  ],
  'itam-users': [
    'Email',
    'Role',
    'Active',
    'Name',
    'Username',
    'PasswordHash',
    'PasswordSalt',
    'Remark',
    'UpdatedAt',
    'LastLoginAt',
    'Allowed_Sites',
  ],
  'itam-settings': ['Key', 'Value', 'Description', 'UpdatedAt'],
  'itam-master': [
    'CategoryKey',
    'ItemID',
    'Value',
    'GroupName',
    'ParentRef',
    'DisplayLabel',
    'SiteCode',
    'AllowedSites',
    'Active',
    'DepartmentCode',
  ],
  'itam-sites': [
    'Site_Code',
    'SiteName',
    'LineOA',
    'Hotline',
    'PaperRateBW',
    'PaperRateColor',
  ],

  // ── Stock sheets ──
  'stock-products': [
    'ProductCode',
    'ProductName',
    'CurrentStock',
    'Unit',
    'UnitPrice',
    'TotalValue',
    'ReorderPoint',
    'LastUpdated',
    'Status',
  ],
  'stock-in': [
    'ReceiptNo',
    'Date',
    'ProductCode',
    'ProductName',
    'Quantity',
    'Unit',
    'UnitPrice',
    'TotalValue',
    'Supplier',
    'Receiver',
    'Remark',
    'PurchaseOrderNo',
  ],
  'stock-out': [
    'IssueNo',
    'Date',
    'ProductCode',
    'ProductName',
    'Quantity',
    'Unit',
    'Requester',
    'Department',
    'Purpose',
    'Approver',
    'ApprovedAt',
    'processed_flag',
    'line_no',
    'reason_reject',
    'source_key',
  ],
  'stock-po': [
    'PurchaseOrderNo',
    'OrderDate',
    'ProductCode',
    'ProductName',
    'QuantityOrdered',
    'Unit',
    'UnitPrice',
    'TotalValue',
    'Supplier',
    'Status',
    'QuantityReceived',
    'QuantityRemaining',
    'CreatedBy',
  ],

  // ── Services sheet (export as JSON; if CSV, these are the flattened fields) ──
  'services-workorders': [
    'id',
    'subject',
    'status',
    'building',
    'location',
    'details',
    'external_meta',
    'reporter_name',
    'request_id',
    'tel',
    'employee_code',
    'submission_source',
    'pic_before',
    'pic_onsite',
    'pic_after',
    'details_admin',
    'date_admin',
    'accept_status',
    'edit_unlock_active',
    'edit_unlock_by',
    'edit_unlock_at',
    'edit_unlock_note',
    'work_completed_at',
    'closed_at',
    'canceled_at',
    'priority',
    'assigned_to',
    'assigned_by',
    'assigned_at',
    'assignment_note',
    'trackable',
    'created_at',
    'updated_at',
  ],
} as const

// ============================================================
// mapCsvRow — convert one CSV row (header→value) to a Prisma-
// shaped object using the named mapping. Returns both the
// mapped object and the list of CSV columns that had no match
// (so the caller can surface a warning to the user).
// ============================================================
export interface MapResult {
  data: Record<string, string>
  unmapped: string[]
}

export function mapCsvRow(
  row: Record<string, string>,
  mapping: Record<string, string>,
): MapResult {
  const data: Record<string, string> = {}
  const unmapped: string[] = []

  // Pre-build a normalized lookup: normalizedCsvHeader → prismaField
  const normalizedLookup = new Map<string, string>()
  for (const [csvKey, prismaField] of Object.entries(mapping)) {
    normalizedLookup.set(normalizeKey(csvKey), prismaField)
  }

  for (const [csvKey, rawValue] of Object.entries(row)) {
    // Try exact match first (case-sensitive, as written in mapping)
    let prismaField = mapping[csvKey]
    // Fall back to normalized match
    if (!prismaField) {
      const normalizedField = normalizedLookup.get(normalizeKey(csvKey))
      if (normalizedField) prismaField = normalizedField
    }

    if (!prismaField) {
      unmapped.push(csvKey)
      continue
    }
    if (prismaField === '_skip') continue

    // Don't overwrite if a previous CSV column already mapped here
    if (data[prismaField] === undefined) {
      data[prismaField] = (rawValue ?? '').trim()
    }
  }

  return { data, unmapped }
}

// ============================================================
// Helper: convert truthy/falsey strings to boolean
// ============================================================
export function parseBool(v: string | undefined | null): boolean {
  if (!v) return false
  const t = v.trim().toLowerCase()
  return (
    t === 'true' ||
    t === '1' ||
    t === 'yes' ||
    t === 'y' ||
    t === 'active' ||
    t === 'on' ||
    t === '✓'
  )
}

// ============================================================
// Helper: parse ISO date string OR legacy date formats.
// Accepts: 2025-01-31, 2025/01/31, 31/01/2025, 31-01-2025,
//          2025-01-31T08:30:00Z, JS Date numbers.
// Returns ISO string (YYYY-MM-DD) or null if unparseable.
// ============================================================
export function parseDate(v: string | undefined | null): string | null {
  if (!v) return null
  const t = v.trim()
  if (!t) return null

  // Already ISO date (yyyy-mm-dd)
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)

  // dd/mm/yyyy or dd-mm-yyyy
  const m1 = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/)
  if (m1) {
    const dd = m1[1].padStart(2, '0')
    const mm = m1[2].padStart(2, '0')
    return `${m1[3]}-${mm}-${dd}`
  }

  // yyyy/mm/dd
  const m2 = t.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/)
  if (m2) {
    const mm = m2[2].padStart(2, '0')
    const dd = m2[3].padStart(2, '0')
    return `${m2[1]}-${mm}-${dd}`
  }

  // Try Date parsing as last resort
  const d = new Date(t)
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }
  return null
}

// ============================================================
// Helper: parse ISO datetime string for DateTime fields.
// Returns Date instance or null.
// ============================================================
export function parseDateTime(v: string | undefined | null): Date | null {
  if (!v) return null
  const t = v.trim()
  if (!t) return null

  // ISO with timezone
  const d1 = new Date(t)
  if (!isNaN(d1.getTime())) return d1

  // Date-only fallback
  const dateOnly = parseDate(t)
  if (dateOnly) {
    const d2 = new Date(dateOnly + 'T00:00:00Z')
    if (!isNaN(d2.getTime())) return d2
  }
  return null
}

// ============================================================
// Helper: convert string to integer (returns 0 on bad input)
// ============================================================
export function toInt(v: string | undefined | null, fallback = 0): number {
  if (v === null || v === undefined) return fallback
  const t = String(v).trim()
  if (t === '') return fallback
  const n = Number(t)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

// ============================================================
// Helper: convert string to float (returns null on bad input)
// ============================================================
export function toFloat(v: string | undefined | null): number | null {
  if (v === null || v === undefined) return null
  const t = String(v).trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ============================================================
// CSV parser — RFC 4180 compliant.
//   Handles quoted fields, escaped "" → ", commas/newlines
//   inside quotes. Returns array of rows, each row is array
//   of string fields. The first row is treated as headers.
// ============================================================
export function parseCsv(text: string): string[][] {
  // Strip UTF-8 BOM if present
  const src = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
      continue
    }
    if (c === ',') {
      cur.push(field)
      field = ''
      continue
    }
    if (c === '\r') {
      if (src[i + 1] === '\n') i++
      cur.push(field)
      rows.push(cur)
      cur = []
      field = ''
      continue
    }
    if (c === '\n') {
      cur.push(field)
      rows.push(cur)
      cur = []
      field = ''
      continue
    }
    field += c
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field)
    rows.push(cur)
  }
  // Drop trailing empty row from a final newline
  if (
    rows.length > 0 &&
    rows[rows.length - 1].length === 1 &&
    rows[rows.length - 1][0] === ''
  ) {
    rows.pop()
  }
  return rows
}

// ============================================================
// Helper: turn a 2D grid (rows) into a list of {header: value}
// objects, trimming values and skipping empty rows.
// ============================================================
export function rowsToObjects(grid: string[][]): Record<string, string>[] {
  if (grid.length < 2) return []
  const headers = grid[0].map((h) => h.trim())
  const out: Record<string, string>[] = []
  for (let i = 1; i < grid.length; i++) {
    const row = grid[i]
    // Skip totally empty rows
    if (row.length === 1 && row[0].trim() === '') continue
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => {
      obj[h] = (row[idx] ?? '').trim()
    })
    out.push(obj)
  }
  return out
}

// ============================================================
// Export type for the source parameter on /api/import
// ============================================================
export type AppsScriptSource =
  | 'apps-script-itam'
  | 'apps-script-services'
  | 'apps-script-stock'

// Maps a (source, sheetId) pair → which Prisma model/mapping to use
export const SOURCE_SHEET_REGISTRY = {
  'apps-script-itam': {
    label: 'IT-Asset-Management',
    icon: '📊',
    sheets: [
      {
        id: 'itam-device',
        label: 'All_Devices',
        desc: 'รายการอุปกรณ์ทั้งหมด (28 คอลัมน์)',
        mapping: 'device',
        model: 'Device',
      },
      {
        id: 'itam-meter',
        label: 'Meter_Readings',
        desc: 'ประวัติการจดมิเตอร์ (21 คอลัมน์)',
        mapping: 'meterReading',
        model: 'MeterReading',
      },
      {
        id: 'itam-transfer',
        label: 'Location_History',
        desc: 'ประวัติการย้ายอุปกรณ์ (21 คอลัมน์)',
        mapping: 'deviceTransfer',
        model: 'DeviceTransfer',
      },
      {
        id: 'itam-users',
        label: 'User_Permissions',
        desc: 'ผู้ใช้และสิทธิ์ (11 คอลัมน์)',
        mapping: 'user',
        model: 'User',
      },
      {
        id: 'itam-settings',
        label: 'App_Settings',
        desc: 'ตั้งค่าระบบแบบ key-value (4 คอลัมน์)',
        mapping: 'appSetting',
        model: 'AppSetting',
      },
      {
        id: 'itam-master',
        label: 'Master_Items',
        desc: 'ข้อมูลมาตรฐาน (10 คอลัมน์)',
        mapping: 'masterItem',
        model: 'MasterItem',
      },
      {
        id: 'itam-sites',
        label: 'Site_Attributes',
        desc: 'สาขาและอัตราค่ากระดาษ (6 คอลัมน์)',
        mapping: 'site',
        model: 'Site',
      },
    ],
  },
  'apps-script-stock': {
    label: 'Stock',
    icon: '📦',
    sheets: [
      {
        id: 'stock-products',
        label: 'Products',
        desc: 'สินค้าคงคลัง (9 คอลัมน์)',
        mapping: 'stockItem',
        model: 'StockItem',
      },
      {
        id: 'stock-in',
        label: 'StockIn',
        desc: 'รับสินค้าเข้า (12 คอลัมน์)',
        mapping: 'stockIn',
        model: 'StockTransaction',
      },
      {
        id: 'stock-out',
        label: 'StockOut',
        desc: 'เบิกสินค้าออก (15 คอลัมน์)',
        mapping: 'stockOut',
        model: 'StockTransaction',
      },
      {
        id: 'stock-po',
        label: 'PurchaseOrders',
        desc: 'ใบสั่งซื้อ (13 คอลัมน์)',
        mapping: 'purchaseOrder',
        model: 'PurchaseOrder',
      },
    ],
  },
  'apps-script-services': {
    label: 'Services',
    icon: '🔧',
    sheets: [
      {
        id: 'services-workorders',
        label: 'Data (WorkOrders)',
        desc: 'ใบงานแจ้งซ่อม (export เป็น CSV จาก JSON)',
        mapping: 'workOrder',
        model: 'WorkOrder',
      },
    ],
  },
} as const

export type SheetId = keyof typeof TEMPLATE_HEADERS
export type MappingName = keyof typeof FIELD_MAPPINGS
