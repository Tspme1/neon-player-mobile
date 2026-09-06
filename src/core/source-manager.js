// 音源管理器 — 合并 music.js + http-client.js + source-registry.js + source-import.js
// 提供统一搜索、URL获取、音源导入管理
// LX 音源通过 WebView 沙箱（引用 lx-webview-manager.js + lx-webview-sandbox.js + lx-runner.js + anti-debug-patch.js）

import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import crypto from 'crypto-js';
import { fetchViaWebView, isFetcherReady, waitForFetcherReady } from '../components/WebViewFetcher';

// LX WebView 沙箱（这些文件保持不动，直接引用）
import { getLxMusicUrlWebView, isSandboxReady, waitForSandboxReady } from '../services/lx-webview-manager';
import { getLxMusicUrl } from '../services/lx-runner';

// Storage
import { KEYS, getCachedUrl, setCachedUrl } from './storage';

// =====================================================================
// 内置音源 API
// =====================================================================

// === 原生层 LX 音源 URL 获取 (后台 WebView 不可用时的替代方案) ===
// LX 音源脚本最终成功的是第三个 API: music-api.gdstudio.xyz
// 这个 API 返回完整 URL (非 30 秒试听), 可以在原生 OkHttp 层直接请求
async function nativeLxMusicUrl(songId, platform = 'netease', quality = 'standard') {
  const _t0 = Date.now();
  const _log = (label) => console.log(`[DBG] +${Date.now() - _t0}ms [nativeLx] ${label}`);
  _log(`start songId=${songId} platform=${platform} quality=${quality}`);
  // gdstudio API 支持的 source 名称映射
  const sourceMap = { netease: 'netease', tencent: 'tencent', kuwo: 'kuwo', kugou: 'kugou' };
  const src = sourceMap[platform] || 'netease';
  // 音质映射到 bitrate
  const brMap = { low: 128, standard: 320, high: 320, lossless: 320 };
  const br = brMap[quality] || 320;
  const apis = [
    `https://music-api.gdstudio.xyz/api.php?types=url&source=${src}&id=${songId}&br=${br}`,
  ];
  // cenguigui 仅支持网易云
  if (platform === 'netease') {
    apis.push(`https://api.cenguigui.cn/api/netease/music_v1.php?type=json&id=${songId}&level=standard`);
  }
  
  for (let i = 0; i < apis.length; i++) {
    const apiUrl = apis[i];
    try {
      _log(`API ${i + 1}/${apis.length} start: ${apiUrl.substring(0, 80)}...`);
      const { NativeModules } = await import('react-native');
      if (!NativeModules.MediaModule || !NativeModules.MediaModule.nativeHttpGet) {
        _log('nativeHttpGet not available');
        continue;
      }
      const headers = JSON.stringify({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://music.163.com/',
      });
      const responseText = await NativeModules.MediaModule.nativeHttpGet(apiUrl, headers);
      _log(`API ${i + 1} response: ${responseText ? responseText.substring(0, 120) : 'empty'}`);
      if (!responseText) continue;
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        _log(`API ${i + 1} JSON parse failed`);
        continue;
      }
      
      if (data.url && typeof data.url === 'string' && data.url.startsWith('http')) {
        _log(`API ${i + 1} OK: url found`);
        return data.url;
      }
      if (data.data && data.data.url) {
        _log(`API ${i + 1} OK: data.url found`);
        return data.data.url;
      }
      if (data.musicUrl) {
        _log(`API ${i + 1} OK: musicUrl found`);
        return data.musicUrl;
      }
      _log(`API ${i + 1} no url in response`);
    } catch (e) {
      _log(`API ${i + 1} error: ${e.message}`);
    }
  }
  _log('all APIs exhausted, return null');
  return null;
}

// === 网易云 ===

async function neteaseSearch(keyword, offset = 0, limit = 30) {
  const url = `https://music.163.com/api/search/get/web?csrf_token=&hlpretag=&hlposttag=&s=${encodeURIComponent(keyword)}&type=1&offset=${offset}&total=true&limit=${limit}`;
  const result = await fetchJSON(url);
  if (result.code === 200 && result.result && result.result.songs) {
    return result.result.songs.map(song => ({
      id: song.id,
      name: song.name,
      artist: song.artists.map(a => a.name).join(', '),
      album: song.album.name,
      duration: Math.floor(song.duration / 1000),
      fee: song.fee || 0,
      _src: 'netease',
    }));
  }
  return [];
}

async function neteaseSongUrl(songId, quality = 'standard') {
  const outerUrl = `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
  try {
    const levelMap = { low: 'standard', standard: 'standard', high: 'exhigh', lossless: 'lossless' };
    const level = levelMap[quality] || 'standard';
    const apiUrl = `https://music.163.com/api/song/enhance/player/url/v1?ids=[${songId}]&level=${level}&encodeType=aac`;
    const result = await fetchJSON(apiUrl);
    if (result.code === 200 && result.data && result.data.length > 0 && result.data[0].url) {
      return { url: result.data[0].url, isLocal: false };
    }
  } catch (e) {
    // neteaseSongUrl API error, fall through to outer URL
  }
  return { url: outerUrl, isLocal: false };
}

async function neteaseLyrics(songId) {
  try {
    const url = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`;
    const result = await fetchJSON(url);
    if (result.code === 200) {
      return {
        lrc: (result.lrc && result.lrc.lyric) || '',
        tlyric: (result.tlyric && result.tlyric.lyric) || '',
      };
    }
  } catch (e) {
    console.error('[SourceManager] Lyrics error:', e.message);
  }
  return { lrc: '', tlyric: '' };
}

async function neteaseToplist() {
  try {
    const result = await fetchJSON('https://music.163.com/api/toplist');
    if (result.code === 200 && result.list) {
      return result.list.map(item => ({
        id: item.id,
        name: item.name,
        coverImgUrl: item.coverImgUrl || '',
        updateFrequency: item.updateFrequency || '',
        description: item.description || '',
      }));
    }
  } catch (e) {
    console.error('[SourceManager] Toplist error:', e.message);
  }
  return [];
}

async function neteaseToplistDetail(toplistId) {
  try {
    const url = `https://music.163.com/api/v6/playlist/detail?id=${toplistId}&n=100`;
    const result = await fetchJSON(url);
    if (result.code === 200 && result.playlist && result.playlist.tracks) {
      return result.playlist.tracks.slice(0, 100).map(song => ({
        id: song.id,
        name: song.name,
        artist: song.ar ? song.ar.map(a => a.name).join(', ') : '',
        album: song.al ? song.al.name : '',
        duration: Math.floor(song.dt / 1000),
        fee: song.fee || 0,
      }));
    }
  } catch (e) {
    console.error('[SourceManager] Toplist detail error:', e.message);
  }
  return [];
}

async function neteaseShuffleSongs() {
  try {
    const toplistIds = [3778678, 19723756, 3779629, 2884035];
    const songs = [];
    for (const id of toplistIds) {
      try {
        const url = `https://music.163.com/api/v6/playlist/detail?id=${id}&n=100`;
        const result = await fetchJSON(url);
        if (result.code === 200 && result.playlist && result.playlist.tracks) {
          result.playlist.tracks.slice(0, 15).forEach(song => {
            songs.push({
              id: song.id,
              name: song.name,
              artist: song.ar ? song.ar.map(a => a.name).join(', ') : '',
              album: song.al ? song.al.name : '',
              duration: Math.floor(song.dt / 1000),
              fee: song.fee || 0,
            });
          });
        }
      } catch {
        // skip failed
      }
    }
    // Fisher-Yates shuffle
    for (let i = songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [songs[i], songs[j]] = [songs[j], songs[i]];
    }
    return songs.slice(0, 40);
  } catch (e) {
    console.error('[SourceManager] Shuffle songs error:', e.message);
    return [];
  }
}

// === 酷我 ===

async function kuwoSearch(keyword, page = 0, limit = 30) {
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
    const songs = (parsed.abslist || []).map((s) => {
      let name = s.SONGNAME || '';
      let artist = s.ARTIST || '';
      let album = s.ALBUM || '';
      try { name = decodeURIComponent(name); } catch {}
      try { artist = decodeURIComponent(artist); } catch {}
      try { album = decodeURIComponent(album); } catch {}
      return {
        id: (s.MUSICRID || '').replace('MUSIC_', ''),
        name, artist, album,
        duration: parseInt(s.DURATION || 0),
        fee: (parseInt(s.KMARK || 0) > 0) ? 1 : 0, _src: 'kuwo',
      };
    });
    return songs;
  } catch {
    return [];
  }
}

async function kuwoSongUrl(songId) {
  try {
    // 使用 antiserver 接口，不需要 cookie
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

// === 酷狗 ===

async function kugouSearch(keyword, page = 0, limit = 30) {
  try {
    const url = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(keyword)}&page=${page + 1}&pagesize=${limit}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.kugou.com/' },
    });
    const parsed = await res.json();
    const songs = ((parsed.data && parsed.data.lists) || []).map(s => {
      let name = s.SongName || '';
      let artist = s.SingerName || '';
      let album = s.AlbumName || '';
      try { name = decodeURIComponent(name).replace(/<em>|<\/em>/g, ''); } catch {}
      try { artist = decodeURIComponent(artist); } catch {}
      try { album = decodeURIComponent(album); } catch {}
      return {
        id: `${s.FileHash}|${s.AlbumID || '0'}`,
        name, artist, album,
        duration: parseInt(s.Duration || 0),
        fee: (s.Privilege && s.Privilege > 0) ? 1 : 0, _src: 'kugou',
      };
    });
    return songs;
  } catch {
    return [];
  }
}

async function kugouSongUrl(songId) {
  try {
    const parts = String(songId).split('|');
    const songHash = parts[0];
    const albumId = parts[1] || '0';
    // 使用移动端接口，不需要 cookie
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
    // 优先 backup_url，其次 play_url/url
    const playUrl = parsed.backup_url && parsed.backup_url[0] || parsed.play_url || parsed.url;
    return playUrl && playUrl.startsWith('http') ? playUrl : null;
  } catch {
    return null;
  }
}

// === 咪咕 ===

async function miguSearch(keyword, limit = 30) {
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
    return songs.map(s => {
      if (songs.indexOf(s) === 0) {
        console.log(`[DBG] [source] miguSearch first song keys: ${Object.keys(s).join(',')} copyrightId=${s.copyrightId} contentId=${s.contentId} songId=${s.songId}`);
      }
      return {
        id: s.songId || s.id || '',
        copyrightId: s.contentId || s.copyrightId || s.id || '',
        name: s.name || '',
        artist: (s.singerList || []).map(a => a.name || '').join(' / ') || s.singer || '',
        album: s.album || '',
        duration: parseInt(s.duration || 0),
        fee: (s.copyrightType && s.copyrightType === '2') ? 1 : 0, _src: 'migu',
      };
    });
  } catch {
    return [];
  }
}

async function miguSongUrl(songId, song) {
  try {
    const contentId = (song && song.copyrightId) || songId;
    console.log(`[DBG] [source] miguSongUrl: songId=${songId} contentId=${contentId} song.copyrightId=${song && song.copyrightId}`);
    // 咕音乐 API 直接 302 重定向到 CDN MP3 URL，直接返回 API URL 给 ExoPlayer 处理重定向
    return `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/sub/listenSong.do?songId=${songId}&contentId=${contentId}&copyrightId=${contentId}&resourceType=E&netType=01&toneFlag=128&channel=0146951`;
  } catch {
    return null;
  }
}

// === QQ音乐 ===

async function tencentSearch(keyword, page = 0, limit = 30) {
  try {
    const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(keyword)}&format=json&n=${limit}&p=${page + 1}&cr=1&g_tk=5381&t=0&loginUin=0&platform=yqq&needNewCode=0`;
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
    const songs = ((parsed.data && parsed.data.song && parsed.data.song.list) || []).map(s => ({
      id: s.songmid || '',
      name: s.songname || '',
      artist: (s.singer || []).map(a => a.name || '').join(' / '),
      album: (s.albumname || s.album && s.album.name) || '',
      duration: parseInt(s.interval || 0),
      fee: s.pay && s.pay.payplay ? 1 : 0,
      _src: 'tencent',
    }));
    return songs;
  } catch {
    return [];
  }
}

async function tencentSongUrl(songmid) {
  try {
    // QQ音乐获取播放 URL 需要通过 u.y.qq.com cgi 接口
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

// 安全编码 URL
function safeEncodeUrl(url) {
  try {
    const decoded = decodeURIComponent(url);
    if (decoded !== url) return url;
    return encodeURI(url);
  } catch {
    return encodeURI(url);
  }
}

/**
 * 获取 JSON — 优先原生 OkHttp，回退 fetch
 */
export async function fetchJSON(url, options = {}) {
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://music.163.com',
  };
  const headers = { ...defaultHeaders, ...(options.headers || {}) };
  
  // 优先使用原生 OkHttp（后台 JS 被挂起时仍可工作）
  try {
    if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
      const text = await NativeModules.MediaModule.nativeHttpGet(url, JSON.stringify(headers));
      return JSON.parse(text);
    }
  } catch (e) {
    // native OkHttp failed, fall through to JS fetch
  }
  
  // 回退到 JS fetch
  const res = await fetch(url, { ...options, headers });
  return res.json();
}

/**
 * 获取文本 — 优先 WebView fetch（走 Chromium 网络栈），回退 RN fetch，再回退原生 OkHttp
 */
export async function fetchText(url, options = {}) {
  const encodedUrl = safeEncodeUrl(url);
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
  };
  const headers = { ...defaultHeaders, ...(options.headers || {}) };

  // 方案 1: WebView fetch（走 Chromium 网络栈，和浏览器一样快）
  if (isFetcherReady()) {
    try {
      const text = await fetchViaWebView(encodedUrl, { headers, timeout: 15000 });
      if (text && text.length > 0) return text;
      throw new Error('Empty response from WebView');
    } catch (e) {
      // WebView failed, trying RN fetch
    }
  } else {
    // WebView 未就绪，等一下
    const ready = await waitForFetcherReady(3000);
    if (ready) {
      try {
        const text = await fetchViaWebView(encodedUrl, { headers, timeout: 15000 });
        if (text && text.length > 0) return text;
      } catch (e) {
        // WebView failed, trying RN fetch
      }
    }
  }

  // 方案 2: RN fetch (global.fetch + AbortController)
  try {
    const controller = new global.AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await global.fetch(encodedUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    if (text && text.length > 0) return text;
    throw new Error('Empty response');
  } catch (e) {
    // RN fetch failed, trying native OkHttp
  }

  // 方案 3: 原生 OkHttp
  try {
    if (NativeModules.UpdaterModule && NativeModules.UpdaterModule.fetchText) {
      const text = await NativeModules.UpdaterModule.fetchText(encodedUrl);
      return text;
    }
  } catch (e) {
    // native OkHttp failed
  }

  // 方案 4: XHR 最后兜底
  return fetchTextViaXHR(encodedUrl, { ...options, headers }, 30000);
}

// XMLHttpRequest 回退
function fetchTextViaXHR(url, options, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'text';
    xhr.timeout = timeoutMs;

    const headers = options.headers || {};
    for (const key in headers) {
      try { xhr.setRequestHeader(key, headers[key]); } catch {}
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
      } else {
        reject(new Error('HTTP ' + xhr.status + ': ' + xhr.statusText));
      }
    };
    xhr.onerror = () => reject(new Error('网络请求失败（XHR onerror）'));
    xhr.ontimeout = () => reject(new Error('请求超时（' + timeoutMs + 'ms）'));
    xhr.send();
  });
}

// =====================================================================
// 音源注册表管理（从 source-registry.js 合并）
// =====================================================================

// === 元数据解析 ===

export function parseMetadata(jsCode) {
  if (jsCode.startsWith('\ufeff')) jsCode = jsCode.slice(1);
  const blockMatch = jsCode.match(/^\/\*[\s\S]+?\*\//);
  if (!blockMatch) return null;

  const blockText = blockMatch[0];
  const meta = { name: '', description: '', version: '', author: '', homepage: '' };
  const limits = { name: 24, description: 36, author: 56, homepage: 1024, version: 36 };

  const lineRegex = /^\s?\*\s?@(\w+)\s+(.+)$/gm;
  let match;
  while ((match = lineRegex.exec(blockText)) !== null) {
    const key = match[1];
    const val = match[2].trim();
    if (key in meta) {
      meta[key] = val.length > limits[key] ? val.slice(0, limits[key]) + '...' : val;
    }
  }

  if (!meta.name) {
    meta.name = `user_api_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  }
  return meta;
}

export function generateSourceId(jsCode) {
  const hash = crypto.MD5(jsCode).toString();
  return `user_api_${hash.slice(0, 8)}_${Date.now()}`;
}

export function parseLxProtocol(raw) {
  if (raw.startsWith('lx-music://import/url/')) {
    const encoded = raw.slice('lx-music://import/url/'.length);
    try {
      const decoded = decodeURIComponent(encoded);
      if (decoded.startsWith('http')) return decoded;
    } catch {}
    try {
      const decoded = global.atob ? global.atob(encoded) : encoded;
      if (decoded.startsWith('http')) return decoded;
    } catch {}
  }
  return raw;
}

// === 注册表持久化 ===

export async function loadRegistry() {
  try {
    const json = await AsyncStorage.getItem(KEYS.SOURCE_REGISTRY);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

export async function saveRegistry(entries) {
  try {
    await AsyncStorage.setItem(KEYS.SOURCE_REGISTRY, JSON.stringify(entries));
  } catch (e) {
    console.error('[SourceManager] saveRegistry error:', e);
  }
}

export async function readSourceCode(sourceId) {
  try {
    return await AsyncStorage.getItem(KEYS.SOURCE_CODE_PREFIX + sourceId);
  } catch {
    return null;
  }
}

export async function writeSourceCode(sourceId, code) {
  try {
    await AsyncStorage.setItem(KEYS.SOURCE_CODE_PREFIX + sourceId, code);
  } catch (e) {
    console.error('[SourceManager] writeSourceCode error:', e);
  }
}

export async function deleteSourceCode(sourceId) {
  try {
    await AsyncStorage.removeItem(KEYS.SOURCE_CODE_PREFIX + sourceId);
  } catch {}
}

// =====================================================================
// 音源导入管理（从 source-import.js 合并）
// =====================================================================

/**
 * 从 URL 导入音源
 */
export async function importFromUrl(url, onProgress) {
  try {
    onProgress?.('正在解析链接...');
    const realUrl = parseLxProtocol(url.trim());
    if (!realUrl.startsWith('http')) {
      return { success: false, error: '无效的 URL' };
    }

    onProgress?.('正在获取音源脚本...');
    const jsCode = await fetchText(realUrl);

    onProgress?.('正在解析音源信息...');
    const meta = parseMetadata(jsCode);
    if (!meta) return { success: false, error: '无效的音源文件（找不到头部注释块）' };

    onProgress?.('正在注册音源...');
    const srcId = generateSourceId(jsCode);
    const entries = await loadRegistry();
    if (entries.some(e => e.id === srcId)) {
      return { success: false, error: '该音源已存在' };
    }

    await writeSourceCode(srcId, jsCode);

    const entry = {
      id: srcId,
      name: meta.name,
      description: meta.description,
      version: meta.version,
      author: meta.author,
      homepage: meta.homepage,
      origin_url: realUrl,
      enabled: true,
      addedAt: Date.now(),
    };
    entries.push(entry);
    await saveRegistry(entries);
    return { success: true, entry };
  } catch (e) {
    console.error('[SourceManager] importFromUrl error:', e.message, e.stack);
    return { success: false, error: e.message };
  }
}

/**
 * 从文件导入音源
 */
export async function importFromFile(onProgress) {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/javascript',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets || result.assets.length === 0) {
      return { success: false, canceled: true };
    }

    onProgress?.('正在读取文件...');
    const file = result.assets[0];
    const response = await fetch(file.uri);
    const jsCode = await response.text();

    onProgress?.('正在解析音源信息...');
    const meta = parseMetadata(jsCode);
    if (!meta) return { success: false, error: '无效的音源文件（找不到头部注释块）' };

    onProgress?.('正在注册音源...');
    const srcId = generateSourceId(jsCode);
    const entries = await loadRegistry();
    if (entries.some(e => e.id === srcId)) {
      return { success: false, error: '该音源已存在' };
    }

    await writeSourceCode(srcId, jsCode);

    const entry = {
      id: srcId,
      name: meta.name,
      description: meta.description,
      version: meta.version,
      author: meta.author,
      homepage: meta.homepage,
      origin_url: '',
      enabled: true,
      addedAt: Date.now(),
    };
    entries.push(entry);
    await saveRegistry(entries);
    return { success: true, entry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 删除音源
 */
export async function deleteSource(sourceId) {
  const entries = await loadRegistry();
  const idx = entries.findIndex(e => e.id === sourceId);
  if (idx >= 0) {
    await deleteSourceCode(sourceId);
    entries.splice(idx, 1);
    await saveRegistry(entries);
    return { success: true };
  }
  return { success: false, error: '音源不存在' };
}

/**
 * 启用/禁用音源
 */
export async function setSourceEnabled(sourceId, enabled) {
  const entries = await loadRegistry();
  const entry = entries.find(e => e.id === sourceId);
  if (entry) {
    entry.enabled = enabled;
    await saveRegistry(entries);
    return { success: true };
  }
  return { success: false, error: '音源不存在' };
}

/**
 * 更新音源（从原始 URL 重新拉取）
 */
export async function updateSource(sourceId) {
  try {
    const entries = await loadRegistry();
    const entry = entries.find(e => e.id === sourceId);
    if (!entry) return { success: false, error: '音源不存在' };
    if (!entry.origin_url) return { success: false, error: '该音源不是通过 URL 导入的，无法自动更新' };

    const jsCode = await fetchText(entry.origin_url);
    const meta = parseMetadata(jsCode);
    if (meta) {
      entry.name = meta.name || entry.name;
      entry.description = meta.description || entry.description;
      entry.version = meta.version || entry.version;
      entry.author = meta.author || entry.author;
      entry.homepage = meta.homepage || entry.homepage;
    }
    await writeSourceCode(sourceId, jsCode);
    await saveRegistry(entries);
    return { success: true, entry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// =====================================================================
// 统一搜索入口
// =====================================================================

/**
 * 多源搜索统一入口（双轴模式）
 * @param {string} searchSource 搜索来源（netease/tencent/kuwo/kugou/migu/aggregate）
 * @param {string} keyword 搜索关键词
 * @returns {Promise<Array>} 搜索结果数组，每条带 _platform 字段
 */
export async function musicSearch(searchSource, keyword, page = 0) {
  try {
    // 聚合搜索：五大平台并行搜索，合并去重按热度排序
    if (searchSource === 'aggregate') {
      const platforms = ['netease', 'tencent', 'kuwo', 'kugou'];
      const results = await Promise.allSettled(
        platforms.map(p => searchByPlatform(p, keyword, page))
      );
      return mergeSearchResults(results, platforms);
    }
    // LX 音源: 搜索回退到网易云，但标记 _src 为 LX 来源
    if (searchSource.startsWith('lx:')) {
      const results = await neteaseSearch(keyword, page * 30);
      return results.map(s => ({ ...s, _src: searchSource, _platform: 'netease' }));
    }
    // 内置音源
    return await searchByPlatform(searchSource, keyword, page);
  } catch (e) {
    console.error('[SourceManager] Search error:', e.message);
    return [];
  }
}

/**
 * 单平台搜索（内部函数）
 */
async function searchByPlatform(platform, keyword, page = 0) {
  switch (platform) {
    case 'netease':
      return (await neteaseSearch(keyword, page * 30)).map(s => ({ ...s, _platform: 'netease' }));
    case 'tencent':
      return (await tencentSearch(keyword, page)).map(s => ({ ...s, _platform: 'tencent' }));
    case 'kuwo':
      return (await kuwoSearch(keyword, page)).map(s => ({ ...s, _platform: 'kuwo' }));
    case 'kugou':
      return (await kugouSearch(keyword, page)).map(s => ({ ...s, _platform: 'kugou' }));
    default:
      return [];
  }
}

/**
 * 聚合搜索合并：去重 + 按热度排序
 * - 多平台命中数优先（同一首歌在越多平台出现越排前）
 * - 其次热度分（各平台排名加权，网易云权重最高）
 */
function mergeSearchResults(results, platforms) {
  const merged = [];
  const seen = new Map(); // key: normalizedName__normalizedArtist -> index

  const platformWeight = {
    netease: 5, tencent: 4, kuwo: 3, kugou: 2,
  };

  for (let i = 0; i < results.length; i++) {
    if (results[i].status !== 'fulfilled') continue;
    const platformResults = results[i].value;
    const platform = platforms[i];

    for (let rank = 0; rank < platformResults.length; rank++) {
      const song = platformResults[rank];
      const key = normalizeKey(song.name, song.artist);

      if (seen.has(key)) {
        const existing = merged[seen.get(key)];
        existing._hitCount = (existing._hitCount || 1) + 1;
        existing._hotScore += (platformWeight[platform] || 1) * Math.max(1, 30 - rank);
        continue;
      }

      const hotScore = (platformWeight[platform] || 1) * Math.max(1, 30 - rank);
      seen.set(key, merged.length);
      merged.push({
        ...song,
        _platform: platform,
        _hitCount: 1,
        _hotScore: hotScore,
      });
    }
  }

  merged.sort((a, b) => {
    if (b._hitCount !== a._hitCount) return b._hitCount - a._hitCount;
    return b._hotScore - a._hotScore;
  });

  return merged;
}

function normalizeKey(name, artist) {
  return `${(name || '').toLowerCase().trim()}__${(artist || '').toLowerCase().trim()}`;
}

// =====================================================================
// 请求去重：相同 songId 的 URL 请求只发一次
// =====================================================================

const pendingUrlRequests = new Map();

/**
 * 统一 URL 获取入口（双轴模式）
 * @param {string} playSource 播放音源（'official' | 'lx:{sourceId}'）
 * @param {object|string} songOrId 歌曲对象（含 _platform）或 songId
 * @param {object} [song] 歌曲对象（可选，当第一个参数为 songId 时使用）
 * @returns {Promise<{url: string, isLocal: boolean}|null>}
 */
export async function musicSongUrl(playSource, songOrId, song) {
  let platform, songId, songObj;

  if (typeof songOrId === 'object' && songOrId !== null) {
    // 新模式：musicSongUrl(playSource, songObj)
    songObj = songOrId;
    songId = songObj.songId || songObj.id;
    platform = songObj._platform || songObj._src || 'netease';
    if (typeof platform === 'string' && platform.startsWith('lx:')) platform = 'netease';
  } else {
    // 旧模式：musicSongUrl(source, songId, song)
    songId = songOrId;
    songObj = song || {};
    platform = playSource;
    if (typeof platform === 'string' && platform.startsWith('lx:')) platform = 'netease';
    if (playSource === 'official') {
      platform = songObj._platform || songObj._src || 'netease';
      if (typeof platform === 'string' && platform.startsWith('lx:')) platform = 'netease';
    }
  }

  const cacheKey = `${platform}_${songId}`;

  // 从 store 获取当前音质设置
  const { usePlayerStore } = await import('../store/useStore');
  const quality = usePlayerStore.getState().musicQuality || 'standard';

  if (pendingUrlRequests.has(cacheKey)) {
    return pendingUrlRequests.get(cacheKey);
  }

  const promise = _musicSongUrlImpl(playSource, songId, platform, songObj, quality)
    .finally(() => {
      pendingUrlRequests.delete(cacheKey);
    });

  pendingUrlRequests.set(cacheKey, promise);
  return promise;
}

async function _musicSongUrlImpl(playSource, songId, platform, song, quality = 'standard') {
  try {
    const _t0 = Date.now();
    const _log = (label) => console.log(`[DBG] +${Date.now() - _t0}ms [source] ${label}`);
    _log(`musicSongUrl: playSource=${playSource} platform=${platform} songId=${songId}`);

    // ===== LX 音源播放 =====
    if (playSource.startsWith('lx:')) {
      const sourceId = playSource.slice(3);
      try {
        // 第一步: 优先 nativeLxMusicUrl（所有平台）
        _log('LX: nativeLxMusicUrl start (primary)');
        let url = await nativeLxMusicUrl(songId, platform, quality);
        _log(`LX: nativeLxMusicUrl done: ${url ? 'has url' : 'null'}`);
        if (url && typeof url === 'string' && url.startsWith('http')) {
          return { url, isLocal: false };
        }

        // 第二步: WebView 沙箱（传入平台参数，支持五平台）
        _log('LX: fallback to WebView');
        url = null;
        if (isSandboxReady()) {
          _log('LX: sandbox ready, getLxMusicUrlWebView start');
          url = await getLxMusicUrlWebView(sourceId, songId, '128k', platform);
          _log(`LX: getLxMusicUrlWebView done: ${url ? 'has url' : 'null'}`);
        } else {
          _log('LX: sandbox not ready, waitForSandboxReady(5000)');
          const waited = await waitForSandboxReady(5000);
          _log(`LX: waitForSandboxReady result: ${waited}`);
          if (waited) {
            url = await getLxMusicUrlWebView(sourceId, songId, '128k', platform);
            _log(`LX: getLxMusicUrlWebView done: ${url ? 'has url' : 'null'}`);
          }
        }
        if (url && typeof url === 'string' && url.startsWith('http')) {
          // 检测 QQ 音乐试听版 URL（RS02 开头，只有 30秒-1分钟）
          if (platform === 'tencent' && url.includes('/RS02')) {
            _log('LX: QQ music preview URL detected (RS02), fallback to official API');
            const officialUrl = await getOfficialUrl('tencent', songId, song, quality);
            if (officialUrl && officialUrl.url) {
              _log('LX: QQ music official API fallback success');
              return officialUrl;
            }
            _log('LX: QQ music official API fallback also failed');
          } else {
            return { url, isLocal: false };
          }
        }

        _log('LX: all methods failed, return null');
        return null;
      } catch (e) {
        console.error('[SourceManager] LX source URL error:', e.message);
        _log(`LX ERROR: ${e.message}`);
        return null;
      }
    }

    // ===== 官方 API 播放 =====
    if (playSource === 'official' || !playSource.startsWith('lx:')) {
      return await getOfficialUrl(platform, songId, song, quality);
    }

    return null;
  } catch (e) {
    console.error('[SourceManager] Song URL error:', e.message);
    return null;
  }
}

/**
 * 官方 API 获取 URL（按平台分发）
 */
async function getOfficialUrl(platform, songId, song, quality = 'standard') {
  const _log = (label) => console.log(`[DBG] [source] ${label}`);
  let result = null;
  switch (platform) {
    case 'netease':
      _log('official: neteaseSongUrl');
      result = await neteaseSongUrl(songId, quality);
      break;
    case 'tencent':
      _log('official: tencentSongUrl');
      { const u = await tencentSongUrl(songId); _log(`tencentSongUrl result: ${u ? u.substring(0, 80) : 'null'}`); result = { url: u, isLocal: false }; }
      break;
    case 'kuwo':
      _log('official: kuwoSongUrl');
      { const u = await kuwoSongUrl(songId); _log(`kuwoSongUrl result: ${u ? u.substring(0, 80) : 'null'}`); result = { url: u, isLocal: false }; }
      break;
    case 'kugou':
      _log('official: kugouSongUrl');
      { const u = await kugouSongUrl(songId); _log(`kugouSongUrl result: ${u ? u.substring(0, 80) : 'null'}`); result = { url: u, isLocal: false }; }
      break;
    default:
      _log('official: unknown platform, fallback netease');
      result = await neteaseSongUrl(songId, quality);
      break;
  }
  // 过滤无效 URL
  if (!result || (result.url && !result.url.startsWith('http'))) return null;
  if (result.url === null || result.url === undefined || result.url === '') return null;
  return result;
}

// =====================================================================
// 导出网易云专用 API（lyrics-engine 和 player-engine 使用）
// =====================================================================

export {
  neteaseSearch,
  neteaseSongUrl,
  neteaseLyrics,
  neteaseToplist,
  neteaseToplistDetail,
  neteaseShuffleSongs,
};

export default {
  musicSearch,
  musicSongUrl,
  importFromUrl,
  importFromFile,
  deleteSource,
  setSourceEnabled,
  updateSource,
  fetchText,
  fetchJSON,
  parseMetadata,
  generateSourceId,
  parseLxProtocol,
  loadRegistry,
  saveRegistry,
  readSourceCode,
  writeSourceCode,
  deleteSourceCode,
  neteaseSearch,
  neteaseSongUrl,
  neteaseLyrics,
  neteaseToplist,
  neteaseToplistDetail,
  neteaseShuffleSongs,
};
