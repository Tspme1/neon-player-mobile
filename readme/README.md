# Neon Player Mobile

<p align="center">
  <img src="assets/app-icon.png" width="100" height="100" alt="Neon Player" />
</p>

一款开源的 Android 音乐播放器，支持多音源聚合搜索、在线/本地播放、歌词显示、漫游推荐等功能。基于 React Native + Expo 构建。

## ✨ 功能特性

### 播放核心
- 🎵 本地音频播放（mp3/m4a/flac/wav/aac/ogg/wma）
- 🌐 在线搜索与播放（网易云/QQ音乐/酷我/酷狗）
- 📊 聚合搜索 — 五平台并行检索，按命中数+热度排序去重
- 🎶 多音源支持 — 内置官方 API + 可导入第三方 LX 音源脚本
- 🎤 歌词显示（含翻译，实时高亮滚动）
- 🔀 播放模式（顺序/随机/单曲循环）
- 📻 漫游模式（基于播放偏好个性化推荐）
- 📥 播放缓存（自动缓存已播放歌曲，可配置上限）
- 🔊 音质选择（标准/高品/无损）
- 🎚️ 音量控制与持久化

### 系统集成
- 📱 通知栏媒体控件（播放/暂停/上一首/下一首）
- 🔄 APK 自更新（启动自动检查 + 手动检查 + 强制更新支持）
- 🔋 后台播放（前台 Service + Wake Lock）
- 🎧 与其他应用同时播放（检测到非用户暂停后自动恢复）
- 🌙 主题模式（白天/黑夜/自动跟随系统）
- ⏰ 定时关闭（15/30/45/60 分钟 + 自定义）
- 📤 分享歌曲（含播放链接 + App 下载地址）

### 数据管理
- ❤️ 收藏管理（AsyncStorage 持久化）
- 📋 喜欢清单导入/导出（JSON 格式，支持合并/替换）
- ⚙️ 设置持久化（音源/音质/主题/缓存/音量等）

## 🛠️ 技术栈

| 领域 | 技术 |
|------|------|
| 框架 | React Native 0.81 + Expo SDK 54 |
| 语言 | JavaScript (ES6+) + Kotlin (原生模块) |
| 状态管理 | Zustand |
| 音频 | expo-av |
| 存储 | AsyncStorage |
| 图标 | react-native-svg（自绘 SVG） |
| 导航 | 自定义 Tab Bar（无 React Navigation 依赖） |
| 网络 | OkHttp 4.12（原生层）+ fetch（JS 层） |
| 原生模块 | MediaService（前台服务+通知）、MediaModule（音频焦点+网络）、UpdaterModule（APK 自更新） |

## 📁 项目结构

```
neon-player-mobile/
├── App.js                          # 应用入口 + Tab 导航 + 布局
├── app.json                        # Expo 配置
├── babel.config.js
├── eas.json
├── package.json
├── assets/                         # 图标 + 启动屏
├── android/
│   ├── app/src/main/java/com/neon/player/mobile/
│   │   ├── MainActivity.kt
│   │   ├── MainApplication.kt
│   │   ├── media/
│   │   │   ├── MediaModule.kt      # 原生网络请求 + 音频焦点 + 下载
│   │   │   ├── MediaPackage.kt
│   │   │   └── MediaService.kt     # 前台 Service + 媒体通知 + MediaSession
│   │   └── updater/
│   │       ├── UpdaterModule.kt    # APK 下载 + 安装 + 打开目录
│   │       └── UpdaterPackage.kt
│   ├── app/src/main/res/           # 图标/样式/字符串
│   ├── build.gradle
│   ├── gradle.properties
│   └── settings.gradle
├── readme/
│   ├── README.md                   # 本文件
│   └── UPDATE_MANUAL.md            # APK 自更新功能使用手册
└── src/
    ├── theme/
    │   ├── colors.js               # 亮色/暗色色板
    │   ├── spacing.js              # 间距/圆角/字体常量
    │   ├── useTheme.js             # 主题 Hook（白天/黑夜/自动）
    │   └── safearea.js             # 安全区域适配
    ├── store/
    │   └── useStore.js             # Zustand 全局状态镜像
    ├── core/
    │   ├── player-engine.js        # 播放引擎（单一 Sound 实例/队列/模式/漫游）
    │   ├── source-manager.js       # 音源管理（搜索/URL/聚合/多平台）
    │   ├── cache-manager.js        # 播放缓存（三层回退）
    │   ├── storage.js              # AsyncStorage 封装
    │   ├── media-session.js        # 通知栏媒体控件同步
    │   ├── event-bus.js            # 模块间通信
    │   ├── lyrics-engine.js        # 歌词加载/解析/高亮
    │   └── updater.js              # 更新检查（JS 层）
    ├── services/
    │   ├── lx-runner.js            # LX 音源脚本运行器（参考 lx-music）
    │   ├── lx-webview-manager.js   # WebView 沙箱管理
    │   ├── lx-webview-sandbox.js   # WebView 沙箱 HTML
    │   ├── anti-debug-patch.js     # 混淆脚本反调试补丁
    │   ├── favorites.js            # 收藏管理
    │   └── updater.js              # 更新服务
    ├── components/
    │   ├── FullPlayer.js           # 全屏播放页（歌词/进度/音量/三点菜单）
    │   ├── MiniPlayer.js           # 底部迷你播放栏
    │   ├── TrackItem.js            # 歌曲列表项
    │   ├── ContextMenu.js          # 长按上下文菜单
    │   ├── SearchBar.js            # 搜索框
    │   ├── UpdateDialog.js         # 更新弹窗
    │   ├── WebViewFetcher.js       # WebView 抓取器
    │   ├── LxSandbox.js            # 隐藏 WebView 容器
    │   ├── icons.js                # SVG 图标库
    │   ├── EmptyState.js           # 空状态
    │   ├── Spinner.js              # 加载动画
    │   └── Toast.js                # Toast 提示
    ├── screens/
    │   ├── LocalScreen.js          # 本地音乐
    │   ├── OnlineScreen.js         # 在线搜索（双轴选择器）
    │   ├── FavoritesScreen.js      # 我喜欢的
    │   ├── DiscoverScreen.js       # 发现音乐（排行榜/热歌/漫游）
    │   ├── QueueScreen.js          # 播放列表
    │   └── SettingsScreen.js       # 设置
    └── utils/
        ├── format.js               # 时间格式化/VIP 徽章
        └── lyrics.js               # LRC 歌词解析
```

## 🚀 快速开始

### 环境要求

- Node.js 18+
- Android SDK（Build Tools 36.0.0）
- JDK 17

### 安装

```bash
git clone https://github.com/你的用户名/neon-player-mobile.git
cd neon-player-mobile
npm install
```

### 开发运行

```bash
npx expo start
```

按 `a` 在 Android 模拟器或已连接的真机上运行。

### 构建 APK

```bash
cd android
./gradlew assembleRelease
# 输出: android/app/build/outputs/apk/release/app-release.apk
```

> ⚠️ 首次构建需要正确的 Node.js 路径（确保系统 Node 在 PATH 中位于其他 Node 包装器之前）。

## 📖 使用说明

### 搜索与播放

1. 打开 App，默认进入「喜欢」页
2. 切换到「在线」页
3. 左侧选择搜索来源（网易云/QQ/酷我/酷狗/聚合搜索）
4. 右侧选择播放音源（官方 API / 已导入的 LX 音源）
5. 输入关键词搜索，点击歌曲播放

### 导入第三方音源

1. 进入「设置」→「音源管理」
2. 通过 URL 或文件导入 LX 音源脚本（.js）
3. 导入后可在「在线」页右侧选择该音源播放

> 支持的音源脚本格式参考 [lx-music](https://github.com/lyswhut/lx-music-mobile) 项目。

### 主题切换

设置 → 主题模式 → 白天 / 黑夜 / 自动（跟随系统）

## 🔍 实时日志与诊断系统 (AI & 开发者专用)

为方便开发者与 AI 助手在真机运行时零侵入、实时调阅全链路日志与引擎状态，Neon Player Mobile 内置了轻量级原生 HTTP 诊断服务与 Logcat 双轨日志管道。

### 特性与架构
- **零性能损耗**：服务基于 Android 原生守护线程阻塞监听（端口 `18088`），无请求时 0% CPU 占用，对音频解码与前后台播放流畅度无任何干扰；
- **1000 行内存环形队列**：瞬时保存微秒级播放生命周期流水，避免频繁读写闪存；
- **双轨同步**：内存环形队列 + Android 系统 Logcat (`NeonLogger` 标签) + 当日全量持久化落盘日志文件三轨互备。

### 一键调阅脚本 (`scripts/get_realtime_logs.ps1`)

项目根目录下提供了自动化诊断脚本（自动配置 ADB 端口转发，支持 HTTP 与 Logcat 智能回退）：

```powershell
# 1. 查询最新 100 条实时运行日志流水
.\scripts\get_realtime_logs.ps1 -Limit 100

# 2. 查询当前播放器实时状态（当前曲目、歌手、播放/暂停、进度、缓冲日志数等 JSON）
.\scripts\get_realtime_logs.ps1 -Status

# 3. 查询真机音频文件缓存库（缓存目录、文件总数、占用空间 MB 及详细文件列表）
.\scripts\get_realtime_logs.ps1 -Cache

# 4. 调阅今天全量落盘的持久化日志
.\scripts\get_realtime_logs.ps1 -Today

# 5. 测试诊断服务连通性与 App 版本
.\scripts\get_realtime_logs.ps1 -Ping

# 6. 直接抓取系统原生 Logcat 输出流
.\scripts\get_realtime_logs.ps1 -Logcat
```

### HTTP 诊断 REST API 端点

设备连接并执行端口转发后，即可通过任意 HTTP 客户端（curl、浏览器、Postman、脚本等）直接调阅：

```bash
adb forward tcp:18088 tcp:18088
```

| 请求方法与路径 | 描述 | 返回示例 |
| :--- | :--- | :--- |
| `GET /ping` | 健康检查与版本确认 | `{"status":"ok","app":"NeonPlayer","version":"1.00.017",...}` |
| `GET /status` | 播放器及原生服务实时状态 | `{"title":"晴天","artist":"周杰伦","isPlaying":true,...}` |
| `GET /cache` | 本地音频缓存清单与体积统计 | `{"fileCount":3,"totalSizeMB":"12.57","files":[...]}` |
| `GET /logs?limit=200` | 获取内存环形队列最新日志 | `[INFO] [PlayerEngine] +105ms File cache hit ...` |
| `GET /logs/today` | 获取当天完整持久化日志 | 纯文本完整日志文件内容 |

## 🔧 配置

### 更新服务器

编辑 `src/services/updater.js` 第 8 行的 `UPDATE_URL`，指向你的 `update.json` 地址。

详见 [UPDATE_MANUAL.md](readme/UPDATE_MANUAL.md)。

### 版本号

每次发版需修改 3 处：

| 文件 | 字段 |
|------|------|
| `app.json` | `version` |
| `package.json` | `version` |
| `android/app/build.gradle` | `versionCode`（+1）+ `versionName` |

## 📝 更新记录

完整版本变更历史与脱敏技术细节请参阅 [CHANGELOG.md](CHANGELOG.md)。

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源。

## 🙏 鸣谢

- [lx-music](https://github.com/lyswhut/lx-music-mobile) — LX 音源脚本运行器（`src/services/lx-runner.js`）参考了该项目的设计思路
- [Expo](https://expo.dev/) — 提供 React Native 开发与构建基础设施
- [expo-av](https://docs.expo.dev/versions/latest/sdk/av/) — 音频播放
- [Zustand](https://github.com/pmndrs/zustand) — 轻量状态管理

## ⚠️ 免责声明

本项目仅供学习和个人使用。所有音源接口均为公开 API，本项目不存储任何音乐文件。使用第三方音源脚本时请遵守相关法律法规，尊重版权方权益。因使用本项目产生的任何法律责任由使用者自行承担。
