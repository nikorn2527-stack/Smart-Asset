import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateGuestContact } from '@/lib/guest-validation'
import { notifyWorkOrderCreated } from '@/lib/notifications'
import { requireAuth } from '@/lib/auth-middleware'
import { getOrgScope } from '@/lib/org-scope'
import { buildAuthorizationContext } from '@/lib/authorization-context'
import { normalizeSiteCode } from '@/lib/site-scope'
import { demoTag, demoFilter } from '@/lib/demo-mode'
import { withRetryOnUnique } from '@/lib/retry-unique'
import { moduleUnavailableResponse } from '@/lib/module-gate'
import { STATUS_MAPPINGS } from '@/lib/csv-field-mapping'
import { isNumericShortQuery } from '@/lib/suffix-search'
import {
  getActiveWoPattern,
  generateWoNumberFromPattern,
  ensureDefaultWoPatterns,
} from '@/lib/wo-number-pattern'
import { allocateNextNumber } from '@/lib/numbering-engine'

// Allowed status values
const VALID_STATUSES = new Set([
  'PENDING',
  'PENDING_REVIEW',
  'IN_PROGRESS',
  'WAITING_PARTS',
  'COMPLETED',
  'CANCELLED',
])

const VALID_PRIORITIES = new Set(['ปกติ', 'ปานกลาง', 'สูง', 'ด่วน'])

const VALID_SOURCES = new Set(['session', 'guest', 'line_liff', 'public_qr', 'line'])

function pad3(n: number): string {
  return String(n).padStart(3, '0')
}

/**
 * Writes an AuditLog row with an explicit actor. Non-fatal.
 */
async function logAudit(
  action: string,
  entityId: string | null,
  summary: string,
  detail: Record<string, unknown> | null,
  actor: string,
  siteCode?: string | null,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action,
        entity: 'WorkOrder',
        entityId,
        summary,
        detail: detail ? JSON.stringify(detail) : null,
        actor,
        siteCode: siteCode ?? null,
      },
    })
  } catch (err) {
    console.error('logAudit failed:', err)
  }
}

/**
 * Generates the next WO number.
 *
 * Priority:
 *   1. If there is an active WoNumberPattern in the DB → use it.
 *      - `{prefix}{seq:4}`   → PPIT0001 (no dash)
 *      - `{prefix}-{seq:4}`  → PPIT-0001
 *   2. Fallback: legacy PPIT logic — find MAX existing PPIT id + 1.
 *      Falls back to WO-YYYYMMDD-NNN if no PPIT numbers exist (new system).
 */
async function generateWoNumber(): Promise<string | null> {
  // ── 0. Flexible Numbering Engine (ตั้งค่า → เลขใบงาน แบบใหม่) ──
  // ถ้าผู้ดูแลเปิดใช้ NumberingScheme (docType='work-order') ให้ใช้ engine
  // นี้ก่อน — รองรับหมวดหมู่/ปี พ.ศ./รีเซ็ตรายปี เช่น WO-69-0001
  const engineNumber = await allocateNextNumber('work-order', {
    site: null,
  }).catch(() => null)
  if (engineNumber) {
    // ตรวจซ้ำกับ id เดิม (id = woNumber ในระบบนี้)
    const exists = await db.workOrder.findUnique({
      where: { id: engineNumber },
      select: { id: true },
    })
    if (!exists) return engineNumber
  }

  // ── 1. Try the active WoNumberPattern from the settings DB ──
  await ensureDefaultWoPatterns().catch(() => {})
  const activePattern = await getActiveWoPattern().catch(() => null)
  if (activePattern) {
    const generated = await generateWoNumberFromPattern(activePattern).catch(() => null)
    if (generated) return generated
  }

  // ── 2. Fallback: original PPIT format (PPIT + sequence) ──
  // Find MAX id that starts with PPIT (e.g. PPIT3888)
  const lastPpit = await db.workOrder.findFirst({
    where: { id: { startsWith: 'PPIT' } },
    orderBy: { id: 'desc' },
    select: { id: true },
  })
  let nextSeq = 1
  if (lastPpit?.id) {
    const m = lastPpit.id.match(/(\d+)$/)
    if (m) nextSeq = parseInt(m[1], 10) + 1
  }
  // Also check numeric ids (e.g. 001, 281) — fetch all and filter in JS
  // (Prisma doesn't support regex in where clause)
  const allIds = await db.workOrder.findMany({
    where: { id: { not: { startsWith: 'PPIT' } } },
    select: { id: true },
  })
  const numericIds = allIds
    .map(r => parseInt(r.id, 10))
    .filter(n => !isNaN(n) && n > 0)
  if (numericIds.length > 0) {
    const maxNumeric = Math.max(...numericIds)
    if (maxNumeric >= nextSeq) nextSeq = maxNumeric + 1
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `PPIT${String(nextSeq + attempt).padStart(4, '0')}`
    const exists = await db.workOrder.findUnique({
      where: { id: candidate },
      select: { id: true },
    })
    if (!exists) {
      // Use PPIT format as both id AND woNumber
      return candidate
    }
  }
  return null
}

/**
 * Validates the externalMeta payload (for external / off-site work orders).
 * Returns a normalized object or null if invalid.
 */
function normalizeExternalMeta(input: unknown): {
  clientName: string
  place?: string
  contactPhone?: string
  serials?: string[]
} | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  const clientName = String(obj.clientName ?? '').trim()
  if (!clientName) return null
  const out: {
    clientName: string
    place?: string
    contactPhone?: string
    serials?: string[]
  } = { clientName }
  if (typeof obj.place === 'string' && obj.place.trim()) {
    out.place = obj.place.trim()
  }
  if (typeof obj.contactPhone === 'string' && obj.contactPhone.trim()) {
    out.contactPhone = obj.contactPhone.trim()
  }
  if (Array.isArray(obj.serials)) {
    const serials = obj.serials
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
    if (serials.length > 0) out.serials = serials
  }
  return out
}

export async function GET(req: NextRequest) {
  // ── Phase 4.3: Module availability gate ──
  // Returns 404 MODULE_DISABLED when the 'work-orders' module is disabled.
  const moduleCheck = await moduleUnavailableResponse('work-orders')
  if (moduleCheck) return moduleCheck

  // ── Authentication: require an authenticated session ──
  // Previously this route returned work orders with NO auth check at all
  // — anyone hitting the endpoint could see every WO in the system
  // (including reporter names, phone numbers, internal notes). This is
  // a Blocker. Now any authenticated user can list, but the result set
  // is scoped to the user's Site grants via buildAuthorizationContext.
  const auth = await requireAuth(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // ── Organization scope (Phase 1 multi-org) ──
  const orgScope = getOrgScope(auth.user)
  if (!orgScope.ok) {
    return NextResponse.json({ error: orgScope.error.message }, { status: orgScope.error.status })
  }

  try {
    // ── Build authorization context for Site scope ──
    const ctx = await buildAuthorizationContext(
      auth.user,
      auth.row.id,
      auth.row.allowedSites,
    )
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim() ?? ''
    const status = searchParams.get('status')?.trim() ?? ''
    const priority = searchParams.get('priority')?.trim() ?? ''
    const assignedTo = searchParams.get('assignedTo')?.trim() ?? ''
    const specialFeeParam = searchParams.get('specialFee')?.trim().toLowerCase()
    const specialFee =
      specialFeeParam === 'true' || specialFeeParam === '1'
        ? true
        : specialFeeParam === 'false' || specialFeeParam === '0'
          ? false
          : null
    const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
    const pageSize = Math.min(
      100,
      Math.max(1, Number(searchParams.get('pageSize') ?? '20') || 20),
    )

    // ── Optional client-side site filter (superadmin can filter to a single site) ──
    // Non-superadmin users are already scope-restricted below; their `site`
    // param must be a subset of their allowed sites or it's ignored.
    const siteParam = searchParams.get('site')?.trim() ?? ''

    // ── Site scope enforcement ──
    // superadmin → no filter (sees all WOs) unless `site` param is provided
    // non-superadmin with grants → restrict to WO.siteCode in scope OR
    //   (WO.siteCode is null AND WO.device.site in scope) — this catches
    //   legacy rows that haven't been backfilled with siteCode yet.
    // non-superadmin with no grants → empty list (fail-closed).
    let siteFilter: Record<string, unknown> | null = null
    if (ctx.isSuperAdmin || ctx.globalRole === 'admin' || auth.isDemo) {
      // superadmin: apply optional `site` param filter if provided
      if (siteParam) {
        siteFilter = {
          OR: [
            { siteCode: siteParam },
            { siteCode: null, device: { site: siteParam } },
          ],
        }
      }
    } else if (
      ctx.siteScope.kind === 'sites' &&
      ctx.siteScope.siteCodes.length > 0
    ) {
      const allowed = ctx.siteScope.siteCodes
      siteFilter = {
        OR: [
          { siteCode: { in: allowed } },
          { siteCode: null, device: { site: { in: allowed } } },
        ],
      }
    } else {
      // kind === 'none' or legacy 'all' fallback that resolves to no sites
      // → fail-closed: return empty list.
      return NextResponse.json({
        data: [],
        pagination: {
          page,
          pageSize,
          total: 0,
          totalPages: 0,
        },
        stats: {
          PENDING: 0,
          IN_PROGRESS: 0,
          WAITING_PARTS: 0,
          COMPLETED: 0,
          CANCELLED: 0,
        },
      })
    }

    const where: Record<string, unknown> = { ...demoFilter(auth.user), ...orgScope.where }

    // ── Build the `search` OR clause ──
    // Used to combine with site filter via AND when both are present.
    // SUFFIX-AWARE (SEARCH-FIX): for short numeric queries, identifier fields
    // (woNumber, systemJobNo, legacyJobNo) match by SUFFIX — operators often
    // type the last digits of a work-order number from a sticker/receipt.
    let searchOr: Record<string, unknown>[] | null = null
    if (search) {
      const isShort = isNumericShortQuery(search)
      const idOp = isShort ? { endsWith: search } : { contains: search }
      searchOr = [
        { woNumber: idOp },
        { systemJobNo: idOp },
        { legacyJobNo: idOp },
        { subject: { contains: search } },
        { building: { contains: search } },
        { location: { contains: search } },
        { reporterName: { contains: search } },
        { tel: { contains: search } },
        { details: { contains: search } },
        { employeeCode: { contains: search } },
        { assignedTo: { contains: search } },
        { detailsAdmin: { contains: search } },
        { resolution: { contains: search } },
      ]
    }

    // Combine siteFilter + searchOr into `where`.
    if (siteFilter && searchOr) {
      where.AND = [siteFilter, { OR: searchOr }]
    } else if (siteFilter) {
      // siteFilter is `{ OR: [...] }` — copy directly into where so
      // subsequent status/priority/assignedTo filters can be added.
      for (const [k, v] of Object.entries(siteFilter)) where[k] = v
    } else if (searchOr) {
      where.OR = searchOr
    }

    if (status && VALID_STATUSES.has(status)) where.status = status
    if (priority && VALID_PRIORITIES.has(priority)) where.priority = priority
    if (assignedTo) where.assignedTo = assignedTo
    if (specialFee !== null) where.isSpecialFee = specialFee

    const [items, total] = await Promise.all([
      db.workOrder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.workOrder.count({ where }),
    ])

    // Stats for KPI bar (computed for the filtered set ignoring pagination)
    const statusGroups = await db.workOrder.groupBy({
      by: ['status'],
      where,
      _count: true,
    })
    const stats: Record<string, number> = {
      PENDING_REVIEW: 0,
      PENDING: 0,
      IN_PROGRESS: 0,
      WAITING_PARTS: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    }
    for (const g of statusGroups) stats[g.status] = g._count

    return NextResponse.json({
      data: items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      stats,
    })
  } catch (err) {
    console.error('GET /api/work-orders', err)
    const message = process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to fetch work orders') : 'Internal server error'
    return NextResponse.json(
      { error: message, detail: err instanceof Error ? err.stack?.split('\n').slice(0, 3).join(' | ') : String(err) },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  // ── Phase 4.3: Module availability gate ──
  // Guest submissions are accepted even when the module is "disabled"
  // because the public QR repair flow depends on WO creation. So we only
  // gate the staff-side here; the guest-side check happens later via the
  // submissionSource branch.
  const moduleCheck = await moduleUnavailableResponse('work-orders')
  if (moduleCheck) return moduleCheck

  try {
    // ── Auth flow: guest vs. authenticated staff ──
    //
    // Guest flow (submissionSource === 'guest'): auth is OPTIONAL — guests
    // don't need a session to create a WO for themselves. They DO need
    // guest contact validation (name + phone) below.
    //
    // Staff flow (anything else): require WO_CREATE permission. Previously
    // this route used optional auth for everyone, so any logged-in user
    // (even a viewer) could create WOs via the staff endpoint. This is a
    // privilege-escalation Blocker.
    //
    // To pick the correct flow, we need to peek at `submissionSource` in
    // the body BEFORE deciding which auth path to take. We read the body
    // once and reuse it for the rest of the handler.
    const rawBody = await req.json().catch(() => ({}))
    const peekSource =
      typeof rawBody.submissionSource === 'string' &&
      VALID_SOURCES.has(rawBody.submissionSource.trim())
        ? rawBody.submissionSource.trim()
        : 'guest'

    let demo: { user: import('@/lib/auth-shared').AuthUser } | null = null
    let ctx: Awaited<ReturnType<typeof buildAuthorizationContext>> | null = null
    let staffUser: import('@/lib/auth-shared').AuthUser | null = null

    if (peekSource === 'guest') {
      // Guest flow — optional auth (demo users / public LINE submissions)
      const auth = await requireAuth(req).catch(() => null)
      if (auth?.ok) {
        demo = auth.isDemo ? { user: auth.user } : null
      }
    } else {
      // Authenticated staff — hard-require WO_CREATE permission
      const auth = await requireAuth(req, 'WO_CREATE')
      if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status })
      }
      demo = auth.isDemo ? { user: auth.user } : null
      staffUser = auth.user
      ctx = await buildAuthorizationContext(
        auth.user,
        auth.row.id,
        auth.row.allowedSites,
      )
    }

    const body = rawBody as Record<string, unknown>
    const {
      subject,
      building,
      location,
      details,
      priority,
      reporterName,
      reporterEmail,
      tel,
      employeeCode,
      submissionSource,
      deviceId,
      picBefore,
      picBeforeImages,
      actor,
      externalMeta,
      isExternal,
      skipGuestValidation,
      isSpecialFee,
      requestId,
      clientMutationId,
      legacyJobNo: rawLegacyJobNo,
    } = body

    if (!subject || !String(subject).trim()) {
      return NextResponse.json(
        { error: 'กรุณาระบุประเภทปัญหา (subject)' },
        { status: 400 },
      )
    }

    // SPRINT-4 #4 (FIX-036): length caps to prevent abuse + DB bloat
    const subjectStr = String(subject).trim()
    if (subjectStr.length > 500) {
      return NextResponse.json(
        { error: 'ประเภทปัญหายาวเกินไป (สูงสุด 500 ตัวอักษร)' },
        { status: 400 },
      )
    }
    if (details && String(details).length > 5000) {
      return NextResponse.json(
        { error: 'รายละเอียดยาวเกินไป (สูงสุด 5000 ตัวอักษร)' },
        { status: 400 },
      )
    }
    if (tel && String(tel).length > 20) {
      return NextResponse.json(
        { error: 'หมายเลขโทรศัพท์ยาวเกินไป (สูงสุด 20 ตัวอักษร)' },
        { status: 400 },
      )
    }
    // SPRINT-4 #4: priority enum validation
    if (priority && !VALID_PRIORITIES.has(String(priority).toUpperCase())) {
      return NextResponse.json(
        { error: `priority ต้องเป็นค่าใดค่าหนึ่ง: ${Array.from(VALID_PRIORITIES).join(', ')}` },
        { status: 400 },
      )
    }

    // ── Idempotency: check requestId/clientMutationId for replay protection ──
    // If the caller sends a requestId (legacy) or clientMutationId (new),
    // we check if a WO with that idempotency key already exists. If so,
    // return the existing WO as a duplicate success (matching legacy
    // Apps Script behavior). This prevents duplicate WO creation on retry.
    const idempotencyKey =
      (typeof clientMutationId === 'string' && clientMutationId.trim()) ||
      (typeof requestId === 'string' && requestId.trim()) ||
      null
    if (idempotencyKey) {
      const existing = await db.workOrder.findFirst({
        where: {
          OR: [
            { requestId: idempotencyKey },
          ],
        },
        select: {
          id: true,
          woNumber: true,
          systemJobNo: true,
          legacyJobNo: true,
          subject: true,
          status: true,
          createdAt: true,
        },
      })
      if (existing) {
        // Return the existing WO as a duplicate success — the caller
        // should treat this as the result of their original request.
        return NextResponse.json({
          data: existing,
          duplicate: true,
          message: `พบใบงานที่สร้างด้วย requestId '${idempotencyKey}' แล้ว — ส่งคืนข้อมูลเดิม`,
        })
      }
    }

    const source =
      typeof submissionSource === 'string' &&
      VALID_SOURCES.has(submissionSource.trim())
        ? submissionSource.trim()
        : 'guest'
    // Legacy identifiers are accepted for authenticated/import-style flows;
    // guest submissions cannot authoritatively claim a legacy source number.
    const incomingLegacyJobNo =
      typeof rawLegacyJobNo === 'string' && rawLegacyJobNo.trim()
        ? rawLegacyJobNo.trim()
        : null
    const legacyJobNo = source === 'guest' ? null : incomingLegacyJobNo

    // ── External work order (ลูกค้าภายนอก / นอกสถานที่) ──
    // External WOs do NOT require guest contact validation — they are
    // for clients/locations not in the system.
    const externalFlag =
      isExternal === true ||
      (externalMeta && typeof externalMeta === 'object')
    let externalMetaString: string | null = null
    if (externalFlag) {
      const norm = normalizeExternalMeta(externalMeta)
      if (!norm) {
        return NextResponse.json(
          { error: 'กรุณาระบุชื่อลูกค้า (clientName) สำหรับงานนอก' },
          { status: 400 },
        )
      }
      externalMetaString = JSON.stringify(norm)
    }

    // ── Normalize reporter info ──
    let finalReporterName =
      typeof reporterName === 'string' ? reporterName.trim() : ''
    let finalTel = typeof tel === 'string' ? tel.trim() : ''
    let finalEmployeeCode =
      typeof employeeCode === 'string' ? employeeCode.trim() : ''
    let department: string | null = null

    // ── Guest contact validation (skip for external WOs and session users) ──
    // Demo users bypass guest validation — they're for testing only.
    const isDemoUser = demo?.user?.isDemo === true || staffUser?.isDemo === true
    if (
      source === 'guest' &&
      !externalFlag &&
      !isDemoUser &&
      skipGuestValidation !== true
    ) {
      if (!finalReporterName || !finalTel) {
        return NextResponse.json(
          {
            error:
              'ผู้แจ้งซ่อม (Guest) ต้องระบุชื่อและเบอร์โทร เพื่อยืนยันตัวตนกับสมุดผู้ติดต่อ',
          },
          { status: 400 },
        )
      }
      const validation = await validateGuestContact({
        name: finalReporterName,
        phone: finalTel,
        employeeCode: finalEmployeeCode || null,
      })
      if (!validation.ok) {
        return NextResponse.json(
          { error: validation.error ?? 'ยืนยันตัวตนไม่สำเร็จ' },
          { status: 403 },
        )
      }
      // Use canonical (directory) data for the stored WO
      finalReporterName = validation.canonicalName ?? finalReporterName
      finalTel = validation.canonicalPhone ?? finalTel
      finalEmployeeCode = validation.canonicalEmployeeCode ?? finalEmployeeCode
      department = validation.department ?? null
    }

    // ── Derive siteCode from the linked Device (if any) ──
    // WorkOrder.siteCode is the canonical Site reference for Site-based
    // access control. For WOs with a device, we look up device.site and
    // store its normalized form on the WO so subsequent auth checks
    // (canAtSite, GET scope filter) work without a JOIN.
    let derivedSiteCode: string | null = null
    const trimmedDeviceId =
      typeof deviceId === 'string' && deviceId.trim() ? deviceId.trim() : null
    if (trimmedDeviceId) {
      const device = await db.device.findUnique({
        where: { id: trimmedDeviceId },
        select: { site: true },
      })
      if (device) {
        derivedSiteCode = normalizeSiteCode(device.site)
      }
    }

    // ── Site-scoped authorization for staff WO creation ──
    // Guests are not subject to canAtSite (they create WOs through the
    // public guest flow, which is gated by guest contact validation).
    // Staff MUST have WO_CREATE at the derived Site — using canAtSite,
    // not the union of effectivePermissions, to prevent privilege
    // escalation (admin at UDH creating WOs at NKP where they're viewer).
    if (ctx && derivedSiteCode) {
      if (!ctx.isSuperAdmin && !ctx.canAtSite(derivedSiteCode, 'WO_CREATE')) {
        return NextResponse.json(
          { error: `คุณไม่มีสิทธิ์สร้างใบงานที่ Site '${derivedSiteCode}'` },
          { status: 403 },
        )
      }
    }
    // If ctx is set but derivedSiteCode is null (no device), we still
    // allow creation — the WO will be unscoped (siteCode=null). The WO
    // will be invisible to non-superadmin GET callers (since their scope
    // filter requires siteCode OR device.site to be in scope). This is
    // acceptable for now — staff with WO_CREATE can create external WOs.

    const actorName =
      typeof actor === 'string' && actor.trim()
        ? actor.trim()
        : (staffUser?.email ?? finalReporterName ?? 'system')
    // NOTE (PART 3 — Single User System): when the request comes from an
    // authenticated staff/admin, use the session user's email as `actor`.
    // For guest/line submissions, the reporterName (or 'system') is fine.

    const prPriority =
      typeof priority === 'string' && VALID_PRIORITIES.has(priority)
        ? priority
        : 'ปกติ'

    const specialFeeFlag = isSpecialFee === true

    // ── Generate woNumber + create with retry-on-P2002 ──────────────────
    // FIX-024: `generateWoNumber()` uses findFirst+exists-check which races
    // under concurrent inserts — two requests can both compute the same
    // WO number and both try to insert. Wrapping with withRetryOnUnique
    // re-generates the woNumber on each attempt; the winner's row is now
    // visible to the exists-check, so the loser's next attempt picks the
    // next available number.
    const created = await withRetryOnUnique(async () => {
      const woNumber = await generateWoNumber()
      if (!woNumber) {
        throw new Error('สร้างเลขใบงานไม่สำเร็จ กรุณาลองอีกครั้ง')
      }
      return db.workOrder.create({
        data: {
          id: woNumber,       // Preserve current primary-key compatibility.
          woNumber,           // Compatibility/display field used by existing clients.
          systemJobNo: woNumber,
          legacyJobNo,
          requestId: idempotencyKey, // Store for future replay detection
          subject: String(subject).trim(),
          building: building ? String(building).trim() : null,
          location: location ? String(location).trim() : null,
          details: details ? String(details).trim() : null,
          priority: prPriority,
          reporterName: finalReporterName || null,
          reporterEmail: reporterEmail ? String(reporterEmail).trim() : null,
          tel: finalTel || null,
          employeeCode: finalEmployeeCode || null,
          submissionSource: source,
          deviceId: trimmedDeviceId,
          // Store the derived siteCode so GET scope filtering works
          // without a JOIN to Device.
          siteCode: derivedSiteCode,
          picBefore: picBefore ? String(picBefore) : null,
          externalMeta: externalMetaString,
          isSpecialFee: specialFeeFlag,
          status: 'PENDING', // New WOs always start as PENDING (legacy status mapping handled on import)
          ...demoTag(demo?.user ?? null),
        },
      })
    })

    // ── Multi-image (WorkOrderImage, stage='before') ──
    // Accept either an array of base64 data URLs (preferred) or a single
    // picBefore string (legacy). Each becomes its own WorkOrderImage row so
    // the detail page can show all of them.
    const beforeImages: string[] = []
    if (Array.isArray(picBeforeImages)) {
      for (const img of picBeforeImages) {
        if (typeof img === 'string' && img.trim()) {
          beforeImages.push(img)
        }
      }
    }
    if (beforeImages.length === 0 && picBefore) {
      // Legacy single-image path: still mirror it into WorkOrderImage so the
      // detail view (which reads WorkOrderImage) shows it.
      beforeImages.push(String(picBefore))
    }
    if (beforeImages.length > 0) {
      // Cap at 9 (matches the UI limit) to keep the create payload sane.
      await db.workOrderImage.createMany({
        data: beforeImages.slice(0, 9).map((dataUrl) => ({
          workOrderId: created.id,
          stage: 'before',
          image_data: dataUrl,
          fileName: null,
          uploadedBy: actorName,
        })),
      })
    }

    // Auto system message: created
    await db.workOrderMessage.create({
      data: {
        workOrderId: created.id,
        message: externalFlag
          ? `แจ้งซ่อมใหม่ (งานนอก): ${created.subject}`
          : `แจ้งซ่อมใหม่: ${created.subject}`,
        author: actorName,
        authorRole: 'system',
      },
    })

    await logAudit(
      'WO_CREATE',
      created.id,
      `สร้างใบแจ้งซ่อม ${created.woNumber} — ${created.subject}`,
      {
        woNumber: created.woNumber,
        systemJobNo: created.systemJobNo,
        legacyJobNo: created.legacyJobNo,
        subject: created.subject,
        priority: created.priority,
        building: created.building,
        location: created.location,
        reporterName: created.reporterName,
        submissionSource: created.submissionSource,
        external: externalFlag,
        isSpecialFee: specialFeeFlag,
        department,
        siteCode: derivedSiteCode,
        deviceId: trimmedDeviceId,
      },
      actorName,
      derivedSiteCode,
    )
    // Send 'wo_created' to LINE admin group + Telegram admin chat.
    // NOTE (PART 3): pass actor from auth context once NextAuth lands.
    try {
      await notifyWorkOrderCreated(
        {
          id: created.id,
          woNumber: created.woNumber,
          subject: created.subject,
          building: created.building,
          location: created.location,
          reporterName: created.reporterName,
          tel: created.tel,
          priority: created.priority,
          lineUserId: created.lineUserId,
        },
        { channels: ['line-oa', 'telegram'], actor: actorName },
      )
    } catch (e) {
      console.error('[notifications] wo_created trigger failed:', e)
    }

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/work-orders', err)
    const message =
      process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : 'Failed to create work order') : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
