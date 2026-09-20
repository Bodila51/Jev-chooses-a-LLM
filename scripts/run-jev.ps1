param(
  [Parameter(Mandatory=$true, Position=0)]
  [string]$Task,
  [switch]$DryRun,
  [switch]$Approve
)
$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
$env:NODE_OPTIONS = "--use-system-ca"
Get-Content .env | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { Set-Item -Path "Env:$($matches[1])" -Value $matches[2] }
}
$npxArgs = @("tsx", "sdk-runner/cli.ts")
if ($DryRun) { $npxArgs += "--dry-run" } else { $npxArgs += "--run" }
if ($Approve) { $npxArgs += "--approve" }
$npxArgs += $Task
& npx @npxArgs
