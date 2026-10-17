/**
 * test-r2-connection.ts — Test Cloudflare R2 connection + upload.
 *
 * Usage: bun run scripts/test-r2-connection.ts
 *
 * Tests:
 *   1. Verify R2 credentials are set
 *   2. Create S3 client + test connection
 *   3. Upload a test file
 *   4. Verify file exists (HEAD)
 *   5. Get public URL
 *   6. Delete test file (cleanup)
 */

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { readFileSync } from 'node:fs'

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL

console.log('🧪 R2 Connection Test')
console.log('─'.repeat(50))

// ── 1. Verify credentials ──
console.log('\n1. Checking credentials...')
const missing: string[] = []
if (!R2_ACCOUNT_ID) missing.push('R2_ACCOUNT_ID')
if (!R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID')
if (!R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY')
if (!R2_BUCKET_NAME) missing.push('R2_BUCKET_NAME')
if (!R2_PUBLIC_URL) missing.push('R2_PUBLIC_URL')

if (missing.length > 0) {
  console.error('❌ Missing credentials:', missing.join(', '))
  process.exit(1)
}

console.log('✓ All credentials present')
console.log(`  Account ID: ${R2_ACCOUNT_ID!.slice(0, 8)}...${R2_ACCOUNT_ID!.slice(-4)}`)
console.log(`  Access Key: ${R2_ACCESS_KEY_ID!.slice(0, 8)}...${R2_ACCESS_KEY_ID!.slice(-4)}`)
console.log(`  Bucket: ${R2_BUCKET_NAME}`)
console.log(`  Public URL: ${R2_PUBLIC_URL}`)

// ── 2. Create S3 client ──
console.log('\n2. Creating S3 client...')
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID!,
    secretAccessKey: R2_SECRET_ACCESS_KEY!,
  },
})
console.log('✓ S3 client created')

// ── 3. Upload test file ──
console.log('\n3. Uploading test file...')
const testKey = `test/connection-test-${Date.now()}.txt`
const testContent = `R2 connection test at ${new Date().toISOString()}

This file was uploaded by ITAM test script to verify R2 connectivity.
Safe to delete.

Account: ${R2_ACCOUNT_ID}
Bucket: ${R2_BUCKET_NAME}
`

try {
  const uploadStart = Date.now()
  const uploadCmd = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: testKey,
    Body: testContent,
    ContentType: 'text/plain',
    CacheControl: 'no-cache',
  })
  await client.send(uploadCmd)
  console.log(`✓ Upload successful in ${Date.now() - uploadStart}ms`)
  console.log(`  Key: ${testKey}`)
} catch (err) {
  console.error('❌ Upload failed:', err)
  process.exit(1)
}

// ── 4. Verify file exists ──
console.log('\n4. Verifying file exists (HEAD)...')
try {
  const headCmd = new HeadObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: testKey,
  })
  const headRes = await client.send(headCmd)
  console.log('✓ File exists')
  console.log(`  Content-Length: ${headRes.ContentLength} bytes`)
  console.log(`  ContentType: ${headRes.ContentType}`)
} catch (err) {
  console.error('❌ HEAD failed:', err)
  process.exit(1)
}

// ── 5. Get public URL ──
console.log('\n5. Public URL...')
const publicUrl = `${R2_PUBLIC_URL}/${testKey}`
console.log(`✓ Public URL: ${publicUrl}`)

// ── 6. Cleanup ──
console.log('\n6. Cleaning up test file...')
try {
  const deleteCmd = new DeleteObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: testKey,
  })
  await client.send(deleteCmd)
  console.log('✓ Test file deleted')
} catch (err) {
  console.warn('⚠️  Cleanup failed (non-fatal):', err)
}

// ── Summary ──
console.log('\n' + '─'.repeat(50))
console.log('✅ R2 Connection Test: ALL PASSED')
console.log('─'.repeat(50))
console.log('\nR2 is ready to use. The app will now use R2 for:')
console.log('  • WO photos (wo-photos/)')
console.log('  • Device images (device-images/)')
console.log('  • Stickers (stickers/)')
console.log('  • Signatures (signatures/)')
console.log('  • Exports (exports/)')
console.log('\nNext steps:')
console.log('  1. Add the same env vars to Vercel (Settings → Environment Variables)')
console.log('  2. Redeploy')
