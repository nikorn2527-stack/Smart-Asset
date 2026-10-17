#!/usr/bin/env node
/**
 * reset-all-passwords.ts — Reset password for all users.
 *
 * Usage:
 *   bun run scripts/reset-all-passwords.ts [password]
 *
 * Default password: test1234
 *
 * Useful for:
 *   - Recovery when users can't login (NULL passwordHash)
 *   - Setting up demo/test environment
 *   - Emergency password reset
 */

import { db } from '../src/lib/db'
import crypto from 'node:crypto'

const DEFAULT_PASSWORD = process.argv[2] || 'test1234'

function hashPassword(password: string, salt: string, iterations = 10000): string {
  const raw = `${salt}|${password}`
  let hex = crypto.createHash('sha256').update(raw, 'utf8').digest('hex')
  for (let i = 1; i < iterations; i++) {
    const input = i % 1000 === 0 ? `${raw}|${i}` : hex
    hex = crypto.createHash('sha256').update(input, 'utf8').digest('hex')
  }
  return hex
}

function createSalt(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '') + Date.now()
}

async function main() {
  console.log('🔐 Password Reset Tool')
  console.log('─'.repeat(50))
  console.log(`Password to set: ${DEFAULT_PASSWORD}`)
  console.log('')

  const users = await db.user.findMany({
    where: { active: true },
    select: { id: true, username: true, email: true },
  })

  console.log(`Found ${users.length} active users`)

  let reset = 0
  for (const u of users) {
    const salt = createSalt()
    const hash = hashPassword(DEFAULT_PASSWORD, salt)
    await db.user.update({
      where: { id: u.id },
      data: { passwordHash: hash, passwordSalt: salt },
    })
    console.log(`  ✓ ${u.username} / ${u.email}`)
    reset++
  }

  console.log('─'.repeat(50))
  console.log(`✓ Reset ${reset} users to password: ${DEFAULT_PASSWORD}`)
  console.log('')
  console.log('Login with any username + password: ' + DEFAULT_PASSWORD)

  await db.$disconnect()
}

main().catch(async (e) => {
  console.error('❌ Failed:', e)
  await db.$disconnect()
  process.exit(1)
})
