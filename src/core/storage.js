// 统一存储服务 — 合并 favorites.js + cache.js
// 封装 AsyncStorage，提供收藏/播放列表/设置/音量/URL缓存 持久化
import AsyncStorage from '@react-native-async-storage/async-storage';

// === 存储键名 ===
export const KEYS = {
  FAVORITES: '@favorites',
  CUSTOM_PLAYLISTS: '@custom_playlists',
  PLAYLIST: '@playlist',
  SETTINGS: '@settings',
  VOLUME: '@volume',
  SOURCE_REGISTRY: '@source_registry',
  SOURCE_CODE_PREFIX: '@source_code_',
  URL_CACHE: '@url_cache',
  ROAM_PREFS: '@roam_prefs',
};

// === URL 缓存 TTL ===
const URL_CACHE_TTL = 20 * 60 * 1000; // 20 minutes

// === URL 内存缓存（定期批量持久化） ===
const urlCacheMap = new Map();
let urlCacheDirty = false;
let urlCacheFlushTimer = null;
const URL_CACHE_FLUSH_INTERVAL = 30 * 1000; // 30秒批量持久化一次

// =====================================================================
// Favorites 收藏
// =====================================================================

export async function loadFavorites() {
  try {
    const json = await AsyncStorage.getItem(KEYS.FAVORITES);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

export async function saveFavorites(favorites) {
  try {
    await AsyncStorage.setItem(KEYS.FAVORITES, JSON.stringify(favorites));
  } catch (e) {
    console.error('[Storage] saveFavorites error:', e);
  }
}

// === Favorite ID 逻辑 (从桌面端 favorites.js 移植) ===

export function getFavoriteId(track) {
  if (track.type === 'online' || track.songId) {
    return 'online_' + (track.songId || track.id || '');
  }
  return 'local_' + (track.path || '');
}

export function isFavorited(track, favorites) {
  const id = getFavoriteId(track);
  const songId = track.songId || track.id;
  if (songId) {
    return favorites.some(f => f.id === id || (f.type === 'online' && f.songId === songId));
  }
  return favorites.some(f => f.id === id || (f.type !== 'online' && f.path === track.path));
}

export function toggleFavorite(track, favorites) {
  const id = getFavoriteId(track);
  const songId = track.songId || track.id;
  let idx = favorites.findIndex(f => f.id === id);
  if (idx < 0 && songId) {
    idx = favorites.findIndex(f => f.type === 'online' && f.songId === songId);
  } else if (idx < 0 && track.path) {
    idx = favorites.findIndex(f => f.type !== 'online' && f.path === track.path);
  }
  if (idx >= 0) {
    favorites.splice(idx, 1);
  } else {
    favorites.push({
      id: id,
      type: track.type || 'local',
      path: track.path || '',
      name: track.name || '',
      songId: track.songId || track.id || null,
      artist: track.artist || '',
      album: track.album || '',
      duration: track.duration || 0,
      fee: track.fee || 0,
      _src: track._src || null,
      favoritedAt: Date.now(),
    });
  }
  return favorites;
}

// =====================================================================
// Playlist 本地播放列表
// =====================================================================

export async function loadPlaylist() {
  try {
    const json = await AsyncStorage.getItem(KEYS.PLAYLIST);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

export async function savePlaylist(playlist) {
  try {
    await AsyncStorage.setItem(KEYS.PLAYLIST, JSON.stringify(playlist));
  } catch (e) {
    console.error('[Storage] savePlaylist error:', e);
  }
}

// =====================================================================
// Settings 设置
// =====================================================================

export async function loadSettings() {
  try {
    const json = await AsyncStorage.getItem(KEYS.SETTINGS);
    const settings = json ? JSON.parse(json) : {};
    // 向后兼容：旧版只有 currentSource，迁移为双轴
    if (!settings.searchSource && settings.currentSource) {
      // currentSource 可能是 'netease'/'tencent' 等内置音源或 'lx:xxx'
      if (settings.currentSource.startsWith('lx:')) {
        settings.searchSource = 'netease';
        settings.playSource = settings.currentSource;
      } else {
        settings.searchSource = settings.currentSource;
        settings.playSource = 'official';
      }
    }
    if (!settings.searchSource) settings.searchSource = 'netease';
    if (!settings.playSource) settings.playSource = 'official';
    if (!settings.themeMode) settings.themeMode = 'auto';
    if (!settings.musicQuality) settings.musicQuality = 'standard';
    if (!settings.playMode) settings.playMode = 'sequence';
    if (settings.allowMixWithOthers === undefined) settings.allowMixWithOthers = false;
    return settings;
  } catch {
    return { currentSource: 'netease', searchSource: 'netease', playSource: 'official', themeMode: 'auto', musicQuality: 'standard', playMode: 'sequence', allowMixWithOthers: false };
  }
}

export async function saveSettings(settings) {
  try {
    await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('[Storage] saveSettings error:', e);
  }
}

// =====================================================================
// Volume 音量
// =====================================================================

export async function loadVolume() {
  try {
    const vol = await AsyncStorage.getItem(KEYS.VOLUME);
    return vol !== null ? Math.max(0, Math.min(1, parseFloat(vol))) : 0.8;
  } catch {
    return 0.8;
  }
}

export async function saveVolume(volume) {
  try {
    await AsyncStorage.setItem(KEYS.VOLUME, String(volume));
  } catch (e) {
    // silent fail
  }
}

// =====================================================================
// URL 缓存（内存 Map + 定期批量持久化）
// =====================================================================

/**
 * 从内存缓存获取 URL
 */
export function getCachedUrl(key) {
  const cached = urlCacheMap.get(key);
  if (cached && (Date.now() - cached.timestamp) < URL_CACHE_TTL) {
    return cached.data;
  }
  return null;
}

/**
 * 写入 URL 到内存缓存，标记为脏数据等待批量持久化
 */
export function setCachedUrl(key, data) {
  urlCacheMap.set(key, { data, timestamp: Date.now() });
  urlCacheDirty = true;
  scheduleUrlCacheFlush();
}

/**
 * 清除 URL 缓存
 */
export function clearUrlCache() {
  urlCacheMap.clear();
  urlCacheDirty = false;
  if (urlCacheFlushTimer) {
    clearTimeout(urlCacheFlushTimer);
    urlCacheFlushTimer = null;
  }
  // 异步清除持久化数据
  AsyncStorage.removeItem(KEYS.URL_CACHE).catch(() => {});
}

/**
 * 从 AsyncStorage 恢复 URL 缓存到内存（启动时调用）
 */
export async function restoreUrlCache() {
  try {
    const json = await AsyncStorage.getItem(KEYS.URL_CACHE);
    if (json) {
      const persisted = JSON.parse(json);
      const now = Date.now();
      for (const [key, entry] of Object.entries(persisted)) {
        // 只恢复未过期的条目
        if (now - entry.timestamp < URL_CACHE_TTL) {
          urlCacheMap.set(key, entry);
        }
      }
      console.log(`[Storage] Restored ${urlCacheMap.size} URL cache entries`);
    }
  } catch {
    // silent fail
  }
}

/**
 * 调度 URL 缓存批量持久化（防抖）
 */
function scheduleUrlCacheFlush() {
  if (urlCacheFlushTimer) return;
  urlCacheFlushTimer = setTimeout(() => {
    flushUrlCache();
  }, URL_CACHE_FLUSH_INTERVAL);
}

/**
 * 将脏的 URL 缓存批量写入 AsyncStorage
 */
async function flushUrlCache() {
  urlCacheFlushTimer = null;
  if (!urlCacheDirty) return;
  urlCacheDirty = false;
  try {
    const obj = {};
    for (const [key, entry] of urlCacheMap) {
      obj[key] = entry;
    }
    await AsyncStorage.setItem(KEYS.URL_CACHE, JSON.stringify(obj));
  } catch (e) {
    // silent fail — 内存缓存仍然有效
  }
}

// =====================================================================
// Roam Preferences 漫游偏好
// =====================================================================

export async function loadRoamPrefs() {
  try {
    const json = await AsyncStorage.getItem(KEYS.ROAM_PREFS);
    return json ? JSON.parse(json) : { artists: {}, genres: {}, playCount: 0, likedSongs: [] };
  } catch {
    return { artists: {}, genres: {}, playCount: 0, likedSongs: [] };
  }
}

export async function saveRoamPrefs(prefs) {
  try {
    await AsyncStorage.setItem(KEYS.ROAM_PREFS, JSON.stringify(prefs));
  } catch (e) {
    console.error('[Storage] saveRoamPrefs error:', e);
  }
}

export async function clearRoamPrefs() {
  try {
    await AsyncStorage.removeItem(KEYS.ROAM_PREFS);
  } catch (e) {
    console.error('[Storage] clearRoamPrefs error:', e);
  }
}

// =====================================================================
// Custom Playlists 自建歌单
// =====================================================================

export async function loadCustomPlaylists() {
  try {
    const json = await AsyncStorage.getItem(KEYS.CUSTOM_PLAYLISTS);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

export async function saveCustomPlaylists(playlists) {
  try {
    await AsyncStorage.setItem(KEYS.CUSTOM_PLAYLISTS, JSON.stringify(playlists));
  } catch (e) {
    console.error('[Storage] saveCustomPlaylists error:', e);
  }
}

export function createPlaylistObject(name) {
  const trimmed = name ? name.trim() : '';
  return {
    id: 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name: trimmed || '新建歌单',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tracks: [],
  };
}

export function isTrackInPlaylist(playlist, track) {
  if (!playlist || !playlist.tracks) return false;
  const id = getFavoriteId(track);
  const songId = track.songId || track.id;
  if (songId) {
    return playlist.tracks.some(t => t.id === id || (t.type === 'online' && (t.songId === songId || t.id === songId)));
  }
  return playlist.tracks.some(t => t.id === id || (t.type !== 'online' && t.path === track.path));
}

export function addTrackToPlaylistData(playlist, track) {
  if (!playlist) return false;
  if (!playlist.tracks) playlist.tracks = [];
  if (isTrackInPlaylist(playlist, track)) return false;
  const id = getFavoriteId(track);
  playlist.tracks.push({
    id: id,
    type: track.type || 'online',
    path: track.path || '',
    name: track.name || '',
    songId: track.songId || track.id || null,
    artist: track.artist || '',
    album: track.album || '',
    duration: track.duration || 0,
    fee: track.fee || 0,
    _src: track._src || null,
    _platform: track._platform || (track.type === 'online' ? 'netease' : undefined),
    addedAt: Date.now(),
  });
  playlist.updatedAt = Date.now();
  return true;
}

export function removeTrackFromPlaylistData(playlist, trackIdOrSongId) {
  if (!playlist || !playlist.tracks) return;
  const idx = playlist.tracks.findIndex(t => t.id === trackIdOrSongId || t.songId === trackIdOrSongId || t.path === trackIdOrSongId);
  if (idx >= 0) {
    playlist.tracks.splice(idx, 1);
    playlist.updatedAt = Date.now();
  }
}

/**
 * 智能解析导入数据
 * 支持：
 * 1. type: 'neon-player-playlist' (单歌单)
 * 2. type: 'neon-player-favorites' (旧版我喜欢)
 * 3. type: 'neon-player-backup' (全量备份)
 * 4. 洛雪歌单/通用歌曲数组 [{ name, singer/artist, ... }]
 * 5. 纯文本逐行格式 ("歌名 - 歌手" 或 "歌名")
 */
export function parseImportData(rawContent, defaultName = '导入歌单') {
  if (!rawContent || typeof rawContent !== 'string') {
    throw new Error('导入内容为空');
  }

  const content = rawContent.trim();
  let json = null;
  try {
    json = JSON.parse(content);
  } catch {
    json = null;
  }

  // 1. JSON 格式解析
  if (json && typeof json === 'object') {
    // 全量备份
    if (json.type === 'neon-player-backup' || (json.favorites && json.playlists)) {
      return {
        format: 'backup',
        favorites: Array.isArray(json.favorites) ? json.favorites : [],
        playlists: Array.isArray(json.playlists) ? json.playlists : [],
      };
    }

    // 单自建歌单
    if (json.type === 'neon-player-playlist' || (json.name && Array.isArray(json.tracks))) {
      return {
        format: 'single-playlist',
        name: json.name || defaultName,
        tracks: Array.isArray(json.tracks) ? json.tracks : [],
      };
    }

    // 喜欢清单
    if (json.type === 'neon-player-favorites' || Array.isArray(json.favorites)) {
      return {
        format: 'favorites',
        name: '我喜欢的',
        tracks: Array.isArray(json.favorites) ? json.favorites : [],
      };
    }

    // 歌曲数组 (如直接导出的 tracks 数组或第三方歌单数组)
    if (Array.isArray(json)) {
      const tracks = json.map(item => ({
        id: item.id || (item.songId ? 'online_' + item.songId : 'online_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5)),
        type: item.type || 'online',
        path: item.path || '',
        name: item.name || item.title || '未知歌曲',
        songId: item.songId || item.id || null,
        artist: item.artist || item.singer || item.ar || '',
        album: item.album || item.al || '',
        duration: item.duration || 0,
        fee: item.fee || 0,
        _src: item._src || 'netease',
        _platform: item._platform || 'netease',
      }));
      return {
        format: 'single-playlist',
        name: defaultName,
        tracks,
      };
    }
  }

  // 2. 纯文本格式逐行解析 ("歌名 - 歌手" 或 "歌名")
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length > 0) {
    const tracks = lines.map((line, idx) => {
      let name = line;
      let artist = '';
      if (line.includes(' - ')) {
        const parts = line.split(' - ');
        name = parts[0].trim();
        artist = parts.slice(1).join(' - ').trim();
      } else if (line.includes('-')) {
        const parts = line.split('-');
        name = parts[0].trim();
        artist = parts.slice(1).join('-').trim();
      }
      return {
        id: 'online_txt_' + Date.now() + '_' + idx,
        type: 'online',
        name: name || '未知歌曲',
        artist: artist || '',
        album: '',
        duration: 0,
        songId: null,
        _src: 'netease',
        _platform: 'netease',
      };
    });
    return {
      format: 'single-playlist',
      name: defaultName,
      tracks,
    };
  }

  throw new Error('未能识别有效歌单数据');
}

export default {
  KEYS,
  loadFavorites, saveFavorites,
  getFavoriteId, isFavorited, toggleFavorite,
  loadPlaylist, savePlaylist,
  loadSettings, saveSettings,
  loadVolume, saveVolume,
  getCachedUrl, setCachedUrl, clearUrlCache, restoreUrlCache,
  loadRoamPrefs, saveRoamPrefs, clearRoamPrefs,
  loadCustomPlaylists, saveCustomPlaylists,
  createPlaylistObject, isTrackInPlaylist,
  addTrackToPlaylistData, removeTrackFromPlaylistData,
  parseImportData,
};
