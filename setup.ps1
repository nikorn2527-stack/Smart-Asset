# ============================================================
# ITAM-NextJS - Windows PowerShell Setup Script
# ============================================================
# Run this ONCE after cloning the repo on Windows.
#
# Usage (in PowerShell, from the project root):
#   .\setup.ps1
#
# What it does:
#   1. Checks that bun is installed
#   2. Copies .env.example -> .env if missing
#   3. Generates a random JWT_SECRET (if still the placeholder)
#   4. Auto-syncs prisma/schema.prisma provider with DATABASE_URL
#   5. Runs prisma db push (creates the SQLite DB / syncs schema)
#   6. Runs prisma generate (builds the typed client)
#
# After this script finishes, run:
#   bun run dev          # to start the dev server (http://localhost:3000)
# ============================================================

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "  [X]  $msg" -ForegroundColor Red }

# -- 1. Pre-flight: bun --
Write-Step "Checking prerequisites"
try {
    $bunVersion = bun --version 2>$null
    Write-Ok "bun $bunVersion"
} catch {
    Write-Err "bun not found. Install from https://bun.sh (PowerShell):"
    Write-Host '  powershell -c "irm bun.sh/install.ps1 | iex"'
    exit 1
}

# -- 2. Install npm dependencies (idempotent) --
if (-not (Test-Path "node_modules")) {
    Write-Step "Installing dependencies (first run - this takes a few minutes)"
    bun install
    Write-Ok "Dependencies installed"
} else {
    Write-Ok "node_modules exists - skipping bun install"
}

# -- 3. Copy .env.example -> .env if missing --
Write-Step "Setting up .env"
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Ok "Copied .env.example -> .env"
    } else {
        Write-Err ".env.example not found. Create .env manually with DATABASE_URL and JWT_SECRET."
        exit 1
    }
} else {
    Write-Ok ".env already exists"
}

# -- 4. Generate JWT_SECRET if still placeholder --
$envContent = Get-Content ".env" -Raw
if ($envContent -match "JWT_SECRET=CHANGE_ME_TO_RANDOM_32_CHAR_STRING") {
    # Generate 32 random hex chars (PowerShell built-in - no openssl needed)
    $bytes = New-Object byte[] 32
    ([System.Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($bytes)
    $secret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    $envContent = $envContent -replace "JWT_SECRET=CHANGE_ME_TO_RANDOM_32_CHAR_STRING", "JWT_SECRET=$secret"
    Set-Content -Path ".env" -Value $envContent -NoNewline
    Write-Ok "Generated a random JWT_SECRET (64 hex chars)"
} else {
    Write-Ok "JWT_SECRET already set"
}

# -- 5. Load .env into this session (so prisma can see DATABASE_URL) --
Write-Step "Loading .env"
Get-Content ".env" | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $idx = $line.IndexOf("=")
        $key = $line.Substring(0, $idx).Trim()
        $val = $line.Substring($idx + 1).Trim().Trim('"')
        Set-Item -Path "Env:$key" -Value $val
    }
}
$dbUrl = $env:DATABASE_URL
if (-not $dbUrl) {
    Write-Err "DATABASE_URL is not set in .env"
    exit 1
}
if ($dbUrl.StartsWith("file:")) {
    Write-Ok "DATABASE_URL = SQLite (dev mode - no PostgreSQL needed)"
    $env:ITAM_ALLOW_SQLITE = "1"
} elseif ($dbUrl.StartsWith("postgres")) {
    Write-Ok "DATABASE_URL = postgresql:... (PostgreSQL baseline)"
} else {
    Write-Err "DATABASE_URL is not a valid SQLite (file:) or PostgreSQL (postgresql:) URL"
    Write-Host "   Got: $dbUrl" -ForegroundColor White
    Write-Host "   Set DATABASE_URL in .env to either:" -ForegroundColor Yellow
    Write-Host "     file:./db/custom.db          (SQLite for dev)" -ForegroundColor Yellow
    Write-Host "     postgresql://user:pass@host:5432/db  (PostgreSQL for production)" -ForegroundColor Yellow
    exit 1
}

# -- 6. Auto-sync prisma provider with DATABASE_URL --
Write-Step "Syncing prisma provider"
node scripts/set-prisma-provider.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Err "set-prisma-provider.mjs failed"
    exit 1
}

# -- 7. Create db folder if using SQLite --
if ($dbUrl.StartsWith("file:")) {
    $dbDir = Join-Path $ProjectRoot "db"
    if (-not (Test-Path $dbDir)) {
        New-Item -ItemType Directory -Path $dbDir | Out-Null
        Write-Ok "Created db/ folder (SQLite mode)"
    }
}

# -- 8. Database schema setup (SQLite: db push, PostgreSQL: migrate deploy) --
Write-Step "Running database setup"
if ($dbUrl.StartsWith("file:")) {
    bunx prisma db push
    if ($LASTEXITCODE -ne 0) {
        Write-Err "prisma db push failed"
        exit 1
    }
    Write-Ok "Database schema synced (db push - SQLite dev mode)"
} else {
    bunx prisma migrate deploy
    if ($LASTEXITCODE -ne 0) {
        Write-Err "prisma migrate deploy failed"
        exit 1
    }
    Write-Ok "Database schema synced (migrate deploy - PostgreSQL)"
}

# -- 9. prisma generate --
Write-Step "Generating Prisma Client"
bunx prisma generate
if ($LASTEXITCODE -ne 0) {
    Write-Err "prisma generate failed"
    exit 1
}
Write-Ok "Prisma Client generated"

# -- Done --
Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  [OK] Setup complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "  bun run dev      # start dev server on http://localhost:3000"
Write-Host "  bun run db:seed  # (optional) seed demo data"
Write-Host ""
Write-Host "Default login (after seeding): admin / test1234" -ForegroundColor Yellow
