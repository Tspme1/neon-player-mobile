/**
 * 统一歌曲下载用例服务 (Download UseCase Service)
 *
 * 解决此前 FullPlayer / OnlineScreen / FavoritesScreen / DiscoverScreen 四处散落的重复下载代码，
 * 以及非 FullPlayer 页面未走自定义音源级联解析、未复用本地已缓存音频文件的架构缺陷。
 *
 * 核心能力：
 * 1. 0 秒极速本地转存：若歌曲已在 music-cache 缓存落盘，直接通过 UpdaterModule 本地流拷贝至公共音乐目录，零流量秒完成。
 * 2. 全链路多音源级联解析：统一走 resolvePlayableUrlCascade，支持自定义 LX 音源与跨源容灾。
 */

import { NativeModules, Linking } from 'react-native';
import { normalizeTrack, detectPlatform } from '../models/track';
import { resolvePlayableUrlCascade, musicSongUrl } from '../resolver/cascade-resolver';
import { getCachedFile } from '../cache-manager';
import { getSettingsSync } from '../storage';
import logger from '../logger';

/**
 * 清洗合法文件名
 */
export function buildSafeTrackFileName(track, ext = '.mp3') {
  const safeName = `${track.name || '未知歌曲'} - ${track.artist || '未知歌手'}`
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  const cleanExt = ext.startsWith('.') ? ext : `.${ext}`;
  return `${safeName}${cleanExt}`;
}

/**
 * 打开系统下载目录中的 NeonPlayer 文件夹
 */
export async function openDownloadFolderUseCase() {
  try {
    if (NativeModules.UpdaterModule?.openDownloadFolder) {
      await NativeModules.UpdaterModule.openDownloadFolder();
      return;
    }
    await Linking.openURL('content://com.android.externalstorage.documents/document/primary%3ADownload%2FNeonPlayer');
  } catch {
    try {
      await Linking.openURL('content://com.android.externalstorage.documents/root/primary');
    } catch {}
  }
}

/**
 * 统一下载曲目到系统公共音乐目录 (Download/NeonPlayer)
 *
 * @param {object} rawTrack 歌曲对象
 * @param {object} [options] 可选配置
 * @param {string} [options.playSource] 当前播放音源，默认自动从设置读取
 * @param {string} [options.quality] 音质，默认自动从设置读取
 * @param {function} [options.showToast] Toast 回调函数 (message, actionObj) => void
 * @returns {Promise<{success: boolean, path?: string, fromCache?: boolean, error?: string}>}
 */
export async function downloadTrackUseCase(rawTrack, options = {}) {
  const showToast = options.showToast || (() => {});
  if (!rawTrack) {
    showToast('无效曲目');
    return { success: false, error: '无效曲目' };
  }

  const track = normalizeTrack(rawTrack);
  const settings = getSettingsSync() || {};
  const playSource = options.playSource || settings.playSource || 'official';
  const quality = options.quality || settings.musicQuality || 'standard';
  const platform = detectPlatform(track);
  const songId = track.songId || track.id;

  try {
    // 1. 优先检查本地音频缓存 (music-cache)：命中则 0 秒零流量直接转存
    if (songId) {
      try {
        const cachedUri = await getCachedFile(platform, songId);
        if (cachedUri && NativeModules.UpdaterModule?.downloadToMusicDir) {
          const extMatch = cachedUri.match(/\.(mp3|flac|m4a|ogg|wav)$/i);
          const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '.mp3';
          const fileName = buildSafeTrackFileName(track, ext);
          logger.info('DownloadService', `Fast-copying cached file for "${track.name}": ${cachedUri}`);
          const savedPath = await NativeModules.UpdaterModule.downloadToMusicDir(cachedUri, fileName);
          showToast(`已从缓存极速导出: ${savedPath}`, {
            label: '查看文件夹',
            onPress: openDownloadFolderUseCase,
          });
          return { success: true, path: savedPath, fromCache: true };
        }
      } catch (cacheErr) {
        logger.warn('DownloadService', 'Cache fast-copy check failed, falling back to network', cacheErr?.message);
      }
    }

    // 2. 检查曲目自身是否已是本地文件
    if (track.isLocal && track.url && (track.url.startsWith('file://') || track.url.startsWith('/'))) {
      if (NativeModules.UpdaterModule?.downloadToMusicDir) {
        const fileName = buildSafeTrackFileName(track, '.mp3');
        const savedPath = await NativeModules.UpdaterModule.downloadToMusicDir(track.url, fileName);
        showToast(`已导出到: ${savedPath}`, {
          label: '查看文件夹',
          onPress: openDownloadFolderUseCase,
        });
        return { success: true, path: savedPath, fromCache: true };
      }
    }

    // 3. 走多音源级联解析获取可下载的直链
    showToast(`正在准备下载: ${track.name}...`);
    let downloadUrl = null;

    if (songId) {
      const cascadeResult = await resolvePlayableUrlCascade(track, playSource, quality);
      if (cascadeResult && cascadeResult.url) {
        downloadUrl = cascadeResult.url;
      } else {
        const fallbackResult = await musicSongUrl(playSource, track);
        if (fallbackResult && fallbackResult.url) {
          downloadUrl = fallbackResult.url;
        }
      }
    }

    if (!downloadUrl && track.url && track.url.startsWith('http')) {
      downloadUrl = track.url;
    }

    if (!downloadUrl) {
      showToast('无法获取下载链接（可能受版权限制或需切换音源）');
      return { success: false, error: '无法获取下载链接' };
    }

    // 根据 URL 推断扩展名（支持 flac / m4a / mp3）
    const urlPath = downloadUrl.split('?')[0];
    const extMatch = urlPath.match(/\.(flac|m4a|ogg|wav|mp3)$/i);
    const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '.mp3';
    const fileName = buildSafeTrackFileName(track, ext);

    if (NativeModules.UpdaterModule?.downloadToMusicDir) {
      const savedPath = await NativeModules.UpdaterModule.downloadToMusicDir(downloadUrl, fileName);
      showToast(`已下载到: ${savedPath}`, {
        label: '查看文件夹',
        onPress: openDownloadFolderUseCase,
      });
      return { success: true, path: savedPath, fromCache: false };
    } else {
      await Linking.openURL(downloadUrl);
      return { success: true, path: downloadUrl, fromCache: false };
    }
  } catch (e) {
    logger.error('DownloadService', 'Download failed', e);
    showToast('下载失败: ' + (e?.message || '未知错误'));
    return { success: false, error: e?.message || '未知错误' };
  }
}
