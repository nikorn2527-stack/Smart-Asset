/**
 * auth-shared.ts — pure RBAC types & constants (NO Node.js deps).
 *
 * Safe to import from client components. Server-only code lives in
 * `auth.ts` which re-exports everything from here.
 *
 * Granular permissions (Task ID: FIX-RBAC-AUDIT-CYCLE-SITE):
 *   Each user carries an optional `permissions` JSON string (a comma-separated
 *   list, or a JSON array — both forms are parsed) that is MERGED with the
 *   default permissions for their role. The result is the user's effective
 *   permission set, surfaced via `toAuthUser()` / `getUserPermissions()`.
 */

// ─── Types ────────────────────────────────────────────────────────────
export type Permission =
  // ── Dashboard / overview ──
  | 'VIEW_DASHBOARD'
  | 'VIEW_DEVICES'
  | 'VIEW_ANALYTICS'
  // ── Meter ──
  | 'METER_WRITE'
  // ── Device lifecycle ──
  | 'DEVICE_EDIT'
  | 'DEVICE_DELETE'
  | 'DEVICE_TRANSFER'
  | 'LIFECYCLE_EDIT'
  // ── Master data ──
  | 'MASTER_DATA_EDIT'
  // ── Print / Export ──
  | 'EXPORT_PRINT'
  | 'PRINT'
  // ── Admin ──
  | 'ADMIN'
  | 'USER_MANAGE'
  | 'SYSTEM_CONFIG'
  // ── Work orders (granular) ──
  | 'WO_CREATE'
  | 'WO_VIEW_ALL'
  | 'WO_VIEW_SITE'
  | 'WO_VIEW_OWN'
  | 'WO_ASSIGN'
  | 'WO_COMPLETE'
  | 'WO_CANCEL'
  // ── Stock (granular) ──
  | 'STOCK_VIEW'
  | 'STOCK_IN'
  | 'STOCK_OUT'
  | 'STOCK_APPROVE'
  // ── Templates / Import / Audit / Reports ──
  | 'TEMPLATES_MANAGE'
  | 'IMPORT_DATA'
  | 'VIEW_AUDIT'
  | 'VIEW_REPORTS'
  | 'MANAGE_REPORTS'

export type Role = 'superadmin' | 'admin' | 'editor' | 'meter' | 'viewer'

/** Shape returned to the frontend (no secrets). */
export interface AuthUser {
  /** DB primary key — required by the user-management UI (edit/delete/
   *  toggle/permission endpoints address users by id). */
  id: string
  email: string
  role: Role
  name: string | null
  username: string | null
  allowedSites: string | 'ALL'
  permissions: Permission[]
  /** Active flag — surfaced so the admin table can render/toggle it. */
  active: boolean
  /** Demo user flag — surfaced so the UI can show the demo banner. */
  isDemo: boolean
  /** Organization ID (tenant scope) — Phase 1 multi-org foundation.
   *  Null for legacy users without an assigned org. Resolved from
   *  User.organizationId at login time. */
  organizationId: string | null
}

/** Internal — the user record as stored in `user_permissions`. */
export interface UserPermissionRow {
  id: string
  email: string
  role: string
  active: boolean
  name: string | null
  username: string | null
  passwordHash: string | null
  passwordSalt: string | null
  remark: string | null
  lastLoginAt: string | null
  allowedSites: string | null
  /** Optional JSON string or comma-separated list of custom permissions. */
  permissions?: string | null
  /** Demo user flag — present when the User row carries `isDemo`. */
  isDemo?: boolean | null
  /** Organization ID (tenant scope) — Phase 1 multi-org foundation. */
  organizationId?: string | null
}

// ─── Role ↔ permission map (mirror of Code.gs ROLE_PERMISSIONS) ───────
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  superadmin: [
    'VIEW_DASHBOARD', 'VIEW_DEVICES', 'VIEW_ANALYTICS', 'METER_WRITE',
    'DEVICE_EDIT', 'DEVICE_DELETE', 'DEVICE_TRANSFER', 'LIFECYCLE_EDIT',
    'MASTER_DATA_EDIT', 'EXPORT_PRINT', 'PRINT', 'ADMIN',
    'USER_MANAGE', 'SYSTEM_CONFIG',
    'WO_CREATE', 'WO_VIEW_ALL', 'WO_ASSIGN', 'WO_COMPLETE', 'WO_CANCEL',
    'STOCK_VIEW', 'STOCK_IN', 'STOCK_OUT', 'STOCK_APPROVE',
    'TEMPLATES_MANAGE', 'IMPORT_DATA', 'VIEW_AUDIT',
    'VIEW_REPORTS', 'MANAGE_REPORTS',
  ],
  admin: [
    'VIEW_DASHBOARD', 'VIEW_DEVICES', 'VIEW_ANALYTICS', 'METER_WRITE',
    'DEVICE_EDIT', 'DEVICE_DELETE', 'DEVICE_TRANSFER', 'LIFECYCLE_EDIT',
    'MASTER_DATA_EDIT', 'EXPORT_PRINT', 'PRINT', 'ADMIN',
    'USER_MANAGE', 'SYSTEM_CONFIG',
    'WO_CREATE', 'WO_VIEW_ALL', 'WO_ASSIGN', 'WO_COMPLETE', 'WO_CANCEL',
    'STOCK_VIEW', 'STOCK_IN', 'STOCK_OUT', 'STOCK_APPROVE',
    'TEMPLATES_MANAGE', 'IMPORT_DATA', 'VIEW_AUDIT',
    'VIEW_REPORTS', 'MANAGE_REPORTS',
  ],
  editor: [
    'VIEW_DASHBOARD', 'VIEW_DEVICES', 'VIEW_ANALYTICS', 'METER_WRITE',
    'DEVICE_EDIT', 'DEVICE_TRANSFER', 'LIFECYCLE_EDIT',
    'EXPORT_PRINT', 'PRINT',
    'WO_CREATE', 'WO_VIEW_ALL', 'WO_COMPLETE',
    'STOCK_VIEW', 'STOCK_IN', 'STOCK_OUT',
    'IMPORT_DATA',
    'VIEW_REPORTS',
  ],
  meter: [
    'VIEW_DASHBOARD', 'VIEW_DEVICES', 'VIEW_ANALYTICS', 'METER_WRITE',
    'PRINT',
    'WO_CREATE', 'WO_VIEW_OWN',
    'VIEW_REPORTS',
  ],
  viewer: [
    'VIEW_DASHBOARD', 'VIEW_DEVICES', 'VIEW_ANALYTICS', 'PRINT',
    'WO_VIEW_SITE', 'STOCK_VIEW',
    'VIEW_REPORTS',
  ],
}

const ROLE_ALIASES: Record<string, Role> = {
  superadmin: 'superadmin',
  'super admin': 'superadmin',
  'super-admin': 'superadmin',
  admin: 'admin',
  administrator: 'admin',
  ผู้ดูแล: 'admin',
  แอดมิน: 'admin',
  ผู้ดูแลระบบ: 'admin',
  editor: 'editor',
  edit: 'editor',
  manager: 'editor',
  เจ้าหน้าที่: 'editor',
  ผู้แก้ไข: 'editor',
  meter: 'meter',
  meterreader: 'meter',
  meter_reader: 'meter',
  จดมิเตอร์: 'meter',
  viewer: 'viewer',
  read: 'viewer',
  readonly: 'viewer',
  view: 'viewer',
  ผู้ชม: 'viewer',
  ผู้ดูรายงาน: 'viewer',
}

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'ผู้ดูแลสูงสุด',
  admin: 'ผู้ดูแลระบบ',
  editor: 'เจ้าหน้าที่จัดการข้อมูล',
  meter: 'ผู้จดมิเตอร์',
  viewer: 'ผู้ดูรายงาน',
}

/** Permission metadata — used by the Permission Management UI to render
 *  grouped checkboxes. Order = display order. */
export interface PermissionMeta {
  key: Permission
  label: string
  desc: string
}
export interface PermissionGroup {
  title: string
  icon: string
  perms: PermissionMeta[]
}
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'อุปกรณ์',
    icon: '💻',
    perms: [
      { key: 'VIEW_DEVICES', label: 'ดูอุปกรณ์', desc: 'เปิดหน้าจัดการอุปกรณ์' },
      { key: 'DEVICE_EDIT', label: 'แก้ไขอุปกรณ์', desc: 'สร้าง/แก้ไขข้อมูลอุปกรณ์' },
      { key: 'DEVICE_DELETE', label: 'ลบอุปกรณ์', desc: 'ลบอุปกรณ์ออกจากระบบ' },
      { key: 'DEVICE_TRANSFER', label: 'ย้ายอุปกรณ์', desc: 'ย้ายสาขา/ตำแหน่งอุปกรณ์' },
      { key: 'LIFECYCLE_EDIT', label: 'เปลี่ยนสถานะ Lifecycle', desc: 'เปลี่ยนสถานะการใช้งาน' },
      { key: 'MASTER_DATA_EDIT', label: 'ข้อมูลมาตรฐาน', desc: 'แก้ไข Brand/Type/Department' },
    ],
  },
  {
    title: 'มิเตอร์',
    icon: '📈',
    perms: [
      { key: 'VIEW_ANALYTICS', label: 'ดู Analytics', desc: 'เปิดหน้าวิเคราะห์กระดาษ' },
      { key: 'METER_WRITE', label: 'จดมิเตอร์', desc: 'บันทึกการจดมิเตอร์รายเดือน' },
    ],
  },
  {
    title: 'ใบงาน',
    icon: '🔧',
    perms: [
      { key: 'WO_CREATE', label: 'สร้างใบงาน', desc: 'แจ้งซ่อมใหม่' },
      { key: 'WO_VIEW_ALL', label: 'ดูใบงานทั้งหมด', desc: 'เห็นทุกใบงานในระบบ' },
      { key: 'WO_VIEW_SITE', label: 'ดูใบงานสาขาตัวเอง', desc: 'เห็นเฉพาะใบงานของสาขา' },
      { key: 'WO_VIEW_OWN', label: 'ดูใบงานที่ตัวเองแจ้ง', desc: 'เห็นเฉพาะใบงานที่แจ้งเอง' },
      { key: 'WO_ASSIGN', label: 'มอบหมายใบงาน', desc: 'มอบหมายช่าง/เจ้าหน้าที่' },
      { key: 'WO_COMPLETE', label: 'ปิดงาน', desc: 'ทำเครื่องหมายว่าเสร็จสิ้น' },
      { key: 'WO_CANCEL', label: 'ยกเลิกใบงาน', desc: 'ยกเลิกใบงานที่ยังไม่เสร็จ' },
    ],
  },
  {
    title: 'สต็อก',
    icon: '📦',
    perms: [
      { key: 'STOCK_VIEW', label: 'ดูสต็อก', desc: 'เปิดหน้าคลังสินค้า' },
      { key: 'STOCK_IN', label: 'รับเข้า', desc: 'บันทึกการรับสินค้าเข้าคลัง' },
      { key: 'STOCK_OUT', label: 'เบิกออก', desc: 'บันทึกการเบิกสินค้า' },
      { key: 'STOCK_APPROVE', label: 'อนุมัติเบิก', desc: 'อนุมัติคำขอเบิกที่รออนุมัติ' },
    ],
  },
  {
    title: 'ระบบ',
    icon: '⚙️',
    perms: [
      { key: 'VIEW_DASHBOARD', label: 'ดู Dashboard', desc: 'เปิดหน้าสรุปภาพรวม' },
      { key: 'EXPORT_PRINT', label: 'ส่งออก/พิมพ์', desc: 'Export CSV + พิมพ์สติกเกอร์' },
      { key: 'PRINT', label: 'พิมพ์', desc: 'พิมพ์เอกสาร/สติกเกอร์' },
      { key: 'TEMPLATES_MANAGE', label: 'จัดการเทมเพลต', desc: 'สร้าง/แก้ไขเทมเพลต' },
      { key: 'IMPORT_DATA', label: 'นำเข้าข้อมูล', desc: 'Import CSV/Excel' },
      { key: 'VIEW_AUDIT', label: 'ดู Audit Log', desc: 'เปิดหน้าประวัติการใช้งาน' },
      { key: 'USER_MANAGE', label: 'จัดการผู้ใช้', desc: 'สร้าง/แก้ไข/ลบ ผู้ใช้' },
      { key: 'SYSTEM_CONFIG', label: 'ตั้งค่าระบบ', desc: 'ตั้งค่าการแจ้งเตือน/แอป' },
      { key: 'ADMIN', label: 'ผู้ดูแล', desc: 'สิทธิ์ผู้ดูแลระบบทั่วไป' },
      { key: 'VIEW_REPORTS', label: 'ดูรายงาน', desc: 'เปิดหน้ารายงาน/วิเคราะห์ข้อมูล' },
      { key: 'MANAGE_REPORTS', label: 'จัดการรายงาน', desc: 'สร้าง/แก้ไข/ลบรายงานที่บันทึกไว้' },
    ],
  },
]

/** All permission keys — flat list, useful for "select all" UIs. */
export const ALL_PERMISSION_KEYS: Permission[] = PERMISSION_GROUPS.flatMap((g) =>
  g.perms.map((p) => p.key),
)

export function normalizeRole(role: string | null | undefined): Role {
  const key = String(role ?? '').trim().toLowerCase()
  if (key in ROLE_PERMISSIONS) return key as Role
  return ROLE_ALIASES[key] ?? 'viewer'
}

export function getRolePermissions(role: string | null | undefined): Permission[] {
  return ROLE_PERMISSIONS[normalizeRole(role)] ?? ROLE_PERMISSIONS.viewer
}

/**
 * Parse the `permissions` field stored on the User row. Accepts BOTH:
 *   • a JSON array string — e.g. `["WO_CREATE","PRINT"]`
 *   • a comma-separated list — e.g. `"WO_CREATE,PRINT"`
 * Returns `null` when the input is empty/invalid so callers can fall back
 * to the role's default permission set.
 */
export function parseCustomPermissions(raw: string | null | undefined): Permission[] | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Try JSON array first
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        const arr = parsed
          .map((p) => String(p ?? '').trim())
          .filter(Boolean) as Permission[]
        return arr.length ? arr : null
      }
    } catch {
      // fall through to comma-split
    }
  }
  // Comma-separated
  const arr = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as Permission[]
  return arr.length ? arr : null
}

/**
 * Merge a role's default permissions with a user's custom permissions.
 * The custom list is treated as ADDITIVE — granting extra permissions on
 * top of the role's defaults. (To revoke a permission, change the role.)
 *
 * Superadmins always get every permission.
 */
export function getUserPermissions(
  role: string | null | undefined,
  customPermissions?: string | string[] | null,
): Permission[] {
  const r = normalizeRole(role)
  const rolePerms = getRolePermissions(r)
  // Superadmins always get the full set (no further grants needed)
  if (r === 'superadmin') return rolePerms

  let custom: Permission[] | null = null
  if (Array.isArray(customPermissions)) {
    custom = customPermissions.length
      ? (customPermissions.map((p) => String(p).trim()).filter(Boolean) as Permission[])
      : null
  } else if (typeof customPermissions === 'string') {
    custom = parseCustomPermissions(customPermissions)
  }

  if (!custom || custom.length === 0) return rolePerms
  // Merge + dedupe (preserve order: role perms first, then custom extras)
  const set = new Set<Permission>(rolePerms)
  for (const p of custom) set.add(p)
  return Array.from(set)
}

export function hasPermission(role: string | null | undefined, permission: Permission): boolean {
  return getRolePermissions(role).includes(permission)
}

/**
 * Check whether a permission list (already merged for a user) contains
 * the given permission. Used by middleware that loads the row from DB.
 */
export function hasResolvedPermission(perms: Permission[], permission: Permission): boolean {
  return Array.isArray(perms) && perms.includes(permission)
}

export function isAdminRole(role: string | null | undefined): boolean {
  const r = normalizeRole(role)
  return r === 'admin' || r === 'superadmin'
}

export function isSuperAdminRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === 'superadmin'
}

// ─── Site access (mirror of Auth.gs parseAllowedSitesValue + canAccessSite) ─
// SECURITY FIX: Previously, a non-superadmin user with empty/null allowedSites
// was treated as 'ALL' (fail-open). This is incompatible with the Phase 1
// "no grant = no access" policy. Now, empty/null allowedSites for non-superadmin
// returns an empty array (fail-closed). Existing users without allowedSites
// must be granted explicit access via UserSiteGrant or allowedSites.
export function getAllowedSites(user: Pick<UserPermissionRow, 'role' | 'allowedSites'>): string[] | 'ALL' {
  if (isSuperAdminRole(user.role) || normalizeRole(user.role) === 'admin') return 'ALL'
  const raw = String(user.allowedSites ?? '').trim()
  if (raw.toUpperCase() === 'ALL') return 'ALL'
  const arr = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return arr // empty array = no sites (fail-closed)
}

export function canAccessSite(
  user: Pick<UserPermissionRow, 'role' | 'allowedSites'>,
  site: string | null | undefined,
): boolean {
  const allowed = getAllowedSites(user)
  if (allowed === 'ALL') return true
  const t = String(site ?? '').trim()
  if (!t) return false
  return allowed.includes(t)
}

/**
 * Build a Prisma `where` fragment that restricts `Device.site` to the user's
 * allowed sites. Returns an empty object when the user has 'ALL'.
 */
export function siteFilterForUser(
  user: Pick<UserPermissionRow, 'role' | 'allowedSites'>,
  field: 'site' = 'site',
): Record<string, unknown> {
  const allowed = getAllowedSites(user)
  if (allowed === 'ALL') return {}
  return { [field]: { in: allowed } }
}

/** Convert a DB row → safe AuthUser (no hashes/salts leak).
 *  Merges role permissions + the user's custom permissions.
 *  SECURITY FIX: null allowedSites for non-superadmin now returns '' (no sites)
 *  instead of 'ALL' (fail-closed). */
export function toAuthUser(row: UserPermissionRow): AuthUser {
  const role = normalizeRole(row.role)
  const permissions = getUserPermissions(role, row.permissions)
  return {
    id: row.id,
    email: row.email,
    role,
    name: row.name,
    username: row.username,
    allowedSites: (isSuperAdminRole(role) || role === 'admin') ? 'ALL' : (row.allowedSites ?? ''),
    permissions,
    active: row.active === true,
    isDemo: row.isDemo === true,
    organizationId: row.organizationId ?? null,
  }
}
