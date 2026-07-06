<#
    Flow Kit statusline for Claude Code (Windows).
    Windows port of scripts/statusline.sh.

    Parses Claude session JSON from STDIN with ConvertFrom-Json (no jq),
    queries the local agent at http://127.0.0.1:8100 with Invoke-RestMethod,
    and prints one status line. Always exits 0 so it can never break Claude Code.

    ANSI colors: green=32, violet/magenta=35. Uses [char]27 for PS5 + PS7 compat.
#>

# Never let an error abort the line; always exit 0 at the end.
$ErrorActionPreference = "SilentlyContinue"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# Repo root = parent of scripts\ ; cd there so output\ paths resolve like the .sh
$RepoRoot = Split-Path $PSScriptRoot -Parent
try { Set-Location $RepoRoot } catch {}

# ── ANSI colors (built with [char]27 for PS5 + PS7 compat) ──
$ESC = [char]27
$G = "$ESC[32m"   # green
$V = "$ESC[35m"   # violet
$R = "$ESC[0m"    # reset

# ── Unicode glyphs (built with [char] so PS5 renders them, unlike `u{}) ──
$WARN = [char]0x26A0   # ⚠
$UP   = [char]0x2191   # ↑
$DN   = [char]0x2193   # ↓
$X    = [char]0x2717   # ✗
$ARR  = [char]0x2192   # →

# ── Helpers ──
function Get-Prop {
    param($obj, [string]$name)
    if ($null -eq $obj) { return $null }
    $p = $obj.PSObject.Properties[$name]
    if ($p) { return $p.Value }
    return $null
}

function Fetch {
    param([string]$url)
    try {
        return Invoke-RestMethod -Uri $url -TimeoutSec 1 -ErrorAction Stop
    } catch {
        return $null
    }
}

function Count-Array {
    param($v)
    if ($null -eq $v) { return 0 }
    return @($v).Count
}

function ToFloorInt {
    param($v)
    if ($null -eq $v) { return 0 }
    try { return [int][math]::Floor([double]$v) } catch { return 0 }
}

$BASE = "http://127.0.0.1:8100"

# ── Claude session info (from stdin JSON) ──
$CLAUDE = ""
try {
    $stdin = [Console]::In.ReadToEnd()
    if ($stdin -and $stdin.Trim()) {
        $cj = $stdin | ConvertFrom-Json
        $model = Get-Prop $cj "model"
        $modelName = if ($model) { Get-Prop $model "display_name" } else { $null }
        if ($modelName) {
            $cw = Get-Prop $cj "context_window"
            $ctxPct = if ($cw) { Get-Prop $cw "used_percentage" } else { 0 }
            $rl = Get-Prop $cj "rate_limits"
            $rl5 = 0; $rl7 = 0
            if ($rl) {
                $fh = Get-Prop $rl "five_hour"
                $sd = Get-Prop $rl "seven_day"
                if ($fh) { $rl5 = Get-Prop $fh "used_percentage" }
                if ($sd) { $rl7 = Get-Prop $sd "used_percentage" }
            }
            $ctxI = ToFloorInt $ctxPct
            $rl5I = ToFloorInt $rl5
            $rl7I = ToFloorInt $rl7
            $CLAUDE = "$modelName ctx:$G$ctxI%$R rl:$G$rl5I%$R/5h $G$rl7I%$R/7d"
        }
    }
} catch { $CLAUDE = "" }

$prefix = if ($CLAUDE) { "$CLAUDE | " } else { "" }

# ── Health ──
$health = Fetch "$BASE/health"
if ($null -eq $health) {
    Write-Output "${prefix}GLA: $WARN DOWN"
    exit 0
}

$ext = Get-Prop $health "extension_connected"
$ws = Get-Prop $health "ws"
$wsConnects = if ($ws) { Get-Prop $ws "connects" } else { 0 }
$wsDisconnects = if ($ws) { Get-Prop $ws "disconnects" } else { 0 }
$wsUptime = if ($ws) { Get-Prop $ws "uptime_s" } else { 0 }
if ($null -eq $wsConnects) { $wsConnects = 0 }
if ($null -eq $wsDisconnects) { $wsDisconnects = 0 }
if ($null -eq $wsUptime) { $wsUptime = 0 }

if ($ext -eq $true) {
    $wsUpMin = ToFloorInt ([double]$wsUptime / 60)
    $extIcon = "WS:${G}Ok${R}(${wsUpMin}m${UP}${wsConnects}c${DN}${wsDisconnects}d)"
} else {
    $extIcon = "WS:${V}${X}${R}(${DN}${wsDisconnects}d)"
}

# ── Flow auth ──
$flow = Fetch "$BASE/api/flow/status"
$flowKey = if ($flow) { Get-Prop $flow "flow_key_present" } else { $false }
$flowInfo = if ($flowKey -eq $true) { "Auth:Ok" } else { "Auth:$X" }

# ── Credits tier ──
$credits = Fetch "$BASE/api/flow/credits"
$tier = $null
if ($credits) {
    $cdata = Get-Prop $credits "data"
    if ($cdata) { $tier = Get-Prop $cdata "userPaygateTier" }
    if (-not $tier) { $tier = Get-Prop $credits "userPaygateTier" }
}
$creditsInfo = ""
switch ("$tier") {
    "PAYGATE_TIER_ONE" { $creditsInfo = "T1" }
    "PAYGATE_TIER_TWO" { $creditsInfo = "T2" }
    ""      { $creditsInfo = "" }
    default { $creditsInfo = "$tier" }
}

# ── Project (active-project, fallback to projects list) ──
$ap = Fetch "$BASE/api/active-project"
$projId = if ($ap) { Get-Prop $ap "project_id" } else { $null }
$projName = if ($ap) { Get-Prop $ap "project_name" } else { $null }
$vidId = if ($ap) { Get-Prop $ap "video_id" } else { $null }

if (-not $projId) {
    $projects = Fetch "$BASE/api/projects"
    $projArr = @($projects) | Where-Object { $_ -ne $null }
    if ($projArr.Count -eq 0) {
        Write-Output "${prefix}GLA: ${extIcon}"
        exit 0
    }
    $last = $projArr[$projArr.Count - 1]
    $projName = Get-Prop $last "name"
    if (-not $projName) { $projName = "?" }
    $projId = Get-Prop $last "id"
    $videos = Fetch "$BASE/api/videos?project_id=$projId"
    $vidArr = @($videos) | Where-Object { $_ -ne $null }
    if ($vidArr.Count -gt 0) {
        $vidId = Get-Prop $vidArr[$vidArr.Count - 1] "id"
    }
}

function Truncate15 {
    param([string]$s)
    if (-not $s) { return "" }
    if ($s.Length -le 15) { return $s }
    return $s.Substring(0, 15)
}

if (-not $vidId) {
    $shortNameOnly = Truncate15 $projName
    Write-Output "${prefix}GLA: ${extIcon} ${shortNameOnly}"
    exit 0
}

# ── Video orientation ──
$video = Fetch "$BASE/api/videos/$vidId"
$vidOrient = if ($video) { Get-Prop $video "orientation" } else { $null }

# ── Scenes stats ──
$scenes = Fetch "$BASE/api/scenes?video_id=$vidId"
$sceneArr = @($scenes) | Where-Object { $_ -ne $null }
$total = $sceneArr.Count

function Count-Status {
    param($arr, [string]$field)
    return @($arr | Where-Object { (Get-Prop $_ $field) -eq "COMPLETED" }).Count
}

$hImg = Count-Status $sceneArr "horizontal_image_status"
$hVid = Count-Status $sceneArr "horizontal_video_status"
$hUp  = Count-Status $sceneArr "horizontal_upscale_status"
$vImg = Count-Status $sceneArr "vertical_image_status"
$vVid = Count-Status $sceneArr "vertical_video_status"
$vUp  = Count-Status $sceneArr "vertical_upscale_status"

if ($vidOrient -eq "HORIZONTAL") {
    $imgDone = $hImg; $vidDone = $hVid; $upDone = $hUp; $oriLabel = "H"
} elseif ($vidOrient -eq "VERTICAL") {
    $imgDone = $vImg; $vidDone = $vVid; $upDone = $vUp; $oriLabel = "V"
} elseif ($hImg -ne 0 -or $hVid -ne 0) {
    $imgDone = $hImg; $vidDone = $hVid; $upDone = $hUp; $oriLabel = "H"
} else {
    $imgDone = $vImg; $vidDone = $vVid; $upDone = $vUp; $oriLabel = "V"
}

# ── Queue ──
$pending = Count-Array (Fetch "$BASE/api/requests/pending")
$processing = Count-Array (Fetch "$BASE/api/requests?status=PROCESSING")

$shortName = Truncate15 $projName

# ── Project slug + output file counts ──
$slug = $null
$outDir = Fetch "$BASE/api/projects/$projId/output-dir"
if ($outDir) { $slug = Get-Prop $outDir "slug" }

$dlCount = 0
$ttsCount = 0
if ($slug) {
    $fourKDir = Join-Path $RepoRoot ("output\" + $slug + "\4k")
    if (Test-Path $fourKDir) {
        $dlCount = @(Get-ChildItem -Path $fourKDir -Filter "scene_*.mp4" -File -ErrorAction SilentlyContinue).Count
    }
    $ttsDir = Join-Path $RepoRoot ("output\" + $slug + "\tts")
    if (Test-Path $ttsDir) {
        $ttsCount = @(Get-ChildItem -Path $ttsDir -Filter "scene_*.wav" -File -ErrorAction SilentlyContinue).Count
    }
}

# ── Flow string (credits + auth, violet) ──
$flowStr = ""
if ($creditsInfo) { $flowStr = " ${V}${creditsInfo}${R}" }
if ($flowInfo)    { $flowStr = "${flowStr} ${V}${flowInfo}${R}" }

# ── Queue string ──
$queue = "${V}${pending}${R}${ARR}${V}${processing}${R}/5"

Write-Output "${prefix}GLA: ${extIcon}${flowStr} ${shortName} ${oriLabel} ${total}sc img:${V}${imgDone}${R} vid:${V}${vidDone}${R} 4K:${V}${upDone}${R}${DN}${V}${dlCount}${R} TTS:${V}${ttsCount}${R} Q:${queue}"
exit 0
