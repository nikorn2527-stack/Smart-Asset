#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/../.zscripts" && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

# PostgreSQL deployments should only prepare the build directory and never create
# a packaged database file or call Prisma against a local filesystem path.
POSTGRES_BUILD="$TEST_ROOT/postgres-build"
PROJECT_DIR="$TEST_ROOT/project" \
BUILD_DIR="$POSTGRES_BUILD" \
DATABASE_URL="postgresql://postgres:password@example.test:5432/postgres" \
    bash "$SCRIPT_DIR/database-runtime-build.sh"

test -d "$POSTGRES_BUILD"
test ! -e "$POSTGRES_BUILD/db"

# SQLite must fail fast so a Vercel build cannot silently package an ephemeral DB.
SQLITE_BUILD="$TEST_ROOT/sqlite-build"
if PROJECT_DIR="$TEST_ROOT/project" \
   BUILD_DIR="$SQLITE_BUILD" \
   DATABASE_URL="file:$SQLITE_BUILD/custom.db" \
       bash "$SCRIPT_DIR/database-runtime-build.sh"; then
    echo "SQLite DATABASE_URL was accepted unexpectedly" >&2
    exit 1
fi

test ! -e "$SQLITE_BUILD/db"

echo "database runtime build tests passed"
