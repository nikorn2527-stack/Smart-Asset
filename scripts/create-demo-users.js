/**
 * create-demo-users.js — Create 3 demo users for the ITAM Demo Mode.
 *
 * Creates:
 *   demo_admin  / demo123  (role: admin,  isDemo: true)
 *   demo_staff  / demo123  (role: editor, isDemo: true)
 *   demo_viewer / demo123  (role: viewer, isDemo: true)
 *
 * Password hashing uses the SAME PBKDF2-like iterated SHA-256 scheme as
 * src/lib/auth.ts (10 000 rounds) so the existing /api/itam/auth/login
 * endpoint accepts these credentials without any code changes.
 *
 * Usage:
 *   node scripts/create-demo-users.js
 *
 * Re-running is safe — existing demo users are updated in place (password +
 * role are reset to the canonical values; allowedSites stays "ALL").
 */

const crypto = require('node:crypto') // eslint-disable-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client') // eslint-disable-line @typescript-eslint/no-require-imports

const prisma = new PrismaClient()

const PBKDF2_ITERATIONS = 10_000

/** GAS-compatible iterated SHA-256 hash (mirror of src/lib/auth.ts hashPassword). */
function hashPassword(password, salt, iterations = PBKDF2_ITERATIONS) {
  const raw = `${salt ?? ''}|${password ?? ''}`
  let hex = crypto.createHash('sha256').update(raw, 'utf8').digest('hex')
  for (let i = 1; i < iterations; i++) {
    const input = i % 1000 === 0 ? `${raw}|${i}` : hex
    hex = crypto.createHash('sha256').update(input, 'utf8').digest('hex')
  }
  return hex
}

function createPasswordSalt() {
  const a = crypto.randomUUID().replace(/-/g, '')
  const b = crypto.randomUUID().replace(/-/g, '')
  return `${a}${b}${Date.now()}`
}

const DEMO_USERS = [
  {
    email: 'admin@itam.local',
    username: 'admin',
    name: 'Test Admin',
    role: 'admin',
    password: 'test1234',
    allowedSites: 'ALL',
    isDemo: false, // system admin — NOT filtered out by demoFilter
  },
  {
    email: 'demo_admin@itam.demo',
    username: 'demo_admin',
    name: 'ผู้ดูแล (สาธิต)',
    role: 'admin',
    password: 'demo123',
    allowedSites: 'ALL',
    isDemo: true,
  },
  {
    email: 'demo_staff@itam.demo',
    username: 'demo_staff',
    name: 'เจ้าหน้าที่ (สาธิต)',
    role: 'editor',
    password: 'demo123',
    allowedSites: 'ALL',
    isDemo: true,
  },
  {
    email: 'demo_viewer@itam.demo',
    username: 'demo_viewer',
    name: 'ผู้ดูรายงาน (สาธิต)',
    role: 'viewer',
    password: 'demo123',
    allowedSites: 'ALL',
    isDemo: true,
  },
]

async function upsertDemoUser(def) {
  const salt = createPasswordSalt()
  const hash = hashPassword(def.password, salt, PBKDF2_ITERATIONS)

  const data = {
    email: def.email,
    username: def.username,
    name: def.name,
    role: def.role,
    passwordHash: hash,
    passwordSalt: salt,
    allowedSites: def.allowedSites,
    active: true,
    isDemo: def.isDemo ?? true,
  }

  // Try to find an existing demo user by username OR email first
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ username: def.username }, { email: def.email }],
    },
    select: { id: true },
  })

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data,
      select: { id: true, username: true, email: true, role: true, isDemo: true },
    })
    return { action: 'updated', user: updated }
  }

  const created = await prisma.user.create({
    data,
    select: { id: true, username: true, email: true, role: true, isDemo: true },
  })
  return { action: 'created', user: created }
}

async function main() {
  console.log('🧪 Creating/updating 3 demo users...\n')
  for (const def of DEMO_USERS) {
    const { action, user } = await upsertDemoUser(def)
    console.log(
      `  ${action === 'created' ? '✓ Created' : '↻ Updated'}  ${user.username.padEnd(12)} ` +
      `(${user.email})  role=${user.role}  isDemo=${user.isDemo}`,
    )
  }
  console.log('\n✅ Done. Login with username + password "demo123".')
}

main()
  .catch((err) => {
    console.error('❌ Failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
