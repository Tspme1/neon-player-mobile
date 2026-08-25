# Neon Player Mobile — APK 自更新功能使用手册

## 一、功能概述

App 在启动时自动检查服务端是否有新版本，有则弹窗提醒用户更新。用户也可在「设置 → 关于」中手动检查更新。

### 核心特性
- ✅ 启动自动检查（延迟 3 秒，静默后台执行）
- ✅ 弹窗显示新版本号和更新内容
- ✅ 「立即更新」/「暂不更新」两个选项
- ✅ 「不再提醒此版本」勾选框
- ✅ 设置页手动检查更新（会清除跳过记录）
- ✅ 下载进度实时显示
- ✅ 下载完成自动打开系统安装界面
- ✅ 支持强制更新（隐藏"暂不更新"按钮）
- ✅ 数据安全：覆盖安装不丢失喜欢列表、音源、设置

---

## 二、版本号规则

### 格式：X.XX.XXX

| 含义 | 示例 | 说明 |
|------|------|------|
| X | 主版本号 | 1 → 2 → 3，重大改版时递增 |
| XX | 次版本号 | 00 → 01 → 02 → ... → 99，新功能时递增 |
| XXX | 修订号 | 000 → 001 → 002 → ... → 999，bug 修复时递增 |

### 示例
```
1.00.000  ← 初始版本
1.00.001  ← 修复小 bug
1.01.000  ← 新增功能
2.00.000  ← 重大改版
```

### 两个版本字段的作用

| 字段 | 位置 | 类型 | 作用 |
|------|------|------|------|
| versionCode | build.gradle | 整数（1, 2, 3...） | 程序判断是否有新版本（服务端的 versionCode > 本地的 versionCode = 有更新） |
| versionName | app.json / build.gradle | 字符串（"1.00.000"） | 显示给用户看 |

> ⚠ versionCode 必须每次发版 +1，否则 App 判断不出有新版本。

---

## 三、发版流程（开发者操作）

### 步骤 1：更新版本号

修改 3 个地方：

**app.json**：
```json
{
  "expo": {
    "version": "1.00.001"    ← 改这里
  }
}
```

**android/app/build.gradle**：
```groovy
defaultConfig {
    versionCode 2              ← 改这里（+1）程序检测以此为准
    versionName "1.00.001"     ← 改这里（与 app.json 一致）
}
```

### 步骤 2：构建 APK

```powershell
cd D:\Qclaw_work\neon-player-mobile

# 方式 A：EAS Build（需要 Expo 账号登录）
eas build -p android --profile preview

# 方式 B：本地 Gradle 构建（不需要账号）
cd android
.\gradlew.bat assembleRelease
# APK 输出到 android/app/build/outputs/apk/release/app-release.apk
```

### 步骤 3：上传 APK 到服务器

将构建好的 APK 上传到你的服务器或对象存储：

```
https://你的域名/releases/neon-player-1.00.001.apk
```

### 步骤 4：更新版本清单

修改服务器上的 `update.json`：

```json
{
  "versionCode": 2,
  "versionName": "1.00.001",
  "apkUrl": "https://你的域名/releases/neon-player-1.00.001.apk",
  "updateMessage": "修复发现页刷新问题\n优化播放缓存逻辑\n新增 APK 自更新功能",
  "forceUpdate": false,
  "minSupportVersionCode": 1
}
```

### 完成！

用户下次打开 App，3 秒后自动检测到新版本，弹窗提醒更新。

---

## 四、update.json 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| versionCode | int | ✅ | 新版本的整数版本号（必须 > 用户本地的 versionCode 才触发更新） |
| versionName | string | ✅ | 显示给用户的版本名（如 "1.00.001"） |
| apkUrl | string | ✅ | APK 文件的下载地址（需 HTTPS，需公网可访问） |
| updateMessage | string | ✅ | 更新内容描述，显示在弹窗中（支持 \n 换行） |
| forceUpdate | bool | ❌ | 是否强制更新（true 时隐藏"暂不更新"按钮和"不再提醒"选项），默认 false |
| minSupportVersionCode | int | ❌ | 最低支持的版本号（预留字段，当前未使用，后续可用于强制低版本升级） |

### update.json 示例

**普通更新**：
```json
{
  "versionCode": 3,
  "versionName": "1.01.000",
  "apkUrl": "https://example.com/releases/neon-player-1.01.000.apk",
  "updateMessage": "新增歌词滚动显示\n修复部分音源搜索失败问题\n优化启动速度",
  "forceUpdate": false,
  "minSupportVersionCode": 1
}
```

**强制更新（有严重 bug 必须升级）**：
```json
{
  "versionCode": 4,
  "versionName": "1.01.001",
  "apkUrl": "https://example.com/releases/neon-player-1.01.001.apk",
  "updateMessage": "紧急修复：修复可能导致播放崩溃的严重问题，请立即更新",
  "forceUpdate": true,
  "minSupportVersionCode": 1
}
```

---

## 五、用户体验流程

### 5.1 自动检查（App 启动时）

```
用户打开 App
    ↓ （3 秒后）
App 后台请求 update.json
    ↓
有新版本？
  ├── 是 → 用户是否跳过过该版本？
  │         ├── 是 → 不弹窗，正常使用
  │         └── 否 → 弹出更新弹窗
  │                    ├── 点"立即更新" → 下载 APK → 进度条 → 系统安装界面
  │                    └── 点"暂不更新" → 关闭弹窗（可勾选"不再提醒此版本"）
  └── 否 → 正常使用，无任何提示
```

### 5.2 手动检查（设置页）

```
设置 → 关于 → 点"检查更新"
    ↓
清除之前的"不再提醒"记录
    ↓
请求 update.json
    ↓
有新版本？
  ├── 是 → 弹出更新弹窗（即使之前勾过"不再提醒"也会弹）
  └── 否 → Toast 提示"当前已是最新版本"
```

### 5.3 下载与安装

```
点"立即更新"
    ↓
开始下载 APK（显示进度条 0% → 100%）
    ↓
下载完成
    ↓
自动打开 Android 系统安装界面
    ↓
用户点"安装"（系统弹窗，需用户确认）
    ↓
安装完成 → App 自动重启（旧数据全部保留）
```

---

## 六、"不再提醒此版本"机制

### 规则
- 勾选后，该 versionCode 的更新不再自动弹窗
- **仅对当前版本有效**——你发了新版本（versionCode 变了），又会自动弹窗
- 在设置页点"检查更新"会**清除跳过记录**，重新检查所有版本

### 存储位置
- 使用 AsyncStorage 存储，key 为 `@skipped_version`，value 为 versionCode
- 卸载 App 后清除；覆盖安装后保留

### 场景示例
1. 当前版本 versionCode=1，服务端发布 versionCode=2
2. 用户启动 App → 弹窗 → 勾选"不再提醒" → 点"暂不更新"
3. 之后每次启动 App 不再弹窗（versionCode=2 被跳过）
4. 你发布 versionCode=3 → 用户启动 App → 又弹窗了（新版本未被跳过）
5. 用户在设置页点"检查更新" → 即使 versionCode=2 也会重新弹出（清除跳过记录）

---

## 七、数据安全

### 覆盖安装不会丢失的数据

| 数据 | 存储方式 | 覆盖安装后 |
|------|---------|-----------|
| 喜欢列表 | AsyncStorage | ✅ 保留 |
| 自定义音源（注册表 + 代码） | AsyncStorage | ✅ 保留 |
| 设置（缓存限制、当前音源等） | AsyncStorage | ✅ 保留 |
| 音量设置 | AsyncStorage | ✅ 保留 |
| 跳过的版本号 | AsyncStorage | ✅ 保留 |
| 本地音乐文件 | 设备存储 | ✅ 保留 |
| 内置音源 | APK 内置 | ✅ 保留（更新为新版） |

### 可能被清除的数据

| 数据 | 存储方式 | 说明 |
|------|---------|------|
| 播放缓存（音频文件） | app 私有目录 | 部分 Android 版本覆盖安装时可能清理，不影响列表数据，下次播放自动重新缓存 |

---

## 八、服务端配置指南

### 方案 A：GitHub Releases（免费推荐）

1. 在 GitHub 创建仓库（可私有）
2. 每次发版上传 APK 到 Releases
3. 获取下载链接（格式：`https://github.com/用户名/仓库名/releases/download/v1.00.001/neon-player.apk`）
4. update.json 也放在仓库里，通过 raw 链接访问

> 国内访问 GitHub 可能慢，仅推荐测试用途。

### 方案 B：对象存储（腾讯 COS / 阿里 OSS）

1. 创建 Bucket，设为公共读
2. 上传 APK 和 update.json
3. 获取 CDN 加速链接

> 推荐生产使用，国内速度快，成本极低（几毛/月）。

### 方案 C：本机局域网（开发测试）

1. 在 D:\Qclaw_work\ 下创建 `update-server` 目录
2. 放入 update.json 和 APK 文件
3. 用 Python 起简单 HTTP 服务：
   ```powershell
   cd D:\Qclaw_work\update-server
   python -m http.server 3000
   ```
4. src/services/updater.js 中的 URL 改为 `http://192.168.1.27:3000/update.json`

### 修改客户端 URL

编辑 `src/services/updater.js` 第 8 行：

```javascript
// 改为你的实际地址
const UPDATE_URL = 'https://你的域名/update.json';
```

---

## 九、配置项速查

### 客户端需修改的文件

| 文件 | 修改内容 |
|------|---------|
| `src/services/updater.js` 第 8 行 | `UPDATE_URL` 改为实际服务端地址 |

### 每次发版需修改的文件

| 文件 | 修改内容 |
|------|---------|
| `app.json` | `version` 字段改为新版本名（如 "1.00.001"） |
| `android/app/build.gradle` | `versionCode` +1，`versionName` 改为新版本名 |
| 服务端 `update.json` | 更新 versionCode / versionName / apkUrl / updateMessage |

### 构建命令

```powershell
# EAS Build（需登录）
eas build -p android --profile preview

# 本地 Gradle（不需登录）
cd android
.\gradlew.bat assembleRelease
```

---

## 十、常见问题

### Q：Expo Go 里能用更新功能吗？
**不能。** UpdaterModule 是原生模块，只在独立构建的 APK 中生效。Expo Go 里 `NativeModules.UpdaterModule` 为 undefined，updater.js 会安全降级（返回 null，不报错）。

### Q：用户不点"安装"会怎样？
下载完 APK 后会打开系统安装界面，如果用户取消安装，APK 文件仍在 app 私有目录中。下次用户再点"更新"时，updater.js 会重新下载并覆盖旧文件。

### Q：下载失败了怎么办？
弹窗会显示"下载失败，请稍后重试"错误信息，用户可以关闭弹窗稍后再试，或去设置页手动检查更新。

### Q：能不能后台静默安装？
**不能。** Android 安全机制要求用户必须手动确认安装第三方 APK（Android 8+ 需 REQUEST_INSTALL_PACKAGES 权限 + 用户确认）。静默安装需要系统签名或设备 Owner 权限，普通 App 做不到。

### Q：强制更新怎么用？
在 update.json 中设 `"forceUpdate": true`。此时弹窗会：
- 隐藏"暂不更新"按钮（只剩"立即更新"）
- 隐藏"不再提醒此版本"勾选框
- 用户无法跳过，必须更新

> 建议仅在严重 bug 或安全问题时使用。

### Q：能不能灰度发布（只让部分用户看到更新）？
当前方案不支持。后续可在 update.json 中加 `rolloutPercentage` 字段，客户端随机判断是否显示更新。如需要可以加。

### Q：iOS 能用吗？
**不能。** iOS 不允许 App 自行下载安装 IPA，必须通过 App Store。当前 UpdaterModule 仅支持 Android。
