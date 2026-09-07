// 状态 Store — 从 event-bus 订阅 core 模块状态，供 UI 组件使用
// 不再管理播放逻辑，只做状态镜像 + UI 状态
import { create } from 'zustand';
import { NativeModules } from 'react-native';
import { EVENTS, on, off } from '../core/event-bus';
import * as PlayerEngine from '../core/player-engine';
import * as MediaSession from '../core/media-session';
import * as SourceManager from '../core/source-manager';
import {
  loadFavorites, saveFavorites, toggleFavorite, isFavorited,
  loadSettings, saveSettings, loadPlaylist, savePlaylist,
  loadCustomPlaylists, saveCustomPlaylists, createPlaylistObject,
  addTrackToPlaylistData, removeTrackFromPlaylistData, isTrackInPlaylist,
  clearUrlCache,
} from '../core/storage';
import { getCacheSize, clearCache } from '../core/cache-manager';
import { formatCacheSize } from '../utils/format';
import { waitForSandboxReady, initLxSource } from '../services/lx-webview-manager';

// =====================================================================
// Store 定义
// =====================================================================

export const usePlayerStore = create((set, get) => ({
  // === 播放状态（从 player-engine 镜像） ===
  isPlaying: false,
  position: 0,
  duration: 0,
  currentIndex: -1,
  playlist: [],
  queueSource: null,
  playMode: 'sequence',
  isRoaming: false,
  roamPlaylist: [],
  roamIndex: -1,
  currentOnlineSong: null,
  volume: 0.8,
  isMuted: false,

  // === 歌词 ===
  lyricsData: [],
  currentLyricIndex: -1,

  // === 封面（当前播放曲目，来自搜索直出/异步补拉） ===
  currentCoverUrl: null,

  // === 收藏与歌单 ===
  favorites: [],
  customPlaylists: [],
  currentPlaylistId: 'favorites', // 'favorites' 或 自建歌单 id
  addToPlaylistModalVisible: false,
  trackToAdd: null,

  // === 本地音乐 ===
  localLibrary: [],

  // === 搜索 ===
  searchResultsData: [],
  currentSource: 'netease',
  searchSource: 'netease',   // 左轴：搜索来源
  playSource: 'official',    // 右轴：播放音源

  // === 主题 ===
  themeMode: 'auto',         // 'light' | 'dark' | 'auto'

  // === 音质 ===
  musicQuality: 'standard',  // 'low' | 'standard' | 'high' | 'lossless'

  // === 播放模式 ===
  allowMixWithOthers: false,  // 允许与其他应用同时播放

  // === 发现页 ===
  toplistData: [],
  toplistDetailData: null,
  hotData: [],
  discoverSubTab: 'toplist',
  activeTab: 'local',

  // === UI 状态 ===
  settingsVisible: false,
  showToast: false,
  toastMessage: '',
  pendingUpdateInfo: null,

  // =====================================================================
  // Actions
  // =====================================================================

  setToast(msg) {
    set({ showToast: true, toastMessage: msg });
    if (msg) {
      if (window._toastTimer) clearTimeout(window._toastTimer);
      window._toastTimer = setTimeout(() => set({ showToast: false }), 3000);
    }
  },

  setSettingsVisible(visible) {
    set({ settingsVisible: visible });
  },

  setFavorites(favs) {
    set({ favorites: favs });
    PlayerEngine.setFavorites(favs);
    MediaSession.setFavoritesRef(favs);
    saveFavorites(favs);
  },

  // === 自建歌单 Actions ===
  setCustomPlaylists(playlists) {
    set({ customPlaylists: playlists });
    saveCustomPlaylists(playlists);
  },

  setCurrentPlaylistId(id) {
    set({ currentPlaylistId: id || 'favorites' });
  },

  createPlaylist(name) {
    const newPlaylist = createPlaylistObject(name);
    const updated = [newPlaylist, ...get().customPlaylists];
    set({ customPlaylists: updated, currentPlaylistId: newPlaylist.id });
    saveCustomPlaylists(updated);
    get().setToast(`已创建歌单「${newPlaylist.name}」`);
    return newPlaylist;
  },

  deletePlaylist(playlistId) {
    const list = get().customPlaylists;
    const target = list.find(p => p.id === playlistId);
    const updated = list.filter(p => p.id !== playlistId);
    const currentId = get().currentPlaylistId;
    const nextCurrentId = currentId === playlistId ? 'favorites' : currentId;
    set({ customPlaylists: updated, currentPlaylistId: nextCurrentId });
    saveCustomPlaylists(updated);
    if (target) {
      get().setToast(`已删除歌单「${target.name}」`);
    }
  },

  renamePlaylist(playlistId, newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed) return;
    const updated = get().customPlaylists.map(p => {
      if (p.id === playlistId) {
        return { ...p, name: trimmed, updatedAt: Date.now() };
      }
      return p;
    });
    set({ customPlaylists: updated });
    saveCustomPlaylists(updated);
    get().setToast(`歌单已重命名为「${trimmed}」`);
  },

  addTrackToPlaylist(playlistId, track) {
    if (playlistId === 'favorites') {
      const favs = [...get().favorites];
      const added = toggleFavorite(track, favs);
      get().setFavorites(added);
      get().setToast(isFavorited(track, added) ? '已加入我喜欢' : '已从我喜欢移除');
      return true;
    }

    const list = [...get().customPlaylists];
    const target = list.find(p => p.id === playlistId);
    if (!target) return false;

    const added = addTrackToPlaylistData(target, track);
    if (added) {
      set({ customPlaylists: list });
      saveCustomPlaylists(list);
      get().setToast(`已添加到「${target.name}」`);
      return true;
    } else {
      get().setToast(`歌曲已在「${target.name}」中`);
      return false;
    }
  },

  removeTrackFromPlaylist(playlistId, trackIdOrSongId) {
    if (playlistId === 'favorites') {
      const favs = [...get().favorites];
      const idx = favs.findIndex(f => f.id === trackIdOrSongId || f.songId === trackIdOrSongId || f.path === trackIdOrSongId);
      if (idx >= 0) {
        favs.splice(idx, 1);
        get().setFavorites(favs);
        get().setToast('已从我喜欢移除');
      }
      return;
    }

    const list = [...get().customPlaylists];
    const target = list.find(p => p.id === playlistId);
    if (!target) return;

    removeTrackFromPlaylistData(target, trackIdOrSongId);
    set({ customPlaylists: list });
    saveCustomPlaylists(list);
    get().setToast('已从歌单移除');
  },

  openAddToPlaylist(track) {
    set({ trackToAdd: track, addToPlaylistModalVisible: true });
  },

  closeAddToPlaylist() {
    set({ addToPlaylistModalVisible: false, trackToAdd: null });
  },

  setLocalLibrary(library) {
    set({ localLibrary: library });
    savePlaylist(library);
  },

  setSearchResults(results) {
    set({ searchResultsData: results });
  },

  setCurrentSource: async (source) => {
    set({ currentSource: source });
    PlayerEngine.setCurrentSource(source);
    try {
      const settings = await loadSettings();
      settings.currentSource = source;
      // 同步双轴字段（向后兼容）
      if (source.startsWith('lx:')) {
        settings.playSource = source;
      } else {
        settings.searchSource = source;
        settings.playSource = 'official';
      }
      await saveSettings(settings);
    } catch (e) {
      console.error('[Store] Failed to persist currentSource:', e);
    }
  },

  setSearchSource: async (source) => {
    set({ searchSource: source, currentSource: source });
    PlayerEngine.setCurrentSource(source);
    try {
      const settings = await loadSettings();
      settings.searchSource = source;
      settings.currentSource = source;
      await saveSettings(settings);
    } catch (e) {
      console.error('[Store] Failed to persist searchSource:', e);
    }
  },

  setPlaySource: async (source) => {
    set({ playSource: source, currentSource: source });
    PlayerEngine.setCurrentSource(source);
    try {
      const settings = await loadSettings();
      settings.playSource = source;
      settings.currentSource = source;
      await saveSettings(settings);
    } catch (e) {
      console.error('[Store] Failed to persist playSource:', e);
    }
  },

  setThemeMode: async (mode) => {
    set({ themeMode: mode });
    try {
      const settings = await loadSettings();
      settings.themeMode = mode;
      await saveSettings(settings);
    } catch (e) {
      console.error('[Store] Failed to persist themeMode:', e);
    }
  },

  setMusicQuality: async (quality) => {
    set({ musicQuality: quality });
    try {
      const settings = await loadSettings();
      settings.musicQuality = quality;
      await saveSettings(settings);
    } catch (e) {
      console.error('[Store] Failed to persist musicQuality:', e);
    }
  },

  setAllowMixWithOthers: async (value) => {
    set({ allowMixWithOthers: value });
    PlayerEngine.setAllowMixWithOthers(value);
    try {
      const settings = await loadSettings();
      settings.allowMixWithOthers = value;
      await saveSettings(settings);
    } catch (e) {
      console.error('[Store] Failed to persist allowMixWithOthers:', e);
    }
  },

  setToplistData(data) {
    set({ toplistData: data });
  },

  setToplistDetailData(data) {
    set({ toplistDetailData: data });
  },

  setHotData(data) {
    set({ hotData: data });
  },

  setDiscoverSubTab(tab) {
    set({ discoverSubTab: tab });
  },

  setActiveTab(tab) {
    set({ activeTab: tab });
  },

  // === 播放控制（代理到 PlayerEngine） ===
  setQueue(source, tracks, startIndex) {
    PlayerEngine.setQueue(source, tracks, startIndex);
  },

  appendToQueue(source, tracks) {
    PlayerEngine.appendToQueue(source, tracks);
  },

  togglePlay() {
    PlayerEngine.togglePlay();
  },

  playTrack(index) {
    PlayerEngine.playTrack(index);
  },

  playOnlineSong(song, index) {
    PlayerEngine.playOnlineSong(song, index);
  },

  playPrevious() {
    PlayerEngine.playPrevious();
  },

  playNext() {
    PlayerEngine.playNext();
  },

  cyclePlayMode() {
    const mode = PlayerEngine.cyclePlayMode();
    set({ playMode: mode });
    loadSettings().then(settings => {
      settings.playMode = mode;
      saveSettings(settings);
    }).catch(() => {});
    return mode;
  },

  seekTo(positionMs) {
    PlayerEngine.seekTo(positionMs);
  },

  startRoam() {
    PlayerEngine.startRoam();
  },

  stopRoam() {
    PlayerEngine.stopRoam();
  },

  playRoamSong(index) {
    PlayerEngine.playRoamSong(index);
  },

  cleanup() {
    PlayerEngine.cleanup();
  },

  setVolume(vol) {
    PlayerEngine.setVolume(vol);
    set({ volume: vol, isMuted: vol === 0 });
  },

  toggleMute() {
    PlayerEngine.toggleMute();
    set({ volume: PlayerEngine.getVolume(), isMuted: PlayerEngine.getIsMuted() });
  },

  initVolume() {
    PlayerEngine.initVolume().then(() => {
      set({ volume: PlayerEngine.getVolume(), isMuted: PlayerEngine.getIsMuted() });
    });
  },

  // =====================================================================
  // 初始化：订阅 event-bus 事件
  // =====================================================================
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
    const update = {};
    if (data.isPlaying !== undefined) update.isPlaying = data.isPlaying;
    if (data.position !== undefined) update.position = data.position;
    if (data.duration !== undefined) update.duration = data.duration;
    if (Object.keys(update).length > 0) {
      usePlayerStore.setState(update);
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
    // 切歌时同步播放状态
    if (data.isPlaying !== undefined) update.isPlaying = data.isPlaying;
    // 同步播放列表和索引
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

  // lyrics:loaded → 更新歌词数据
  on(EVENTS.LYRICS_LOADED, (data) => {
    usePlayerStore.setState({ lyricsData: data.lyrics, currentLyricIndex: -1 });
  });

  // cover:update → 更新当前曲目封面（切歌时引擎必发一次，含空值清场）
  on(EVENTS.COVER_UPDATE, (data) => {
    if (data && data.url !== undefined) {
      usePlayerStore.setState({ currentCoverUrl: data.url || null });
    }
  });

  // lyrics:highlight → 更新当前歌词行
  on(EVENTS.LYRICS_HIGHLIGHT, (data) => {
    usePlayerStore.setState({ currentLyricIndex: data.index });
  });

  // favorite:toggle → 处理通知栏触发的收藏切换
  on(EVENTS.FAVORITE_TOGGLE, (data) => {
    const { track } = data;
    if (!track) return;
    const favs = [...usePlayerStore.getState().favorites];
    const newFavs = toggleFavorite(track, favs);
    usePlayerStore.getState().setFavorites(newFavs);
    // 通知通知栏更新爱心状态
    const favorited = isFavorited(track, newFavs);
    MediaSession.updateFavoriteState(favorited);
    usePlayerStore.getState().setToast(favorited ? '已加入我喜欢' : '已从我喜欢移除');
  });

  // favorite:state-change → 通知栏爱心同步
  on(EVENTS.FAVORITE_STATE_CHANGE, (data) => {
    // 由 media-session 内部处理，store 不需要额外动作
  });
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

  // 4-5-9. 并行加载收藏、自建歌单、设置、播放列表（无依赖关系）
  const [favs, customPlaylists, settings, savedPlaylist] = await Promise.all([
    loadFavorites(),
    loadCustomPlaylists(),
    loadSettings(),
    loadPlaylist(),
  ]);

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
  });
  PlayerEngine.setCurrentSource(src);
  PlayerEngine.setPlayMode(settings.playMode || 'sequence');
  PlayerEngine.setAllowMixWithOthers(settings.allowMixWithOthers || false);

  // 5.5 预初始化 LX 沙箱（如果播放音源是 LX）
  if (playSrc.startsWith('lx:')) {
    const sourceId = playSrc.slice(3);
    // 等 WebView 就绪（最多 5 秒），不阻塞主流程
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

  // 8. 初始化通知栏（传入已加载的 settings，避免重复 AsyncStorage 读取）
  await MediaSession.initMediaNotification(settings);

  // 9. 设置本地播放列表
  if (savedPlaylist.length > 0) {
    usePlayerStore.setState({ localLibrary: savedPlaylist.map(t => ({ ...t, type: 'local' })) });
  }

  // 10. OkHttp 预连接（并行，不阻塞主流程）
  if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
    NativeModules.MediaModule.nativeHttpGet('https://music.163.com/api/toplist', '{}')
      .then(() => {})
      .catch(() => {});
  }
}
