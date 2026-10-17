# ============================================================
# ITAM regression suite - run against a live dev server.
#   pwsh -NoProfile -ExecutionPolicy Bypass -File .regress.ps1
# Re-runnable. Cleans up every device it creates.
# ============================================================
$ErrorActionPreference = 'Continue'
$base = 'http://localhost:3000'
$script:results = @()
$script:token = $null
$script:createdDevices = @()

function Call($method, $path, $body) {
  $p = @{ Uri = ($base + $path); Method = $method; TimeoutSec = 90; UseBasicParsing = $true; ErrorAction = 'Stop' }
  if ($script:token) { $p.Headers = @{ Authorization = "Bearer $($script:token)" } }
  if ($null -ne $body) { $p.ContentType = 'application/json'; $p.Body = ($body | ConvertTo-Json -Depth 12 -Compress) }
  try { $r = Invoke-WebRequest @p; return @{ code = $r.StatusCode; text = $r.Content } }
  catch { $resp = $_.Exception.Response
    if ($resp) { $t = ''; try { $t = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {}
      return @{ code = [int]$resp.StatusCode; text = $t } }
    return @{ code = 0; text = $_.Exception.Message } }
}

function Check($group, $name, $res, $expect) {
  $ok = $expect -contains $res.code
  $script:results += [PSCustomObject]@{ Group=$group; Name=$name; Code=$res.code; Expected=($expect -join '/'); Ok=$ok
    Detail = $(if ($ok) { '' } else { $s = ($res.text -replace '\s+',' '); if ($s.Length -gt 110) { $s.Substring(0,110) } else { $s } }) }
  $null = $ok
}

function Section($t) { Write-Host ''; Write-Host "### $t" }
function Flag($c) { return @{ code = $c } }
function Ok($b) { return $(if ($b) { 200 } else { 0 }) }

# -- 1. AUTH --
Section 'AUTH'
Check 'AUTH' 'health' (Call 'GET' '/api/health' $null) 200
Check 'AUTH' 'login rejects wrong password' (Call 'POST' '/api/itam/auth/login' @{ username='admin@itam.local'; password='NOPE' } $null) @(400,401,403)
$l = Call 'POST' '/api/itam/auth/login' @{ username='admin@itam.local'; password='test1234' } $null
Check 'AUTH' 'login succeeds' $l @(200)
$script:token = ($l.text | ConvertFrom-Json).token
Check 'AUTH' 'me' (Call 'GET' '/api/itam/auth/me' $null) 200

# -- 2. READ SWEEP --
Section 'READ SWEEP'
$gets = @('dashboard','devices','itam/devices','v1/devices','work-orders','v1/work-orders',
 'stock-items','stock-items/pending','stock-count','purchase-orders','users','users/pending','audit','itam/audit',
 'sites','itam/sites','sites/comparison','site-rates','site-attributes','settings','settings/options',
 'settings/modules','settings/org-profile','settings/asset-categories','reports','reports/asset-register',
 'reports/custom','itam/paper-analytics','itam/dashboard','itam/dashboard/insights','itam/search','search',
 'meter','meter/reminders','itam/meter-readings','v1/meter-readings','cycles','v1/cycles','master',
 'itam/master-items','numbering/schemes','numbering/categories','itam/maintenance','pm/schedules','pm/calendar',
 'pm/executions','itam/assignments','itam/stock','itam/license-records','itam/document-templates',
 'itam/sticker/settings','itam/sticker/templates','itam/notifications/settings','notifications',
 'organizations','sync/status','sync/runs','sync/conflicts','templates','devices/utilization',
 'devices/warranty','devices/lifecycle','devices/next-asset-code',
 'itam/auth/roles','itam/auth/permissions','itam/auth/users','integrations/google-sheets/status',
 'health/authz','search/fts')
foreach ($g in $gets) { Check 'READ' $g (Call 'GET' "/api/$g" $null) 200 }
# location-summary requires site AND building; a bare call 400s by design.
Check 'READ' 'itam/devices/location-summary (site+building)' (Call 'GET' '/api/itam/devices/location-summary?site=NKP&building=RG' $null) 200

# -- 3. DATE-RANGE (regression: Date filters on SQLite) --
Section 'DATE-RANGE (SQLite Date-filter regression)'
$m = '2026-07'
$dated = @("reports/monthly?month=$m","reports/monthly?month=$m&site=UDH","reports/monthly?month=$m&type=stock",
 "reports/monthly?month=$m&type=work-order","reports/monthly?month=$m&type=devices",
 "reports/asset-register?month=$m","reports/wo-cost-summary?month=$m","itam/paper-analytics?month=$m",
 "itam/meter-readings/unread?month=$m","itam/meter-readings?month=$m","v1/meter-readings?month=$m",
 "devices/utilization?month=$m","devices/warranty?month=$m","devices/depreciation?month=$m",
 "sites/comparison?month=$m","cost-analytics?month=$m","cost-analytics/material?month=$m",
 "audit?month=$m","itam/audit?month=$m","itam/dashboard/insights?month=$m","stock-count?month=$m")
foreach ($d in $dated) { Check 'DATERANGE' $d (Call 'GET' "/api/$d" $null) 200 }

# -- 4. DEVICE CRUD (id and assetCode) --
Section 'DEVICE CRUD'
$code = 'REGRESS-' + (Get-Random -Max 99999)
$r = Call 'POST' '/api/itam/devices' @{ assetNo=$code; name='Regression Printer' } $null
Check 'DEVICE' 'create with minimal fields' $r @(200,201)
$dev = $null
try { $o = $r.text | ConvertFrom-Json; $dev = if ($o.device) { $o.device } elseif ($o.data) { $o.data } else { $o } } catch {}
if ($dev -and $dev.id) {
  $script:createdDevices += $dev.id
  Check 'DEVICE' 'no null crash on non-nullable fields' (Flag (Ok ($dev.type -and $dev.brand -and $dev.model -and $dev.site))) @(200)
  Check 'DEVICE' 'read by id'        (Call 'GET'    "/api/itam/devices/$($dev.id)"      $null) 200
  Check 'DEVICE' 'read by assetCode' (Call 'GET'    "/api/itam/devices/$($dev.assetCode)" $null) 200
  Check 'DEVICE' 'update by id'      (Call 'PUT'    "/api/itam/devices/$($dev.id)" @{ name='Regression v2'; brand='HP'; model='M404'; type='PRINTER' } $null) 200
  $upd = (Call 'GET' "/api/itam/devices/$($dev.id)" $null).text | ConvertFrom-Json
  $ud = if ($upd.device) { $upd.device } else { $upd }
  Check 'DEVICE' 'update persisted'  (Flag (Ok ($ud.type -eq 'PRINTER' -and $ud.brand -eq 'HP'))) @(200)
  Check 'DEVICE' 'delete by id'      (Call 'DELETE' "/api/itam/devices/$($dev.id)"      $null) @(200,204)
  Check 'DEVICE' 'gone after delete' (Call 'GET'    "/api/itam/devices/$($dev.id)"      $null) @(404,410)
} else { Check 'DEVICE' 'create returned an id' (Flag 0) @(200) }

$c2 = 'REGRESS-' + (Get-Random -Max 99999)
$r2 = Call 'POST' '/api/itam/devices' @{ assetNo=$c2; name='R2'; type='SCANNER'; site='NKP' } $null
Check 'DEVICE' 'accepts `type` field' $r2 @(200,201)
try { $o = $r2.text | ConvertFrom-Json; $d2 = if ($o.device) { $o.device } elseif ($o.data) { $o.data } else { $o }
  if ($d2.id) { $script:createdDevices += $d2.id
    Check 'DEVICE' 'type stored correctly' (Flag (Ok ($d2.type -eq 'SCANNER'))) @(200)
    Call 'DELETE' "/api/itam/devices/$($d2.id)" $null | Out-Null } } catch {}

# -- 5. METER READING --
Section 'METER READING'
$devs = (Call 'GET' '/api/itam/devices' $null).text | ConvertFrom-Json
$dl = if ($devs.devices) { $devs.devices } elseif ($devs.data) { $devs.data } else { $devs }
$md = @($dl | Where-Object { $_.meterRequired -eq $true })[0]
if ($md) {
  $free = $null
  foreach ($mm in @('2026-01','2026-02','2026-03','2026-04','2026-05','2026-06')) {
    $chk = (Call 'GET' "/api/itam/meter-readings?assetCode=$($md.assetCode)&month=$mm" $null).text | ConvertFrom-Json
    $it = if ($chk.readings) { $chk.readings } elseif ($chk.data) { $chk.data } else { @() }
    if (@($it).Count -eq 0) { $free = $mm; break }
  }
  Write-Host "   target=$($md.assetCode) freeMonth=$free"
  if ($free) {
    $mr = Call 'POST' '/api/itam/meter-readings' @{ assetCode=$md.assetCode; meterBw=([int]$md.lastMeterBw+40); meterColor=([int]$md.lastMeterColor); readingDate="$free-15"; readingMonth=$free; readingType='MONTHLY'; remark='regression' } $null
    Check 'METER' 'create reading' $mr @(200,201)
    $pages = $null
    try { $o = $mr.text | ConvertFrom-Json; $pages = if ($o.reading) { $o.reading.pagesBw } else { $o.pagesBw } } catch {}
    Check 'METER' 'pages computed from prev' (Flag (Ok ($pages -eq 40))) @(200)
    Check 'METER' 'read back' (Call 'GET' "/api/v1/meter-readings?month=$free" $null) 200
    Check 'METER' 'duplicate month rejected' (Call 'POST' '/api/itam/meter-readings' @{ assetCode=$md.assetCode; meterBw=([int]$md.lastMeterBw+41); readingDate="$free-16"; readingMonth=$free; readingType='MONTHLY' } $null) @(400,409)
    Check 'METER' 'future date rejected' (Call 'POST' '/api/itam/meter-readings' @{ assetCode=$md.assetCode; meterBw=1; readingDate='2099-01-01'; readingMonth='2099-01' } $null) @(400,409)
  }
}

# -- 6. TRANSFER --
Section 'TRANSFER'
$src = @($dl | Where-Object { $_.status -eq 'active' -and $_.meterRequired -eq $true })[0]
if ($src) {
  $destSite = if ($src.site -eq 'NKP') { 'UDH' } else { 'NKP' }
  Write-Host "   target=$($src.assetCode) @ $($src.site)"
  Check 'TRANSFER' 'blocked without meter/ack' (Call 'POST' "/api/itam/devices/$($src.id)/transfer" @{ toSite=$destSite; reason='x' } $null) @(400)
  Check 'TRANSFER' 'ack without reason rejected' (Call 'POST' "/api/itam/devices/$($src.id)/transfer" @{ toSite=$destSite; meterSkipAcknowledged=$true } $null) @(400)
  $tr = Call 'POST' "/api/itam/devices/$($src.id)/transfer" @{ toSite=$destSite; toBuilding=$src.building; toFloor=$src.floor; toDepartment='RG'; toDepartmentCode='RG-1'; toLocation='RG'; reason='regression'; meterSkipAcknowledged=$true; skipMeterReason='regression estimate'; estimatedMeterBw=([int]$src.lastMeterBw+15); estimatedMeterColor=([int]$src.lastMeterColor) } $null
  Check 'TRANSFER' 'transfer with estimate' $tr @(200)
  try { $o = $tr.text | ConvertFrom-Json
    Check 'TRANSFER' 'meterReadingId linked' (Flag (Ok ($o.locationHistory.meterReadingId))) @(200)
    Check 'TRANSFER' 'device relocated' (Flag (Ok ($o.device.site -eq $destSite))) @(200) } catch {}
}

# -- 7. OTHER WRITES --
Section 'OTHER WRITES'
$si = (Call 'GET' '/api/stock-items' $null).text | ConvertFrom-Json
$il = if ($si.items) { $si.items } elseif ($si.data) { $si.data } else { $si }
$it0 = @($il)[0]
if ($it0) { Check 'WRITE' 'stock transaction' (Call 'POST' "/api/stock-items/$($it0.id)/transaction" @{ type='IN'; quantity=1; note='regression' } $null) @(200,201) }
Check 'WRITE' 'settings update' (Call 'PUT' '/api/settings' @{ completionEnabled=$true } $null) @(200)

# -- CLEANUP + SUMMARY --
foreach ($id in $script:createdDevices) { Call 'DELETE' "/api/itam/devices/$id" $null | Out-Null }
Write-Host ''
Write-Host '========================================================'
$pass = @($script:results | Where-Object { $_.Ok }).Count
$bad = @($script:results | Where-Object { -not $_.Ok })
Write-Host "TOTAL: $($script:results.Count)   PASS: $pass   FAIL: $($bad.Count)"
if ($bad.Count) {
  Write-Host ''
  $bad | ForEach-Object { Write-Host ("  [{0}] {1} -> got {2} want {3}   {4}" -f $_.Group, $_.Name, $_.Code, $_.Expected, $_.Detail) }
}
Write-Host '========================================================'