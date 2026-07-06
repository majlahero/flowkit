<#
    Flow Kit - Setup (Windows PowerShell)
    Windows port of setup.sh. Only ADDS Windows support; does not touch setup.sh.

    Steps:
      - Check Python (py -3 preferred, else python), pip, ffmpeg, ffprobe, Chrome
      - Create venv, install requirements.txt, verify agent.main imports
      - Configure Claude Code statusline to run scripts\statusline.ps1

    Uses only tools present on a clean Windows box (built-in PowerShell). No jq / bash / iconv.
#>

$ErrorActionPreference = "Stop"

# Repo root = folder containing this script
$RepoRoot = $PSScriptRoot
Set-Location $RepoRoot

Write-Host "========================================="
Write-Host "  Flow Kit - Setup (Windows)"
Write-Host "========================================="
Write-Host ""

$Errors = 0

# --- Python -------------------------------------------------------
Write-Host "Checking Python..."
$PY = $null
# Prefer the py launcher (py -3), fall back to python on PATH
if (Get-Command py -ErrorAction SilentlyContinue) {
    try {
        $null = & py -3 --version 2>&1
        if ($LASTEXITCODE -eq 0) { $PY = @("py", "-3") }
    } catch {}
}
if (-not $PY -and (Get-Command python -ErrorAction SilentlyContinue)) {
    $PY = @("python")
}

# Split $PY into executable + args ONCE. Select-Object -Skip 1 yields an EMPTY
# array when $PY has a single element (avoids the reverse-range bug of
# $PY[1..($PY.Count-1)], where 1..0 == @(1,0) and would inject a bogus arg).
if ($PY) {
    $pyExe  = $PY[0]
    $pyArgs = @($PY | Select-Object -Skip 1)
}

if ($PY) {
    $verRaw = (& $pyExe @pyArgs --version 2>&1) | Select-Object -First 1
    $verStr = ($verRaw -replace '[^0-9.]', '').Trim()
    $parts = $verStr.Split('.')
    $maj = 0; $min = 0
    if ($parts.Count -ge 1) { [int]::TryParse($parts[0], [ref]$maj) | Out-Null }
    if ($parts.Count -ge 2) { [int]::TryParse($parts[1], [ref]$min) | Out-Null }
    if ($maj -gt 3 -or ($maj -eq 3 -and $min -ge 10)) {
        Write-Host "  OK: Python $verStr"
    } else {
        Write-Host "  WARNING: Python $verStr found, 3.10+ recommended"
    }
} else {
    Write-Host "  MISSING: Python not found"
    Write-Host "  Install: https://www.python.org/downloads/"
    Write-Host "           (during install, tick 'Add python.exe to PATH')"
    exit 1
}

# --- pip ----------------------------------------------------------
Write-Host "Checking pip..."
$pipOut = (& $pyExe @pyArgs -m pip --version 2>&1) | Select-Object -First 1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  OK: $pipOut"
} else {
    Write-Host "  MISSING: pip not found"
    Write-Host "  Install: $($PY -join ' ') -m ensurepip --upgrade"
    $Errors++
}

# --- ffmpeg -------------------------------------------------------
Write-Host "Checking ffmpeg..."
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    $ffLine = (& ffmpeg -version 2>&1) | Select-Object -First 1
    $ffVer = ($ffLine -split '\s+')[2]
    Write-Host "  OK: ffmpeg $ffVer"
} else {
    Write-Host "  MISSING: ffmpeg not found (needed for video concat/trim/music)"
    Write-Host "  Windows: winget install Gyan.FFmpeg"
    Write-Host "           or https://ffmpeg.org/download.html"
    $Errors++
}

# --- ffprobe ------------------------------------------------------
Write-Host "Checking ffprobe..."
if (Get-Command ffprobe -ErrorAction SilentlyContinue) {
    Write-Host "  OK: ffprobe available"
} else {
    Write-Host "  MISSING: ffprobe not found (usually bundled with ffmpeg)"
    Write-Host "  Windows: winget install Gyan.FFmpeg"
    $Errors++
}

# --- Chrome -------------------------------------------------------
Write-Host "Checking Chrome..."
$chromePaths = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
)
$chromeFound = $false
foreach ($p in $chromePaths) {
    if ($p -and (Test-Path $p)) { $chromeFound = $true; break }
}
if (-not $chromeFound -and (Get-Command chrome -ErrorAction SilentlyContinue)) {
    $chromeFound = $true
}
if ($chromeFound) {
    Write-Host "  OK: Chrome found"
} else {
    Write-Host "  WARNING: Chrome not detected (needed for extension)"
    Write-Host "  Download: https://www.google.com/chrome/"
}

Write-Host ""

# --- Abort if critical missing ------------------------------------
if ($Errors -gt 0) {
    Write-Host "Found $Errors missing dependency(ies). Install them and re-run."
    exit 1
}

# --- Virtual environment ------------------------------------------
Write-Host "Setting up Python virtual environment..."
$venvPython = Join-Path $RepoRoot "venv\Scripts\python.exe"
if (-not (Test-Path (Join-Path $RepoRoot "venv"))) {
    & $pyExe @pyArgs -m venv venv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  FAILED: could not create venv"
        exit 1
    }
    Write-Host "  Created: venv\"
} else {
    Write-Host "  Exists: venv\"
}

if (-not (Test-Path $venvPython)) {
    Write-Host "  FAILED: venv\Scripts\python.exe not found after venv creation"
    exit 1
}

# --- Install dependencies -----------------------------------------
Write-Host "Installing Python dependencies..."
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAILED: pip upgrade failed"
    exit 1
}
& $venvPython -m pip install -r (Join-Path $RepoRoot "requirements.txt")
if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAILED: pip install -r requirements.txt failed"
    exit 1
}
Write-Host "  Installed: dependencies from requirements.txt"

# --- Verify import ------------------------------------------------
Write-Host "Verifying agent can import..."
& $venvPython -c "from agent.main import app; print('  OK: agent.main imports successfully')"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  FAILED: agent cannot import - check error above"
    exit 1
}

# --- Statusline runner (PowerShell 7 preferred, else Windows PS 5) -
Write-Host "Checking PowerShell for statusline..."
$pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue
if ($pwshCmd) {
    $PWSH = "pwsh"
    Write-Host "  OK: pwsh (PowerShell 7) found"
} else {
    $PWSH = "powershell"
    Write-Host "  OK: using Windows PowerShell (powershell)"
}
Write-Host "  Note: statusline.ps1 parses JSON with ConvertFrom-Json (no jq needed)"

# --- Claude Code statusline ---------------------------------------
$statuslineScript = Join-Path $RepoRoot "scripts\statusline.ps1"
$claudeDir = Join-Path $RepoRoot ".claude"
$claudeSettings = Join-Path $claudeDir "settings.local.json"
$statusLineCommand = "$PWSH -NoProfile -File `"$statuslineScript`""

Write-Host "Setting up Claude Code statusline..."
if (Test-Path $claudeSettings) {
    $raw = Get-Content -Raw -Path $claudeSettings -ErrorAction SilentlyContinue
    $obj = $null
    if ($raw -and $raw.Trim()) {
        try { $obj = $raw | ConvertFrom-Json } catch { $obj = $null }
    }
    if ($null -eq $obj) {
        $obj = [PSCustomObject]@{}
    }
    if ($obj.PSObject.Properties.Name -contains "statusLine") {
        Write-Host "  OK: statusLine already configured"
    } else {
        $sl = [PSCustomObject]@{ type = "command"; command = $statusLineCommand }
        $obj | Add-Member -MemberType NoteProperty -Name "statusLine" -Value $sl -Force
        ($obj | ConvertTo-Json -Depth 20) | Set-Content -Path $claudeSettings -Encoding UTF8
        Write-Host "  Added: statusLine to .claude\settings.local.json"
    }
} else {
    if (-not (Test-Path $claudeDir)) {
        New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
    }
    $obj = [PSCustomObject]@{
        statusLine = [PSCustomObject]@{ type = "command"; command = $statusLineCommand }
    }
    ($obj | ConvertTo-Json -Depth 20) | Set-Content -Path $claudeSettings -Encoding UTF8
    Write-Host "  Created: .claude\settings.local.json with statusLine"
}

Write-Host ""
Write-Host "========================================="
Write-Host "  Setup complete!"
Write-Host "========================================="
Write-Host ""
Write-Host "Next steps:"
Write-Host ""
Write-Host "  1. Load Chrome extension:"
Write-Host "     chrome://extensions -> Developer mode -> Load unpacked -> extension\"
Write-Host ""
Write-Host "  2. Open Google Flow:"
Write-Host "     https://labs.google/fx/tools/flow (sign in)"
Write-Host ""
Write-Host "  3. Start the agent:"
Write-Host "     .\venv\Scripts\Activate.ps1"
Write-Host "     python -m agent.main"
Write-Host ""
Write-Host "  4. Verify:"
Write-Host "     curl http://127.0.0.1:8100/health"
Write-Host "     (or: Invoke-RestMethod http://127.0.0.1:8100/health)"
Write-Host ""
Write-Host "  5. Claude Code statusline:"
Write-Host "     GLA status shows at the bottom of Claude Code automatically."
Write-Host ""
