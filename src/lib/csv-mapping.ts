/**
 * CSV Field Mapping — แปลงชื่อ column จาก Apps Script (เก่า) → Prisma (ใหม่)
 *
 * รองรับทั้ง 3 ระบบ:
 *   - IT-Asset-Management: snake_case (asset_no, device_type, ...)
 *   - Services: JSON fields (reporter_name, pic_before, ...)
 *   - Stock: PascalCase (ProductCode, CurrentStock, ...)
 *
 * การใช้งาน:
 *   import { mapCsvRow, FIELD_MAPPINGS, STATUS_MAPPINGS, parseCsv } from '@/lib/csv-mapping'
 *   const rows = parseCsv(csvText)
 *   const mapped = rows.map(row => mapCsvRow(row, FIELD_MAPPINGS.device))
 */

// ════════════════════════════════════════════════════════════
// FIELD MAPPINGS: old column name → Prisma field name
// ════════════════════════════════════════════════════════════

export const FIELD_MAPPINGS = {
  // ── IT-Asset: All_Devices (snake_case → camelCase) ──
  device: {
    'asset_no': 'assetCode',
    'device_type': 'type',
    'serial': 'serialNumber',
    'department_code': 'departmentCode',
    'contract_no': 'contractNo',
    'remote_id': 'remoteId',
    'updated_at': 'updatedAt',
    'updated_by': 'updatedBy',
    'install_date': 'purchaseDate',
    'uninstall_date': 'uninstallDate',
    'warranty_end': 'warrantyEnd',
    'device_group': 'deviceGroup',
    'cost_center': 'costCenter',
    'meter_required': 'meterRequired',
    'meter_mode': 'meterMode',
    'asset_site_code': 'displayLabel',
    // Direct matches (identity mappings — same name in CSV and Prisma)
    'brand': 'brand',
    'model': 'model',
    'status': 'status',
    'site': 'site',
    'department': 'department',
    'location': 'location',
    'building': 'building',
    'floor': 'floor',
    'ip': 'ip',
    'mac': 'mac',
    'remark': 'remark',
    'vendor': 'vendor',
  } as Record<string, string>,

  // ── IT-Asset: Meter_Readings (snake_case) ──
  meterReading: {
    'reading_id': 'readingId',
    'asset_no': 'assetCode',
    'reading_date': 'readingDate',
    'reading_month': 'readingMonth',
    'meter_bw': 'meterBw',
    'meter_color': 'meterColor',
    'pages_bw': 'pagesBw',
    'pages_color': 'pagesColor',
    'prev_meter_bw': 'prevMeterBw',
    'prev_meter_color': 'prevMeterColor',
    'reading_type': 'readingType',
    'read_by': 'readBy',
    'location_at_reading': 'locationAtReading',
    'site_at_reading': 'siteAtReading',
    'building_at_reading': 'buildingAtReading',
    'floor_at_reading': 'floorAtReading',
    'department_at_reading': 'departmentAtReading',
    'department_code_at_reading': 'departmentCodeAtReading',
    'event_type': 'eventType',
    'event_id': 'eventId',
    // remark = direct match
  } as Record<string, string>,

  // ── IT-Asset: Location_History (PascalCase) ──
  deviceTransfer: {
    'Log_ID': 'logId',
    'Asset_No': 'assetCode',
    'Move_Date': 'moveDate',
    'Action': 'action',
    'From_Status': 'fromStatus',
    'To_Status': 'toStatus',
    'From_Site': 'fromSite',
    'From_AssetSiteCode': 'fromAssetSiteCode',
    'From_Building': 'fromBuilding',
    'From_Floor': 'fromFloor',
    'From_Department': 'fromDepartment',
    'From_Location': 'fromLocation',
    'To_Site': 'toSite',
    'To_AssetSiteCode': 'toAssetSiteCode',
    'To_Building': 'toBuilding',
    'To_Floor': 'toFloor',
    'To_Department': 'toDepartment',
    'To_Location': 'toLocation',
    'Meter_Reading_ID': 'meterReadingId',
    'Moved_By': 'movedBy',
    'Remark': 'remark',
  } as Record<string, string>,

  // ── IT-Asset: Assignments (PascalCase) ──
  assignment: {
    'Assignment_ID': 'assignmentId',
    'Asset_No': 'assetCode',
    'Assignee': 'assignee',
    'Assignee_Role': 'assigneeRole',
    'Department': 'department',
    'Checkout_Date': 'checkoutDate',
    'Expected_Return_Date': 'expectedReturnDate',
    'Actual_Return_Date': 'actualReturnDate',
    'Status': 'status',
    'Notes': 'notes',
    'Created_At': 'createdAt',
  } as Record<string, string>,

  // ── IT-Asset: MaintenanceLog (PascalCase) ──
  maintenanceLog: {
    'Log_ID': 'logId',
    'Asset_No': 'assetCode',
    'Type': 'type',
    'Status': 'status',
    'Start_Date': 'startDate',
    'End_Date': 'endDate',
    'Cost': 'cost',
    'Vendor': 'vendor',
    'Description': 'description',
    'Resolved_Note': 'resolvedNote',
    'Created_At': 'createdAt',
  } as Record<string, string>,

  // ── Services: WorkOrder (JSON fields, snake_case) ──
  workOrder: {
    'id': 'id',
    'subject': 'subject',
    'status': 'status',
    'building': 'building',
    'location': 'location',
    'details': 'details',
    'external_meta': 'externalMeta',
    'reporter_name': 'reporterName',
    'request_id': 'requestId',
    'tel': 'tel',
    'employee_code': 'employeeCode',
    'submission_source': 'submissionSource',
    'pic_before': 'picBefore',
    'pic_onsite': 'picOnsite',
    'pic_after': 'picAfter',
    'details_admin': 'detailsAdmin',
    'date_admin': 'dateAdmin',
    'accept_status': 'acceptStatus',
    'edit_unlock_active': 'editUnlockActive',
    'edit_unlock_by': 'editUnlockBy',
    'edit_unlock_at': 'editUnlockAt',
    'edit_unlock_note': 'editUnlockNote',
    'edit_unlock_updated_at': 'editUnlockUpdatedAt',
    'edit_unlock_closed_at': 'editUnlockClosedAt',
    'work_completed_at': 'workCompletedAt',
    'closed_at': 'closedAt',
    'canceled_at': 'canceledAt',
    'priority': 'priority',
    'assigned_to': 'assignedTo',
    'assigned_by': 'assignedBy',
    'assigned_at': 'assignedAt',
    'assignment_note': 'assignmentNote',
    'trackable': 'trackable',
    'created_at': 'createdAt',
    'updated_at': 'updatedAt',
  } as Record<string, string>,

  // ── Stock: Products (PascalCase) ──
  stockItem: {
    'ProductCode': 'productCode',
    'ProductName': 'productName',
    'CurrentStock': 'quantity',
    'Unit': 'unit',
    'UnitPrice': 'unitCost',
    'TotalValue': 'totalValue',
    'ReorderPoint': 'minQuantity',
    'LastUpdated': 'lastUpdated',
    'Status': 'active',
  } as Record<string, string>,

  // ── Stock: StockIn (PascalCase) ──
  stockIn: {
    'ReceiptNo': 'txnNumber',
    'Date': 'txnDate',
    'ProductCode': 'productCode',
    'ProductName': 'productName',
    'Quantity': 'quantity',
    'Unit': 'unit',
    'UnitPrice': 'unitCost',
    'TotalValue': 'cost',
    'Supplier': 'vendor',
    'Receiver': 'receiver',
    'Remark': 'remark',
    'PurchaseOrderNo': 'purchaseOrderNo',
  } as Record<string, string>,

  // ── Stock: StockOut (PascalCase) ──
  stockOut: {
    'IssueNo': 'txnNumber',
    'Date': 'txnDate',
    'ProductCode': 'productCode',
    'ProductName': 'productName',
    'Quantity': 'quantity',
    'Unit': 'unit',
    'Requester': 'requester',
    'Department': 'department',
    'Purpose': 'purpose',
    'Approver': 'approver',
    'ApprovedAt': 'approvedAt',
    'processed_flag': 'processedFlag',
    'line_no': 'lineNo',
    'reason_reject': 'reasonReject',
    'source_key': 'sourceKey',
  } as Record<string, string>,

  // ── Stock: PurchaseOrders (PascalCase) ──
  purchaseOrder: {
    'PurchaseOrderNo': 'poNumber',
    'OrderDate': 'orderDate',
    'ProductCode': 'productCode',
    'ProductName': 'productName',
    'QuantityOrdered': 'quantityOrdered',
    'Unit': 'unit',
    'UnitPrice': 'unitPrice',
    'TotalValue': 'totalValue',
    'Supplier': 'supplier',
    'Status': 'status',
    'QuantityReceived': 'quantityReceived',
    'QuantityRemaining': 'quantityRemaining',
    'CreatedBy': 'createdBy',
  } as Record<string, string>,

  // ── IT-Asset: User_Permissions ──
  user: {
    'Email': 'email',
    'Username': 'username',
    'Name': 'name',
    'Role': 'role',
    'Active': 'active',
    'PasswordHash': 'passwordHash',
    'Remark': 'remark',
    'UpdatedAt': 'updatedAt',
    'LastLoginAt': 'lastLoginAt',
    'Allowed_Sites': 'allowedSites',
  } as Record<string, string>,
}

// ════════════════════════════════════════════════════════════
// STATUS MAPPINGS: old status values → new normalized values
// ════════════════════════════════════════════════════════════

export const STATUS_MAPPINGS = {
  // Services app uses emoji + Thai text
  workOrder: {
    '🟠รอดำเนินการ': 'PENDING',
    '🔵สำรวจหน้างาน/แก้ไข': 'IN_PROGRESS',
    '🟡รอเบิกอะไหล่': 'WAITING_PARTS',
    '🟢จบงาน': 'COMPLETED',
    '⚫ยกเลิกงาน': 'CANCELLED',
    // Also accept plain English (in case CSV was pre-processed)
    'PENDING': 'PENDING',
    'IN_PROGRESS': 'IN_PROGRESS',
    'WAITING_PARTS': 'WAITING_PARTS',
    'COMPLETED': 'COMPLETED',
    'CANCELLED': 'CANCELLED',
  } as Record<string, string>,

  // Stock app uses Active/Inactive
  stockItem: {
    'Active': 'true',
    'Inactive': 'false',
    'active': 'true',
    'inactive': 'false',
    'TRUE': 'true',
    'FALSE': 'false',
  } as Record<string, string>,
}

// ════════════════════════════════════════════════════════════
// CSV PARSER (RFC 4180 compliant)
// ════════════════════════════════════════════════════════════

export function parseCsv(text: string): Record<string, string>[] {
  const lines: string[][] = []
  let currentLine: string[] = []
  let currentField = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          currentField += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        currentField += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        currentLine.push(currentField)
        currentField = ''
      } else if (char === '\n' || char === '\r') {
        if (currentField || currentLine.length > 0) {
          currentLine.push(currentField)
          lines.push(currentLine)
          currentLine = []
          currentField = ''
        }
        if (char === '\r' && text[i + 1] === '\n') i++
      } else {
        currentField += char
      }
    }
  }
  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField)
    lines.push(currentLine)
  }

  if (lines.length < 2) return []

  const headers = lines[0].map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const row: Record<string, string> = {}
    headers.forEach((header, i) => {
      row[header] = (line[i] || '').trim()
    })
    return row
  })
}

// ════════════════════════════════════════════════════════════
// MAPPING HELPER
// ════════════════════════════════════════════════════════════

/**
 * Convert a CSV row using a field mapping.
 * Unmapped columns are collected separately (for warnings).
 */
export function mapCsvRow(
  row: Record<string, string>,
  mapping: Record<string, string>,
): { mapped: Record<string, unknown>; unmapped: string[] } {
  const mapped: Record<string, unknown> = {}
  const unmapped: string[] = []

  for (const [csvKey, value] of Object.entries(row)) {
    // Try exact match first, then case-insensitive
    let prismaField = mapping[csvKey]
    if (!prismaField) {
      prismaField = mapping[csvKey.toLowerCase()]
    }
    if (!prismaField) {
      prismaField = mapping[csvKey.replace(/_/g, '')]
    }

    if (prismaField) {
      mapped[prismaField] = value
    } else if (csvKey && value) {
      unmapped.push(csvKey)
    }
  }

  return { mapped, unmapped }
}

/**
 * Map a status value using a status mapping.
 */
export function mapStatus(
  value: string,
  mapping: Record<string, string>,
): string {
  return mapping[value] || mapping[value.trim()] || value
}

/**
 * Generate a CSV template string for a given mapping.
 */
export function generateCsvTemplate(mapping: Record<string, string>): string {
  const headers = Object.keys(mapping)
  return headers.join(',') + '\n'
}
