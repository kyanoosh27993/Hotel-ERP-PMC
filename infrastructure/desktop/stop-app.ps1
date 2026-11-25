# stop-app.ps1 — stop the running Hotel ERP app cleanly before install/uninstall.
# Called by installer.nsi (upgrade/reinstall) and the uninstaller.
# Clean shutdown of PostgreSQL is done first via pg_ctl so no WAL replay is needed next run.
# ASCII-only on purpose: PowerShell 5.1 reads BOM-less files as ANSI and would corrupt
# non-ASCII string literals.
param(
  [string]$InstallDir,
  [string]$DataDir
)
$ErrorActionPreference = 'SilentlyContinue'

function Stop-Under($root) {
  if (-not $root) { return }
  $rootNorm = $root.TrimEnd('\').ToLower()
  Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.TrimEnd('\').ToLower().StartsWith($rootNorm)
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

# 1) close launcher/API node processes whose exe lives under the install dir
Stop-Under $InstallDir

# 2) close cmd consoles running our run-server.cmd / boot.cmd
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'cmd.exe' -and $_.CommandLine -and (
    $_.CommandLine -like '*run-server.cmd*' -or $_.CommandLine -like '*HotelERP*boot.cmd*'
  )
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# 3) clean stop of the embedded PostgreSQL (fast) — keeps data consistent
if ($DataDir -and $InstallDir) {
  $pgCtl = Join-Path $InstallDir 'api\node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe'
  $pgData = Join-Path $DataDir 'pgdata'
  if (Test-Path $pgCtl) {
    & $pgCtl -D $pgData -m fast -w -t 60 stop
  }
}

# 4) force-kill any orphan postgres.exe whose data dir is ours (any install location)
if ($DataDir) {
  $pgDataNorm = (Join-Path $DataDir 'pgdata').ToLower()
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'postgres.exe' -and $_.CommandLine -and $_.CommandLine.ToLower().Contains($pgDataNorm)
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

# 5) final sweep of anything still under the install dir
Stop-Under $InstallDir

# 6) remove the de-elevation scheduled task if present
schtasks /delete /tn 'HotelERP Limited Run' /f

# 7) wait until no processes are left under the install dir (up to 15s)
for ($i = 0; $i -lt 15; $i++) {
  $left = Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $InstallDir -and $_.ExecutablePath.TrimEnd('\').ToLower().StartsWith($InstallDir.TrimEnd('\').ToLower())
  }
  if (-not $left) { break }
  Start-Sleep -Milliseconds 1000
}
