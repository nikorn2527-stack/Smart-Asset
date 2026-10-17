/**
 * create-superadmin.ts — Create a real super admin account in production DB.
 *
 * Usage (run on Vercel or locally with DATABASE_URL pointing to production):
 *   DATABASE_URL="postgresql://..." bun run scripts/create-superadmin.ts
 *
 * Prompts for email + password (or reads from env: SUPERADMIN_EMAIL,
 * SUPERADMIN_PASSWORD). Creates the user with role=superadmin, active=true.
 *
 * If the user already exists (by email), updates role to superadmin +
 * resets password + sets active=true.
 */
import { PrismaClient } from '@prisma/client'
import * as crypto from 'crypto'
import * as readline from 'readline'

const prisma = new PrismaClient()

const PBKDF2_ITERATIONS = 10000

function createPasswordSalt(): string {
  return crypto.randomBytes(16).toString('hex')
}

function hashPassword(password: string, salt: string, iterations = PBKDF2_ITERATIONS): string {
  const raw = `${salt}|${password}`
  let hex = crypto.createHash('sha256').update(raw, 'utf8').digest('hex')
  for (let i = 1; i < iterations; i++) {
    const input = i % 1000 === 0 ? `${raw}|${i}` : hex
    hex = crypto.createHash('sha256').update(input, 'utf8').digest('hex')
  }
  return hex
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  Create Super Admin Account')
  console.log('═══════════════════════════════════════════\n')

  const email = process.env.SUPERADMIN_EMAIL || await ask('Email: ')
  if (!email) {
    console.error('❌ Email is required')
    process.exit(1)
  }

  const password = process.env.SUPERADMIN_PASSWORD || await ask('Password (min 8 chars): ')
  if (!password || password.length < 8) {
    console.error('❌ Password must be at least 8 characters')
    process.exit(1)
  }

  const name = process.env.SUPERADMIN_NAME || await ask('Display name (e.g. นิกร ศรีสุข): ') || email
  const username = process.env.SUPERADMIN_USERNAME || await ask('Username (e.g. nikorn): ') || email.split('@')[0]

  const salt = createPasswordSalt()
  const hash = hashPassword(password, salt)

  // Check if user exists
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  })

  if (existing) {
    console.log(`\n🔄 User already exists — updating to superadmin...`)
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: 'superadmin',
        active: true,
        name,
        passwordHash: hash,
        passwordSalt: salt,
        allowedSites: 'ALL',
        updatedAt: new Date(),
      },
    })
    console.log(`✅ Updated: ${updated.email} (role: superadmin, active: true)`)
  } else {
    console.log(`\n🆕 Creating new superadmin...`)
    const created = await prisma.user.create({
      data: {
        email,
        username,
        name,
        role: 'superadmin',
        active: true,
        passwordHash: hash,
        passwordSalt: salt,
        allowedSites: 'ALL',
      },
    })
    console.log(`✅ Created: ${created.email} (role: superadmin, active: true)`)
  }

  console.log(`\n═══════════════════════════════════════════`)
  console.log(`  Login: ${email} / ${password}`)
  console.log(`  URL: https://itam-next-js.vercel.app/`)
  console.log(`═══════════════════════════════════════════`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('❌ Error:', e)
  process.exit(1)
})
