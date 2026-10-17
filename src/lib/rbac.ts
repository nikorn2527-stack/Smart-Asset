// ============================================================
// RBAC + Site-Level Permissions (Task ID: RBAC-DASHBOARD)
// ============================================================
// ระบบสิทธิ์แบบ granular:
//   - ผู้ดูแลระบบ (admin) เห็นทุกอย่าง
//   - ผู้จัดการ (manager) เห็น dashboard + reports + มอบหมายงานได้
//   - ช่าง (staff) แก้ไขอุปกรณ์ + รับใบงาน + เบิกของได้
//   - ผู้ประสานงาน (coordinator) แจ้งซ่อมได้ + เห็นใบงานตัวเอง
//   - ผู้ดู (viewer) ดูได้อย่างเดียว
//
// แต่ละ user มี `permissions` (JSON array) ที่สามารถ override ค่า default
// ของ role ได้ และมี `allowedSites` ("ALL" หรือ comma-separated) ควบคุม
// การเข้าถึงข้อมูลแยกตามสาขา
// ============================================================

// ---- Permission definitions ----
export const PERMISSIONS = {
  // ITAM (devices)
  DEVICES_VIEW: 'devices:view',
  DEVICES_EDIT: 'devices:edit',
  DEVICES_DELETE: 'devices:delete',
  DEVICES_TRANSFER: 'devices:transfer',
  METER_WRITE: 'meter:write',

  // Work Orders (แจ้งซ่อม)
  WO_CREATE: 'wo:create', // แจ้งซ่อมได้ (ทุกคน)
  WO_VIEW_ALL: 'wo:view:all', // เห็นทุกใบงาน
  WO_VIEW_SITE: 'wo:view:site', // เห็นเฉพาะสาขาตัวเอง
  WO_VIEW_OWN: 'wo:view:own', // เห็นเฉพาะที่ตัวเองแจ้ง
  WO_ASSIGN: 'wo:assign', // มอบหมายงาน
  WO_UPDATE: 'wo:update', // อัปเดตสถานะ
  WO_COMPLETE: 'wo:complete', // ปิดงาน
  WO_CANCEL: 'wo:cancel', // ยกเลิกงาน
  WO_UNLOCK: 'wo:unlock', // ปลดล็อกแก้ไข

  // Stock (สต็อก)
  STOCK_VIEW: 'stock:view',
  STOCK_IN: 'stock:in', // รับเข้า
  STOCK_OUT: 'stock:out', // เบิกออก
  STOCK_APPROVE: 'stock:approve', // อนุมัติเบิก
  STOCK_ADJUST: 'stock:adjust', // ปรับปรุง
  PO_CREATE: 'po:create', // สร้างใบสั่งซื้อ
  PO_APPROVE: 'po:approve', // อนุมัติใบสั่งซื้อ

  // Reports & Dashboard
  DASHBOARD_VIEW: 'dashboard:view',
  REPORTS_VIEW: 'reports:view',
  REPORTS_EXPORT: 'reports:export',

  // Admin
  USERS_MANAGE: 'users:manage',
  SETTINGS_MANAGE: 'settings:manage',
  TEMPLATES_MANAGE: 'templates:manage',
  IMPORT_DATA: 'import:data',
} as const

export type PermissionKey = keyof typeof PERMISSIONS
export type PermissionValue = (typeof PERMISSIONS)[PermissionKey]

// ---- Role definitions with default permissions ----
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['*'], // all permissions
  manager: [
    'dashboard:view',
    'reports:view',
    'reports:export',
    'devices:view',
    'wo:view:all',
    'stock:view',
    'po:approve',
  ],
  staff: [
    // ช่าง
    'dashboard:view',
    'devices:view',
    'devices:edit',
    'wo:create',
    'wo:view:all',
    'wo:update',
    'wo:complete',
    'stock:view',
    'stock:out',
  ],
  coordinator: [
    // ผู้ประสานงานหน่วยงานอื่น
    'dashboard:view',
    'wo:create',
    'wo:view:own',
  ],
  viewer: [
    'dashboard:view',
    'devices:view',
    'wo:view:site',
    'stock:view',
  ],
  // Legacy fallback (editor → มีสิทธิ์เท่า staff + import)
  editor: [
    'dashboard:view',
    'devices:view',
    'devices:edit',
    'wo:create',
    'wo:view:all',
    'wo:update',
    'wo:complete',
    'stock:view',
    'stock:in',
    'stock:out',
    'import:data',
  ],
}

export const ROLE_LABELS: Record<string, string> = {
  admin: 'ผู้ดูแลระบบ',
  manager: 'ผู้จัดการ',
  staff: 'ช่างเทคนิค',
  coordinator: 'ผู้ประสานงาน',
  viewer: 'ผู้ดู',
  editor: 'ผู้แก้ไข (legacy)',
}

export const ALL_ROLES = ['admin', 'manager', 'staff', 'coordinator', 'viewer'] as const
export type Role = (typeof ALL_ROLES)[number]

// ---- All permission values (flattened) — used to expand `*` ----
export const ALL_PERMISSION_VALUES: string[] = Object.values(PERMISSIONS)

// ---- Helper functions ----

/**
 * คืนค่า permissions ของ role ตาม default
 * (admin → คืนค่าทุก permission; role ที่ไม่รู้จัก → คืน [])
 */
export function getRolePermissions(role: string): string[] {
  const perms = ROLE_PERMISSIONS[role]
  if (!perms) return []
  if (perms.includes('*')) return [...ALL_PERMISSION_VALUES]
  return [...perms]
}

/**
 * คืนค่า permissions สุดท้ายของ user
 * ถ้ามี `customPermissions` จะใช้แทนค่า default ของ role
 * (admin ที่กำหนดเองจะยังคงมีสิทธิ์ `*` อยู่เสมอ)
 */
export function getUserPermissions(
  role: string,
  customPermissions?: string[] | null,
): string[] {
  if (Array.isArray(customPermissions) && customPermissions.length > 0) {
    if (customPermissions.includes('*')) return [...ALL_PERMISSION_VALUES]
    return [...customPermissions]
  }
  return getRolePermissions(role)
}

/**
 * ตรวจสอบว่า user มี permission ที่ระบุหรือไม่
 * รองรับ wildcard `*` และ prefix wildcard เช่น `devices:*`
 */
export function hasPermission(
  userPermissions: string[],
  permission: string,
): boolean {
  if (!Array.isArray(userPermissions) || userPermissions.length === 0) return false
  if (userPermissions.includes('*')) return true
  if (userPermissions.includes(permission)) return true
  // prefix wildcard: e.g. "devices:*" matches "devices:view"
  const [prefix] = permission.split(':')
  if (prefix && userPermissions.includes(`${prefix}:*`)) return true
  return false
}

/**
 * ตรวจสอบว่า user มี permission อย่างน้อยหนึ่งอย่างในรายการที่ระบุ
 */
export function hasAnyPermission(
  userPermissions: string[],
  permissions: string[],
): boolean {
  if (!Array.isArray(permissions) || permissions.length === 0) return false
  return permissions.some((p) => hasPermission(userPermissions, p))
}

/**
 * ตรวจสอบการเข้าถึงสาขา (site-level permission)
 *  - `null` / `undefined` / `""` → ปฏิเสธ (ไม่มีสิทธิ์เข้าถึง site ใด)
 *  - `"ALL"` → เข้าถึงได้ทุก site
 *  - comma-separated → เข้าถึงได้เฉพาะที่อยู่ในรายการ (เทียบแบบ case-insensitive, trim spaces)
 */
export function canAccessSite(
  userAllowedSites: string | null | undefined,
  site: string,
): boolean {
  if (!userAllowedSites || !site) return false
  const trimmed = userAllowedSites.trim()
  if (trimmed === '' ) return false
  if (trimmed.toUpperCase() === 'ALL') return true
  const allowed = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase())
  return allowed.includes(site.trim().toLowerCase())
}

/**
 * แปลง allowedSites เป็น array ของชื่อสาขา
 *  - "ALL" → null (หมายถึงทุกสาขา)
 *  - comma-separated → array ของชื่อสาขา
 *  - ค่าว่าง → [] (ไม่มีสิทธิ์เข้าถึงสาขาใด)
 */
export function parseAllowedSites(
  allowedSites: string | null | undefined,
): string[] | null {
  if (!allowedSites) return []
  const trimmed = allowedSites.trim()
  if (trimmed === '') return []
  if (trimmed.toUpperCase() === 'ALL') return null // null = all sites
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// ---- Auth helpers (server-side) ----

export interface AuthUser {
  id: string
  email: string
  username?: string | null
  name?: string | null
  role: string
  department?: string | null
  permissions: string[]
  allowedSites: string | null
  active: boolean
  /** Demo users see only demo data (isDemo=true), real users see only real data */
  isDemo?: boolean | null
}

/**
 * แปลง record จาก DB ให้เป็น AuthUser พร้อม permissions ที่ resolved แล้ว
 */
export function toAuthUser(user: {
  id: string
  email: string
  username?: string | null
  name?: string | null
  role: string
  department?: string | null
  permissions?: string | null
  allowedSites?: string | null
  active: boolean
  isDemo?: boolean | null
}): AuthUser {
  let customPerms: string[] | null = null
  if (user.permissions) {
    try {
      const parsed = JSON.parse(user.permissions)
      if (Array.isArray(parsed)) {
        customPerms = parsed.filter((p): p is string => typeof p === 'string')
      }
    } catch {
      customPerms = null
    }
  }
  return {
    id: user.id,
    email: user.email,
    username: user.username ?? null,
    name: user.name ?? null,
    role: user.role,
    department: user.department ?? null,
    permissions: getUserPermissions(user.role, customPerms),
    allowedSites: user.allowedSites ?? null,
    active: user.active,
    // Carry through the isDemo flag so demoFilter() can isolate demo vs real data
    isDemo: user.isDemo ?? false,
  }
}

// ---- Client-side permission gate helpers (used in components) ----

/**
 * สร้าง object ที่บอกว่าแต่ละ nav item ควรแสดงหรือไม่ โดยอ้างอิงจาก permissions
 * ใช้ใน Sidebar component
 *
 * Each nav item maps to one or more required permission keys. The user's
 * effective permission set (role defaults + per-user grants stored on
 * `User.permissions`) is what we check against — so admins can grant/revoke
 * individual menu items per user via the Permission Management UI.
 *
 * Permission keys mirror the values exported from `auth-shared.ts` (the
 * SCREAMING_SNAKE form like 'VIEW_DASHBOARD' / 'WO_VIEW_ALL' — these are
 * ALSO accepted here alongside the legacy colon-delimited form like
 * 'dashboard:view' / 'wo:view:all' so both auth systems work).
 */
export interface NavVisibility {
  dashboard: boolean
  devices: boolean
  meter: boolean
  paperAnalytics: boolean
  workOrders: boolean
  stock: boolean
  import: boolean
  templates: boolean
  settings: boolean
  audit: boolean
}

function hasAnyPerm(perms: string[], keys: string[]): boolean {
  if (!Array.isArray(perms) || perms.length === 0) return false
  if (perms.includes('*')) return true
  for (const k of keys) {
    if (perms.includes(k)) return true
    // prefix wildcard: e.g. "devices:*" matches "devices:view"
    const [prefix] = k.split(':')
    if (prefix && perms.includes(`${prefix}:*`)) return true
  }
  return false
}

export function computeNavVisibility(
  userPermissions: string[],
): NavVisibility {
  return {
    dashboard: hasAnyPerm(userPermissions, [
      'VIEW_DASHBOARD',
      'dashboard:view',
    ]),
    devices: hasAnyPerm(userPermissions, [
      'VIEW_DEVICES',
      'devices:view',
    ]),
    meter: hasAnyPerm(userPermissions, [
      'METER_WRITE',
      'meter:write',
    ]),
    paperAnalytics: hasAnyPerm(userPermissions, [
      'VIEW_ANALYTICS',
      'reports:view',
    ]),
    workOrders: hasAnyPerm(userPermissions, [
      'WO_CREATE',
      'WO_VIEW_ALL',
      'WO_VIEW_SITE',
      'WO_VIEW_OWN',
      'wo:create',
      'wo:view:own',
      'wo:view:site',
      'wo:view:all',
    ]),
    stock: hasAnyPerm(userPermissions, [
      'STOCK_VIEW',
      'STOCK_IN',
      'STOCK_OUT',
      'STOCK_APPROVE',
      'stock:view',
    ]),
    import: hasAnyPerm(userPermissions, [
      'IMPORT_DATA',
      'import:data',
    ]),
    templates: hasAnyPerm(userPermissions, [
      'TEMPLATES_MANAGE',
      'templates:manage',
    ]),
    settings: hasAnyPerm(userPermissions, [
      'SYSTEM_CONFIG',
      'USER_MANAGE',
      'MASTER_DATA_EDIT',
      'ADMIN',
      'settings:manage',
    ]),
    audit: hasAnyPerm(userPermissions, [
      'VIEW_AUDIT',
      'ADMIN',
    ]),
  }
}

/**
 * ค่า default ที่ใช้ตอนที่ยังไม่ได้ login (preview mode)
 * ให้สิทธิ์ admin เพื่อให้เห็น UI ครบทุกหน้าใน sandbox
 */
export const DEFAULT_PREVIEW_PERMISSIONS = [...ALL_PERMISSION_VALUES]
