/**
 * seed-authorization-catalog.ts — Seed Role, Permission, RolePermission tables.
 *
 * Task ID: PHASE1-AUTH-FOUNDATION
 *
 * This script populates the authorization catalog from the in-code
 * ROLE_PERMISSIONS and PERMISSION_GROUPS definitions in auth-shared.ts.
 * It is idempotent — running it multiple times is safe.
 *
 * Run with: bun scripts/seed-authorization-catalog.ts
 */

import { db } from '../src/lib/db'
import {
  ROLE_PERMISSIONS,
  ROLE_LABELS,
  PERMISSION_GROUPS,
  ALL_PERMISSION_KEYS,
  type Permission,
  type Role,
} from '../src/lib/auth-shared'

async function main() {
  console.log('Seeding authorization catalog...')

  // ── 1) Seed Permission table ──
  // Map each permission to resource + action based on its key prefix
  const permMeta: Record<string, { resource: string; action: string; desc: string }> = {}
  for (const group of PERMISSION_GROUPS) {
    for (const p of group.perms) {
      // Derive resource from group title, action from the permission key
      const resourceMap: Record<string, string> = {
        'อุปกรณ์': 'device',
        'มิเตอร์': 'meter',
        'ใบงาน': 'work_order',
        'สต็อก': 'stock',
        'ระบบ': 'system',
      }
      const resource = resourceMap[group.title] ?? 'system'
      // Extract action from the key (e.g. VIEW_DEVICES → view, DEVICE_EDIT → edit)
      let action = 'view'
      if (p.key.includes('_CREATE')) action = 'create'
      else if (p.key.includes('_EDIT')) action = 'edit'
      else if (p.key.includes('_DELETE')) action = 'delete'
      else if (p.key.includes('_TRANSFER')) action = 'transfer'
      else if (p.key.includes('_ASSIGN')) action = 'assign'
      else if (p.key.includes('_COMPLETE')) action = 'complete'
      else if (p.key.includes('_CANCEL')) action = 'cancel'
      else if (p.key.includes('_APPROVE')) action = 'approve'
      else if (p.key.includes('_MANAGE')) action = 'manage'
      else if (p.key.includes('_IMPORT')) action = 'import'
      else if (p.key.includes('_IN')) action = 'stock_in'
      else if (p.key.includes('_OUT')) action = 'stock_out'
      else if (p.key.includes('_WRITE')) action = 'write'
      else if (p.key.includes('_VIEW')) action = 'view'
      permMeta[p.key] = { resource, action, desc: p.desc }
    }
  }

  let permCount = 0
  for (const key of ALL_PERMISSION_KEYS) {
    const meta = permMeta[key] ?? { resource: 'system', action: 'view', desc: key }
    await db.permission.upsert({
      where: { code: key },
      update: {
        resource: meta.resource,
        action: meta.action,
        description: meta.desc,
        active: true,
      },
      create: {
        code: key,
        resource: meta.resource,
        action: meta.action,
        description: meta.desc,
        active: true,
      },
    })
    permCount++
  }
  console.log(`  ✓ Seeded ${permCount} permissions`)

  // ── 2) Seed Role table ──
  const roleDescriptions: Record<Role, string> = {
    superadmin: 'ผู้ดูแลระบบสูงสุด — เข้าถึงทุก Site และฟังก์ชัน',
    admin: 'ผู้ดูแลระบบ — จัดการข้อมูลและผู้ใช้ภายใน Site ที่ได้รับมอบหมาย',
    editor: 'ผู้แก้ไข — สร้าง/แก้ไขข้อมูลปฏิบัติการได้',
    meter: 'ผู้จดมิเตอร์ — บันทึกการจดมิเตอร์เท่านั้น',
    viewer: 'ผู้ดู — อ่านข้อมูลได้เท่านั้น ไม่สามารถแก้ไข',
  }
  let roleCount = 0
  for (const roleCode of Object.keys(ROLE_PERMISSIONS) as Role[]) {
    await db.role.upsert({
      where: { code: roleCode },
      update: {
        name: ROLE_LABELS[roleCode],
        description: roleDescriptions[roleCode],
        isSystem: true,
        active: true,
      },
      create: {
        code: roleCode,
        name: ROLE_LABELS[roleCode],
        description: roleDescriptions[roleCode],
        isSystem: true,
        active: true,
      },
    })
    roleCount++
  }
  console.log(`  ✓ Seeded ${roleCount} roles`)

  // ── 3) Seed RolePermission join table ──
  let rpCount = 0
  for (const roleCode of Object.keys(ROLE_PERMISSIONS) as Role[]) {
    const perms = ROLE_PERMISSIONS[roleCode]
    for (const permCode of perms) {
      await db.rolePermission.upsert({
        where: {
          roleCode_permissionCode: { roleCode, permissionCode: permCode },
        },
        update: {},
        create: {
          roleCode,
          permissionCode: permCode,
        },
      })
      rpCount++
    }
  }
  console.log(`  ✓ Seeded ${rpCount} role-permission mappings`)

  // ── 4) Summary ──
  const totalRoles = await db.role.count()
  const totalPerms = await db.permission.count()
  const totalRP = await db.rolePermission.count()
  const totalGrants = await db.userSiteGrant.count()
  console.log('')
  console.log('=== Authorization Catalog Summary ===')
  console.log(`  Roles:           ${totalRoles}`)
  console.log(`  Permissions:     ${totalPerms}`)
  console.log(`  RolePermissions: ${totalRP}`)
  console.log(`  UserSiteGrants:  ${totalGrants}`)
  console.log('')
  console.log('Done. Catalog is ready for buildAuthorizationContext().')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
