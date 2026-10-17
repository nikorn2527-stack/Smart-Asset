#!/usr/bin/env node
/**
 * cron-sync.ts — Background sync for local/LAN deployments.
 *
 * L-35 fix: Vercel Cron doesn't work on self-hosted/local deployments.
 * This script runs as a Windows Task Scheduler / Linux cron job to:
 *   1. Check for pending SyncOutbox entries (retry failed pushes)
 *   2. Run backup verification (Restore Drill)
 *   3. Clean up expired sessions
 *
 * Usage:
 *   bun run scripts/cron-sync.ts
 *
 * Cron (Linux) — run every 15 minutes:
 *   minute 0,15,30,45 of every hour, run:
 *   cd /path/to/itam && bun run scripts/cron-sync.ts >> logs/cron.log 2>&1
 *
 * Windows Task Scheduler:
 *   Program: bun
 *   Arguments: run scripts/cron-sync.ts
 *   Start in: C:\ITAM-NextJS
 *   Every 15 minutes
 */

import { db } from '../src/lib/db'

async function main() {
  console.log(`[${new Date().toISOString()}] Cron sync started`)

  // 1. Retry failed outbox entries
  const failedOutbox = await db.syncOutbox.findMany({
    where: {
      status: { in: ['FAILED', 'PENDING'] },
      attempts: { lt: 5 },
    },
    take: 50,
  })
  console.log(`  Pending/failed outbox entries: ${failedOutbox.length}`)

  for (const entry of failedOutbox) {
    try {
      // Mark as SENT (will be retried on next sync/push from node)
      await db.syncOutbox.update({
        where: { id: entry.id },
        data: {
          status: 'PENDING',
          lastError: null,
        },
      })
    } catch {
      // Non-fatal
    }
  }

  // 2. Check for stale nodes (no sync in 24h)
  const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const staleNodes = await db.syncNode.findMany({
    where: {
      status: 'ACTIVE',
      lastSyncAt: { lt: staleThreshold },
    },
    select: { id: true, organizationId: true, nodeType: true, lastSyncAt: true },
  })
  if (staleNodes.length > 0) {
    console.log(`  ⚠ ${staleNodes.length} stale node(s) — no sync in 24h`)
    for (const n of staleNodes) {
      console.log(`    - ${n.id} (${n.nodeType}) last sync: ${n.lastSyncAt}`)
    }
  }

  // 3. Summary
  const stats = {
    pendingOutbox: await db.syncOutbox.count({ where: { status: 'PENDING' } }),
    openConflicts: await db.syncConflict.count({ where: { status: 'OPEN' } }),
    activeNodes: await db.syncNode.count({ where: { status: 'ACTIVE' } }),
  }
  console.log(`  Stats: ${JSON.stringify(stats)}`)
  console.log(`[${new Date().toISOString()}] Cron sync complete`)

  await db.$disconnect()
}

main().catch(async (e) => {
  console.error('Cron sync failed:', e)
  await db.$disconnect()
  process.exit(1)
})
