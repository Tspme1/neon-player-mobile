// 媒体通知栏 — 订阅 event-bus 状态变化，同步通知栏
// 通知栏按钮事件 → emit event-bus
// 纯 JS 播放（expo-av），前台服务 + WakeLock 保持进程高优先级
//
// 关键设计：
// 1. 每次更新都发完整状态（title/artist/artwork/duration/isPlaying/position/isFavorited）
//    通过单一 ReactMethod updateNotification 一次性传给原生层
// 2. 50ms 防抖合并连续更新，避免高频调用阻塞 JS 线程
// 3. 原生层缓存所有字段，确保通知栏 UI 永远有最新完整状态
import { NativeModules, NativeEventEmitter } from 'react-native';
import { EVENTS, on, off, emit } from './event-bus';
import { loadSettings, saveSettings } from './storage';

const MediaModule = NativeModules.MediaModule;
const isAvailable = !!MediaModule;

let eventEmitter = null;
let initialized = false;

// 通知栏当前显示的状态（JS 侧缓存，用于合并更新）
let notifTitle = '';
let notifArtist = '';
let notifArtworkUrl = '';
let notifDuration = 0;
let notifIsPlaying = false;
let notifPosition = 0;
let notifIsFavorited = false;

// 收藏列表引用
let _favorites = [];

// 是否有更新待推送
let pendingFlush = false;
let flushTimer = null;
const FLUSH_DELAY = 50;

// =====================================================================
// 核心同步：把完整状态一次性推给原生层
// =====================================================================

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushToNative();
  }, FLUSH_DELAY);
}

function flushToNative() {
  if (!isAvailable || !initialized) return;
  try {
    MediaModule.updateNotification(
      notifTitle,
      notifArtist,
      notifArtworkUrl,
      notifDuration,
      notifIsPlaying,
      notifPosition,
      notifIsFavorited
    );
  } catch (e) {
    console.error('[MediaSession] flushToNative error:', e);
  }
}

// =====================================================================
// 内部更新函数（合并到缓存，触发防抖）
// =====================================================================

function setMetadata(title, artist, artworkUrl, durationSec) {
  notifTitle = title || '';
  notifArtist = artist || '';
  notifArtworkUrl = artworkUrl || '';
  notifDuration = durationSec || 0;
  // 曲目元数据变化必须立即同步，后台 setTimeout 不可靠
  flushToNative();
}

function setPlaybackState(isPlaying, positionSec) {
  notifIsPlaying = !!isPlaying;
  notifPosition = positionSec || 0;
  // 播放状态变化必须立即同步
  flushToNative();
}

function setFavoriteState(favorited) {
  notifIsFavorited = !!favorited;
  // 喜欢状态变化必须立即同步
  flushToNative();
}

function isFavoritedTrack(track) {
  if (!track) return false;
  // 在线曲目：用 songId/id 匹配
  if (track.type === 'online' || (track.songId && !String(track.songId).startsWith('local_'))) {
    const id = track.songId || track.id;
    if (id) {
      return _favorites.some(f => f.type === 'online' && f.songId === id);
    }
  }
  // 本地曲目：用 path 匹配
  return _favorites.some(f => f.type !== 'online' && f.path === track.path);
}

// =====================================================================
// 公开 API
// =====================================================================

export async function initMediaNotification(settingsData = null) {
  if (!isAvailable) {
    console.log('[MediaSession] Native module not available (Expo Go?), skipping');
    return;
  }

  const settings = settingsData || await loadSettings();
  const enabled = settings.mediaNotificationEnabled !== false;

  try {
    MediaModule.initMediaSession();
    MediaModule.setMediaNotificationEnabled(enabled);
    initialized = true;
  } catch (e) {
    console.error('[MediaSession] init error:', e);
  }

  // 监听原生按钮事件 → emit event-bus
  if (!eventEmitter) {
    eventEmitter = new NativeEventEmitter(MediaModule);
    eventEmitter.addListener('MediaControlEvent', (eventName) => {
      emit(EVENTS.PLAYBACK_CONTROL, { action: eventName });
    });
  }

  subscribeToEvents();
}

export async function setMediaNotificationEnabled(enabled) {
  if (!isAvailable) return;

  const settings = await loadSettings();
  settings.mediaNotificationEnabled = enabled;
  await saveSettings(settings);

  try {
    if (enabled && !initialized) {
      MediaModule.initMediaSession();
      initialized = true;
      subscribeToEvents();
    }
    MediaModule.setMediaNotificationEnabled(enabled);
  } catch (e) {
    console.error('[MediaSession] setEnabled error:', e);
  }
}

export async function isMediaNotificationEnabled() {
  const settings = await loadSettings();
  return settings.mediaNotificationEnabled !== false;
}

export function updateMetadata(title, artist, artworkUrl, durationSec) {
  if (!isAvailable || !initialized) return;
  setMetadata(title, artist, artworkUrl, durationSec);
}

export function updatePlaybackState(isPlaying, positionSec) {
  if (!isAvailable || !initialized) return;
  setPlaybackState(isPlaying, positionSec);
}

export function updateFavoriteState(favorited) {
  if (!isAvailable || !initialized) return;
  setFavoriteState(favorited);
}

export function stopMediaNotification() {
  if (!isAvailable || !initialized) return;
  try {
    MediaModule.stopMediaSession();
    initialized = false;
    unsubscribeFromEvents();
  } catch (e) {
    // silent fail
  }
}

export function setFavoritesRef(favs) {
  _favorites = favs;
}

// =====================================================================
// event-bus 订阅管理
// =====================================================================

let unsubPlaybackState = null;
let unsubTrackChange = null;
let unsubFavoriteState = null;
let unsubCoverUpdate = null;

function subscribeToEvents() {
  if (unsubPlaybackState) return;

  // playback:state-change → 更新播放状态 + 位置
  unsubPlaybackState = on(EVENTS.PLAYBACK_STATE_CHANGE, (data) => {
    if (data.isPlaying !== undefined) {
      setPlaybackState(data.isPlaying, (data.position || 0) / 1000);
    }
  });

  // playback:track-change → 更新曲目元数据 + 播放状态 + 喜欢状态（一次性同步推送）
  unsubTrackChange = on(EVENTS.PLAYBACK_TRACK_CHANGE, (data) => {
    const { track, isPlaying } = data;
    if (!track) return;

    // 先更新所有缓存变量，最后只调一次 flushToNative
    // 避免多次 flushToNative 在后台被 RN bridge throttle 导致中间状态生效
    const artworkUrl = track.picUrl || track.cover || track.album?.picUrl || '';
    notifTitle = track.name || '未知歌曲';
    notifArtist = track.artist || '';
    notifArtworkUrl = artworkUrl;
    notifDuration = (track.duration || 0) / 1000;
    if (isPlaying !== undefined) {
      notifIsPlaying = !!isPlaying;
      notifPosition = 0;
    }
    notifIsFavorited = isFavoritedTrack(track);
    flushToNative();
  });

  // favorite:state-change → 更新通知栏爱心图标
  unsubFavoriteState = on(EVENTS.FAVORITE_STATE_CHANGE, (data) => {
    setFavoriteState(data.favorited);
  });

  // cover:update → 封面异步补拉到位后刷新通知栏 artwork
  unsubCoverUpdate = on(EVENTS.COVER_UPDATE, (data) => {
    if (data && data.url && data.url !== notifArtworkUrl) {
      notifArtworkUrl = data.url;
      flushToNative();
    }
  });
}

function unsubscribeFromEvents() {
  if (unsubPlaybackState) { unsubPlaybackState(); unsubPlaybackState = null; }
  if (unsubTrackChange) { unsubTrackChange(); unsubTrackChange = null; }
  if (unsubFavoriteState) { unsubFavoriteState(); unsubFavoriteState = null; }
  if (unsubCoverUpdate) { unsubCoverUpdate(); unsubCoverUpdate = null; }
}

export default {
  initMediaNotification,
  setMediaNotificationEnabled,
  isMediaNotificationEnabled,
  updateMetadata,
  updatePlaybackState,
  updateFavoriteState,
  stopMediaNotification,
  setFavoritesRef,
};
