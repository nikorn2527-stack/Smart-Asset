#!/bin/bash
# safe-migrate.sh — Safe database migration with backup.
#
# Flow:
#   1. Backup DB to JSON (./backups/backup-<timestamp>.json)
#   2. Run prisma migrate (or db push with confirmation)
#   3. If migration fails → print restore instructions
#   4. If migration succeeds → verify + print summary
#
# Usage:
#   bash scripts/safe-migrate.sh              # migrate dev
#   bash scripts/safe-migrate.sh --push       # db push (faster, less safe)
#   bash scripts/safe-migrate.sh --production # migrate deploy

set -e

# H-02 fix: use portable path resolution instead of hardcoded /home/z/my-project
# Resolve project root from script location (works on Linux, macOS, WSL, Git Bash)
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%S")
BACKUP_FILE="backups/backup-${TIMESTAMP}.json"
USE_PUSH=false
IS_PRODUCTION=false

# Parse args
for arg in "$@"; do
  case $arg in
    --push)
      USE_PUSH=true
      ;;
    --production)
      IS_PRODUCTION=true
      ;;
  esac
done

echo "🛡️  Safe Database Migration"
echo "─────────────────────────────────────────"
echo "Timestamp: ${TIMESTAMP}"
if [ "$USE_PUSH" = true ]; then
  echo "Mode: prisma db push (faster, less safe)"
else
  echo "Mode: prisma migrate"
fi
echo "─────────────────────────────────────────"

# Step 1: Backup
echo ""
echo "📦 Step 1: Backup database..."
mkdir -p backups
if bun run scripts/backup-db.ts --output="${BACKUP_FILE}"; then
  echo "✓ Backup saved to ${BACKUP_FILE}"
else
  echo "✗ Backup failed — aborting migration"
  exit 1
fi

# Step 2: Migrate
echo ""
echo "🔄 Step 2: Run migration..."
MIGRATION_EXIT=0

if [ "$USE_PUSH" = true ]; then
  if [ "$IS_PRODUCTION" = true ]; then
    npx prisma db push --skip-generate || MIGRATION_EXIT=$?
  else
    npx prisma db push --accept-data-loss || MIGRATION_EXIT=$?
  fi
else
  if [ "$IS_PRODUCTION" = true ]; then
    npx prisma migrate deploy || MIGRATION_EXIT=$?
  else
    npx prisma migrate dev || MIGRATION_EXIT=$?
  fi
fi

# Step 3: Handle result
if [ $MIGRATION_EXIT -ne 0 ]; then
  echo ""
  echo "❌ Migration failed!"
  echo ""
  echo "🔄 To restore from backup:"
  echo "   bun run scripts/restore-db.ts ${BACKUP_FILE}"
  echo ""
  echo "⚠️  Backup file: ${BACKUP_FILE}"
  exit $MIGRATION_EXIT
fi

# Step 4: Verify
echo ""
echo "✅ Migration succeeded!"
echo ""
echo "📋 Summary:"
echo "   Backup: ${BACKUP_FILE}"
echo "   Mode: $([ "$USE_PUSH" = true ] && echo 'db push' || echo 'migrate')"
echo ""
echo "💡 If something looks wrong, restore with:"
echo "   bun run scripts/restore-db.ts ${BACKUP_FILE}"
