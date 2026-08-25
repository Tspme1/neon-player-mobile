// 歌词解析 — 从桌面端 lyrics.js 移植

export function parseLyrics(lrc, tlyric) {
  if (!lrc) return [];

  const lines = lrc.split('\n');
  const translations = {};

  if (tlyric) {
    tlyric.split('\n').forEach(line => {
      const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
      if (match) {
        const time = parseInt(match[1]) * 60 + parseInt(match[2]) + parseInt(match[3]) / 1000;
        translations[time.toFixed(2)] = match[4].trim();
      }
    });
  }

  const result = [];
  lines.forEach(line => {
    const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (match) {
      const time = parseInt(match[1]) * 60 + parseInt(match[2]) + parseInt(match[3]) / 1000;
      const text = match[4].trim();
      if (text) {
        result.push({
          time: time,
          text: text,
          translation: translations[time.toFixed(2)] || ''
        });
      }
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
