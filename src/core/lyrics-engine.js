// 歌词引擎 — 从 store/player.js 歌词逻辑 + utils/lyrics.js 合并
// 提供歌词获取、解析、高亮更新，通过 event-bus 通知外部
import { parseLyrics, findCurrentLyricIndex } from '../utils/lyrics';
import { neteaseLyrics } from './source-manager';
import { EVENTS, emit } from './event-bus';

// =====================================================================
// 歌词状态（模块内部）
// =====================================================================

let lyricsData = [];
let currentLyricIndex = -1;

// =====================================================================
// 公开 API
// =====================================================================

/**
 * 获取歌词（网易云 API）
 * 获取成功后通过 event-bus emit `lyrics:loaded`
 * @param {string|number} songId 歌曲ID
 * @returns {Promise<Array>} 歌词数组
 */
export async function fetchLyrics(songId) {
  if (!songId) {
    lyricsData = [];
    currentLyricIndex = -1;
    emit(EVENTS.LYRICS_LOADED, { lyrics: [], songId });
    return [];
  }

  try {
    const result = await neteaseLyrics(songId);
    lyricsData = parseLyrics(result.lrc, result.tlyric);
    currentLyricIndex = -1;
    emit(EVENTS.LYRICS_LOADED, { lyrics: lyricsData, songId });
    return lyricsData;
  } catch (e) {
    console.error('[LyricsEngine] fetchLyrics error:', e.message);
    lyricsData = [];
    currentLyricIndex = -1;
    emit(EVENTS.LYRICS_LOADED, { lyrics: [], songId });
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
 * 重置歌词状态（切歌时调用，清空上一首歌词并通知 UI）
 */
export function resetLyrics() {
  lyricsData = [];
  currentLyricIndex = -1;
  emit(EVENTS.LYRICS_LOADED, { lyrics: [], songId: null });
}

export default {
  fetchLyrics,
  updateHighlight,
  getLyrics,
  getCurrentLyricIndex,
  resetLyrics,
};
