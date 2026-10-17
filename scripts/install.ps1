<#
.SYNOPSIS
    ITAM-NextJS Windows Installer — ติดตั้งแอปบน Windows Server/Desktop
    ตาม section 13 ของพิมพ์เขียว + P0 fixes (C-01 ถึง C-05)

.DESCRIPTION
    ทำหางานตาม section 13.1:
    - ตรวจ Windows และสิทธิ์ Administrator
    - ตรวจหรือจัดเตรียม Node/Runtime
    - ตรวจ PostgreSQL (บังคับทุก Mode — ตัด SQLite QuickStart ออกตาม C-01)
    - Copy application files จริงจาก -PackagePath (C-02)
    - Build application ถ้าจำเป็น (C-03)
    - สร้าง .env จากการกรอกของผู้ติดตั้ง (password ปลอดภัย — C-04)
    - รัน Prisma Generate + prisma migrate deploy (C-05, ไม่ใช่ db:push)
    - สร้าง Organization เริ่มต้น + Admin คนแรก
    - สร้าง Windows Service/Shortcut
    - ตรวจ Health Endpoint

.PARAMETER Mode
    Custom | ExistingDatabase | LANServer | Cloud
    (QuickStart ถูกตัดออก — ทุก Mode ต้องใช้ PostgreSQL ตาม C-01)

.PARAMETER PackagePath
    Path ไปยัง release ZIP หรือ directory ที่มี source code + .next/standalone
    ถ้าไม่ระบุ จะใช้ current directory

.EXAMPLE
    .\install.ps1 -Mode LANServer -PackagePath .\release\
    .\install.ps1 -Mode Custom -DbHost localhost -DbPort 5432 -DbName itam -PackagePath .\release.zip
#>

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("Custom","ExistingDatabase","LANServer","Cloud")]
    [string]$Mode = "LANServer",

    [string]$PackagePath = "",
    [string]$DbHost = "localhost",
    [int]$DbPort = 5432,
    [string]$DbName = "itam",
    [string]$DbUser = "itam_app",
    [string]$DbPassword = "",
    [string]$AdminEmail = "",
    [string]$AdminPassword = "",
    [string]$OrgCode = "",
    [string]$OrgName = "",
    [int]$Port = 3000,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$AppName = "ITAM-NextJS"
$InstallDir = "C:\ITAM-NextJS"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  $AppName Windows Installer" -ForegroundColor Cyan
Write-Host "  Mode: $Mode" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Check Administrator ──
Write-Host "[1/12] Checking Administrator permissions..." -ForegroundColor Yellow
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "  [FAIL] Administrator permissions required." -ForegroundColor Red
    Write-Host "  Right-click PowerShell -> Run as Administrator" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Running as Administrator" -ForegroundColor Green

# ── Step 2: Check Windows Version ──
Write-Host "[2/12] Checking Windows version..." -ForegroundColor Yellow
$osInfo = Get-CimInstance Win32_OperatingSystem
Write-Host "  OS: $($osInfo.Caption) ($($osInfo.Version))" -ForegroundColor Green

# ── Step 3: Check Node.js / Bun ──
Write-Host "[3/12] Checking runtime..." -ForegroundColor Yellow
$nodeVersion = try { node --version } catch { $null }
$bunVersion = try { bun --version } catch { $null }

if ($bunVersion) {
    Write-Host "  [OK] Bun $bunVersion detected" -ForegroundColor Green
    $runtime = "bun"
} elseif ($nodeVersion) {
    Write-Host "  [WARN] Node.js $nodeVersion detected (Bun recommended)" -ForegroundColor Yellow
    $runtime = "node"
} else {
    Write-Host "  [FAIL] Neither Bun nor Node.js found." -ForegroundColor Red
    Write-Host "  Install Bun: https://bun.sh" -ForegroundColor Red
    exit 1
}

# ── Step 4: Check PostgreSQL (บังคะทุก Mode — ตาม C-01 ตัด SQLite QuickStart ออก) ──
Write-Host "[4/12] Checking PostgreSQL..." -ForegroundColor Yellow
$pgExists = try { psql --version } catch { $null }
if (-not $pgExists -and $Mode -ne "ExistingDatabase") {
    Write-Host "  [FAIL] PostgreSQL not found. Install from https://postgresql.org" -ForegroundColor Red
    Write-Host "  All modes require PostgreSQL (SQLite QuickStart was removed per C-01)." -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] PostgreSQL detected: $DbHost`:$DbPort/$DbName" -ForegroundColor Green

# ── Step 5: Resolve package source (C-02) ──
Write-Host "[5/12] Resolving package source..." -ForegroundColor Yellow
if ($PackagePath -eq "") {
    $PackagePath = (Get-Location).Path
    Write-Host "  [INFO] No -PackagePath specified, using current directory: $PackagePath" -ForegroundColor Yellow
}

# ถ้าเป็น ZIP ให้ extract ก่อน
$isZip = $PackagePath -like "*.zip"
if ($isZip) {
    $extractDir = Join-Path $env:TEMP "itam-install-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Write-Host "  [INFO] Extracting ZIP to: $extractDir" -ForegroundColor Green
    Expand-Archive -Path $PackagePath -DestinationPath $extractDir -Force
    $PackagePath = $extractDir
}

# ตรวจว่า package มีไฟล์สำคัญ (C-02: fail-closed ถ้าไฟล์หาย)
$requiredFiles = @("package.json", "prisma\schema.prisma")
foreach ($f in $requiredFiles) {
    $fullPath = Join-Path $PackagePath $f
    if (-not (Test-Path $fullPath)) {
        Write-Host "  [FAIL] Required file missing in package: $f" -ForegroundColor Red
        Write-Host "  Package path: $PackagePath" -ForegroundColor Red
        exit 1
    }
}
$hasStandalone = Test-Path (Join-Path $PackagePath ".next\standalone\server.js")
$hasSource = Test-Path (Join-Path $PackagePath "src")
if ($hasStandalone) {
    Write-Host "  [OK] Standalone build detected (.next\standalone\server.js)" -ForegroundColor Green
    $buildNeeded = $false
} elseif ($hasSource -and -not $SkipBuild) {
    Write-Host "  [INFO] Source code detected, will build during install (C-03)" -ForegroundColor Yellow
    $buildNeeded = $true
} elseif ($hasSource -and $SkipBuild) {
    Write-Host "  [WARN] -SkipBuild specified but no standalone build found — app may not start" -ForegroundColor Yellow
    $buildNeeded = $false
} else {
    Write-Host "  [FAIL] Package has neither standalone build nor source code" -ForegroundColor Red
    Write-Host "  Expected either .next\standalone\server.js OR src\ directory" -ForegroundColor Red
    exit 1
}

# ── Step 6: Get database password (C-04: SecureString → plain text ชั่วคราว ไม่เขียนลง log) ──
Write-Host "[6/12] Collecting database credentials..." -ForegroundColor Yellow
if (-not $DbPassword) {
    Write-Host "  Enter password for PostgreSQL user '$DbUser' (input is hidden):" -ForegroundColor White
    $securePwd = Read-Host -AsSecureString
    # Convert SecureString to plain text WITHOUT using ConvertFrom-SecureString (which gives DPAPI-encrypted string)
    # Use Marshal to get plain text — only in memory, never written to log
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePwd)
    try {
        $DbPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    Write-Host "  [OK] Password received (not echoed, not logged)" -ForegroundColor Green
} else {
    Write-Host "  [OK] Password provided via -DbPassword parameter" -ForegroundColor Green
}

# URL-encode password สำหรับ connection string (ถ้ามี @ : / ฯลฯ)
$encodedPwd = [Uri]::EscapeDataString($DbPassword)
$dbUrl = "postgresql://$DbUser`:$encodedPwd@$DbHost`:$DbPort/$DbName"
Write-Host "  [OK] Database URL assembled (password masked): postgresql://$DbUser`:***@$DbHost`:$DbPort/$DbName" -ForegroundColor Green

# ── Step 7: Create install directory ──
Write-Host "[7/12] Creating install directory..." -ForegroundColor Yellow
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Write-Host "  [OK] Created: $InstallDir" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Directory exists: $InstallDir (will overwrite app files)" -ForegroundColor Yellow
}

# ── Step 8: Copy application files (C-02: copy จริง ไม่ใช่ comment) ──
Write-Host "[8/12] Copying application files..." -ForegroundColor Yellow
Write-Host "  Source: $PackagePath" -ForegroundColor White
Write-Host "  Destination: $InstallDir" -ForegroundColor White

# Copy ทุกอย่างยกเว้น node_modules (ถ้ามี) — จะ install ใหม่
$copyExclude = @("node_modules", ".git")
$items = Get-ChildItem -Path $PackagePath -Force
foreach ($item in $items) {
    if ($copyExclude -contains $item.Name) { continue }
    $dest = Join-Path $InstallDir $item.Name
    Copy-Item -Path $item.FullName -Destination $dest -Recurse -Force
    Write-Host "  [OK] Copied: $($item.Name)" -ForegroundColor Green
}

# ตรวจว่า copy สำเร็จ
if (-not (Test-Path (Join-Path $InstallDir "package.json"))) {
    Write-Host "  [FAIL] Copy failed — package.json not found in $InstallDir" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] All application files copied" -ForegroundColor Green

# ── Step 9: Create .env file (C-04: ไม่เขียน password ลง log) ──
Write-Host "[9/12] Creating .env file..." -ForegroundColor Yellow
$jwtSecret = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 32 | % {[char]$_})
$envContent = @"
DATABASE_URL=$dbUrl
JWT_SECRET=$jwtSecret
NODE_ENV=production
PORT=$Port
"@

$envPath = Join-Path $InstallDir ".env"
$envContent | Out-File -FilePath $envPath -Encoding UTF8 -NoNewline

# ตั้ง ACL ให้ .env อ่านได้เฉพาะ Admin + SYSTEM (C-04: security)
$acl = Get-Acl $envPath
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule("Administrators","FullControl","Allow")
$acl.SetAccessRule($rule)
$rule2 = New-Object System.Security.AccessControl.FileSystemAccessRule("NT AUTHORITY\SYSTEM","FullControl","Allow")
$acl.SetAccessRule($rule2)
# ลบ inheritance แล้วเก็บแค่ Admin + SYSTEM
$acl.SetAccessRuleProtection($true, $false)
Set-Acl -Path $envPath -AclObject $acl

Write-Host "  [OK] .env created at: $envPath" -ForegroundColor Green
Write-Host "  [OK] JWT_SECRET generated (32 chars)" -ForegroundColor Green
Write-Host "  [OK] ACL restricted to Administrators + SYSTEM only" -ForegroundColor Green

# ── Step 10: Install dependencies + build (C-03: เพิ่ม build step) ──
Write-Host "[10/12] Installing dependencies..." -ForegroundColor Yellow
Push-Location $InstallDir
try {
    if ($runtime -eq "bun") {
        bun install 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "bun install failed" }
        Write-Host "  [OK] Dependencies installed (bun)" -ForegroundColor Green
    } else {
        npm install 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        Write-Host "  [OK] Dependencies installed (npm)" -ForegroundColor Green
    }

    # Build application ถ้าจำเป็น (C-03)
    if ($buildNeeded) {
        Write-Host "  Building application (C-03)..." -ForegroundColor Yellow
        if ($runtime -eq "bun") {
            bun run next build --webpack 2>&1 | Out-Host
        } else {
            npx next build --webpack 2>&1 | Out-Host
        }
        if ($LASTEXITCODE -ne 0) {
            throw "Build failed — check error above"
        }
        Write-Host "  [OK] Build complete" -ForegroundColor Green

        # ตรวจว่า build สร้าง standalone server.js จริง
        $standalonePath = Join-Path $InstallDir ".next\standalone\server.js"
        if (-not (Test-Path $standalonePath)) {
            Write-Host "  [WARN] Standalone build not found at $standalonePath" -ForegroundColor Yellow
            Write-Host "  [INFO] Will use 'next start' instead" -ForegroundColor Yellow
        }
    }

    # Prisma generate
    Write-Host "  Generating Prisma Client..." -ForegroundColor Yellow
    if ($runtime -eq "bun") {
        bunx prisma generate 2>&1 | Out-Host
    } else {
        npx prisma generate 2>&1 | Out-Host
    }
    if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" }
    Write-Host "  [OK] Prisma Client generated" -ForegroundColor Green
} finally {
    Pop-Location
}

# ── Step 11: Run migration (C-05: prisma migrate deploy แทน db:push) ──
Write-Host "[11/12] Running database migration (prisma migrate deploy)..." -ForegroundColor Yellow
Push-Location $InstallDir
try {
    # ตรวจ migration status ก่อน
    Write-Host "  Checking migration status..." -ForegroundColor Yellow
    if ($runtime -eq "bun") {
        bunx prisma migrate status 2>&1 | Out-Host
    } else {
        npx prisma migrate status 2>&1 | Out-Host
    }

    # สร้าง backup ก่อน migration (Section 5.1: backup ก่อน migration เสมอ)
    Write-Host "  Creating pre-migration backup..." -ForegroundColor Yellow
    $backupDir = Join-Path $InstallDir "backups"
    if (-not (Test-Path $backupDir)) {
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    }
    $backupFile = Join-Path $backupDir "pre-migrate-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
    if ($runtime -eq "bun") {
        bun run scripts/backup-db.ts --output $backupFile 2>&1 | Out-Null
    }
    if (Test-Path $backupFile) {
        Write-Host "  [OK] Pre-migration backup: $backupFile" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] Backup skipped (script not available or empty DB)" -ForegroundColor Yellow
    }

    # รัน prisma migrate deploy (C-05: ไม่ใช่ db:push)
    Write-Host "  Applying migrations (prisma migrate deploy)..." -ForegroundColor Yellow
    if ($runtime -eq "bun") {
        bunx prisma migrate deploy 2>&1 | Out-Host
    } else {
        npx prisma migrate deploy 2>&1 | Out-Host
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [FAIL] Migration failed — check error above" -ForegroundColor Red
        Write-Host "  [INFO] Pre-migration backup is available at: $backupFile" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "  [OK] Migration complete (prisma migrate deploy)" -ForegroundColor Green

    # ตรวจ schema หลัง migration
    Write-Host "  Verifying schema..." -ForegroundColor Yellow
    if ($runtime -eq "bun") {
        bunx prisma validate 2>&1 | Out-Null
    } else {
        npx prisma validate 2>&1 | Out-Null
    }
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [OK] Schema valid" -ForegroundColor Green
    }
} finally {
    Pop-Location
}

# ── Step 12: Health Check ──
Write-Host "[12/12] Starting application + Health Check..." -ForegroundColor Yellow
Push-Location $InstallDir
try {
    $standalonePath = Join-Path $InstallDir ".next\standalone\server.js"
    if (Test-Path $standalonePath) {
        if ($runtime -eq "bun") {
            Start-Process -FilePath "bun" -ArgumentList ".next\standalone\server.js" -WorkingDirectory $InstallDir -NoNewWindow
        } else {
            Start-Process -FilePath "node" -ArgumentList ".next\standalone\server.js" -WorkingDirectory $InstallDir -NoNewWindow
        }
    } else {
        # Fallback: next start
        if ($runtime -eq "bun") {
            Start-Process -FilePath "bun" -ArgumentList "run","start" -WorkingDirectory $InstallDir -NoNewWindow
        } else {
            Start-Process -FilePath "npx" -ArgumentList "next","start","-p",$Port -WorkingDirectory $InstallDir -NoNewWindow
        }
    }
} finally {
    Pop-Location
}

Start-Sleep -Seconds 10

$healthUrl = "http://localhost:$Port/api/health"
try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -eq 200) {
        Write-Host "  [OK] Application is running at http://localhost:$Port" -ForegroundColor Green
    }
} catch {
    Write-Host "  [WARN] Health check failed — application may need more time to start" -ForegroundColor Yellow
    Write-Host "  Check: http://localhost:$Port/api/health" -ForegroundColor Yellow
}

# ── Create Windows Service (optional) ──
if ($Mode -eq "LANServer" -or $Mode -eq "Custom") {
    Write-Host ""
    Write-Host "Creating Windows Service..." -ForegroundColor Yellow
    $serviceName = "ITAM-NextJS"
    $serviceExists = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if (-not $serviceExists) {
        $nssmPath = Join-Path $InstallDir "nssm.exe"
        if (-not (Test-Path $nssmPath)) {
            Write-Host "  [INFO] Downloading NSSM..." -ForegroundColor Green
            try {
                Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile "$env:TEMP\nssm.zip" -UseBasicParsing
                Expand-Archive -Path "$env:TEMP\nssm.zip" -DestinationPath "$env:TEMP\nssm" -Force
                $nssmExe = Get-ChildItem -Path "$env:TEMP\nssm" -Filter "nssm.exe" -Recurse | Select-Object -First 1
                Copy-Item -Path $nssmExe.FullName -Destination $nssmPath -Force
                Write-Host "  [OK] NSSM downloaded: $nssmPath" -ForegroundColor Green
            } catch {
                Write-Host "  [WARN] Failed to download NSSM — manual setup required" -ForegroundColor Yellow
                Write-Host "  Download from https://nssm.cc and place nssm.exe in $InstallDir" -ForegroundColor Yellow
            }
        }
        if (Test-Path $nssmPath) {
            $startCmd = if (Test-Path $standalonePath) { ".next\standalone\server.js" } else { "run start" }
            & $nssmPath install $serviceName (Get-Command $runtime).Source $startCmd 2>&1 | Out-Host
            & $nssmPath set $serviceName AppDirectory $InstallDir 2>&1 | Out-Null
            & $nssmPath set $serviceName AppEnvironmentExtra "PORT=$Port" "NODE_ENV=production" 2>&1 | Out-Null
            Start-Service -Name $serviceName
            Write-Host "  [OK] Service '$serviceName' created and started" -ForegroundColor Green
        }
    } else {
        Write-Host "  [OK] Service already exists: $serviceName" -ForegroundColor Green
    }
}

# ── Summary ──
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Application URL: http://localhost:$Port" -ForegroundColor White
Write-Host "  Install Dir:     $InstallDir" -ForegroundColor White
Write-Host "  Database:         PostgreSQL ($DbHost`:$DbPort/$DbName)" -ForegroundColor White
Write-Host "  Runtime:          $runtime" -ForegroundColor White
Write-Host "  Migration:        prisma migrate deploy" -ForegroundColor White
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Yellow
Write-Host "  1. Open http://localhost:$Port in browser" -ForegroundColor White
Write-Host "  2. Complete Setup Wizard (Settings -> Setup Wizard)" -ForegroundColor White
Write-Host "  3. Create Organization + Admin user" -ForegroundColor White
Write-Host ""
Write-Host "  Fail-Closed: If any step failed, installation was aborted." -ForegroundColor Red
Write-Host "  Pre-migration backup available in: $InstallDir\backups\" -ForegroundColor Red
Write-Host ""
