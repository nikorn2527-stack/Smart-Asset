/**
 * GET /api/settings/completion
 *
 * Settings Completion Guidance per UX/UI Standards §4.
 *
 * Returns actionable items based on REAL database data:
 *   - status: 'complete' | 'incomplete' | 'not_started' | 'error' | 'not_required' | 'permission_limited'
 *   - reason: WHY this needs action (Thai)
 *   - impact: WHAT modules/features are affected if not set (Thai)
 *   - href: deep-link to the settings tab (e.g. /?tab=master)
 *   - section: optional hash for field-level scroll (e.g. #approvers)
 *   - canEdit: false if user lacks permission (filtered out of actionable list by client)
 *   - requiredFor: machine-readable module keys (e.g. ['devices','work-orders'])
 *
 * IMPORTANT: This is NOT a menu duplicate. The client filters to only
 * show actionable items (incomplete / not_started / error) that the user
 * can edit. `not_required` and `permission_limited` items are excluded
 * from the user's pending list.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-middleware'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { getUserPermissions, type Permission } from '@/lib/auth'

export interface CompletionItem {
  key: string
  category: string
  label: string
  description?: string
  status: 'complete' | 'incomplete' | 'not_started' | 'error' | 'not_required' | 'permission_limited'
  reason?: string
  impact?: string
  href?: string
  section?: string
  canEdit: boolean
  requiredFor?: string[]
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, 'VIEW_DASHBOARD')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const user = auth.row
  const ctx = await buildAuthorizationContext(auth.user, auth.row.id, auth.row.allowedSites)
  const organizationId = auth.row.organizationId ?? auth.user.organizationId ?? null
  const organizationWhere = organizationId
    ? { organizationId }
    : { organizationId: null }
  const organizationOrGlobalWhere = organizationId
    ? { OR: [{ organizationId }, { organizationId: null }] }
    : { organizationId: null }
  const canEdit = ctx.can('SYSTEM_CONFIG') || ctx.can('ADMIN')
  const canManageUsers = ctx.can('USER_MANAGE') || canEdit
  const canEditMasterData = ctx.can('MASTER_DATA_EDIT') || canEdit
  const canManageSync = canEdit

  const items: CompletionItem[] = []

  // 1. Organization
  try {
    const orgCount = organizationId
      ? await db.organization.count({ where: { id: organizationId } })
      : await db.organization.count({ where: { active: true } })
    items.push({
      key: 'organization',
      category: 'ระบบและองค์กร',
      label: 'ข้อมูลหน่วยงาน',
      description: 'องค์กรหลักที่ใช้ในระบบ (สำหรับ multi-org และ sync)',
      status: orgCount > 0 ? 'complete' : 'not_started',
      href: '/?tab=organizations',
      section: '#org-primary',
      canEdit,
      reason: orgCount > 0 ? undefined : 'ยังไม่ได้สร้างองค์กรหลัก',
      impact: orgCount > 0 ? undefined : 'การซิงค์ข้อมูลข้ามสาขา และการแยกข้อมูลระหว่างองค์กรจะทำงานไม่ได้',
      requiredFor: ['multi-org', 'sync'],
    })
  } catch {
    items.push({
      key: 'organization', category: 'ระบบและองค์กร', label: 'ข้อมูลหน่วยงาน',
      status: 'error', canEdit, reason: 'ตรวจสอบไม่ได้', impact: 'ไม่สามารถยืนยันสถานะองค์กรได้',
    })
  }

  // 2. Sites
  try {
    const siteCount = await db.siteAttribute.count({ where: organizationWhere })
    items.push({
      key: 'sites',
      category: 'ระบบและองค์กร',
      label: 'ไซต์/สาขา',
      description: 'สาขาที่ติดตั้งอุปกรณ์ (ใช้ในการกรองและรายงาน)',
      status: siteCount > 0 ? 'complete' : 'incomplete',
      href: '/?tab=site-attributes',
      section: '#site-list',
      canEdit,
      reason: siteCount > 0 ? undefined : 'ยังไม่มีสาขาในระบบ',
      impact: siteCount > 0 ? undefined : 'ไม่สามารถลงทะเบียนอุปกรณ์หรือสร้าง Work Order ได้ เพราะต้องเลือกสาขาปลายทาง',
      requiredFor: ['devices', 'work-orders'],
    })
  } catch {
    items.push({
      key: 'sites', category: 'ระบบและองค์กร', label: 'ไซต์/สาขา',
      status: 'error', canEdit, reason: 'ตรวจสอบไม่ได้', impact: 'ไม่สามารถยืนยันสถานะสาขาได้',
    })
  }

  // 3. Users
  try {
    const userCount = await db.user.count({ where: { ...organizationWhere, active: true } })
    items.push({
      key: 'users',
      category: 'ผู้ใช้และความปลอดภัย',
      label: 'ผู้ใช้และสิทธิ์',
      description: 'บัญชีผู้ใช้ที่เข้าสู่ระบบและดำเนินงานได้',
      status: userCount > 0 ? 'complete' : 'not_started',
      href: '/?tab=users',
      section: '#user-list',
      canEdit: canManageUsers,
      reason: userCount > 0 ? undefined : 'ยังไม่มีผู้ใช้ในระบบ',
      impact: userCount > 0 ? undefined : 'ไม่มีใครเข้าสู่ระบบได้นอกจากบัญชี superadmin',
      requiredFor: ['all'],
    })
  } catch {
    items.push({
      key: 'users', category: 'ผู้ใช้และความปลอดภัย', label: 'ผู้ใช้และสิทธิ์',
      status: 'error', canEdit, reason: 'ตรวจสอบไม่ได้', impact: 'ไม่สามารถยืนยันสถานะผู้ใช้ได้',
    })
  }

  // 4. Master Data
  try {
    const masterCount = await db.masterItem.count({ where: organizationOrGlobalWhere })
    items.push({
      key: 'master-data',
      category: 'ข้อมูลและการดำเนินงาน',
      label: 'Master Data',
      description: 'ข้อมูลมาตรฐาน: ประเภท, ยี่ห้อ, รุ่น, ปัญหา, วิธีแก้',
      status: masterCount > 0 ? 'complete' : 'incomplete',
      href: '/?tab=master',
      section: '#master-list',
      canEdit: canEditMasterData,
      reason: masterCount > 0 ? undefined : 'ยังไม่มีข้อมูลมาตรฐานในระบบ',
      impact: masterCount > 0 ? undefined : 'การสร้างอุปกรณ์และ Work Order จะกรอกข้อมูลได้ยาก เพราะ dropdown จะว่าง',
      requiredFor: ['devices', 'work-orders'],
    })
  } catch {
    items.push({
      key: 'master-data', category: 'ข้อมูลและการดำเนินงาน', label: 'Master Data',
      status: 'error', canEdit, reason: 'ตรวจสอบไม่ได้', impact: 'ไม่สามารถยืนยันสถานะ master data ได้',
    })
  }

  // 5. Notifications
  try {
    const notifSettings = await db.appSetting.findFirst({ where: { key: 'notifyemails' } })
    const hasNotif = notifSettings && notifSettings.value
    items.push({
      key: 'notifications',
      category: 'การแจ้งเตือน',
      label: 'การแจ้งเตือน',
      description: 'ช่องทางแจ้งเตือน (Email / LINE / Telegram)',
      status: hasNotif ? 'complete' : 'not_started',
      href: '/?tab=notifications',
      section: '#channel-config',
      canEdit,
      reason: hasNotif ? undefined : 'ยังไม่ได้ตั้งค่าช่องทางแจ้งเตือน',
      impact: hasNotif ? undefined : 'ผู้ใช้จะไม่ได้รับการแจ้งเตือนเมื่อมี Work Order ใหม่ หรืออุปกรณ์ใกล้หมดประกัน',
      requiredFor: [],
    })
  } catch {
    items.push({
      key: 'notifications', category: 'การแจ้งเตือน', label: 'การแจ้งเตือน',
      status: 'not_required', canEdit, reason: 'ไม่จำเป็น', impact: 'ไม่กระทบ',
    })
  }

  // 6. OAuth (optional)
  items.push({
    key: 'oauth',
    category: 'ผู้ใช้และความปลอดภัย',
    label: 'OAuth/เข้าสู่ระบบภายนอก',
    description: 'Google / LINE / Apple / Telegram sign-in',
    status: 'not_required',
    canEdit,
    reason: 'ไม่จำเป็น — ใช้รหัสผ่านเข้าสู่ระบบได้',
    impact: 'ไม่มีผลกระทบ',
  })

  // 7. Sync (optional — only if user enabled sync module)
  try {
    const nodeCount = organizationId
      ? await db.syncNode.count({ where: { organizationId } })
      : 0
    items.push({
      key: 'sync-nodes',
      category: 'การตรวจสอบ',
      label: 'Sync Status',
      description: 'การเชื่อมต่อกับ offline node (สาขาที่ไม่ได้ออนไลน์ตลอด)',
      status: nodeCount > 0 ? 'complete' : 'not_required',
      href: '/?tab=sync-test',
      section: '#node-list',
      canEdit: canManageSync,
      reason: nodeCount > 0 ? undefined : 'ไม่ได้ใช้ Offline Sync',
      impact: nodeCount > 0 ? undefined : 'ไม่มีผล หากทุกสาขาออนไลน์ตลอดเวลา',
      requiredFor: [],
    })
  } catch {
    items.push({
      key: 'sync-nodes', category: 'การตรวจสอบ', label: 'Sync Status',
      status: 'not_required', canEdit,
    })
  }

  // 8. Number patterns
  try {
    const patternCount = await db.assetNumberPattern.count({ where: organizationOrGlobalWhere })
    items.push({
      key: 'number-patterns',
      category: 'ข้อมูลและการดำเนินงาน',
      label: 'รูปแบบเลขที่ทรัพย์สิน',
      description: 'รูปแบบรหัสอุปกรณ์อัตโนมัติ เช่น SITE-YYYY-NNNN',
      status: patternCount > 0 ? 'complete' : 'incomplete',
      href: '/?tab=number-patterns',
      section: '#pattern-list',
      canEdit: canEditMasterData,
      reason: patternCount > 0 ? undefined : 'ยังไม่ได้ตั้งค่ารูปแบบเลขที่ทรัพย์สิน',
      impact: patternCount > 0 ? undefined : 'ระบบจะใช้รหัสอัตโนมัติแบบ default (เลขลำดับ) ทำให้ไม่สามารถแยกสาขา/ปี จากโค้ดได้',
      requiredFor: ['devices'],
    })
  } catch {
    items.push({
      key: 'number-patterns', category: 'ข้อมูลและการดำเนินงาน', label: 'รูปแบบเลขที่ทรัพย์สิน',
      status: 'not_required', canEdit,
    })
  }

  // 9. Approvers (for Work Order workflow)
  try {
    // Check effective Work Order completion permission instead of assuming
    // that every admin role is an approver. Custom role/user permissions and
    // organization scope must be respected here.
    const approverCandidates = await db.user.findMany({
      where: { ...organizationWhere, active: true },
      select: { role: true, permissions: true },
    })
    const approverCount = approverCandidates.filter((candidate) =>
      getUserPermissions(candidate.role, candidate.permissions).includes('WO_COMPLETE' as Permission),
    ).length
    items.push({
      key: 'approvers',
      category: 'ผู้ใช้และความปลอดภัย',
      label: 'ผู้อนุมัติ Work Order',
      description: 'บัญชีที่มีสิทธิ์อนุมัติ Work Order ก่อนดำเนินการ',
      status: approverCount > 0 ? 'complete' : 'incomplete',
      href: '/?tab=users',
      section: '#approvers',
      canEdit: canManageUsers,
      reason: approverCount > 0 ? undefined : 'ยังไม่ได้กำหนดผู้อนุมัติ',
      impact: approverCount > 0 ? undefined : 'Work Order จะสร้างได้ แต่ส่งอนุมัติไม่ได้ — งานจะค้างในสถานะ PENDING_REVIEW',
      requiredFor: ['work-orders'],
    })
  } catch {
    items.push({
      key: 'approvers', category: 'ผู้ใช้และความปลอดภัย', label: 'ผู้อนุมัติ Work Order',
      status: 'not_required', canEdit,
    })
  }

  // Compute progress percentage (excluding not_required and permission_limited)
  const eligible = items.filter(
    i => i.status !== 'not_required' && i.status !== 'permission_limited',
  )
  const completed = eligible.filter(i => i.status === 'complete').length
  const percentage = eligible.length > 0
    ? Math.round((completed / eligible.length) * 100)
    : 100

  return NextResponse.json({ items, percentage, total: eligible.length, completed })
}
