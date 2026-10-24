// 酷狗音乐 Provider (搜索 / 播放直链 / 双阶段歌词 / 封面补拉)
import { NativeModules } from 'react-native';
import { decodeBase64, decodeHtmlEntities } from '../http/http-client';
import { normalizeTrack } from '../models/track';

const kugouPicCache = new Map();

export async function kugouSearch(keyword, page = 0, limit = 30) {
  try {
    const url = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(keyword)}&page=${page + 1}&pagesize=${limit}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.kugou.com/' },
    });
    const parsed = await res.json();
    return ((parsed.data && parsed.data.lists) || []).map(s => {
      let name = s.SongName || '';
      let artist = s.SingerName || '';
      let album = s.AlbumName || '';
      try { name = decodeURIComponent(name).replace(/<em>|<\/em>/g, ''); } catch {}
      try { artist = decodeURIComponent(artist); } catch {}
      try { album = decodeURIComponent(album); } catch {}
      const id = `${s.FileHash}|${s.AlbumID || '0'}`;
      return normalizeTrack({
        id,
        songId: id,
        hash: s.FileHash,
        name,
        artist,
        album,
        duration: parseInt(s.Duration || 0),
        fee: (s.Privilege && s.Privilege > 0) ? 1 : 0,
        _src: 'kugou',
        _platform: 'kugou',
        albumId: String(s.AlbumID || '0'),
        picUrl: s.Image ? s.Image.replace('{size}', '400').replace(/^http:/, 'https:') : '',
      }, 'kugou');
    });
  } catch {
    return [];
  }
}

export async function kugouSongUrl(songId) {
  try {
    const parts = String(songId).split('|');
    const songHash = parts[0];
    const url = `https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${songHash}`;
    const headers = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'Referer': 'https://m.kugou.com/' };
    let parsed;
    try {
      if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
        const text = await NativeModules.MediaModule.nativeHttpGet(url, JSON.stringify(headers));
        parsed = JSON.parse(text);
      } else {
        const res = await fetch(url, { headers });
        parsed = await res.json();
      }
    } catch {
      const res = await fetch(url, { headers });
      parsed = await res.json();
    }
    const playUrl = (parsed.backup_url && parsed.backup_url[0]) || parsed.play_url || parsed.url;
    return playUrl && playUrl.startsWith('http') ? playUrl : null;
  } catch {
    return null;
  }
}

export async function kugouLyrics(song) {
  if (!song) return { lrc: '', tlyric: '' };
  const rawId = String(song.hash || song.songId || song.id || '');
  const hash = (rawId.includes('|') ? rawId.split('|')[0] : rawId).toUpperCase();
  if (!hash) return { lrc: '', tlyric: '' };
  const durationMs = (parseInt(song.duration) || 0) * 1000;
  const name = encodeURIComponent(song.name || '');
  const headers = {
    'KG-RC': '1',
    'KG-THash': 'expand_search_manager.cpp:852736169:451',
    'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
  };
  try {
    const searchUrl = `http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${name}&hash=${hash}&timelength=${durationMs}&lrctxt=1`;
    let parsed;
    if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
      const text = await NativeModules.MediaModule.nativeHttpGet(searchUrl, JSON.stringify(headers));
      parsed = JSON.parse(text);
    } else {
      const res = await fetch(searchUrl, { headers });
      parsed = await res.json();
    }
    if (parsed && parsed.candidates && parsed.candidates.length > 0) {
      const cand = parsed.candidates[0];
      const dlUrl = `http://lyrics.kugou.com/download?ver=1&client=pc&id=${cand.id}&accesskey=${cand.accesskey}&fmt=lrc&charset=utf8`;
      let dlParsed;
      if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
        const text = await NativeModules.MediaModule.nativeHttpGet(dlUrl, JSON.stringify(headers));
        dlParsed = JSON.parse(text);
      } else {
        const res = await fetch(dlUrl, { headers });
        dlParsed = await res.json();
      }
      if (dlParsed && dlParsed.content) {
        const lrc = decodeHtmlEntities(decodeBase64(dlParsed.content));
        return { lrc, tlyric: '' };
      }
    }
  } catch (e) {
    console.error('[KugouProvider] kugouLyrics error:', e.message);
  }
  return { lrc: '', tlyric: '' };
}

export async function kugouSongPic(songId, track = null) {
  try {
    const rawId = (track && (track.hash || track.songId || track.id)) || songId || '';
    const hash = String(rawId).split('|')[0];
    if (!hash || hash.length < 32) return '';
    if (kugouPicCache.has(hash)) return kugouPicCache.get(hash);

    const url = `https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${hash}`;
    const headers = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'Referer': 'https://m.kugou.com/' };
    let text = '';
    if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
      text = await NativeModules.MediaModule.nativeHttpGet(url, JSON.stringify(headers));
    } else {
      const res = await fetch(url, { headers });
      text = await res.text();
    }
    const parsed = JSON.parse(text);
    let img = parsed.album_img || parsed.imgUrl || '';
    if (img) {
      img = img.replace('{size}', '400');
    }
    kugouPicCache.set(hash, img);
    if (kugouPicCache.size > 300) {
      let drop = kugouPicCache.size - 200;
      for (const k of kugouPicCache.keys()) {
        if (drop-- <= 0) break;
        kugouPicCache.delete(k);
      }
    }
    return img;
  } catch {
    return '';
  }
}

export default {
  kugouSearch,
  kugouSongUrl,
  kugouLyrics,
  kugouSongPic,
};
