#!/bin/bash
# verify-merge.sh — ตรวจสอบฟังก์ชันครบหลัง merge
# รัน: bash scripts/verify-merge.sh
# ใช้หลัง merge ทุกครั้งเพื่อป้องกันฟังก์ชันหาย

set -e
cd "$(dirname "$0")/.."

echo "============================================="
echo "🔍 ITAM-NextJS — Merge Verification"
echo "============================================="
echo ""

ERRORS=0

check() {
  local label="$1"
  local cmd="$2"
  local expected="$3"

  local result
  result=$(eval "$cmd" 2>/dev/null)
  if [ -z "$result" ]; then result="0"; fi

  if [ "$result" -ge "$expected" ] 2>/dev/null; then
    echo "  ✅ $label (found: $result)"
  else
    echo "  ❌ $label — Expected: $expected, Got: $result"
    ERRORS=$((ERRORS + 1))
  fi
}

echo "📦 Phase 1: File Existence"
echo "--------------------------------------------"
check "db-config.ts exists" "test -f src/lib/db-config.ts && echo 1 || echo 0" "1"
check "vercel-blob-storage.ts exists" "test -f src/lib/vercel-blob-storage.ts && echo 1 || echo 0" "1"
check "supabase-realtime.ts exists" "test -f src/lib/supabase-realtime.ts && echo 1 || echo 0" "1"
check "health-edge route exists" "test -f src/app/api/health-edge/route.ts && echo 1 || echo 0" "1"
check "daily-report cron exists" "test -f src/app/api/cron/daily-report/route.ts && echo 1 || echo 0" "1"

echo ""
echo "📦 Phase 2: Layout.tsx imports"
echo "--------------------------------------------"
check "Analytics imported" "grep -c 'from \"@vercel/analytics/react\"' src/app/layout.tsx" "1"
check "SpeedInsights imported" "grep -c 'from \"@vercel/speed-insights/next\"' src/app/layout.tsx" "1"
check "<Analytics /> used" "grep -c '<Analytics />' src/app/layout.tsx" "1"
check "<SpeedInsights /> used" "grep -c '<SpeedInsights />' src/app/layout.tsx" "1"

echo ""
echo "📦 Phase 3: Edge runtime + cron"
echo "--------------------------------------------"
check "Edge runtime in health-edge" "grep -c \"runtime = 'edge'\" src/app/api/health-edge/route.ts" "1"
check "maxDuration in daily-report" "grep -c 'maxDuration = 60' src/app/api/cron/daily-report/route.ts" "1"

echo ""
echo "📦 Phase 4: vercel.json crons"
echo "--------------------------------------------"
CRON_COUNT=$(grep -c '"path":' vercel.json 2>/dev/null || echo 0)
echo "  Cron jobs in vercel.json: $CRON_COUNT (expected 2)"
if [ "$CRON_COUNT" = "2" ]; then
  echo "  ✅ Both crons present"
else
  echo "  ❌ Expected 2 crons, got $CRON_COUNT"
  ERRORS=$((ERRORS + 1))
fi

check "keepalive cron" "grep -c 'api/cron/keepalive' vercel.json" "1"
check "daily-report cron" "grep -c 'api/cron/daily-report' vercel.json" "1"

echo ""
echo "📦 Phase 5: Bug fixes preserved"
echo "--------------------------------------------"
check "admin bypass in wo-authz.ts" "grep -c \"ctx.globalRole === 'admin'\" src/lib/wo-authz.ts" "1"
check "LineBinding.lineUserId @unique" "grep -A1 'lineUserId' prisma/schema.prisma | grep -c '@unique'" "1"
check "findFirst in webhook (3+ occurrences)" "grep -c 'lineBinding.findFirst' src/app/api/line/webhook/route.ts | head -1" "3"

# AlertDialogAction should be REDUCED in work-orders-page.tsx (was many, now 2 less)
ALERT_ACTION_COUNT=$(grep -c '<AlertDialogAction' src/components/itam/work-orders-page.tsx 2>/dev/null || echo 0)
echo "  AlertDialogAction count: $ALERT_ACTION_COUNT (should be less than before)"
if [ "$ALERT_ACTION_COUNT" -lt 10 ]; then
  echo "  ✅ AlertDialogAction reduced (fix applied)"
else
  echo "  ⚠️  AlertDialogAction count high — verify manually"
fi

echo ""
echo "📦 Phase 6: Dependencies in package.json"
echo "--------------------------------------------"
check "@vercel/analytics" "grep -c '\"@vercel/analytics\"' package.json" "1"
check "@vercel/speed-insights" "grep -c '\"@vercel/speed-insights\"' package.json" "1"
check "@vercel/blob" "grep -c '\"@vercel/blob\"' package.json" "1"
check "@supabase/supabase-js" "grep -c '\"@supabase/supabase-js\"' package.json" "1"

echo ""
echo "📦 Phase 7: db:seed script exists"
echo "--------------------------------------------"
check "db:seed in package.json" "grep -c '\"db:seed\"' package.json" "1"

echo ""
echo "============================================="
if [ "$ERRORS" -eq 0 ]; then
  echo "🎉 ALL CHECKS PASSED — Safe to deploy!"
  echo "============================================="
  exit 0
else
  echo "❌ $ERRORS ERRORS FOUND — Fix before deploy!"
  echo "============================================="
  exit 1
fi
