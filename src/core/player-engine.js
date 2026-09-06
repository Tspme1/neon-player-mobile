// 播放引擎 — 从 store/player.js 重构
// 管理单一 Audio.Sound 实例、播放队列、播放模式、漫游模式、切歌流程
// 通过 event-bus emit 状态变化，接收 media-session 控制事件
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeModules, AppState } from 'react-native';
import { EVENTS, emit, on } from './event-bus';
import {
  musicSongUrl,
  neteaseSongUrl,
  neteaseShuffleSongs,
  neteaseLyrics,
} from './source-manager';
import {
  getCachedUrl,
  setCachedUrl,
  loadVolume,
  saveVolume,
  loadSettings,
  saveSettings,
  isFavorited,
  loadRoamPrefs,
  saveRoamPrefs,
  clearRoamPrefs,
} from './storage';
import {
  getCachedFile,
  deleteCachedFile,
  downloadAndCache,
  enforceCacheLimit,
} from './cache-manager';
import { fetchLyrics, updateHighlight, resetLyrics } from './lyrics-engine';

// =====================================================================
// 内部状态
// =====================================================================

let soundObject = null;
let suppressAudioError = false;

// 播放队列
let playlist = [];
let currentIndex = -1;
let queueSource = null;

// 播放模式
let playMode = 'sequence'; // sequence | shuffle | repeat-one

// 漫游模式
let roamPlaylist = [];
let roamIndex = -1;
let isRoaming = false;

// 播放状态
let isPlaying = false;
let position = 0;
let duration = 0;
let volume = 0.8;
let isMuted = false;
let userPaused = false; // true when user explicitly paused (not interrupted by other apps)

// 当前在线歌曲信息
let currentOnlineSong = null;

// 收藏列表引用（由外部通过 setFavorites 设置）
let favorites = [];

// 当前音源（由外部通过 setCurrentSource 设置）
let currentSource = 'netease';

// Toast 回调（由外部设置）
let toastCallback = null;

// =====================================================================
// 音频模式配置
// =====================================================================

let allowMixWithOthers = false;

export function setAllowMixWithOthers(value) {
  allowMixWithOthers = value;
  setupAudio();
  // Notify native layer to skip audio focus acquisition
  try {
    NativeModules.MediaModule?.setSkipAudioFocus(value);
  } catch (e) {
    console.warn('[PlayerEngine] setSkipAudioFocus native call failed:', e);
  }
}

async function setupAudio() {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: !allowMixWithOthers,
      playThroughEarpieceAndroid: false,
      // Android: when true, don't acquire audio focus → other apps keep playing
      // interruptionModeAndroid: 1=DO_NOT_MIX, 2=DUCK_OTHERS
      // When allowMixWithOthers, use DUCK_OTHERS (less aggressive)
      interruptionModeAndroid: allowMixWithOthers ? 2 : 1,
    });
  } catch (e) {
    console.error('[PlayerEngine] Audio mode setup error:', e);
  }
}

// =====================================================================
// 内部辅助函数
// =====================================================================

async function unloadSound() {
  if (soundObject) {
    const oldSound = soundObject;
    soundObject = null;
    try {
      oldSound.setOnPlaybackStatusUpdate(null);
      try {
        await oldSound.pauseAsync();
      } catch {}
      await oldSound.unloadAsync();
    } catch {}
  }
}

function setupPlaybackStatusUpdate() {
  if (!soundObject) return;
  soundObject.setOnPlaybackStatusUpdate((status) => {
    if (status.isLoaded) {
      position = status.positionMillis || 0;
      duration = status.durationMillis || 0;

      // 只在 isPlaying 真正变化时才通知（避免状态抖动）
      const playingChanged = status.isPlaying !== isPlaying;
      if (playingChanged) {
        isPlaying = status.isPlaying;

        // If allowMixWithOthers and playing changed to false without user action,
        // it's an audio focus interruption from another app → resume immediately
        // (Must NOT trigger when track naturally finishes)
        if (!status.isPlaying && !status.didJustFinish && allowMixWithOthers && !userPaused && soundObject) {
          console.log('[PlayerEngine] Audio focus interrupted, resuming immediately');
          soundObject.playAsync().catch(e => {
            console.error('[PlayerEngine] Auto-resume failed:', e);
          });
          Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            staysActiveInBackground: true,
            playsInSilentModeIOS: true,
            shouldDuckAndroid: false,
            playThroughEarpieceAndroid: false,
            interruptionModeAndroid: 2, // DUCK_OTHERS — less aggressive
          }).catch(() => {});
        }
      }

      // 通知位置/时长更新（每次都发，UI 进度条需要）
      emit(EVENTS.PLAYBACK_STATE_CHANGE, {
        position: position,
        duration: duration,
        ...(playingChanged ? { isPlaying: status.isPlaying } : {}),
      });

      // 更新歌词高亮
      const currentTimeSec = (status.positionMillis || 0) / 1000;
      updateHighlight(currentTimeSec);

      // 自动播放下一首
      if (status.didJustFinish) {
        if (soundObject) {
          soundObject.setOnPlaybackStatusUpdate(null);
        }
        if (playMode === 'repeat-one') {
          if (soundObject) soundObject.replayAsync();
        } else {
          playNext();
        }
      }
    } else if (status.error) {
      console.error(`[PlayerEngine] Playback error: ${status.error}`);
      isPlaying = false;
      emit(EVENTS.PLAYBACK_STATE_CHANGE, { isPlaying: false, position, duration });
      showToast('播放异常');
    }
  });
}

function showToast(msg) {
  if (toastCallback) toastCallback(msg);
}

// =====================================================================
// 公开 API — 音量控制
// =====================================================================

export async function initVolume() {
  await setupAudio();
  const vol = await loadVolume();
  volume = vol;
  if (soundObject) {
    await soundObject.setVolumeAsync(vol);
  }
}

export async function setVolume(vol) {
  volume = vol;
  isMuted = vol === 0;
  if (soundObject) {
    await soundObject.setVolumeAsync(vol);
  }
  await saveVolume(vol);
}

export async function toggleMute() {
  if (isMuted || volume === 0) {
    const vol = volume > 0 ? volume : 0.8;
    isMuted = false;
    volume = vol;
    if (soundObject) await soundObject.setVolumeAsync(vol);
  } else {
    isMuted = true;
    if (soundObject) await soundObject.setVolumeAsync(0);
  }
}

export function getVolume() {
  return volume;
}

export function getIsMuted() {
  return isMuted;
}

// =====================================================================
// 公开 API — 队列管理
// =====================================================================

export function setQueue(source, sourceArray, startIndex = 0) {
  queueSource = source;
  playlist = sourceArray.map(t => ({ ...t }));
  currentIndex = startIndex;
  emit(EVENTS.PLAYBACK_QUEUE_CHANGE, { playlist, currentIndex, queueSource: source });
}

export function appendToQueue(source, tracks) {
  for (const track of tracks) {
    if (!playlist.some(t => (t.songId && t.songId === track.songId) || t.path === track.path)) {
      playlist.push({ ...track });
    }
  }
  if (!queueSource) queueSource = source;
  emit(EVENTS.PLAYBACK_QUEUE_CHANGE, { playlist, currentIndex, queueSource });
}

export function getPlaylist() {
  return playlist;
}

export function getCurrentIndex() {
  return currentIndex;
}

export function getQueueSource() {
  return queueSource;
}

// =====================================================================
// 内部辅助 — 本地音频路径解析
// =====================================================================

async function resolveLocalAudioUri(track) {
  if (!track) return null;
  const rawPath = track.path || track.uri || track.cachedPath || '';
  if (!rawPath) return null;

  // 1. content:// 协议直接使用
  if (rawPath.startsWith('content://')) {
    return rawPath;
  }

  // 2. 剥离 file:// 得到纯本地路径
  let cleanPath = rawPath;
  if (cleanPath.startsWith('file://')) {
    cleanPath = cleanPath.slice(7);
  }
  cleanPath = cleanPath.replace(/\\/g, '/');

  // 3. 检查原路径是否存在
  try {
    const info = await FileSystem.getInfoAsync('file://' + cleanPath);
    if (info.exists) {
      return 'file://' + cleanPath;
    }
  } catch {}

  // 4. 从文件名去 documentDirectory 和 cacheDirectory 搜索
  const fileName = cleanPath.split('/').pop();
  if (fileName) {
    const docPath = (FileSystem.documentDirectory || '') + 'local-music/' + fileName;
    try {
      const docInfo = await FileSystem.getInfoAsync(docPath);
      if (docInfo.exists) return docPath;
    } catch {}

    const cachePath = (FileSystem.cacheDirectory || '') + 'local-music/' + fileName;
    try {
      const cacheInfo = await FileSystem.getInfoAsync(cachePath);
      if (cacheInfo.exists) return cachePath;
    } catch {}
  }

  // 5. 回退使用原始 URI
  if (track.originalUri) {
    return track.originalUri;
  }

  return rawPath.startsWith('file://') ? rawPath : ('file://' + rawPath);
}

// =====================================================================
// 公开 API — 播放控制
// =====================================================================

export async function togglePlay() {
  if (currentIndex === -1 && playlist.length > 0) {
    await playTrack(0);
    return;
  }

  const wasPlaying = isPlaying;
  userPaused = wasPlaying; // track user intent
  try {
    if (soundObject) {
      if (wasPlaying) {
        await soundObject.pauseAsync();
        isPlaying = false;
      } else {
        userPaused = false;
        await soundObject.playAsync();
        isPlaying = true;
      }
    } else if (currentIndex >= 0 && currentIndex < playlist.length) {
      // 当前没有 soundObject（例如之前加载失败或未初始化），用户点击播放时重试当前歌曲
      userPaused = false;
      await playTrack(currentIndex);
      return;
    }
  } catch (e) {
    console.error('[PlayerEngine] togglePlay error:', e);
    // 若 playAsync 失败（如音频已被系统中断卸载），尝试重新加载该曲目
    if (!wasPlaying && currentIndex >= 0 && currentIndex < playlist.length) {
      try {
        userPaused = false;
        await playTrack(currentIndex);
        return;
      } catch {}
    }
    isPlaying = false;
  }
  emit(EVENTS.PLAYBACK_STATE_CHANGE, { isPlaying, position, duration });
}

export async function playTrack(index) {
  userPaused = false;
  if (index < 0 || index >= playlist.length) return;
  if (isRoaming && queueSource !== 'roam') stopRoam();

  const track = playlist[index];
  currentIndex = index;
  if (isRoaming) roamIndex = index;

  // 立即 emit TRACK_CHANGE 和 STATE_CHANGE，让 UI 即时显示新曲目信息并置为暂停等待
  isPlaying = false;
  resetLyrics();
  emit(EVENTS.PLAYBACK_TRACK_CHANGE, { track, index, isPlaying: false, isRoaming });
  emit(EVENTS.PLAYBACK_STATE_CHANGE, { isPlaying: false, position: 0, duration: track.duration || 0 });

  // 立即停止并卸载上一首音乐，音乐立马暂停等待下一首
  await unloadSound();

  if (track.type === 'online') {
    await playOnlineSong(track, index);
    return;
  }

  // Local track
  try {
    const playUri = await resolveLocalAudioUri(track);
    if (!playUri) {
      showToast('本地文件不存在或无法访问');
      isPlaying = false;
      emit(EVENTS.PLAYBACK_TRACK_CHANGE, { track, index, isPlaying: false, isRoaming });
      emit(EVENTS.PLAYBACK_STATE_CHANGE, { isPlaying: false, position: 0, duration: 0 });
      return;
    }
    soundObject = new Audio.Sound();
    await soundObject.loadAsync({ uri: playUri });
    await soundObject.setVolumeAsync(volume);
    setupPlaybackStatusUpdate();
    await soundObject.playAsync();
    isPlaying = true;
    currentOnlineSong = null;
    resetLyrics(); // 清空上一首歌词
    emit(EVENTS.PLAYBACK_TRACK_CHANGE, { track, index, isPlaying: true, isRoaming });
    emit(EVENTS.PLAYBACK_STATE_CHANGE, { isPlaying: true, position: 0, duration: track.duration || 0 });
  } catch (e) {
    console.error('[PlayerEngine] playTrack error:', e);
    showToast('播放失败');
    isPlaying = false;
    emit(EVENTS.PLAYBACK_TRACK_CHANGE, { track, index, isPlaying: false, isRoaming });
    emit(EVENTS.PLAYBACK_STATE_CHANGE, { isPlaying: false, position: 0, duration: 0 });
  }
}

export async function playOnlineSong(song, queueIndex = -1) {
  userPaused = false;
  if (isRoaming && queueSource !== 'roam') stopRoam();

  const songId = song.songId || song.id;
  if (!songId) {
    showToast('无法播放:缺少歌曲ID');
    return;
  }

  const source = song._src || song._platform || currentSource || (queueSource || 'netease');
  // 从 song 中提取平台信息（双轴模式）
  const platform = song._platform || (source.startsWith('lx:') ? 'netease' : source);
  const apiSource = source.startsWith('lx:') ? source :
    (['netease', 'tencent', 'kuwo', 'kugou'].includes(source) ? source : 'netease');

  let targetIndex = queueIndex;
  if (targetIndex < 0) {
    targetIndex = playlist.findIndex(t => t.type === 'online' && (t.songId === songId || t.id === songId));
  }
  if (targetIndex >= 0) {
    currentIndex = targetIndex;
    if (isRoaming) roamIndex = targetIndex;
  }

  // ===== [DBG] 播放链路计时 =====
  const _dbgT0 = Date.now();
  const _dbgLog = (label) => console.log(`[DBG] +${Date.now() - _dbgT0}ms ${label}`);
  // 双轴模式：从 settings 获取 playSource，决定用哪个音源获取 URL
  const settings = await loadSettings();
  const playSource = settings.playSource || 'official';
  _dbgLog(`playOnlineSong start: songId=${songId} platform=${platform} playSource=${playSource}`);

  // 立即停止并卸载当前音频（与获取 URL 并行，首次播放时 unloadSound 是空操作）
  isPlaying = false;
  resetLyrics(); // 清空上一首歌词
  emit(EVENTS.PLAYBACK_STATE_CHANGE, { isPlaying: false, position: 0, duration: 0 });

  _dbgLog('unloadSound start');
  await unloadSound();
  _dbgLog('unloadSound done');

  // Check URL cache（用 platform 做 key）
  const cacheKey = `${platform}_${songId}`;
  let songUrlData = getCachedUrl(cacheKey);
  if (songUrlData) _dbgLog('URL cache hit');

  // URL 缓存缺失时，先检查文件缓存
  let cachedFilePath = null;
  if (!songUrlData) {
    cachedFilePath = await getCachedFile(platform, songId);
    if (cachedFilePath) _dbgLog('File cache hit');
  }
  const hasFileCache = !!cachedFilePath;

  // 卸载旧音频与获取 URL 并行
  let urlPromise = null;
  if (!songUrlData) {
    if (!hasFileCache) {
      showToast('正在获取歌曲链接...');
    }
    _dbgLog('musicSongUrl start');
    urlPromise = Promise.race([
      musicSongUrl(playSource, { ...song, songId, _platform: platform }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('获取链接超时(30s)')), 30000)
      ),
    ]).then(r => { _dbgLog(`musicSongUrl done: ${r ? 'has url' : 'null'}`); return r; }).catch(() => null);
  }

  if (urlPromise) {
    songUrlData = await urlPromise;
  }
  if (!songUrlData || !songUrlData.url) {
      // LX 音源失败：直接报错，不回退官方 API（用户要求）
      const fee = song.fee || 0;
      if (playSource.startsWith('lx:')) {
        showToast('⚠️ 当前播放音源获取失败，请切换播放音源');
        _dbgLog('ABORT: LX playSource failed, no fallback');
      } else {
        showToast(fee === 1 || fee === 8 ? '此歌曲为 VIP 专享,无法播放' : '无法获取歌曲链接');
        _dbgLog('ABORT: no url');
      }
      isPlaying = false;
      emit(EVENTS.PLAYBACK_TRACK_CHANGE, { track: song, index: targetIndex, isPlaying: false, isRoaming: isRoaming || queueSource === 'roam' });
      emit(EVENTS.PLAYBACK_STATE_CHANGE, { isPlaying: false, position: 0, duration: 0 });
      return;
  }
  setCachedUrl(cacheKey, songUrlData);

  // 检查在此期间是否有其他播放请求介入
  if (currentIndex !== targetIndex) return;

  try {
    soundObject = new Audio.Sound();

    // 优先使用文件缓存（复用前面已查过的 cachedFilePath，避免重复 I/O）
    let playUri = songUrlData.url;
    let usedFileCache = false;
    if (!songUrlData.isLocal && cachedFilePath) {
      playUri = cachedFilePath;
      usedFileCache = true;
    }

    // 前后台差异化策略：前台流式播放（快），后台先下载再播放（稳）
    const isBackground = AppState.currentState === 'background';
    _dbgLog(`AppState: ${isBackground ? 'background' : 'active'}, playUri: ${playUri === songUrlData.url ? 'remote' : 'local'}`);
    if (!songUrlData.isLocal && !usedFileCache) {
      if (isBackground) {
        // 后台：先下载到本地再播放（避免 expo-av 后台加载远程 URL 失败）
        _dbgLog('BG: downloadAndCache start');
        try {
          const downloadedPath = await downloadAndCache(platform, songId, songUrlData.url);
          _dbgLog(`BG: downloadAndCache done: ${downloadedPath ? 'ok' : 'null'}`);
          if (downloadedPath) {
            playUri = downloadedPath;
            usedFileCache = true;
          }
        } catch (e) {
          _dbgLog(`BG: downloadAndCache error: ${e.message}`);
        }
      } else {
        // 前台：直接用远程 URL 流式播放（ExoPlayer 缓冲快，几百毫秒出声）
        // 异步下载缓存，不影响当前播放速度，下次播放同一首歌走本地文件
        downloadAndCache(platform, songId, songUrlData.url).then(() => {
          loadSettings().then(s => {
            enforceCacheLimit(s.cacheLimitMB || 500);
          });
        }).catch(() => {});
      }
    }

    const uri = songUrlData.isLocal
      ? 'file:///' + songUrlData.url.replace(/\\/g, '/')
      : playUri;

    const loadStart = Date.now();
    _dbgLog('loadAsync start');
    try {
      await soundObject.loadAsync({ uri });
      _dbgLog(`loadAsync done: ${Date.now() - loadStart}ms`);
    } catch (loadErr) {
      // 文件缓存可能损坏，删除后用原始 URL 重试
      if (usedFileCache) {
        await deleteCachedFile(platform, songId);
        await soundObject.unloadAsync();
        soundObject = new Audio.Sound();
        await soundObject.loadAsync({ uri: songUrlData.url });
      } else {
        throw loadErr;
      }
    }

    // 先播放出声，再设置音量（音量已被 initVolume 设好，不阻塞播放启动）
    setupPlaybackStatusUpdate();
    _dbgLog('playAsync start');
    await soundObject.playAsync();
    _dbgLog(`playAsync done: +${Date.now() - _dbgT0}ms total`);
    await soundObject.setVolumeAsync(volume);

    isPlaying = true;
    currentOnlineSong = { id: songId, name: song.name, artist: song.artist };

    // 记录漫游偏好（如果当前是漫游模式）
    if (queueSource === 'roam' || isRoaming) {
      recordRoamPref(song);
    }

    emit(EVENTS.PLAYBACK_TRACK_CHANGE, { track: song, index: targetIndex, isPlaying: true, isRoaming: isRoaming || queueSource === 'roam' });
    emit(EVENTS.PLAYBACK_STATE_CHANGE, { isPlaying: true, position: 0, duration: song.duration || 0 });

    // Fetch lyrics
    fetchLyrics(songId);

    // 已有文件缓存时，检查缓存限额
    if (!songUrlData.isLocal && usedFileCache) {
      // 已有文件缓存，检查缓存限额
      loadSettings().then(s => {
        enforceCacheLimit(s.cacheLimitMB || 500);
      });
    }
  } catch (e) {
    console.error('[PlayerEngine] playOnlineSong error:', e);
    showToast('播放失败');
    isPlaying = false;
    emit(EVENTS.PLAYBACK_TRACK_CHANGE, { track: song, index: targetIndex, isPlaying: false, isRoaming: isRoaming || queueSource === 'roam' });
    emit(EVENTS.PLAYBACK_STATE_CHANGE, { isPlaying: false, position: 0, duration: 0 });
  }
}

export async function playPrevious() {
  userPaused = false;
  if (playlist.length === 0) return;
  let prev;
  if (playMode === 'shuffle') {
    prev = Math.floor(Math.random() * playlist.length);
  } else {
    prev = (currentIndex - 1 + playlist.length) % playlist.length;
  }
  await playTrack(prev);
}

export async function playNext() {
  userPaused = false;
  if (playlist.length === 0) return;
  let next;
  if (playMode === 'shuffle') {
    do {
      next = Math.floor(Math.random() * playlist.length);
    } while (next === currentIndex && playlist.length > 1);
  } else {
    next = currentIndex + 1;
    if (next >= playlist.length) {
      if (queueSource === 'roam' || isRoaming) {
        // 漫游播完一轮，自动拉取新一轮漫游歌曲
        await startRoam();
        return;
      }
      next = 0; // 顺序播放循环
    }
  }
  await playTrack(next);
}

export function cyclePlayMode() {
  const modes = ['sequence', 'shuffle', 'repeat-one'];
  const labels = { 'sequence': '顺序播放', 'shuffle': '随机播放', 'repeat-one': '单曲循环' };
  const currentIdx = modes.indexOf(playMode);
  playMode = modes[(currentIdx + 1) % modes.length];
  showToast(labels[playMode]);
  loadSettings().then(settings => {
    settings.playMode = playMode;
    saveSettings(settings);
  }).catch(() => {});
  return playMode;
}

export function getPlayMode() {
  return playMode;
}

export function setPlayMode(mode) {
  playMode = mode;
}

// =====================================================================
// 公开 API — 漫游模式
// =====================================================================

export async function startRoam() {
  showToast('加载漫游歌曲...');
  const rawSongs = await neteaseShuffleSongs();
  if (!rawSongs || rawSongs.length === 0) {
    showToast('无法获取漫游歌曲,请稍后重试');
    return;
  }

  // 标准化歌曲对象字段
  const songs = rawSongs.map(s => ({
    ...s,
    songId: s.id,
    _platform: 'netease',
    _src: 'netease',
    type: 'online',
  }));

  // 根据偏好排序漫游歌曲
  try {
    const prefs = await loadRoamPrefs();
    if (prefs.artists && Object.keys(prefs.artists).length > 0) {
      // 根据歌手偏好打分排序
      const artistScores = prefs.artists;
      songs.sort((a, b) => {
        const aScore = artistScores[a.artist] || 0;
        const bScore = artistScores[b.artist] || 0;
        return bScore - aScore;
      });
      // 取前 30 首混合打乱（保持偏好但增加多样性）
      const top = songs.slice(0, 30);
      const rest = songs.slice(30);
      // shuffle top half
      for (let i = top.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [top[i], top[j]] = [top[j], top[i]];
      }
      roamPlaylist = [...top, ...rest];
    } else {
      roamPlaylist = songs;
    }
  } catch {
    roamPlaylist = songs;
  }

  isRoaming = true;
  roamIndex = 0;
  setQueue('roam', roamPlaylist, 0);
  await playTrack(0);
}

export function stopRoam() {
  isRoaming = false;
  if (queueSource === 'roam') {
    queueSource = null;
    playlist = [];
    currentIndex = -1;
  }
  roamPlaylist = [];
  roamIndex = -1;
  currentOnlineSong = null;
  isPlaying = false;
  unloadSound();
  emit(EVENTS.PLAYBACK_STATE_CHANGE, { isPlaying: false, position: 0, duration: 0 });
  emit(EVENTS.PLAYBACK_QUEUE_CHANGE, { playlist: [], currentIndex: -1, queueSource: null });
}

export async function resetRoamPrefs() {
  await clearRoamPrefs();
  showToast('漫游偏好已重置');
}

async function recordRoamPref(song) {
  try {
    const prefs = await loadRoamPrefs();
    // 记录歌手播放次数
    if (song.artist) {
      prefs.artists[song.artist] = (prefs.artists[song.artist] || 0) + 1;
    }
    prefs.playCount = (prefs.playCount || 0) + 1;
    // 限制偏好大小
    const artistEntries = Object.entries(prefs.artists);
    if (artistEntries.length > 200) {
      artistEntries.sort((a, b) => b[1] - a[1]);
      prefs.artists = Object.fromEntries(artistEntries.slice(0, 100));
    }
    await saveRoamPrefs(prefs);
  } catch (e) {
    // silent fail
  }
}

export async function playRoamSong(index) {
  if (index < 0 || index >= playlist.length) return;
  roamIndex = index;
  await playTrack(index);
}

export function playRoamNext() {
  playNext();
}

export function getIsRoaming() {
  return isRoaming || queueSource === 'roam';
}

export function getRoamPlaylist() {
  return (isRoaming || queueSource === 'roam') ? playlist : roamPlaylist;
}

export function getRoamIndex() {
  return (isRoaming || queueSource === 'roam') ? currentIndex : roamIndex;
}

// =====================================================================
// 公开 API — Seek
// =====================================================================

export async function seekTo(positionMs) {
  if (soundObject) {
    await soundObject.setPositionAsync(positionMs);
  }
  position = positionMs;
  // 主动更新歌词高亮
  updateHighlight(positionMs / 1000);
  emit(EVENTS.PLAYBACK_STATE_CHANGE, { position: positionMs, duration, isPlaying });
}

// =====================================================================
// 公开 API — 状态查询
// =====================================================================

export function getIsPlaying() {
  return isPlaying;
}

export function getPosition() {
  return position;
}

export function getDuration() {
  return duration;
}

export function getCurrentOnlineSong() {
  return currentOnlineSong;
}

// =====================================================================
// 公开 API — 外部引用注入
// =====================================================================

/**
 * 设置收藏列表引用（用于通知栏更新喜欢状态）
 */
export function setFavorites(favs) {
  favorites = favs;
}

/**
 * 设置当前音源
 */
export function setCurrentSource(src) {
  currentSource = src || 'netease';
}

/**
 * 设置 Toast 回调
 */
export function setToastCallback(cb) {
  toastCallback = cb;
}

// =====================================================================
// 媒体控制事件订阅（来自 media-session）
// =====================================================================

let controlUnsub = null;

/**
 * 初始化播放引擎，订阅控制事件
 */
export function initPlayerEngine() {
  if (controlUnsub) return;
  controlUnsub = on(EVENTS.PLAYBACK_CONTROL, (data) => {
    const { action } = data;
    switch (action) {
      case 'play':
        if (!isPlaying) togglePlay();
        break;
      case 'pause':
        if (isPlaying) togglePlay();
        break;
      case 'next':
        playNext();
        break;
      case 'prev':
        playPrevious();
        break;
      case 'stop':
        stopRoam();
        unloadSound();
        isPlaying = false;
        emit(EVENTS.PLAYBACK_STATE_CHANGE, { isPlaying: false, position: 0, duration: 0 });
        break;
      case 'favorite': {
        const track = isRoaming ? roamPlaylist[roamIndex] : playlist[currentIndex];
        if (track) emit(EVENTS.FAVORITE_TOGGLE, { track });
        break;
      }
    }
  });
}

/**
 * 清理播放引擎
 */
export async function cleanup() {
  if (controlUnsub) {
    controlUnsub();
    controlUnsub = null;
  }
  await unloadSound();
}

export default {
  initVolume,
  setVolume,
  toggleMute,
  setQueue,
  appendToQueue,
  togglePlay,
  playTrack,
  playOnlineSong,
  playPrevious,
  playNext,
  cyclePlayMode,
  seekTo,
  startRoam,
  stopRoam,
  resetRoamPrefs,
  playRoamSong,
  playRoamNext,
  cleanup,
  initPlayerEngine,
  setFavorites,
  setCurrentSource,
  setToastCallback,
  getPlaylist,
  getCurrentIndex,
  getIsPlaying,
  getPosition,
  getDuration,
  getPlayMode,
  setPlayMode,
  getIsRoaming,
  getRoamPlaylist,
  getRoamIndex,
  getCurrentOnlineSong,
  getVolume,
  getIsMuted,
  getQueueSource,
};
