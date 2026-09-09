// 全链路轻量非阻塞日志系统
// 核心原则：内存环形缓冲 + 后台异步批量落盘 + 零阻塞 + 自动按日轮转与淘汰
import * as FileSystem from 'expo-file-system/legacy';
import { NativeModules, Platform } from 'react-native';
import * as Sharing from 'expo-sharing';

const LOG_DIR = (FileSystem.documentDirectory || '') + 'logs/';
const MAX_MEMORY_LOGS = 200;           // 内存保留最新行数，供即时排查与查看
const MAX_RETENTION_DAYS = 3;          // 磁盘最多保留 3 天日志
const MAX_TOTAL_SIZE_BYTES = 5 * 1024 * 1024; // 日志目录最大 5 MB
const BATCH_FLUSH_COUNT = 25;          // 待写队列达到 25 条立即批量刷盘
const FLUSH_DEBOUNCE_MS = 3000;        // 默认 3 秒防抖自动刷盘

class Logger {
  constructor() {
    this._memoryLogs = [];
    this._writeQueue = [];
    this._flushTimer = null;
    this._isFlushing = false;
    this._dirEnsured = false;
    this._initialized = false;
  }

  /**
   * 初始化日志系统（在 App.js 或 initApp 中调用）
   */
  async initLogger() {
    if (this._initialized) return;
    this._initialized = true;
    try {
      await this._ensureDir();
      // 启动时在后台静默执行过期日志清理（最多保留 3 天，总大小限额 5MB）
      setTimeout(() => {
        this.housekeeping().catch(() => {});
      }, 2000);
      this.info('Logger', 'Logger initialized successfully', {
        platform: Platform.OS,
        logDir: LOG_DIR,
      });
    } catch (e) {
      console.warn('[Logger] init error:', e?.message);
    }
  }

  // === 基础日志方法 ===
  debug(tag, message, ...args) {
    this._record('DEBUG', tag, message, args);
  }

  info(tag, message, ...args) {
    this._record('INFO', tag, message, args);
  }

  warn(tag, message, ...args) {
    this._record('WARN', tag, message, args);
  }

  error(tag, message, ...args) {
    this._record('ERROR', tag, message, args);
  }

  // === 内部格式化与记录 ===
  _record(level, tag, message, args) {
    const timestamp = this._formatTimestamp(new Date());
    let detailStr = '';
    if (args && args.length > 0) {
      detailStr = ' ' + args.map(a => this._safeStringify(a)).join(' ');
    }

    const logLine = `[${timestamp}] [${level}] [${tag}] ${message}${detailStr}`;

    // 1. 推入内存环形缓冲（耗时 < 0.01ms）
    this._memoryLogs.push(logLine);
    if (this._memoryLogs.length > MAX_MEMORY_LOGS) {
      this._memoryLogs.shift();
    }

    // 2. 推入待写队列
    this._writeQueue.push(logLine);

    // 3. 同时透传到开发调试控制台
    if (__DEV__) {
      if (level === 'ERROR') {
        console.error(`[${tag}]`, message, ...args);
      } else if (level === 'WARN') {
        console.warn(`[${tag}]`, message, ...args);
      } else {
        console.log(`[${tag}]`, message, ...args);
      }
    }

    // 4. 触发条件式异步刷盘（错误立即刷盘，或累积超阈值，或防抖定时器）
    if (level === 'ERROR' || this._writeQueue.length >= BATCH_FLUSH_COUNT) {
      this.scheduleFlush(0);
    } else {
      this.scheduleFlush(FLUSH_DEBOUNCE_MS);
    }
  }

  /**
   * 调度批量刷盘
   */
  scheduleFlush(delayMs = 0) {
    if (delayMs === 0) {
      if (this._flushTimer) {
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
      }
      this.flush().catch(() => {});
      return;
    }

    if (!this._flushTimer) {
      this._flushTimer = setTimeout(() => {
        this._flushTimer = null;
        this.flush().catch(() => {});
      }, delayMs);
    }
  }

  /**
   * 异步批量将待写日志写入当日文件
   */
  async flush() {
    if (this._writeQueue.length === 0 || this._isFlushing) {
      return;
    }

    this._isFlushing = true;
    const batch = this._writeQueue.splice(0, this._writeQueue.length);
    const content = batch.join('\n') + '\n';

    try {
      await this._ensureDir();
      const fileName = this._getTodayLogFileName();
      const filePath = LOG_DIR + fileName;

      // 优先调用原生 MediaModule 高性能追加写入（零内存开销，直接通过底层 FileOutputStream 追加）
      if (NativeModules.MediaModule && NativeModules.MediaModule.appendToFile) {
        await NativeModules.MediaModule.appendToFile(filePath, content);
      } else {
        // 回退方案：通过 FileSystem 追加
        const info = await FileSystem.getInfoAsync(filePath);
        if (info.exists) {
          const oldContent = await FileSystem.readAsStringAsync(filePath);
          await FileSystem.writeAsStringAsync(filePath, oldContent + content);
        } else {
          await FileSystem.writeAsStringAsync(filePath, content);
        }
      }
    } catch (e) {
      // 容错隔离：写日志异常绝对不能抛出影响业务
      console.warn('[Logger] Flush error:', e?.message);
    } finally {
      this._isFlushing = false;
      // 如果在写入期间又产生了新日志，再次调度刷盘
      if (this._writeQueue.length > 0) {
        this.scheduleFlush(FLUSH_DEBOUNCE_MS);
      }
    }
  }

  /**
   * 确保日志目录存在
   */
  async _ensureDir() {
    if (this._dirEnsured) return;
    try {
      const info = await FileSystem.getInfoAsync(LOG_DIR);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(LOG_DIR, { intermediates: true });
      }
      this._dirEnsured = true;
    } catch {}
  }

  /**
   * 获取今日日志文件名 (格式: app_YYYY-MM-DD.log)
   */
  _getTodayLogFileName() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `app_${y}-${m}-${day}.log`;
  }

  /**
   * 格式化时间戳
   */
  _formatTimestamp(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}.${ms}`;
  }

  /**
   * 安全序列化对象，防止大字符串、长 HTML、Base64 或循环引用拖垮性能
   */
  _safeStringify(obj) {
    if (obj === null || obj === undefined) return String(obj);
    if (typeof obj === 'string') {
      if (obj.length > 200) {
        return `"${obj.substring(0, 180)}...[len=${obj.length}]"`;
      }
      return `"${obj}"`;
    }
    if (obj instanceof Error) {
      return `[Error: ${obj.message}]`;
    }
    if (typeof obj !== 'object') {
      return String(obj);
    }
    try {
      const seen = new WeakSet();
      return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        if (typeof value === 'string' && value.length > 200) {
          return `${value.substring(0, 180)}...[len=${value.length}]`;
        }
        return value;
      });
    } catch {
      return '[Unserializable Object]';
    }
  }

  // =====================================================================
  // 生命周期与清理（Housekeeping & Clear）
  // =====================================================================

  /**
   * 日志自动轮转与清理：
   * 1. 删除超过 MAX_RETENTION_DAYS (3天) 的历史日志
   * 2. 若总日志体积超过 MAX_TOTAL_SIZE_BYTES (5MB)，按旧到新删除
   */
  async housekeeping() {
    try {
      await this._ensureDir();
      const files = await FileSystem.readDirectoryAsync(LOG_DIR);
      const logFiles = files.filter(f => f.startsWith('app_') && f.endsWith('.log'));
      const now = Date.now();
      const maxAgeMs = MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000;

      const fileStats = [];
      for (const file of logFiles) {
        try {
          const info = await FileSystem.getInfoAsync(LOG_DIR + file);
          if (info.exists) {
            fileStats.push({
              name: file,
              path: LOG_DIR + file,
              size: info.size || 0,
              modTime: (info.modificationTime ? info.modificationTime * 1000 : now),
            });
          }
        } catch {}
      }

      // 按修改时间升序排列（最旧的在前面）
      fileStats.sort((a, b) => a.modTime - b.modTime);

      let totalSize = fileStats.reduce((acc, f) => acc + f.size, 0);

      // 1. 删除过期的日志文件
      for (const item of fileStats) {
        if (now - item.modTime > maxAgeMs) {
          try {
            await FileSystem.deleteAsync(item.path, { idempotent: true });
            totalSize -= item.size;
          } catch {}
        }
      }

      // 2. 超出总容量上限时，淘汰最旧文件
      for (const item of fileStats) {
        if (totalSize <= MAX_TOTAL_SIZE_BYTES) break;
        try {
          await FileSystem.deleteAsync(item.path, { idempotent: true });
          totalSize -= item.size;
        } catch {}
      }
    } catch (e) {
      console.warn('[Logger] housekeeping error:', e?.message);
    }
  }

  /**
   * 清空所有日志文件与内存缓冲（联动清理音乐缓存时调用）
   */
  async clearLogs() {
    try {
      this._memoryLogs = [];
      this._writeQueue = [];
      if (this._flushTimer) {
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
      }
      await this._ensureDir();
      const files = await FileSystem.readDirectoryAsync(LOG_DIR);
      for (const file of files) {
        try {
          await FileSystem.deleteAsync(LOG_DIR + file, { idempotent: true });
        } catch {}
      }
      return true;
    } catch (e) {
      console.warn('[Logger] clearLogs error:', e?.message);
      return false;
    }
  }

  /**
   * 获取日志总大小与文件数
   * @returns {Promise<{totalBytes: number, fileCount: number, formatted: string}>}
   */
  async getLogSize() {
    try {
      await this._ensureDir();
      const files = await FileSystem.readDirectoryAsync(LOG_DIR);
      let totalBytes = 0;
      let fileCount = 0;
      for (const file of files) {
        try {
          const info = await FileSystem.getInfoAsync(LOG_DIR + file);
          if (info.exists && info.size) {
            totalBytes += info.size;
            fileCount++;
          }
        } catch {}
      }
      return {
        totalBytes,
        fileCount,
        formatted: this._formatSize(totalBytes),
      };
    } catch {
      return { totalBytes: 0, fileCount: 0, formatted: '0 B' };
    }
  }

  _formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 获取内存中最近的日志列表
   * @param {number} count 
   * @returns {string[]}
   */
  getRecentLogs(count = 50) {
    return this._memoryLogs.slice(-count);
  }

  /**
   * 获取最新日志文件路径（用于导出分享）
   */
  async getLatestLogFilePath() {
    await this.flush();
    try {
      await this._ensureDir();
      const files = await FileSystem.readDirectoryAsync(LOG_DIR);
      const logFiles = files.filter(f => f.startsWith('app_') && f.endsWith('.log'));
      if (logFiles.length === 0) return null;
      // 找到最近命名的文件
      logFiles.sort().reverse();
      const latestPath = LOG_DIR + logFiles[0];
      const info = await FileSystem.getInfoAsync(latestPath);
      return info.exists && info.size > 0 ? latestPath : null;
    } catch {
      return null;
    }
  }

  /**
   * 调起系统原生分享，一键分享当前日志文件
   */
  async shareLog() {
    const filePath = await this.getLatestLogFilePath();
    if (!filePath) {
      return { success: false, message: '暂无日志文件可分享' };
    }
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      return { success: false, message: '当前设备不支持文件分享' };
    }
    try {
      await Sharing.shareAsync(filePath, {
        mimeType: 'text/plain',
        dialogTitle: '分享 NeonPlayer 运行日志',
        UTI: 'public.plain-text',
      });
      return { success: true };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }
}

// 导出全局单例
const logger = new Logger();
export default logger;
