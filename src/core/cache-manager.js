// 文件缓存管理 — 音频文件缓存到 documentDirectory/music-cache/
// 从 services/file-cache.js 重构：移除 formatCacheSize（移到 utils）
import * as FileSystem from 'expo-file-system/legacy';
import { NativeModules } from 'react-native';
import logger from './logger';

// 使用 documentDirectory 而非 cacheDirectory，确保应用退出后缓存仍然保留
const CACHE_DIR = FileSystem.documentDirectory + 'music-cache/';
const OLD_CACHE_DIR = FileSystem.cacheDirectory + 'music-cache/';

let migrated = false;

// === 旧缓存目录迁移 ===
async function migrateOldCache() {
  if (migrated) return;
  migrated = true;
  try {
    const oldInfo = await FileSystem.getInfoAsync(OLD_CACHE_DIR);
    if (!oldInfo.exists) return;
    const newInfo = await FileSystem.getInfoAsync(CACHE_DIR);
    if (!newInfo.exists) {
      await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    }
    const files = await FileSystem.readDirectoryAsync(OLD_CACHE_DIR);
    for (const file of files) {
      const oldPath = OLD_CACHE_DIR + file;
      const newPath = CACHE_DIR + file;
      try {
        await FileSystem.moveAsync({ from: oldPath, to: newPath });
      } catch {}
    }
    try {
      await FileSystem.deleteAsync(OLD_CACHE_DIR, { idempotent: true });
    } catch {}
    // migrated
  } catch (e) {
    // migration error
  }
}

// === 确保缓存目录存在 ===
async function ensureCacheDir() {
  await migrateOldCache();
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
  return CACHE_DIR;
}

// === 生成缓存文件名 ===
function cacheFileName(source, songId, ext = 'mp3') {
  const safeSource = String(source).replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeSongId = String(songId).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safeSource}_${safeSongId}.${ext}`;
}

// =====================================================================
// 公开 API
// =====================================================================

/**
 * 获取缓存文件路径（如果存在且非空）
 * @param {string} source 音源名
 * @param {string|number} songId 歌曲ID
 * @returns {Promise<string|null>} 文件路径或 null
 */
export async function getCachedFile(source, songId) {
  try {
    const dir = await ensureCacheDir();
    const name = cacheFileName(source, songId);
    const path = dir + name;
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists && info.size > 0) {
      return path;
    }
    return null;
  } catch (e) {
    console.error('[CacheManager] getCachedFile error:', e.message);
    return null;
  }
}

/**
 * 删除指定缓存文件（用于播放失败时清理损坏缓存）
 * @param {string} source 音源名
 * @param {string|number} songId 歌曲ID
 */
export async function deleteCachedFile(source, songId) {
  try {
    const dir = await ensureCacheDir();
    const name = cacheFileName(source, songId);
    const path = dir + name;
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      await FileSystem.deleteAsync(path, { idempotent: true });
      // deleted corrupted cache file
    }
  } catch (e) {
    console.error('[CacheManager] deleteCachedFile error:', e.message);
  }
}

/**
 * 下载并缓存音频文件
 * 优先使用原生 OkHttp（NativeModules.UpdaterModule）下载，回退到 expo-file-system
 * @param {string} source 音源名
 * @param {string|number} songId 歌曲ID
 * @param {string} url 远程音频 URL
 * @returns {Promise<string|null>} 本地文件路径或 null
 */
export async function downloadAndCache(source, songId, url) {
  try {
    const dir = await ensureCacheDir();
    const name = cacheFileName(source, songId);
    const path = dir + name;

    // 检查是否已缓存
    const existing = await getCachedFile(source, songId);
    if (existing) return existing;

    // 优先使用 MediaModule 原生下载（后台 JS 被挂起时仍可工作）
    try {
      if (NativeModules.MediaModule && NativeModules.MediaModule.downloadFile) {
        const result = await NativeModules.MediaModule.downloadFile(url, path);
        if (result) return path;
      }
    } catch (e) {
      // 原生下载失败，回退到其他方式
    }

    // 回退：UpdaterModule 原生下载
    try {
      if (NativeModules.UpdaterModule && NativeModules.UpdaterModule.downloadFile) {
        const result = await NativeModules.UpdaterModule.downloadFile(url, path);
        if (result) return path;
      }
    } catch (e) {
      // 原生下载失败，回退到 expo-file-system
    }

    // 最后回退：expo-file-system 下载
    const downloadResult = await FileSystem.downloadAsync(url, path);
    if (downloadResult.status === 200) {
      return downloadResult.uri;
    }
    // download failed
    return null;
  } catch (e) {
    console.error('[CacheManager] downloadAndCache error:', e.message);
    return null;
  }
}

/**
 * 计算缓存目录大小
 * @returns {Promise<{totalSize: number, fileCount: number}>}
 */
export async function getCacheSize() {
  try {
    const dir = await ensureCacheDir();
    const files = await FileSystem.readDirectoryAsync(dir);
    let totalSize = 0;
    let fileCount = 0;
    for (const file of files) {
      try {
        const info = await FileSystem.getInfoAsync(dir + file);
        if (info.exists && info.size) {
          totalSize += info.size;
          fileCount++;
        }
      } catch {
        // 文件不可读，尝试删除
        try {
          await FileSystem.deleteAsync(dir + file, { idempotent: true });
        } catch {}
      }
    }
    return { totalSize, fileCount };
  } catch (e) {
    console.error('[CacheManager] getCacheSize error:', e.message);
    return { totalSize: 0, fileCount: 0 };
  }
}

/**
 * 清理全部缓存
 * @returns {Promise<boolean>}
 */
export async function clearCache() {
  try {
    const dir = await ensureCacheDir();
    const files = await FileSystem.readDirectoryAsync(dir);
    for (const file of files) {
      await FileSystem.deleteAsync(dir + file, { idempotent: true });
    }
    // 联动清除运行日志
    await logger.clearLogs();
    logger.info('CacheManager', 'Cache and logs cleared completely');
    return true;
  } catch (e) {
    logger.error('CacheManager', 'clearCache error', e);
    return false;
  }
}

/**
 * 根据缓存限制清理旧文件（LRU 简化版 — 按修改时间排序）
 * @param {number} limitMB 缓存上限（MB），0 表示无限制
 */
export async function enforceCacheLimit(limitMB) {
  if (limitMB === 0) return;
  try {
    const dir = await ensureCacheDir();
    const files = await FileSystem.readDirectoryAsync(dir);
    const items = [];
    let totalSize = 0;
    for (const file of files) {
      try {
        const info = await FileSystem.getInfoAsync(dir + file);
        if (info.exists && info.size) {
          items.push({
            name: file,
            size: info.size,
            modificationTime: info.modificationTime,
          });
          totalSize += info.size;
        }
      } catch {
        // 文件不可读，尝试删除
        try {
          await FileSystem.deleteAsync(dir + file, { idempotent: true });
        } catch {}
      }
    }
    const limitBytes = limitMB * 1024 * 1024;
    if (totalSize <= limitBytes) return;

    // 按修改时间排序（最旧的先删）
    items.sort((a, b) => a.modificationTime - b.modificationTime);
    for (const item of items) {
      if (totalSize <= limitBytes) break;
      await FileSystem.deleteAsync(dir + item.name, { idempotent: true });
      totalSize -= item.size;
    }
  } catch (e) {
    console.error('[CacheManager] enforceCacheLimit error:', e.message);
  }
}

export default {
  getCachedFile,
  deleteCachedFile,
  downloadAndCache,
  getCacheSize,
  clearCache,
  enforceCacheLimit,
};
