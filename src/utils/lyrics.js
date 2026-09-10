// 歌词解析 — 从桌面端 lyrics.js 移植并增强标准 LRC [offset] 解析与动态前瞻补偿

// 前瞻时间补偿量（秒）：抵消 Android AudioTrack 硬件缓冲延迟(~80-100ms)与 ScrollView 滚动动画过渡(~200-250ms)
const ANTICIPATION_OFFSET_SEC = 0.25;

export function parseLyrics(lrc, tlyric) {
  if (!lrc || typeof lrc !== 'string') return [];

  // 解析 [offset:+/-ms] 全局偏移量（毫秒），正数延后，负数提前
  let offsetSec = 0;
  const offsetMatch = lrc.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
  if (offsetMatch) {
    offsetSec = (parseInt(offsetMatch[1], 10) || 0) / 1000;
  }

  const lines = lrc.split(/\r?\n/);
  const translations = {};

  const parseTime = (minStr, secStr, msStr) => {
    const min = parseInt(minStr, 10) || 0;
    const sec = parseInt(secStr, 10) || 0;
    let ms = 0;
    if (msStr) {
      if (msStr.length === 2) {
        ms = parseInt(msStr, 10) * 10;
      } else if (msStr.length === 3) {
        ms = parseInt(msStr, 10);
      } else {
        ms = Math.round(parseFloat('0.' + msStr) * 1000);
      }
    }
    return min * 60 + sec + ms / 1000;
  };

  const timeTagRegex = /\[(\d{1,2}):(\d{2})(?:[.:](\d{2,3}))?\]/g;

  if (tlyric && typeof tlyric === 'string') {
    tlyric.split(/\r?\n/).forEach(line => {
      timeTagRegex.lastIndex = 0;
      const text = line.replace(timeTagRegex, '').trim();
      timeTagRegex.lastIndex = 0;
      let m;
      while ((m = timeTagRegex.exec(line)) !== null) {
        const time = Math.max(0, parseTime(m[1], m[2], m[3]) + offsetSec);
        translations[time.toFixed(2)] = text;
      }
    });
  }

  const result = [];
  lines.forEach(line => {
    timeTagRegex.lastIndex = 0;
    const text = line.replace(timeTagRegex, '').trim();
    if (!text) return;
    timeTagRegex.lastIndex = 0;
    let m;
    while ((m = timeTagRegex.exec(line)) !== null) {
      const time = Math.max(0, parseTime(m[1], m[2], m[3]) + offsetSec);
      result.push({
        time: time,
        text: text,
        translation: translations[time.toFixed(2)] || ''
      });
    }
  });

  return result.sort((a, b) => a.time - b.time);
}

export function findCurrentLyricIndex(lyricsData, currentTime) {
  if (!lyricsData || lyricsData.length === 0) return -1;
  const effectiveTime = currentTime + ANTICIPATION_OFFSET_SEC;
  let newIndex = -1;
  for (let i = 0; i < lyricsData.length; i++) {
    if (effectiveTime >= lyricsData[i].time) {
      newIndex = i;
    } else {
      break;
    }
  }
  return newIndex;
}
