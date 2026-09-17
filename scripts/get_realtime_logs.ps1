<#
.SYNOPSIS
    实时调阅 Neon Player Mobile 运行日志与诊断信息
.DESCRIPTION
    供 AI 与开发者一键查询运行中真机的实时日志。
    优先通过 HTTP 诊断服务 (端口 18088) 获取内存环形日志或当日落盘文件，
    若 HTTP 无法连接则自动回退至 Android 原生 Logcat (Tag: NeonLogger)。
.PARAMETER Limit
    调阅最新内存日志行数，默认 100 行。
.PARAMETER Today
    调阅今天全量落盘日志文件。
.PARAMETER Status
    调阅当前播放器引擎状态 (JSON 格式)。
.PARAMETER Ping
    检查诊断服务连通性。
.PARAMETER Logcat
    直接通过 adb logcat 抓取原生日志。
.EXAMPLE
    .\scripts\get_realtime_logs.ps1
    .\scripts\get_realtime_logs.ps1 -Limit 200
    .\scripts\get_realtime_logs.ps1 -Today
    .\scripts\get_realtime_logs.ps1 -Status
#>

[CmdletBinding()]
param (
    [int]$Limit = 100,
    [switch]$Today,
    [switch]$Status,
    [switch]$Ping,
    [switch]$Cache,
    [switch]$Logcat
)

# 1. 定位 adb
$adb = $null
if (Get-Command adb -ErrorAction SilentlyContinue) {
    $adb = "adb"
} else {
    $defaultPaths = @(
        "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
        "C:\Users\tangshupeng\AppData\Local\Android\Sdk\platform-tools\adb.exe",
        "D:\Android\Sdk\platform-tools\adb.exe"
    )
    foreach ($p in $defaultPaths) {
        if (Test-Path $p) {
            $adb = $p
            break
        }
    }
}

# 2. 如果指定了 -Logcat，直接走 adb logcat
if ($Logcat) {
    if (-not $adb) {
        throw "adb executable not found!"
    }
    Write-Host "[NeonLogger] Fetching from Android Logcat..." -ForegroundColor Cyan
    & $adb logcat -s NeonLogger:V -d
    exit 0
}

# 3. 尝试通过 ADB 转发端口 18088
if ($adb) {
    try {
        & $adb forward tcp:18088 tcp:18088 2>$null | Out-Null
    } catch {}
}

# 4. 组装 HTTP 请求 URL
$baseUrl = "http://127.0.0.1:18088"
$targetUri = "$baseUrl/logs?limit=$Limit"

if ($Ping) {
    $targetUri = "$baseUrl/ping"
} elseif ($Status) {
    $targetUri = "$baseUrl/status"
} elseif ($Cache) {
    $targetUri = "$baseUrl/cache"
} elseif ($Today) {
    $targetUri = "$baseUrl/logs/today"
}

# 5. 发起 HTTP 调阅
$httpSuccess = $false
try {
    $res = Invoke-WebRequest -Uri $targetUri -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    if ($res.StatusCode -eq 200) {
        $httpSuccess = $true
        Write-Output $res.Content
    }
} catch {
    # HTTP 失败（如应用尚未在前台运行或尚未启动）
}

# 6. 回退方案：如果 HTTP 失败且安装了 adb，尝试走 logcat
if (-not $httpSuccess) {
    if ($adb) {
        Write-Warning "[LogServer] HTTP connection to 127.0.0.1:18088 failed. Falling back to ADB Logcat..."
        try {
            $logcatOutput = & $adb logcat -s NeonLogger:V -d
            if ($logcatOutput) {
                Write-Output $logcatOutput
            } else {
                Write-Warning "No logs found in Logcat with tag NeonLogger."
            }
        } catch {
            Write-Error "Failed to fetch logs from Logcat: $_"
        }
    } else {
        Write-Error "Cannot connect to LogServer (127.0.0.1:18088) and ADB is not available."
    }
}
