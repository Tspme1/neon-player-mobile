// QQ音乐 / 腾讯音乐 Provider (搜索 / 播放直链 / 歌词 / 封面补拉)
import { NativeModules } from 'react-native';
import { decodeBase64, decodeHtmlEntities } from '../http/http-client';
import { normalizeTrack } from '../models/track';
import logger from '../logger';

const tencentPicCache = new Map();

export async function tencentSearch(keyword, page = 0, limit = 30) {
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://y.qq.com/',
    };

    // 方案 1 (首选)：现役稳定免签搜索接口 search_for_qq_cp
    const searchUrl = `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?w=${encodeURIComponent(keyword)}&format=json&n=${limit}&p=${page + 1}`;
    let songList = null;

    try {
      let text = '';
      if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
        text = await NativeModules.MediaModule.nativeHttpGet(searchUrl, JSON.stringify(headers));
      } else {
        const res = await fetch(searchUrl, { headers });
        text = await res.text();
      }
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        const jsonMatch = text.match(/^[a-zA-Z_0-9\$\.]+\s*\(([\s\S]*)\)\s*;?$/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[1]);
      }
      if (parsed && parsed.data && parsed.data.song && Array.isArray(parsed.data.song.list) && parsed.data.song.list.length > 0) {
        songList = parsed.data.song.list;
      }
    } catch (e) {
      logger.warn('TencentProvider:search', 'search_for_qq_cp request error', e.message);
    }

    // 方案 2 (备用)：musicu.fcg
    if (!songList || songList.length === 0) {
      try {
        const payload = {
          req: {
            method: 'DoSearchForQQMusicDesktop',
            module: 'music.search.SearchCgiService',
            param: {
              search_type: 0,
              query: keyword,
              page_num: page + 1,
              num_per_page: Math.min(limit, 10),
            },
          },
        };
        const musicuUrl = `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;
        let text = '';
        if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
          text = await NativeModules.MediaModule.nativeHttpGet(musicuUrl, JSON.stringify(headers));
        } else {
          const res = await fetch(musicuUrl, { headers });
          text = await res.text();
        }
        const mParsed = JSON.parse(text);
        const mList = mParsed?.req?.data?.body?.song?.list;
        if (mList && mList.length > 0) {
          songList = mList;
        }
      } catch {}
    }

    // 方案 3 (兜底)：smartbox_new.fcg
    if (!songList || songList.length === 0) {
      try {
        const smartUrl = `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=${encodeURIComponent(keyword)}&format=json`;
        let text = '';
        if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
          text = await NativeModules.MediaModule.nativeHttpGet(smartUrl, JSON.stringify(headers));
        } else {
          const res = await fetch(smartUrl, { headers });
          text = await res.text();
        }
        const sParsed = JSON.parse(text);
        const sItemList = sParsed?.data?.song?.itemlist;
        if (sItemList && sItemList.length > 0) {
          return sItemList.map(s => normalizeTrack({
            id: s.mid || s.docid || '',
            songId: s.mid || s.docid || '',
            name: s.name || '',
            artist: s.singer || '',
            album: '',
            duration: 0,
            fee: 0,
            _src: 'tencent',
            _platform: 'tencent',
            picUrl: s.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.mid}.jpg` : '',
          }, 'tencent'));
        }
      } catch {}
    }

    if (!songList || !Array.isArray(songList)) {
      return [];
    }

    return songList.map(s => {
      const mid = s.songmid || s.mid || '';
      const name = s.songname || s.name || '';
      let artist = '';
      if (Array.isArray(s.singer)) {
        artist = s.singer.map(a => a.name || '').join(' / ');
      } else if (typeof s.singer === 'string') {
        artist = s.singer;
      }
      const album = s.albumname || (s.album && s.album.name) || '';
      const albummid = s.albummid || (s.album && s.album.mid) || '';
      const singermid = (s.singer && s.singer[0] && s.singer[0].mid) || '';
      const duration = parseInt(s.interval || s.duration || 0);
      let fee = 0;
      if (s.pay) {
        if (s.pay.payplay === 1 || s.pay.pay_play === 1) {
          fee = 1;
        }
      }

      return normalizeTrack({
        id: mid,
        songId: mid,
        name,
        artist,
        album,
        duration,
        fee,
        _src: 'tencent',
        _platform: 'tencent',
        picUrl: albummid
          ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg`
          : (singermid
            ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singermid}.jpg`
            : ''),
      }, 'tencent');
    });
  } catch (e) {
    logger.error('TencentProvider:search', 'Search failed', e);
    return [];
  }
}

export async function tencentSongUrl(songmid) {
  try {
    const guid = String(Math.floor(Math.random() * 1e10));
    const url = `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(JSON.stringify({
      req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param: { guid, songmid: [songmid], songtype: [0], uin: '0', loginflag: 1, platform: '20' } },
      comm: { uin: 0, format: 'json', ct: 24, cv: 0 }
    }))}`;
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://y.qq.com/' };
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
    const info = parsed.req_0 && parsed.req_0.data;
    if (info && info.midurlinfo && info.midurlinfo.length > 0) {
      const purl = info.midurlinfo[0].purl;
      if (purl) {
        const sip = (info.sip && info.sip[0]) || 'https://dl.stream.qqmusic.qq.com/';
        return sip + purl;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function tencentLyrics(songmid) {
  if (!songmid) return { lrc: '', tlyric: '' };
  logger.info('TencentProvider', 'tencentLyrics start', { songmid });
  try {
    const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${songmid}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://y.qq.com/portal/player.html',
    };
    let text = '';
    if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
      text = await NativeModules.MediaModule.nativeHttpGet(url, JSON.stringify(headers));
    } else {
      const res = await fetch(url, { headers });
      text = await res.text();
    }
    if (text) {
      let cleanText = text.trim();
      const m = cleanText.match(/^[a-zA-Z_0-9$]+\s*\(([\s\S]*)\)\s*;?$/);
      if (m) cleanText = m[1];
      const parsed = JSON.parse(cleanText);
      if (parsed && (parsed.code === 0 || parsed.lyric)) {
        const rawLrc = decodeBase64(parsed.lyric || '');
        const rawTlyric = decodeBase64(parsed.trans || '');
        const lrc = decodeHtmlEntities(rawLrc);
        const tlyric = decodeHtmlEntities(rawTlyric);
        logger.info('TencentProvider', 'tencentLyrics success', { lines: lrc ? lrc.split('\n').length : 0 });
        return { lrc, tlyric };
      }
    }
  } catch (e) {
    logger.error('TencentProvider', 'tencentLyrics error', e);
  }
  return { lrc: '', tlyric: '' };
}

export async function tencentSongPic(songmid) {
  if (!songmid) return '';
  if (tencentPicCache.has(songmid)) return tencentPicCache.get(songmid);
  try {
    const url = `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid=${encodeURIComponent(songmid)}&format=json`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://y.qq.com/',
    };
    let text = '';
    if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
      text = await NativeModules.MediaModule.nativeHttpGet(url, JSON.stringify(headers));
    } else {
      const res = await fetch(url, { headers });
      text = await res.text();
    }
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/^[a-zA-Z_0-9\$\.]+\s*\(([\s\S]*)\)\s*;?$/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[1]);
    }
    const songData = parsed?.data?.[0];
    const albummid = songData?.album?.mid;
    const singermid = songData?.singer?.[0]?.mid;
    let pic = '';
    if (albummid) {
      pic = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg`;
    } else if (singermid) {
      pic = `https://y.gtimg.cn/music/photo_new/T001R300x300M000${singermid}.jpg`;
    }
    tencentPicCache.set(songmid, pic);
    if (tencentPicCache.size > 300) {
      let drop = tencentPicCache.size - 200;
      for (const k of tencentPicCache.keys()) {
        if (drop-- <= 0) break;
        tencentPicCache.delete(k);
      }
    }
    return pic;
  } catch (e) {
    logger.warn('TencentProvider', 'tencentSongPic error', e.message);
    return '';
  }
}

export default {
  tencentSearch,
  tencentSongUrl,
  tencentLyrics,
  tencentSongPic,
};
