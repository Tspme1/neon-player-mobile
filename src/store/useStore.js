/**
 * 全局状态 Store (Zustand Slices 组合架构 — Phase 2)
 *
 * 将原本单文件庞大的 Store 拆分为职责清晰、边界明确的 5 个 Slice：
 * - playerSlice:   播放控制、进度/音量、当前曲目歌词与封面镜像
 * - queueSlice:    播放队列、漫游队列、队列原语 (insertNextInQueue / removeFromQueue)
 * - librarySlice:  收藏夹、自建歌单、本地音乐库
 * - settingsSlice: 双轴音源配置、音质、主题、跨源容灾开关
 * - uiSlice:       搜索结果、发现页榜单、全局弹窗与 Toast
 */

import { create } from 'zustand';
import { NativeModules } from 'react-native';
import { EVENTS, on } from '../core/event-bus';
import * as PlayerEngine from '../core/player-engine';
import * as MediaSession from '../core/media-session';
import {
  loadFavorites,
  saveFavorites,
  toggleFavorite,
  isFavorited,
  loadSettings,
  loadPlaylist,
  loadCustomPlaylists,
  saveCustomPlaylists,
  clearUrlCache,
} from '../core/storage';
import { waitForSandboxReady, initLxSource } from '../services/lx-webview-manager';
import logger from '../core/logger';

import { createPlayerSlice } from './slices/playerSlice';
import { createQueueSlice } from './slices/queueSlice';
import { createLibrarySlice } from './slices/librarySlice';
import { createSettingsSlice } from './slices/settingsSlice';
import { createUiSlice } from './slices/uiSlice';

// 独立的高频进度 Store，供进度条专用订阅，防止 100ms position 变动冲刷全局 Store
export const usePlaybackProgress = create(() => ({
  position: 0,
  duration: 0,
}));

// Phase 4: 独立的歌词高亮 Store，供全屏播放器可见时专用订阅，彻底消除每句歌词切换时触发全应用重渲染
export const useLyricsStore = create(() => ({
  lyricsData: [],
  currentLyricIndex: -1,
}));

// 组合 5 大领域 Slice 构建统一 Store（100% 保持外部 Selector / getState 兼容）
export const usePlayerStore = create((set, get) => ({
  ...createPlayerSlice(set, get),
  ...createQueueSlice(set, get),
  ...createLibrarySlice(set, get),
  ...createSettingsSlice(set, get),
  ...createUiSlice(set, get),
}));

// =====================================================================
// event-bus 订阅 — 从 core 模块同步状态到 store
// =====================================================================

let _initialized = false;

export function initStore() {
  if (_initialized) return;
  _initialized = true;

  // playback:state-change → 更新播放状态
  on(EVENTS.PLAYBACK_STATE_CHANGE, (data) => {
    // 1. 只有播放/暂停状态改变时才更新全局 usePlayerStore，切断全应用页面的 100ms 重渲染风暴
    if (data.isPlaying !== undefined && data.isPlaying !== usePlayerStore.getState().isPlaying) {
      usePlayerStore.setState({ isPlaying: data.isPlaying });
    }

    // 2. 高频进度更新仅写入专用轻量 Hook usePlaybackProgress
    const progUpdate = {};
    if (data.position !== undefined) progUpdate.position = data.position;
    if (data.duration !== undefined) progUpdate.duration = data.duration;
    if (Object.keys(progUpdate).length > 0) {
      usePlaybackProgress.setState(progUpdate);
    }
  });

  // playback:track-change → 更新当前曲目信息
  on(EVENTS.PLAYBACK_TRACK_CHANGE, (data) => {
    const update = {};
    if (data.index !== undefined) update.currentIndex = data.index;
    if (data.track !== undefined) {
      if (data.track.type === 'online' || data.track.songId) {
        update.currentOnlineSong = {
          id: data.track.songId || data.track.id,
          name: data.track.name,
          artist: data.track.artist,
        };
      } else {
        update.currentOnlineSong = null;
      }
    }
    if (data.isPlaying !== undefined) update.isPlaying = data.isPlaying;
    update.playlist = PlayerEngine.getPlaylist();
    update.currentIndex = PlayerEngine.getCurrentIndex();
    update.isRoaming = PlayerEngine.getIsRoaming();
    update.roamPlaylist = PlayerEngine.getRoamPlaylist();
    update.roamIndex = PlayerEngine.getRoamIndex();
    usePlayerStore.setState(update);
  });

  // playback:queue-change → 更新播放队列
  on(EVENTS.PLAYBACK_QUEUE_CHANGE, (data) => {
    if (data.queueSource === 'roam') {
      usePlayerStore.setState({
        isRoaming: true,
        roamPlaylist: data.playlist,
        roamIndex: data.currentIndex,
        playlist: data.playlist,
        currentIndex: data.currentIndex,
        queueSource: 'roam',
      });
    } else {
      usePlayerStore.setState({
        playlist: data.playlist,
        currentIndex: data.currentIndex,
        queueSource: data.queueSource,
        isRoaming: false,
      });
    }
  });

  // lyrics:loaded → 更新独立歌词 Store（不冲刷全局 usePlayerStore）
  on(EVENTS.LYRICS_LOADED, (data) => {
    useLyricsStore.setState({ lyricsData: data.lyrics || [], currentLyricIndex: -1 });
  });

  // cover:update → 更新当前曲目封面（切歌时引擎必发一次，含空值清场）
  on(EVENTS.COVER_UPDATE, (data) => {
    if (data && data.url !== undefined) {
      const coverUrl = data.url || null;
      usePlayerStore.setState({ currentCoverUrl: coverUrl });

      // 如果补拉到了有效封面，自动同步写回 favorites 和 customPlaylists，持久化修复缺失封面
      if (coverUrl && data.key) {
        const { favorites, customPlaylists } = usePlayerStore.getState();
        let favUpdated = false;
        const newFavs = favorites.map(f => {
          const fKey = f.songId || f.id || f.path;
          if (fKey === data.key || ('online_' + fKey) === data.key || fKey === ('online_' + data.key)) {
            if (!f.picUrl || f.picUrl !== coverUrl) {
              favUpdated = true;
              return { ...f, picUrl: coverUrl, pic: coverUrl };
            }
          }
          return f;
        });
        if (favUpdated) {
          usePlayerStore.setState({ favorites: newFavs });
          saveFavorites(newFavs);
        }

        let cpUpdated = false;
        const newPlaylists = customPlaylists.map(pl => {
          if (!pl.tracks) return pl;
          let trackUpdated = false;
          const updatedTracks = pl.tracks.map(t => {
            const tKey = t.songId || t.id || t.path;
            if (tKey === data.key || ('online_' + tKey) === data.key || tKey === ('online_' + data.key)) {
              if (!t.picUrl || t.picUrl !== coverUrl) {
                trackUpdated = true;
                return { ...t, picUrl: coverUrl, pic: coverUrl };
              }
            }
            return t;
          });
          if (trackUpdated) {
            cpUpdated = true;
            return { ...pl, tracks: updatedTracks, updatedAt: Date.now() };
          }
          return pl;
        });
        if (cpUpdated) {
          usePlayerStore.setState({ customPlaylists: newPlaylists });
          saveCustomPlaylists(newPlaylists);
        }
      }
    }
  });

  // lyrics:highlight → 仅更新独立歌词 Store，杜绝后台列表页与 MiniPlayer 无意义重渲染
  on(EVENTS.LYRICS_HIGHLIGHT, (data) => {
    if (data.index !== useLyricsStore.getState().currentLyricIndex) {
      useLyricsStore.setState({ currentLyricIndex: data.index });
    }
  });

  // favorite:toggle → 处理通知栏触发的收藏切换
  on(EVENTS.FAVORITE_TOGGLE, (data) => {
    const { track } = data;
    if (!track) return;
    const favs = [...usePlayerStore.getState().favorites];
    const newFavs = toggleFavorite(track, favs);
    usePlayerStore.getState().setFavorites(newFavs);
    const favorited = isFavorited(track, newFavs);
    MediaSession.updateFavoriteState(favorited);
    usePlayerStore.getState().setToast(favorited ? '已加入我喜欢' : '已从我喜欢移除');
  });

  // favorite:state-change → 通知栏爱心同步
  on(EVENTS.FAVORITE_STATE_CHANGE, () => {});
}

// =====================================================================
// 初始化函数（App 启动时调用）
// =====================================================================

export async function initApp() {
  // 1. 清除旧 URL 缓存（同步，无 I/O）
  clearUrlCache();

  // 2. 初始化 store 订阅
  initStore();

  // 3. 设置 toast 回调
  PlayerEngine.setToastCallback((msg) => {
    usePlayerStore.getState().setToast(msg);
  });

  // 4-5-9. 加载收藏、自建歌单、设置、播放列表（优先命中 NeonKV 原生同步缓存，毫秒级返回）
  const [favs, customPlaylists, settings, savedPlaylist] = await Promise.all([
    loadFavorites(),
    loadCustomPlaylists(),
    loadSettings(),
    loadPlaylist(),
  ]);

  logger.info('Store:initApp', 'settings and storage hydrated', {
    favsCount: favs?.length || 0,
    customPlaylistsCount: customPlaylists?.length || 0,
    savedPlaylistCount: savedPlaylist?.length || 0,
    currentSource: settings.currentSource,
    playSource: settings.playSource,
  });

  usePlayerStore.getState().setFavorites(favs);
  usePlayerStore.setState({ customPlaylists });
  const src = settings.currentSource || settings.searchSource || 'netease';
  const searchSrc = settings.searchSource || src;
  const playSrc = settings.playSource || (src.startsWith('lx:') ? src : 'official');
  usePlayerStore.setState({
    currentSource: src,
    searchSource: searchSrc,
    playSource: playSrc,
    themeMode: settings.themeMode || 'auto',
    musicQuality: settings.musicQuality || 'standard',
    playMode: settings.playMode || 'sequence',
    allowMixWithOthers: settings.allowMixWithOthers || false,
    enableCrossPlatformFailover: settings.enableCrossPlatformFailover !== false,
  });
  PlayerEngine.setCurrentSource(src);
  PlayerEngine.setPlayMode(settings.playMode || 'sequence');
  PlayerEngine.setAllowMixWithOthers(settings.allowMixWithOthers || false);

  // 5.5 预初始化 LX 沙箱（如果播放音源是 LX）
  if (playSrc.startsWith('lx:')) {
    const sourceId = playSrc.slice(3);
    logger.info('Store:initApp', 'LX source detected, warming sandbox', { sourceId });
    waitForSandboxReady(5000).then(ready => {
      if (ready) {
        initLxSource(sourceId).catch(() => {});
      }
    });
  }

  // 6. 初始化音量
  await usePlayerStore.getState().initVolume();

  // 7. 初始化播放引擎（订阅控制事件）
  PlayerEngine.initPlayerEngine();

  // 8. 初始化通知栏
  await MediaSession.initMediaNotification(settings);

  // 9. 设置本地播放列表
  if (savedPlaylist.length > 0) {
    usePlayerStore.setState({ localLibrary: savedPlaylist.map(t => ({ ...t, type: 'local' })) });
  }

  // 10. OkHttp 预连接
  if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
    NativeModules.MediaModule.nativeHttpGet('https://music.163.com/api/toplist', '{}')
      .then(() => {})
      .catch(() => {});
  }
  logger.info('Store:initApp', 'initApp fully completed');
}
