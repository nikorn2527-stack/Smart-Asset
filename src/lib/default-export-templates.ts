/**
 * default-export-templates.ts — Default export templates for all pages.
 *
 * Each template defines:
 *   - columns: which fields to export (name + label)
 *   - format: csv | xlsx | pdf
 *   - filename: pattern for the output file
 *
 * Usage:
 *   import { DEVICE_EXPORT, WO_EXPORT, STOCK_EXPORT, METER_EXPORT }
 *   const handleExport = () => downloadCsv(`devices-${dateStamp()}.csv`, rows, DEVICE_EXPORT.columns)
 */

export interface ExportColumn {
  key: string
  label: string
}

export interface ExportTemplate {
  name: string
  columns: ExportColumn[]
  defaultFormat: 'csv' | 'xlsx' | 'pdf'
  filename: string
}

// ── Devices ──
export const DEVICE_EXPORT: ExportTemplate = {
  name: 'รายการอุปกรณ์',
  filename: 'devices',
  defaultFormat: 'csv',
  columns: [
    { key: 'assetCode', label: 'รหัสอุปกรณ์' },
    { key: 'name', label: 'ชื่ออุปกรณ์' },
    { key: 'brand', label: 'ยี่ห้อ' },
    { key: 'model', label: 'รุ่น' },
    { key: 'serialNumber', label: 'Serial Number' },
    { key: 'type', label: 'ประเภท' },
    { key: 'status', label: 'สถานะ' },
    { key: 'site', label: 'สาขา' },
    { key: 'department', label: 'แผนก' },
    { key: 'departmentCode', label: 'รหัสแผนก' },
    { key: 'building', label: 'อาคาร' },
    { key: 'floor', label: 'ชั้น' },
    { key: 'location', label: 'ที่ตั้ง' },
    { key: 'purchaseDate', label: 'วันที่ซื้อ' },
    { key: 'warrantyEnd', label: 'วันหมดประกัน' },
    { key: 'vendor', label: 'ผู้จำหน่าย' },
    { key: 'ip', label: 'IP Address' },
    { key: 'mac', label: 'MAC Address' },
  ],
}

// ── Work Orders ──
export const WO_EXPORT: ExportTemplate = {
  name: 'รายการใบงาน',
  filename: 'work-orders',
  defaultFormat: 'csv',
  columns: [
    { key: 'woNumber', label: 'เลขที่ใบงาน' },
    { key: 'subject', label: 'หัวข้อ' },
    { key: 'status', label: 'สถานะ' },
    { key: 'priority', label: 'ความเร่งด่วน' },
    { key: 'reporterName', label: 'ผู้แจ้ง' },
    { key: 'tel', label: 'เบอร์โทร' },
    { key: 'building', label: 'อาคาร' },
    { key: 'location', label: 'ที่ตั้ง' },
    { key: 'siteCode', label: 'สาขา' },
    { key: 'assignedTo', label: 'ผู้รับผิดชอบ' },
    { key: 'createdAt', label: 'วันที่แจ้ง' },
    { key: 'closedAt', label: 'วันที่ปิดงาน' },
    { key: 'details', label: 'รายละเอียด' },
    { key: 'resolution', label: 'ผลการแก้ไข' },
  ],
}

// ── Stock Items ──
export const STOCK_EXPORT: ExportTemplate = {
  name: 'รายการสต็อก',
  filename: 'stock-items',
  defaultFormat: 'csv',
  columns: [
    { key: 'productCode', label: 'รหัสสินค้า' },
    { key: 'productName', label: 'ชื่อสินค้า' },
    { key: 'category', label: 'หมวดหมู่' },
    { key: 'brand', label: 'ยี่ห้อ' },
    { key: 'model', label: 'รุ่น' },
    { key: 'quantity', label: 'คงเหลือ' },
    { key: 'minQuantity', label: 'จุดสั่งซื้อ' },
    { key: 'unit', label: 'หน่วย' },
    { key: 'unitCost', label: 'ราคา/หน่วย' },
    { key: 'totalValue', label: 'มูลค่ารวม' },
    { key: 'site', label: 'สาขา' },
    { key: 'location', label: 'ที่เก็บ' },
    { key: 'active', label: 'สถานะ' },
  ],
}

// ── Meter Readings ──
export const METER_EXPORT: ExportTemplate = {
  name: 'รายการจดมิเตอร์',
  filename: 'meter-readings',
  defaultFormat: 'csv',
  columns: [
    { key: 'assetCode', label: 'รหัสอุปกรณ์' },
    { key: 'deviceName', label: 'ชื่ออุปกรณ์' },
    { key: 'readingDate', label: 'วันที่จด' },
    { key: 'readingMonth', label: 'เดือน' },
    { key: 'meterBw', label: 'มิเตอร์ขาวดำ' },
    { key: 'meterColor', label: 'มิเตอร์สี' },
    { key: 'pagesBw', label: 'แผ่นขาวดำ' },
    { key: 'pagesColor', label: 'แผ่นสี' },
    { key: 'readingType', label: 'ประเภท' },
    { key: 'readBy', label: 'ผู้จด' },
    { key: 'remark', label: 'หมายเหตุ' },
  ],
}

// ── All templates ──
export const ALL_EXPORT_TEMPLATES = {
  devices: DEVICE_EXPORT,
  workOrders: WO_EXPORT,
  stock: STOCK_EXPORT,
  meter: METER_EXPORT,
}
