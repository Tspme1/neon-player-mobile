---
name: neon-release-backup
description: >-
  Automates the complete release and backup workflow for Neon Player Mobile.
  Use this skill when the user asks to sync the project to GitHub, publish a new GitHub Release with APK,
  or backup the project core files and Release APK to D:\anti_work\backup.
---

# Neon Player Mobile Release & Backup Workflow

This skill automates the complete release and core backup pipeline for Neon Player Mobile:
1. Version check and consistency across `package.json`, `app.json`, and `android/app/build.gradle`.
2. Git staging, committing, and tagging (`v<version>` tag).
3. Pushing branch and tags to GitHub (`origin main --tags`).
4. Creating a GitHub Release via GitHub REST API and uploading the compiled `app-release.apk` as `neon-player-<version>.apk`.
5. Backing up core source files, configurations, and the standalone APK to `D:\anti_work\backup\neon-player-v<version>`.

---

## Quick Execution

Run the bundled PowerShell script from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .agents/skills/neon-release-backup/scripts/release_and_backup.ps1 `
    -CommitMessage "feat: release v1.00.012 - fix splash screen border & QQ music lyrics" `
    -ReleaseNotes "更新内容：`n1. 修复启动页四角灰色弧线问题`n2. 修复QQ音乐歌词解析与跨源匹配`n3. 优化本地封面读取" `
    -SkipBuild
```

If the Release APK has not been built yet, omit `-SkipBuild` or run:
```powershell
cd android
./gradlew.bat assembleRelease
cd ..
```

---

## Detailed Step-by-Step Procedure

### 1. Pre-flight Verification
Before releasing, verify that versions are synchronized:
- `package.json`: `"version": "1.xx.xxx"`
- `app.json`: `"expo.version": "1.xx.xxx"`
- `android/app/build.gradle`: `versionCode <int>` and `versionName "1.xx.xxx"`
- Ensure `android/app/build/outputs/apk/release/app-release.apk` exists and is up-to-date.

### 2. Git Commit & Tagging
1. Stage all changes:
   ```bash
   git add .
   ```
2. Commit with descriptive release message:
   ```bash
   git commit -m "feat: release v<version> - <summary of changes>"
   ```
3. Create annotated git tag:
   ```bash
   git tag -a <version> -m "Neon Player Mobile v<version>"
   ```
4. Push to remote:
   ```bash
   git push origin main
   git push origin <version>
   ```

### 3. Publish GitHub Release with APK
1. Retrieve GitHub Personal Access Token (PAT):
   - By default, credentials stored in Windows Credential Manager can be queried via:
     ```powershell
     "protocol=https`nhost=github.com`n" | git credential fill
     ```
   - Alternatively, pass `GITHUB_TOKEN` environment variable.
2. Call GitHub REST API to create release:
   - `POST https://api.github.com/repos/Tspme1/neon-player-mobile/releases`
   - Body: `{"tag_name": "<version>", "name": "neon-player-<version>", "body": "<release notes>", "draft": false, "prerelease": false}`
3. Upload `app-release.apk`:
   - `POST <upload_url>?name=neon-player-<version>.apk`
   - Header: `Content-Type: application/vnd.android.package-archive`

### 4. Local Core Backup
Backup destination: `D:\anti_work\backup\neon-player-v<version>`

Standard backup manifest:
- **Root files**: `.gitignore`, `App.js`, `app.json`, `babel.config.js`, `eas.json`, `GEMINI.md`, `LICENSE`, `package-lock.json`, `package.json`
- **Core source directories**: `src/`, `assets/`, `readme/`, `交接文档/`, `.agents/`
- **Android project core** (exclude `.gradle`, `build/`, and `app/build/`):
  - `android/gradle/`
  - `android/app/src/`
  - `android/app/build.gradle`, `debug.keystore`, `proguard-rules.pro`
  - `android/build.gradle`, `gradle.properties`, `gradlew`, `gradlew.bat`, `local.properties`, `settings.gradle`
- **Release APK**:
  - Copy `android/app/build/outputs/apk/release/app-release.apk` to `D:\anti_work\backup\neon-player-v<version>\neon-player-<version>.apk`

---

## Important Rules
- **Never delete user files**: Strictly follow the file deletion permission rule.
- **Always preserve previous backups**: Every release creates a new standalone folder `neon-player-v<version>` under `D:\anti_work\backup`.
- **Chinese responses**: Always respond to the user in Chinese.
