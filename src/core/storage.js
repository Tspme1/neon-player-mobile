// 统一高速存储引擎 (L1 内存缓存 + L2 原生 NeonKV 同步引擎 + L3 AsyncStorage 自动平滑迁移)
// 同时内置 WeakMap O(1) 收藏/歌单哈希索引，彻底消除长列表渲染时的 O(N*M) 线性扫描开销
import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeTrack } from './models/track';

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

// =====================================================================
// 底层 NeonKV + AsyncStorage 混合引擎（零丢失自动迁移 + 0ms 同步读取）
// =====================================================================

const memoryKV = new Map();
const asyncMirrorTimers = new Map();

function hasNativeKV() {
  return !!(NativeModules.MediaModule && typeof NativeModules.MediaModule.kvGetString === 'function');
}

/**
 * 同步读取键值（优先 L1 内存 -> L2 原生同步 NeonKV）
 */
export function kvGetSync(key) {
  if (memoryKV.has(key)) {
    return memoryKV.get(key);
  }
  if (hasNativeKV()) {
    try {
      const val = NativeModules.MediaModule.kvGetString(key);
      if (val !== null && val !== undefined) {
        memoryKV.set(key, val);
        return val;
      }
    } catch {}
  }
  return null;
}

/**
 * 异步读取键值（支持首次从旧版 AsyncStorage 无感自动迁移至 NeonKV）
 */
export async function kvGetAsync(key) {
  const syncVal = kvGetSync(key);
  if (syncVal !== null && syncVal !== undefined) {
    return syncVal;
  }
  try {
    const legacyVal = await AsyncStorage.getItem(key);
    if (legacyVal !== null && legacyVal !== undefined) {
      memoryKV.set(key, legacyVal);
      if (hasNativeKV()) {
        try { NativeModules.MediaModule.kvSetString(key, legacyVal); } catch {}
      }
      return legacyVal;
    }
  } catch {}
  return null;
}

/**
 * 写入键值（L1 内存立即生效 + L2 原生异步 apply + L3 AsyncStorage 防抖双写备份）
 */
export async function kvSetAsync(key, valueStr) {
  const str = String(valueStr ?? '');
  memoryKV.set(key, str);
  if (hasNativeKV()) {
    try {
      NativeModules.MediaModule.kvSetString(key, str);
    } catch {}
  }
  // 防抖写入 AsyncStorage 作为双保险备份（避免高频序列化阻塞 Bridge）
  if (asyncMirrorTimers.has(key)) {
    clearTimeout(asyncMirrorTimers.get(key));
  }
  const timer = setTimeout(() => {
    asyncMirrorTimers.delete(key);
    AsyncStorage.setItem(key, str).catch(() => {});
  }, 200);
  asyncMirrorTimers.set(key, timer);
}

/**
 * 删除键值
 */
export async function kvRemoveAsync(key) {
  memoryKV.delete(key);
  if (asyncMirrorTimers.has(key)) {
    clearTimeout(asyncMirrorTimers.get(key));
    asyncMirrorTimers.delete(key);
  }
  if (hasNativeKV()) {
    try { NativeModules.MediaModule.kvRemove(key); } catch {}
  }
  try {
    await AsyncStorage.removeItem(key);
  } catch {}
}

// =====================================================================
// O(1) 哈希索引加速引擎（WeakMap 绑定数组引用，列表渲染性能提升数十倍）
// =====================================================================

const favSetCache = new WeakMap();

function getFavoriteLookupSet(favorites) {
  if (!Array.isArray(favorites) || favorites.length === 0) return null;
  let set = favSetCache.get(favorites);
  if (!set) {
    set = new Set();
    for (let i = 0; i < favorites.length; i++) {
      const f = favorites[i];
      if (!f) continue;
      if (f.id) set.add(`id:${f.id}`);
      if (f.type === 'online' && f.songId) set.add(`song:${f.songId}`);
      if (f.type !== 'online' && f.path) set.add(`path:${f.path}`);
    }
    favSetCache.set(favorites, set);
  }
  return set;
}

function invalidateFavoriteLookup(favorites) {
  if (favorites && typeof favorites === 'object') {
    favSetCache.delete(favorites);
  }
}

// =====================================================================
// Favorites 收藏
// =====================================================================

export async function loadFavorites() {
  try {
    const json = await kvGetAsync(KEYS.FAVORITES);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

export async function saveFavorites(favorites) {
  invalidateFavoriteLookup(favorites);
  try {
    await kvSetAsync(KEYS.FAVORITES, JSON.stringify(favorites));
  } catch (e) {
    console.error('[Storage] saveFavorites error:', e);
  }
}

export function getFavoriteId(track) {
  if (!track) return '';
  if (track.type === 'online' || track.songId) {
    return 'online_' + (track.songId || track.id || '');
  }
  return 'local_' + (track.path || '');
}

export function isFavorited(track, favorites) {
  if (!track || !Array.isArray(favorites) || favorites.length === 0) return false;
  const set = getFavoriteLookupSet(favorites);
  if (!set) return false;

  const id = getFavoriteId(track);
  if (id && set.has(`id:${id}`)) return true;

  const songId = track.songId || track.id;
  if (songId && set.has(`song:${songId}`)) return true;

  if (track.path && set.has(`path:${track.path}`)) return true;
  return false;
}

export function toggleFavorite(track, favorites) {
  if (!track || !Array.isArray(favorites)) return favorites || [];
  invalidateFavoriteLookup(favorites);

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
    const normalized = normalizeTrack(track);
    favorites.push({
      id: id,
      type: normalized.type,
      path: normalized.path || '',
      name: normalized.name || '',
      title: normalized.name || '',
      songId: normalized.songId || null,
      artist: normalized.artist || '',
      album: normalized.album || '',
      duration: normalized.duration || 0,
      fee: normalized.fee || 0,
      _src: normalized._src || null,
      _platform: normalized._platform || undefined,
      picUrl: normalized.picUrl || '',
      pic: normalized.picUrl || '',
      favoritedAt: Date.now(),
    });
  }
  invalidateFavoriteLookup(favorites);
  return favorites;
}

// =====================================================================
// Playlist 本地播放列表
// =====================================================================

export async function loadPlaylist() {
  try {
    const json = await kvGetAsync(KEYS.PLAYLIST);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

export async function savePlaylist(playlist) {
  try {
    await kvSetAsync(KEYS.PLAYLIST, JSON.stringify(playlist));
  } catch (e) {
    console.error('[Storage] savePlaylist error:', e);
  }
}

// =====================================================================
// Settings 设置（支持 0ms 同步读取 getSettingsSync，彻底解耦循环依赖）
// =====================================================================

const DEFAULT_SETTINGS = {
  currentSource: 'netease',
  searchSource: 'netease',
  playSource: 'official',
  themeMode: 'auto',
  musicQuality: 'standard',
  playMode: 'sequence',
  allowMixWithOthers: false,
  enableCrossPlatformFailover: true,
};

let memoryCachedSettings = null;

function normalizeSettingsObject(raw = {}) {
  const settings = { ...raw };
  if (!settings.searchSource && settings.currentSource) {
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
  if (!settings.currentSource) settings.currentSource = settings.playSource !== 'official' ? settings.playSource : settings.searchSource;
  if (!settings.themeMode) settings.themeMode = 'auto';
  if (!settings.musicQuality) settings.musicQuality = 'standard';
  if (!settings.playMode) settings.playMode = 'sequence';
  if (settings.allowMixWithOthers === undefined) settings.allowMixWithOthers = false;
  if (settings.enableCrossPlatformFailover === undefined) settings.enableCrossPlatformFailover = true;
  return settings;
}

/**
 * 同步获取当前设置（0ms 立即返回，供核心引擎与级联解析器直接调用，无需动态 import Store）
 */
export function getSettingsSync() {
  if (memoryCachedSettings) return { ...memoryCachedSettings };
  const syncJson = kvGetSync(KEYS.SETTINGS);
  if (syncJson) {
    try {
      memoryCachedSettings = normalizeSettingsObject(JSON.parse(syncJson));
      return { ...memoryCachedSettings };
    } catch {}
  }
  return { ...DEFAULT_SETTINGS };
}

export async function loadSettings() {
  if (memoryCachedSettings) return { ...memoryCachedSettings };
  try {
    const json = await kvGetAsync(KEYS.SETTINGS);
    const raw = json ? JSON.parse(json) : {};
    memoryCachedSettings = normalizeSettingsObject(raw);
    return { ...memoryCachedSettings };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings) {
  memoryCachedSettings = normalizeSettingsObject(settings);
  try {
    await kvSetAsync(KEYS.SETTINGS, JSON.stringify(memoryCachedSettings));
  } catch (e) {
    console.error('[Storage] saveSettings error:', e);
  }
}

// =====================================================================
// Volume 音量
// =====================================================================

export async function loadVolume() {
  try {
    const vol = await kvGetAsync(KEYS.VOLUME);
    return vol !== null ? Math.max(0, Math.min(1, parseFloat(vol))) : 0.8;
  } catch {
    return 0.8;
  }
}

export async function saveVolume(volume) {
  try {
    await kvSetAsync(KEYS.VOLUME, String(volume));
  } catch {
    // silent fail
  }
}

// =====================================================================
// URL 缓存（内存 Map + 定期批量持久化）
// =====================================================================

const URL_CACHE_TTL = 20 * 60 * 1000; // 20 minutes
const urlCacheMap = new Map();
let urlCacheDirty = false;
let urlCacheFlushTimer = null;
const URL_CACHE_FLUSH_INTERVAL = 30 * 1000;

export function getCachedUrl(key) {
  const cached = urlCacheMap.get(key);
  if (cached && (Date.now() - cached.timestamp) < URL_CACHE_TTL) {
    return cached.data;
  }
  return null;
}

export function setCachedUrl(key, data) {
  urlCacheMap.set(key, { data, timestamp: Date.now() });
  urlCacheDirty = true;
  scheduleUrlCacheFlush();
}

export function clearUrlCache() {
  urlCacheMap.clear();
  urlCacheDirty = false;
  if (urlCacheFlushTimer) {
    clearTimeout(urlCacheFlushTimer);
    urlCacheFlushTimer = null;
  }
  kvRemoveAsync(KEYS.URL_CACHE).catch(() => {});
}

export async function restoreUrlCache() {
  try {
    const json = await kvGetAsync(KEYS.URL_CACHE);
    if (json) {
      const persisted = JSON.parse(json);
      const now = Date.now();
      for (const [key, entry] of Object.entries(persisted)) {
        if (now - entry.timestamp < URL_CACHE_TTL) {
          urlCacheMap.set(key, entry);
        }
      }
    }
  } catch {
    // silent fail
  }
}

function scheduleUrlCacheFlush() {
  if (urlCacheFlushTimer) return;
  urlCacheFlushTimer = setTimeout(() => {
    flushUrlCache();
  }, URL_CACHE_FLUSH_INTERVAL);
}

async function flushUrlCache() {
  urlCacheFlushTimer = null;
  if (!urlCacheDirty) return;
  urlCacheDirty = false;
  try {
    const obj = {};
    for (const [key, entry] of urlCacheMap) {
      obj[key] = entry;
    }
    await kvSetAsync(KEYS.URL_CACHE, JSON.stringify(obj));
  } catch {
    // silent fail
  }
}

// =====================================================================
// Roam Preferences 漫游偏好
// =====================================================================

export async function loadRoamPrefs() {
  try {
    const json = await kvGetAsync(KEYS.ROAM_PREFS);
    return json ? JSON.parse(json) : { artists: {}, genres: {}, playCount: 0, likedSongs: [] };
  } catch {
    return { artists: {}, genres: {}, playCount: 0, likedSongs: [] };
  }
}

export async function saveRoamPrefs(prefs) {
  try {
    await kvSetAsync(KEYS.ROAM_PREFS, JSON.stringify(prefs));
  } catch (e) {
    console.error('[Storage] saveRoamPrefs error:', e);
  }
}

export async function clearRoamPrefs() {
  try {
    await kvRemoveAsync(KEYS.ROAM_PREFS);
  } catch (e) {
    console.error('[Storage] clearRoamPrefs error:', e);
  }
}

// =====================================================================
// Custom Playlists 自建歌单
// =====================================================================

export async function loadCustomPlaylists() {
  try {
    const json = await kvGetAsync(KEYS.CUSTOM_PLAYLISTS);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

export async function saveCustomPlaylists(playlists) {
  try {
    await kvSetAsync(KEYS.CUSTOM_PLAYLISTS, JSON.stringify(playlists));
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
  if (!playlist || !Array.isArray(playlist.tracks) || !track) return false;
  return isFavorited(track, playlist.tracks);
}

export function addTrackToPlaylistData(playlist, track) {
  if (!playlist || !track) return false;
  if (!playlist.tracks) playlist.tracks = [];
  invalidateFavoriteLookup(playlist.tracks);
  if (isTrackInPlaylist(playlist, track)) return false;

  const normalized = normalizeTrack(track);
  const id = getFavoriteId(normalized);
  playlist.tracks.push({
    id: id,
    type: normalized.type,
    path: normalized.path || '',
    name: normalized.name || '',
    title: normalized.name || '',
    songId: normalized.songId || null,
    artist: normalized.artist || '',
    album: normalized.album || '',
    duration: normalized.duration || 0,
    fee: normalized.fee || 0,
    _src: normalized._src || null,
    _platform: normalized._platform || undefined,
    picUrl: normalized.picUrl || '',
    pic: normalized.picUrl || '',
    addedAt: Date.now(),
  });
  invalidateFavoriteLookup(playlist.tracks);
  playlist.updatedAt = Date.now();
  return true;
}

export function removeTrackFromPlaylistData(playlist, trackIdOrSongId) {
  if (!playlist || !playlist.tracks) return;
  invalidateFavoriteLookup(playlist.tracks);
  const idx = playlist.tracks.findIndex(t => t.id === trackIdOrSongId || t.songId === trackIdOrSongId || t.path === trackIdOrSongId);
  if (idx >= 0) {
    playlist.tracks.splice(idx, 1);
    invalidateFavoriteLookup(playlist.tracks);
    playlist.updatedAt = Date.now();
  }
}

/**
 * 智能解析导入数据
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

  if (json && typeof json === 'object') {
    if (json.type === 'neon-player-backup' || (json.favorites && json.playlists)) {
      return {
        format: 'backup',
        favorites: Array.isArray(json.favorites) ? json.favorites.map(t => normalizeTrack(t)) : [],
        playlists: Array.isArray(json.playlists) ? json.playlists : [],
      };
    }

    if (json.type === 'neon-player-playlist' || (json.name && Array.isArray(json.tracks))) {
      return {
        format: 'single-playlist',
        name: json.name || defaultName,
        tracks: Array.isArray(json.tracks) ? json.tracks.map(t => normalizeTrack(t)) : [],
      };
    }

    if (json.type === 'neon-player-favorites' || Array.isArray(json.favorites)) {
      return {
        format: 'favorites',
        name: '我喜欢的',
        tracks: Array.isArray(json.favorites) ? json.favorites.map(t => normalizeTrack(t)) : [],
      };
    }

    if (Array.isArray(json)) {
      const tracks = json.map(item => normalizeTrack({
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
        picUrl: item.picUrl || item.pic || item.cover || '',
      }));
      return {
        format: 'single-playlist',
        name: defaultName,
        tracks,
      };
    }
  }

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
      return normalizeTrack({
        id: 'online_txt_' + Date.now() + '_' + idx,
        type: 'online',
        name: name || '未知歌曲',
        artist: artist || '',
        album: '',
        duration: 0,
        songId: null,
        _src: 'netease',
        _platform: 'netease',
      });
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
  kvGetSync, kvGetAsync, kvSetAsync, kvRemoveAsync,
  loadFavorites, saveFavorites,
  getFavoriteId, isFavorited, toggleFavorite,
  loadPlaylist, savePlaylist,
  getSettingsSync, loadSettings, saveSettings,
  loadVolume, saveVolume,
  getCachedUrl, setCachedUrl, clearUrlCache, restoreUrlCache,
  loadRoamPrefs, saveRoamPrefs, clearRoamPrefs,
  loadCustomPlaylists, saveCustomPlaylists,
  createPlaylistObject, isTrackInPlaylist,
  addTrackToPlaylistData, removeTrackFromPlaylistData,
  parseImportData,
};
