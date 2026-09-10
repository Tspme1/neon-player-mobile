// 歌词引擎 — 支持全平台（网易云、QQ音乐、酷狗、酷我、本地文件、LX自定义音源及跨源兜底）
// 提供歌词获取、解析、高亮更新、内存缓存、防并发竞态控制，通过 event-bus 通知外部

import { parseLyrics, findCurrentLyricIndex } from '../utils/lyrics';
import {
  neteaseLyrics,
  tencentLyrics,
  kugouLyrics,
  kuwoLyrics,
  searchFallbackLyrics,
} from './source-manager';
import { getLxLyricWebView } from '../services/lx-webview-manager';
import { loadSettings } from './storage';
import { EVENTS, emit } from './event-bus';
import { AppState } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import logger from './logger';

// =====================================================================
// 歌词状态（模块内部）
// =====================================================================

let lyricsData = [];
let currentLyricIndex = -1;
let currentSongKey = '';
let activeRequestToken = 0;
const lyricsCache = new Map(); // key -> parsed lyrics array (max 200 items)

// =====================================================================
// 辅助方法
// =====================================================================

/**
 * 生成歌曲唯一标识缓存 key
 */
function getTrackKey(track) {
  if (!track) return '';
  if (typeof track === 'string' || typeof track === 'number') return `netease_${track}`;
  if (track.type === 'local' || (!track.type && (track.path || track.cachedPath))) {
    return `local_${track.title || track.name || ''}_${track.artist || ''}_${track.path || track.cachedPath || ''}`;
  }
  const platform = track._platform || track._src || 'netease';
  const id = track.songId || track.id || track.songmid || track.hash || '';
  return `${platform}_${id}`;
}

/**
 * 尝试读取本地同名 .lrc 文件
 */
async function readLocalLrc(track) {
  const rawPath = track.cachedPath || track.path || track.uri || '';
  if (!rawPath) return null;
  const lrcCandidates = [];
  if (rawPath.includes('.')) {
    lrcCandidates.push(rawPath.replace(/\.[^.]+$/, '.lrc'));
  }
  lrcCandidates.push(rawPath + '.lrc');

  for (const candidate of lrcCandidates) {
    try {
      const clean = candidate.replace(/\\/g, '/');
      const uri = clean.startsWith('file://') ? clean : (clean.startsWith('/') ? 'file://' + clean : clean);
      const info = await FileSystem.getInfoAsync(uri);
      if (info && info.exists) {
        const content = await FileSystem.readAsStringAsync(uri, { encoding: 'utf8' });
        if (content && content.trim()) {
          return { lrc: content, tlyric: '' };
        }
      }
    } catch {
      // 忽略文件读取错误
    }
  }
  return null;
}

// =====================================================================
// 公开 API
// =====================================================================

/**
 * 获取歌词（多源路由 + 官方原源保障 + 跨源同名搜索兜底 + 内存缓存）
 * 获取成功后通过 event-bus emit `lyrics:loaded`
 * @param {Object|string|number} trackOrSongId 歌曲对象或歌曲ID
 * @returns {Promise<Array>} 歌词数组
 */
export async function fetchLyrics(trackOrSongId) {
  const reqToken = ++activeRequestToken;

  if (!trackOrSongId) {
    lyricsData = [];
    currentLyricIndex = -1;
    currentSongKey = '';
    emit(EVENTS.LYRICS_LOADED, { lyrics: [], songId: null, track: null });
    return [];
  }

  // 统一转为歌曲对象
  let track = trackOrSongId;
  if (typeof trackOrSongId === 'string' || typeof trackOrSongId === 'number') {
    track = { id: trackOrSongId, songId: trackOrSongId, _src: 'netease', type: 'online' };
  }

  const key = getTrackKey(track);

  // 1. 检查内存缓存
  if (key && lyricsCache.has(key)) {
    const cached = lyricsCache.get(key);
    lyricsData = cached;
    currentLyricIndex = -1;
    currentSongKey = key;
    emit(EVENTS.LYRICS_LOADED, { lyrics: cached, songId: track.songId || track.id, track });
    return cached;
  }

  try {
    let lrcRes = null;
    let parsed = [];
    const isLocal = track.type === 'local' || (!track.type && (track.path || track.cachedPath));

    if (isLocal) {
      // 本地歌曲优先查找同目录 .lrc
      lrcRes = await readLocalLrc(track);
      if (lrcRes && lrcRes.lrc) {
        parsed = parseLyrics(lrcRes.lrc, lrcRes.tlyric);
      }
    } else {
      // 在线歌曲
      const platform = track._platform || track._src || 'netease';
      const songId = track.songId || track.id || track.songmid || track.hash;
      logger.info('LyricsEngine', 'fetchLyrics online', { platform, songId });

      // 1. 优先尝试 LX 自定义音源（如果已配置）
      try {
        const settings = await loadSettings();
        const playSource = settings.playSource || 'official';
        if (playSource.startsWith('lx:')) {
          const lxSourceId = playSource.replace('lx:', '');
          const lxResult = await getLxLyricWebView(lxSourceId, track, platform);
          if (lxResult && lxResult.lrc) {
            const testParsed = parseLyrics(lxResult.lrc, lxResult.tlyric);
            if (testParsed && testParsed.length > 0) {
              lrcRes = lxResult;
              parsed = testParsed;
              logger.info('LyricsEngine', 'LX lyric fetched successfully', { lines: parsed.length });
            } else {
              logger.warn('LyricsEngine', 'LX lyric returned unparseable content, fallback to official');
            }
          }
        }
      } catch (e) {
        logger.warn('LyricsEngine', 'LX lyric attempt failed', e?.message);
      }

      // 2. 如果 LX 音源未返回有效歌词，强制回退至原平台官方专属接口（按精确歌曲 ID 查询，100% 准确原版）
      if (!parsed || parsed.length === 0) {
        logger.info('LyricsEngine', 'official lyric request', { platform, songId });
        try {
          if (platform === 'netease' && songId) {
            lrcRes = await neteaseLyrics(songId);
          } else if (platform === 'tencent') {
            const songmid = track.songmid || songId;
            lrcRes = await tencentLyrics(songmid);
          } else if (platform === 'kugou') {
            lrcRes = await kugouLyrics(track);
          } else if (platform === 'kuwo') {
            lrcRes = await kuwoLyrics(songId);
          }
          if (lrcRes && lrcRes.lrc) {
            parsed = parseLyrics(lrcRes.lrc, lrcRes.tlyric);
            if (parsed && parsed.length > 0) {
              logger.info('LyricsEngine', 'Official lyric parsed successfully', { platform, lines: parsed.length });
            }
          }
        } catch (err) {
          logger.warn('LyricsEngine', 'Official lyric request failed', err?.message);
        }
      }
    }

    // 3. 跨源同名搜索兜底（仅当专属源与官方接口均未获取到有效歌词时触发）
    if (!parsed || parsed.length === 0) {
      const title = track.name || track.title || '';
      const artist = track.artist || '';
      if (title) {
        logger.info('LyricsEngine', 'Dedicated lyric missing, start fallback search', { title, artist });
        const fallbackRes = await searchFallbackLyrics(title, artist);
        if (fallbackRes && fallbackRes.lrc) {
          parsed = parseLyrics(fallbackRes.lrc, fallbackRes.tlyric);
          logger.info('LyricsEngine', 'Fallback lyric matched and parsed', { lines: parsed.length });
        }
      }
    }

    // 3. 竞态检查：如果在异步等待期间用户切了歌，丢弃此次响应
    if (reqToken !== activeRequestToken) {
      return [];
    }

    lyricsData = parsed || [];
    logger.info('LyricsEngine', 'Lyrics ready', { lines: lyricsData.length, key });
    currentLyricIndex = -1;
    currentSongKey = key;

    // 写入缓存
    if (key && lyricsData.length > 0) {
      lyricsCache.set(key, lyricsData);
      if (lyricsCache.size > 200) {
        const firstKey = lyricsCache.keys().next().value;
        lyricsCache.delete(firstKey);
      }
    }

    emit(EVENTS.LYRICS_LOADED, { lyrics: lyricsData, songId: track.songId || track.id, track });
    return lyricsData;
  } catch (e) {
    console.error('[LyricsEngine] fetchLyrics error:', e.message);
    if (reqToken === activeRequestToken) {
      lyricsData = [];
      currentLyricIndex = -1;
      emit(EVENTS.LYRICS_LOADED, { lyrics: [], songId: track.songId || track.id, track });
    }
    return [];
  }
}

/**
 * 更新当前歌词高亮行
 * 通过 event-bus emit `lyrics:highlight`
 * @param {number} currentTime 当前播放时间（秒）
 */
export function updateHighlight(currentTime) {
  if (lyricsData.length === 0) return;
  // 后台/锁屏待机状态直接跳过歌词滚动与高亮计算，节省系统资源与电量
  if (AppState.currentState === 'background') return;

  const newIndex = findCurrentLyricIndex(lyricsData, currentTime);
  if (newIndex !== currentLyricIndex) {
    currentLyricIndex = newIndex;
    emit(EVENTS.LYRICS_HIGHLIGHT, { index: newIndex, time: currentTime });
  }
}

/**
 * 获取当前歌词数据
 * @returns {Array}
 */
export function getLyrics() {
  return lyricsData;
}

/**
 * 获取当前高亮行索引
 * @returns {number}
 */
export function getCurrentLyricIndex() {
  return currentLyricIndex;
}

/**
 * 重置歌词状态（切歌时调用，清空上一首歌词并取消正在进行的请求）
 */
export function resetLyrics() {
  activeRequestToken++;
  lyricsData = [];
  currentLyricIndex = -1;
  currentSongKey = '';
  emit(EVENTS.LYRICS_LOADED, { lyrics: [], songId: null, track: null });
}

export default {
  fetchLyrics,
  updateHighlight,
  getLyrics,
  getCurrentLyricIndex,
  resetLyrics,
};

