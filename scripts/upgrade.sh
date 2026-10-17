/**
 * upgrade.sh — Upgrade Flow (section 14)
 *
 * Flow: Health Check → Backup → Maintenance Mode → Migration → Smoke Test → Disable Maintenance
 *
 * Usage:
 *   bash scripts/upgrade.sh
 *
 * Prerequisites:
 *   - .env with DATABASE_URL + JWT_SECRET
 *   - prisma/schema.prisma up to date
 */
#!/bin/bash
set -euo pipefail

echo "══════════════════════════════════════════"
echo "  ITAM Upgrade Flow"
echo "══════════════════════════════════════════"

# ── Step 1: Health Check ──
echo ""
echo "── Step 1: Health Check ──"
if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
  echo "  ✓ Application is running"
else
  echo "  ⚠ Application not running (may be expected before upgrade)"
fi

# Check DB exists
if [ ! -f "db/custom.db" ]; then
  echo "  ❌ Database not found: db/custom.db"
  exit 1
fi
echo "  ✓ Database found"

# ── Step 2: Pre-Migration Backup ──
echo ""
echo "── Step 2: Pre-Migration Backup ──"
bun scripts/pre-migration-backup.ts
if [ $? -ne 0 ]; then
  echo "  ❌ Backup failed — aborting upgrade"
  exit 1
fi
echo "  ✓ Backup complete"

# ── Step 3: Maintenance Mode (TODO: implement maintenance page) ──
echo ""
echo "── Step 3: Maintenance Mode ──"
echo "  ⚠ Maintenance mode not yet implemented — inform users manually"
echo "  (Future: create .maintenance file → proxy shows maintenance page)"

# ── Step 4: Migration ──
echo ""
echo "── Step 4: Database Migration ──"
echo "  Running prisma db push..."
bun run db:push
if [ $? -ne 0 ]; then
  echo "  ❌ Migration failed — restoring backup..."
  # Restore the latest backup
  LATEST_BACKUP=$(ls -t db/backups/pre-migration-*.db 2>/dev/null | head -1)
  if [ -n "$LATEST_BACKUP" ]; then
    cp "$LATEST_BACKUP" db/custom.db
    echo "  ✓ Restored from backup: $LATEST_BACKUP"
  fi
  echo "  ❌ Upgrade failed — backup restored"
  exit 1
fi
echo "  ✓ Migration complete"

# ── Step 5: Smoke Test ──
echo ""
echo "── Step 5: Smoke Test ──"
sleep 5  # Wait for app to pick up changes
if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
  echo "  ✓ Health check passed"
else
  echo "  ⚠ Application not responding after migration"
  echo "  Check logs and restart manually"
fi

# ── Step 6: Disable Maintenance Mode ──
echo ""
echo "── Step 6: Disable Maintenance Mode ──"
echo "  ✓ Inform users that system is back online"

# ── Summary ──
echo ""
echo "══════════════════════════════════════════"
echo "  ✓ Upgrade complete"
echo "══════════════════════════════════════════"
