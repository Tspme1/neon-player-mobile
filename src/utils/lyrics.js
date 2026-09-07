// 歌词解析 — 从桌面端 lyrics.js 移植

export function parseLyrics(lrc, tlyric) {
  if (!lrc || typeof lrc !== 'string') return [];

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
        const time = parseTime(m[1], m[2], m[3]);
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
      const time = parseTime(m[1], m[2], m[3]);
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
  let newIndex = -1;
  for (let i = 0; i < lyricsData.length; i++) {
    if (currentTime >= lyricsData[i].time) {
      newIndex = i;
    } else {
      break;
    }
  }
  return newIndex;
}
