#!/bin/bash
# run-tests.sh — start the dev server, run Playwright E2E tests, stop the server.
#
# Usage:
#   ./scripts/run-tests.sh                # run all E2E tests
#   ./scripts/run-tests.sh tests/e2e/auth.spec.ts   # run a single file
#
# Env vars:
#   TEST_URL      — override the base URL (default http://localhost:3000)
#   E2E_ADMIN_USER / E2E_ADMIN_PASS          — admin credentials
#   E2E_DEMO_ADMIN_USER / E2E_DEMO_ADMIN_PASS — demo credentials
#
# Exit code = Playwright's exit code (0 = all passed, 1 = some failed).

set -u

PROJECT_DIR="/home/z/my-project"
cd "$PROJECT_DIR" || { echo "❌ Project dir not found: $PROJECT_DIR"; exit 2; }

echo "🧪 Starting E2E tests..."

# Start the dev server in the background.
bun run dev > /tmp/itam-e2e-dev.log 2>&1 &
SERVER_PID=$!
echo "   dev server PID: $SERVER_PID"

# Wait for the server to be ready (poll the homepage).
echo "   waiting for dev server..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000/ > /dev/null 2>&1; then
    echo "   ✓ dev server ready after ${i}s"
    break
  fi
  sleep 1
done

# Run Playwright (forward any extra args).
npx playwright test "$@"
TEST_EXIT=$?

# Stop the dev server.
echo "🛑 Stopping dev server (PID $SERVER_PID)..."
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true

exit "$TEST_EXIT"
