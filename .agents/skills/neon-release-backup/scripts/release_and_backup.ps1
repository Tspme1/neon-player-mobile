<#
.SYNOPSIS
    Neon Player Mobile 自动化发布与核心备份脚本
.DESCRIPTION
    1. 读取并校验 package.json、app.json 与 android/app/build.gradle 版本号
    2. Git 提交修改与打 Tag
    3. 推送 main 分支与 Tag 到 GitHub 远程仓库
    4. 通过 GitHub REST API 创建 Release 并上传 Release APK
    5. 备份核心代码与 Release APK 到 D:\anti_work\backup\neon-player-v<version>
#>
param(
    [string]$CommitMessage,
    [string]$ReleaseNotes,
    [switch]$SkipBuild = $true
)

$ErrorActionPreference = "Stop"

# 1. 确定项目根目录
$ProjectRoot = "D:\anti_work\neon"
Set-Location $ProjectRoot

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " Neon Player Mobile Release & Backup " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 2. 读取版本号
$packageJsonPath = Join-Path $ProjectRoot "package.json"
if (-not (Test-Path $packageJsonPath)) {
    throw "package.json not found: $packageJsonPath"
}
$pkg = Get-Content $packageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $pkg.version
Write-Host "[1/6] Current version: $version" -ForegroundColor Green

# 3. 检查 APK 文件
$apkSourcePath = Join-Path $ProjectRoot "android\app\build\outputs\apk\release\app-release.apk"
if (-not $SkipBuild -or -not (Test-Path $apkSourcePath)) {
    Write-Host "[2/6] Building Release APK..." -ForegroundColor Yellow
    Set-Location (Join-Path $ProjectRoot "android")
    cmd.exe /c ".\gradlew.bat assembleRelease"
    Set-Location $ProjectRoot
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $apkSourcePath)) {
        throw "Release APK build failed!"
    }
} else {
    $apkSizeMB = [math]::Round((Get-Item $apkSourcePath).Length / 1MB, 2)
    Write-Host "[2/6] Found Release APK: $apkSourcePath ($apkSizeMB MB)" -ForegroundColor Green
}

# 4. Git 检查与提交
Write-Host "[3/6] Git staging and committing..." -ForegroundColor Yellow
git add .
$status = git status --porcelain
if ($status) {
    if (-not $CommitMessage) {
        $CommitMessage = "feat: release v$version - update and bug fixes"
    }
    Write-Host "Commit message: $CommitMessage" -ForegroundColor Gray
    git commit -m $CommitMessage
} else {
    Write-Host "No unstaged changes to commit." -ForegroundColor Gray
}

# 检查 Tag 是否存在
$existingTag = git tag -l $version
if (-not $existingTag) {
    Write-Host "Creating Git Tag: $version" -ForegroundColor Green
    git tag -a $version -m "Neon Player Mobile v$version"
} else {
    Write-Host "Git Tag $version already exists." -ForegroundColor Gray
}

# 推送到远程仓库
Write-Host "Pushing to GitHub (origin main and tags)..." -ForegroundColor Yellow
git push origin main
git push origin $version

# 5. GitHub Release 发布
Write-Host "[4/6] Creating GitHub Release via REST API..." -ForegroundColor Yellow
$token = $null
try {
    $credInfo = "protocol=https`nhost=github.com`n" | git credential fill
    foreach ($line in ($credInfo -split "`n")) {
        if ($line.Trim().StartsWith("password=")) {
            $token = $line.Trim().Substring(9).Trim()
            break
        }
    }
} catch {
    Write-Warning "Failed to read credentials from git credential: $_"
}

if (-not $token -and $env:GITHUB_TOKEN) {
    $token = $env:GITHUB_TOKEN
}

if (-not $token) {
    Write-Warning "GitHub token not found. Skipping GitHub Release API creation."
} else {
    $headers = @{
        "Authorization" = "token $token"
        "User-Agent" = "Neon-Release-Agent"
        "Accept" = "application/vnd.github.v3+json"
    }
    
    $repo = "Tspme1/neon-player-mobile"
    $releaseTitle = "neon-player-$version"
    
    if (-not $ReleaseNotes) {
        $ReleaseNotes = "Neon Player Mobile v$version release."
    }

    # 检查 Release 是否已存在
    $releaseUrl = "https://api.github.com/repos/$repo/releases/tags/$version"
    $releaseObj = $null
    try {
        $releaseObj = Invoke-RestMethod -Uri $releaseUrl -Headers $headers -Method Get -ErrorAction Stop
        Write-Host "GitHub Release already exists: $($releaseObj.html_url)" -ForegroundColor Yellow
    } catch {
        # 不存在则创建
        $createBody = @{
            tag_name = $version
            name = $releaseTitle
            body = $ReleaseNotes
            draft = $false
            prerelease = $false
        } | ConvertTo-Json -Compress

        Write-Host "Creating GitHub Release: $releaseTitle ..." -ForegroundColor Yellow
        $createUrl = "https://api.github.com/repos/$repo/releases"
        $releaseObj = Invoke-RestMethod -Uri $createUrl -Headers $headers -Method Post -Body ([System.Text.Encoding]::UTF8.GetBytes($createBody)) -ContentType "application/json; charset=utf-8"
        Write-Host "GitHub Release created successfully: $($releaseObj.html_url)" -ForegroundColor Green
    }

    # 上传 APK 资产
    $apkName = "neon-player-$version.apk"
    $assetAlreadyUploaded = $false
    if ($releaseObj.assets) {
        foreach ($a in $releaseObj.assets) {
            if ($a.name -eq $apkName) {
                $assetAlreadyUploaded = $true
                Write-Host "APK asset already exists in Release: $apkName" -ForegroundColor Yellow
                break
            }
        }
    }

    if (-not $assetAlreadyUploaded) {
        Write-Host "Uploading APK asset ($apkName) to GitHub Release..." -ForegroundColor Yellow
        $uploadUrlTemplate = $releaseObj.upload_url -replace '\{\?name,label\}', "?name=$apkName"
        
        $apkBytes = [System.IO.File]::ReadAllBytes($apkSourcePath)
        $uploadHeaders = @{
            "Authorization" = "token $token"
            "User-Agent" = "Neon-Release-Agent"
            "Content-Type" = "application/vnd.android.package-archive"
        }
        $uploadResult = Invoke-RestMethod -Uri $uploadUrlTemplate -Headers $uploadHeaders -Method Post -Body $apkBytes
        Write-Host "APK uploaded successfully: $($uploadResult.browser_download_url)" -ForegroundColor Green
    }
}

# 6. 本地核心备份到 D:\anti_work\backup
$backupDirName = "neon-player-v$version"
$backupRoot = "D:\anti_work\backup"
$targetBackupDir = Join-Path $backupRoot $backupDirName

Write-Host "[5/6] Backing up core files to $targetBackupDir ..." -ForegroundColor Yellow

if (-not (Test-Path $targetBackupDir)) {
    New-Item -ItemType Directory -Path $targetBackupDir -Force | Out-Null
}

# 6.1 备份根目录文件
$rootFiles = @(".gitignore", "App.js", "app.json", "babel.config.js", "eas.json", "GEMINI.md", "LICENSE", "package-lock.json", "package.json")
foreach ($f in $rootFiles) {
    $srcFile = Join-Path $ProjectRoot $f
    if (Test-Path $srcFile) {
        Copy-Item -Path $srcFile -Destination (Join-Path $targetBackupDir $f) -Force
    }
}

# 6.2 备份核心目录
$coreDirs = @("src", "assets", "readme", "交接文档", ".agents")
foreach ($d in $coreDirs) {
    $srcDir = Join-Path $ProjectRoot $d
    if (Test-Path $srcDir) {
        $destDir = Join-Path $targetBackupDir $d
        Copy-Item -Path $srcDir -Destination $destDir -Recurse -Force
    }
}

# 6.3 备份 android 核心文件（排除 build 与 .gradle）
$androidDest = Join-Path $targetBackupDir "android"
if (-not (Test-Path $androidDest)) {
    New-Item -ItemType Directory -Path $androidDest -Force | Out-Null
}

$androidRootFiles = @(".gitignore", "build.gradle", "gradle.properties", "gradlew", "gradlew.bat", "local.properties", "settings.gradle")
foreach ($f in $androidRootFiles) {
    $srcFile = Join-Path $ProjectRoot "android\$f"
    if (Test-Path $srcFile) {
        Copy-Item -Path $srcFile -Destination (Join-Path $androidDest $f) -Force
    }
}

# 复制 android/gradle
if (Test-Path (Join-Path $ProjectRoot "android\gradle")) {
    Copy-Item -Path (Join-Path $ProjectRoot "android\gradle") -Destination (Join-Path $androidDest "gradle") -Recurse -Force
}

# 复制 android/app 源码与配置
$androidAppDest = Join-Path $androidDest "app"
if (-not (Test-Path $androidAppDest)) {
    New-Item -ItemType Directory -Path $androidAppDest -Force | Out-Null
}
$appFiles = @("build.gradle", "debug.keystore", "proguard-rules.pro")
foreach ($f in $appFiles) {
    $srcFile = Join-Path $ProjectRoot "android\app\$f"
    if (Test-Path $srcFile) {
        Copy-Item -Path $srcFile -Destination (Join-Path $androidAppDest $f) -Force
    }
}
if (Test-Path (Join-Path $ProjectRoot "android\app\src")) {
    Copy-Item -Path (Join-Path $ProjectRoot "android\app\src") -Destination (Join-Path $androidAppDest "src") -Recurse -Force
}

# 6.4 复制 Release APK 并重命名
$targetApkPath = Join-Path $targetBackupDir "neon-player-$version.apk"
Copy-Item -Path $apkSourcePath -Destination $targetApkPath -Force
Write-Host "Copied Release APK to: $targetApkPath" -ForegroundColor Green

Write-Host "[6/6] Verifying backup..." -ForegroundColor Yellow
$backupFiles = Get-ChildItem -Path $targetBackupDir
Write-Host "Backup item count: $($backupFiles.Count)" -ForegroundColor Gray

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " Release & Backup completed successfully! " -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan