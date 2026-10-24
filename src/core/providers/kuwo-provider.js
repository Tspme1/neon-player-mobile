// 酷我音乐 Provider (搜索 / 播放直链 / 歌词)
import { NativeModules } from 'react-native';
import { decodeHtmlEntities } from '../http/http-client';
import { normalizeTrack } from '../models/track';
import logger from '../logger';

export async function kuwoSearch(keyword, page = 0, limit = 30) {
  try {
    const url = `https://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${page}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/'/g, '"'));
    } catch {
      return [];
    }
    return (parsed.abslist || []).map((s) => {
      let name = s.SONGNAME || '';
      let artist = s.ARTIST || '';
      let album = s.ALBUM || '';
      try { name = decodeURIComponent(name); } catch {}
      try { artist = decodeURIComponent(artist); } catch {}
      try { album = decodeURIComponent(album); } catch {}
      const id = (s.MUSICRID || '').replace('MUSIC_', '');
      return normalizeTrack({
        id,
        songId: id,
        name,
        artist,
        album,
        duration: parseInt(s.DURATION || 0),
        fee: (parseInt(s.KMARK || 0) > 0) ? 1 : 0,
        _src: 'kuwo',
        _platform: 'kuwo',
        picUrl: s.web_albumpic_short
          ? 'http://img1.kwcdn.kuwo.cn/star/albumcover/500/' + String(s.web_albumpic_short).replace(/^\d+\//, '')
          : '',
      }, 'kuwo');
    });
  } catch {
    return [];
  }
}

export async function kuwoSongUrl(songId, song = null) {
  try {
    if (song && (song.fee === 1 || song.fee === 8)) {
      logger.warn('KuwoProvider', `Skipping VIP song (${songId}) on official kuwo API to prevent 11s promo audio`);
      return null;
    }
    const url = `https://antiserver.kuwo.cn/anti.s?type=convert_url&format=mp3&response=url&rid=${songId}`;
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.kuwo.cn/' };
    let text;
    try {
      if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
        text = await NativeModules.MediaModule.nativeHttpGet(url, JSON.stringify(headers));
      } else {
        const res = await fetch(url, { headers });
        text = await res.text();
      }
    } catch {
      const res = await fetch(url, { headers });
      text = await res.text();
    }
    const playUrl = text && text.trim();
    return playUrl && playUrl.startsWith('http') ? playUrl : null;
  } catch {
    return null;
  }
}

export async function kuwoLyrics(songId) {
  if (!songId) return { lrc: '', tlyric: '' };
  try {
    const rid = String(songId).replace('MUSIC_', '');
    const url = `http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${rid}&httpsStatus=1`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    };
    let parsed;
    if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
      const text = await NativeModules.MediaModule.nativeHttpGet(url, JSON.stringify(headers));
      parsed = JSON.parse(text);
    } else {
      const res = await fetch(url, { headers });
      parsed = await res.json();
    }
    if (parsed && parsed.data && Array.isArray(parsed.data.lrclist) && parsed.data.lrclist.length > 0) {
      const lines = parsed.data.lrclist.map(item => {
        const t = parseFloat(item.time) || 0;
        const m = Math.floor(t / 60).toString().padStart(2, '0');
        const s = (t % 60).toFixed(2).padStart(5, '0');
        return `[${m}:${s}]${decodeHtmlEntities(item.lineLyric || '')}`;
      });
      return { lrc: lines.join('\n'), tlyric: '' };
    }
  } catch (e) {
    console.error('[KuwoProvider] kuwoLyrics error:', e.message);
  }
  return { lrc: '', tlyric: '' };
}

export default {
  kuwoSearch,
  kuwoSongUrl,
  kuwoLyrics,
};
