// 咪咕音乐 Provider (搜索 / 播放直链)
import crypto from 'crypto-js';
import { normalizeTrack } from '../models/track';

export async function miguSearch(keyword, limit = 30) {
  try {
    const timestamp = String(Date.now());
    const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
    const sigMd5 = '6cdc72a439cef99a3418d2a78aa28c73';
    const raw = `${keyword}${sigMd5}yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${timestamp}`;
    const sign = crypto.MD5(raw).toString();
    const params = new URLSearchParams({
      isCorrect: '0', isCopyright: '1',
      searchSwitch: '{"song":1,"album":0,"singer":0,"tagSong":1,"mvSong":0,"bestShow":1,"songlist":0,"lyricSong":0}',
      pageSize: String(limit), text: keyword, pageNo: '1', sort: '0', sid: 'USS',
    });
    const url = `https://jadeite.migu.cn/music_search/v3/search/searchAll?${params}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0', 'Referer': 'https://m.music.migu.cn/',
        'uiVersion': 'A_music_3.6.1', 'deviceId': deviceId,
        'timestamp': timestamp, 'sign': sign, 'channel': '0146921',
      },
    });
    const parsed = await res.json();
    if (parsed.code !== '000000') return [];
    let songsData = (parsed.songResultData && parsed.songResultData.resultList) || [];
    let songs = [];
    for (const item of songsData) {
      if (Array.isArray(item)) songs.push(...item);
      else if (typeof item === 'object') songs.push(item);
    }
    return songs.map(s => normalizeTrack({
      id: s.songId || s.id || '',
      songId: s.songId || s.id || '',
      copyrightId: s.contentId || s.copyrightId || s.id || '',
      name: s.name || '',
      artist: (s.singerList || []).map(a => a.name || '').join(' / ') || s.singer || '',
      album: s.album || '',
      duration: parseInt(s.duration || 0),
      fee: (s.copyrightType && s.copyrightType === '2') ? 1 : 0,
      _src: 'migu',
      _platform: 'migu',
    }, 'migu'));
  } catch {
    return [];
  }
}

export async function miguSongUrl(songId, song) {
  try {
    const contentId = (song && song.copyrightId) || songId;
    return `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/sub/listenSong.do?songId=${songId}&contentId=${contentId}&copyrightId=${contentId}&resourceType=E&netType=01&toneFlag=128&channel=0146951`;
  } catch {
    return null;
  }
}

export default {
  miguSearch,
  miguSongUrl,
};
