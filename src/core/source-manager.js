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
import logger from './logger';

// =====================================================================
// 内置音源 API
// =====================================================================

// === 原生层 LX 音源 URL 获取 (后台 WebView 不可用时的替代方案) ===
// LX 音源脚本最终成功的是第三个 API: music-api.gdstudio.xyz
// 这个 API 返回完整 URL (非 30 秒试听), 可以在原生 OkHttp 层直接请求
async function nativeLxMusicUrl(songId, platform = 'netease', quality = 'standard') {
  // gdstudio.xyz 和 cenguigui 仅稳定支持网易云，其他平台（酷狗、酷我、腾讯等）直接进 WebView 沙箱，避免浪费数秒网络超时
  if (platform !== 'netease') {
    return null;
  }
  const _t0 = Date.now();
  const _log = (label) => logger.info('SourceManager:nativeLx', `+${Date.now() - _t0}ms ${label}`);
  _log(`start songId=${songId} platform=${platform} quality=${quality}`);
  const src = 'netease';
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

// === HTML 实体反转义工具 (参考 lx-music decodeName) ===
function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#32;/g, ' ')
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&#38;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&#40;/g, '(')
    .replace(/&#41;/g, ')')
    .replace(/&#58;/g, ':')
    .replace(/&#60;/g, '<')
    .replace(/&#62;/g, '>')
    .replace(/&#133;/g, '...');
}

// === Base64 UTF-8 解码工具 ===
function decodeBase64(str) {
  if (!str) return '';
  const clean = String(str).replace(/[\r\n\s]/g, '');
  // 1. Buffer 优先 (Node / polyfill 环境)
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(clean, 'base64').toString('utf8');
    }
  } catch {}
  // 2. TextDecoder + atob (Hermes / 现代 JS 原生支持，容错不中断)
  try {
    if (typeof atob === 'function' && typeof TextDecoder !== 'undefined') {
      const binary = atob(clean);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
  } catch {}
  // 3. crypto-js 兜底
  try {
    if (crypto && crypto.enc && crypto.enc.Base64) {
      const words = crypto.enc.Base64.parse(clean);
      const utf8 = words.toString(crypto.enc.Utf8);
      if (utf8) return utf8;
    }
  } catch {}
  // 4. 手动位移解码兜底
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const cClean = clean.replace(/=+$/, '');
    let bytes = [];
    for (let i = 0; i < cClean.length; i += 4) {
      const a = chars.indexOf(cClean[i]);
      const b = chars.indexOf(cClean[i + 1]);
      const c = cClean[i + 2] ? chars.indexOf(cClean[i + 2]) : 0;
      const d = cClean[i + 3] ? chars.indexOf(cClean[i + 3]) : 0;
      const n = (a << 18) | (b << 12) | (c << 6) | d;
      bytes.push((n >> 16) & 0xff);
      if (cClean[i + 2]) bytes.push((n >> 8) & 0xff);
      if (cClean[i + 3]) bytes.push(n & 0xff);
    }
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      const c = bytes[i++];
      if (c < 128) out += String.fromCharCode(c);
      else if (c > 191 && c < 224) out += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
      else if (c > 223 && c < 240) out += String.fromCharCode(((c & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
      else if (c > 239 && c < 248) {
        const cp = ((c & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
        out += String.fromCodePoint ? String.fromCodePoint(cp) : '';
      }
    }
    return out;
  } catch {}
  return '';
}

// === QQ音乐/腾讯歌词 (参考 lx-music-mobile) ===
async function tencentLyrics(songmid) {
  if (!songmid) return { lrc: '', tlyric: '' };
  logger.info('SourceManager', 'tencentLyrics start', { songmid });
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
        logger.info('SourceManager', 'tencentLyrics success', { lines: lrc ? lrc.split('\n').length : 0 });
        return { lrc, tlyric };
      } else {
        logger.warn('SourceManager', 'tencentLyrics non-zero code', parsed?.code);
      }
    }
  } catch (e) {
    logger.error('SourceManager', 'tencentLyrics error', e);
  }
  return { lrc: '', tlyric: '' };
}

// === 酷狗音乐歌词 (参考 lx-music-mobile 双阶段检索) ===
async function kugouLyrics(song) {
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
    console.error('[SourceManager] kugouLyrics error:', e.message);
  }
  return { lrc: '', tlyric: '' };
}

// === 酷我音乐歌词 (参考 lx-music-mobile) ===
async function kuwoLyrics(songId) {
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
    console.error('[SourceManager] kuwoLyrics error:', e.message);
  }
  return { lrc: '', tlyric: '' };
}

// === 跨源同名搜索兜底 (多源智能校验，杜绝曲目串音) ===
async function searchFallbackLyrics(name, artist) {
  if (!name) return { lrc: '', tlyric: '' };
  try {
    // 1. 提取首要歌手名，清洗合作者、工作室、特殊字符等 (如 "者来女 / 游戏科学 / 8082Audio" -> "者来女")
    const rawArtist = (artist || '').split(/[/,、&|;；]/)[0] || '';
    const cleanArtist = rawArtist.replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').trim();
    const keyword = `${name} ${cleanArtist}`.trim();
    console.log(`[SourceManager] searchFallbackLyrics keyword: "${keyword}" (original: "${name}" - "${artist}")`);

    const cleanTargetName = name.replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').toLowerCase();
    const rawTargetLower = (name || '').toLowerCase();
    const noiseKeywords = ['伴奏', 'instrumental', 'inst', '纯音乐', 'dj版', 'remix'];

    const isCandidateGood = (s) => {
      const sNameClean = (s.name || '').replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').toLowerCase();
      if (!sNameClean) return false;

      // 排除干扰版本（原名不带伴奏/DJ，但候选带伴奏/DJ）
      for (const noise of noiseKeywords) {
        if (!rawTargetLower.includes(noise) && sNameClean.includes(noise)) return false;
      }

      const nameMatches = sNameClean === cleanTargetName ||
                          sNameClean.startsWith(cleanTargetName) ||
                          cleanTargetName.startsWith(sNameClean) ||
                          sNameClean.includes(cleanTargetName);
      if (!nameMatches) return false;

      if (cleanArtist) {
        const sArtistClean = (s.artist || '').replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').toLowerCase();
        if (!sArtistClean) return false;
        const artistMatches = sArtistClean.includes(cleanArtist.toLowerCase()) || cleanArtist.toLowerCase().includes(sArtistClean);
        if (!artistMatches) return false;
      }
      return true;
    };

    // 2. 优先尝试酷狗搜索（曲库与歌词匹配度最高，覆盖ACG/游戏原声及小众音乐）
    try {
      const kgSongs = await kugouSearch(keyword, 0, 8);
      if (kgSongs && kgSongs.length > 0) {
        const matchingSongs = kgSongs.filter(isCandidateGood);
        // 优先完全匹配歌名的
        const kgMatch = matchingSongs.find(s => (s.name || '').replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').toLowerCase() === cleanTargetName) || matchingSongs[0];

        if (kgMatch) {
          console.log(`[SourceManager] searchFallbackLyrics KuGou match found: ${kgMatch.name} - ${kgMatch.artist}`);
          const result = await kugouLyrics(kgMatch);
          if (result && result.lrc) {
            return result;
          }
        }
      }
    } catch (e) {
      console.warn('[SourceManager] searchFallbackLyrics KuGou error:', e.message);
    }

    // 3. 尝试网易云搜索（带严格歌名与歌手匹配校验，严禁盲目取首条）
    try {
      const wySongs = await neteaseSearch(keyword, 8);
      if (wySongs && wySongs.length > 0) {
        const matchingSongs = wySongs.filter(isCandidateGood);
        // 优先完全匹配歌名的
        const wyMatch = matchingSongs.find(s => (s.name || '').replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').toLowerCase() === cleanTargetName) || matchingSongs[0];

        if (wyMatch) {
          console.log(`[SourceManager] searchFallbackLyrics NetEase match found: ${wyMatch.name} - ${wyMatch.artist}`);
          const result = await neteaseLyrics(wyMatch.id);
          if (result && result.lrc) {
            return result;
          }
        }
      }
    } catch (e) {
      console.warn('[SourceManager] searchFallbackLyrics NetEase error:', e.message);
    }
  } catch (e) {
    console.error('[SourceManager] searchFallbackLyrics error:', e.message);
  }
  return { lrc: '', tlyric: '' };
}

// 网易云歌曲封面补拉：搜索接口（/api/search/get/web）的 album 对象不含 picUrl，
// 需调 song/detail 换取完整专辑图。结果带内存缓存，切歌回放不重复请求。
// 实测：songs[0].album.picUrl 为 https CDN 地址，?param=300y300 可缩放。
const neteasePicCache = new Map(); // songId -> picUrl | ''
export async function neteaseSongPic(songId) {
  if (!songId) return '';
  if (neteasePicCache.has(songId)) return neteasePicCache.get(songId);
  try {
    const url = `https://music.163.com/api/song/detail?id=${songId}&idss=&ids=${encodeURIComponent(JSON.stringify([Number(songId)]))}`;
    const result = await fetchJSON(url);
    let pic = '';
    if (result.code === 200 && result.songs && result.songs[0]) {
      const alb = result.songs[0].album || {};
      pic = alb.picUrl || '';
      if (pic) {
        pic = String(pic).replace(/^http:/, 'https:').split('?')[0] + '?param=300y300';
      }
    }
    neteasePicCache.set(songId, pic);
    if (neteasePicCache.size > 300) {
      // 简单防溢出：超 300 条时清掉前一半（FIFO）
      let drop = neteasePicCache.size - 200;
      for (const k of neteasePicCache.keys()) {
        if (drop-- <= 0) break;
        neteasePicCache.delete(k);
      }
    }
    return pic;
  } catch (e) {
    console.error('[SourceManager] Song pic error:', e.message);
    return '';
  }
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
        // 榜单详情接口的 tracks 自带 al.picUrl（实测验证；如缺失由切歌补拉兜底）
        // 接口返回 http://，图床本身支持 https，统一升级避免 cleartext 依赖
        picUrl: (song.al && song.al.picUrl) ? String(song.al.picUrl).replace(/^http:/, 'https:') + '?param=300y300' : '',
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
        // 封面：搜索自带 web_albumpic_short（形如 "120/s3s94/93/xxx.jpg"，首段是尺寸）
        // 拼接 img1.kwcdn.kuwo.cn/star/albumcover/{size}/...（实测 200/108KB@500px）
        // 注意：该 CDN https 证书不匹配（SAN 不含此域名）→ 只能用 http，
        // 依赖 AndroidManifest 的 usesCleartextTraffic=true。将来关 cleartext 时需改造。
        picUrl: s.web_albumpic_short
          ? 'http://img1.kwcdn.kuwo.cn/star/albumcover/500/' + String(s.web_albumpic_short).replace(/^\d+\//, '')
          : '',
      };
    });
    return songs;
  } catch {
    return [];
  }
}

async function kuwoSongUrl(songId, song = null) {
  try {
    // 过滤 VIP 曲目：酷我官方 antiserver 对 VIP 歌曲仅返回 11 秒提示语音（"该歌曲为VIP专享，请在酷我音乐客户端试听"）
    if (song && (song.fee === 1 || song.fee === 8)) {
      logger.warn('SourceManager:kuwo', `Skipping VIP song (${songId}) on official kuwo API to prevent 11s promo audio`);
      return null;
    }
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
        // 封面：搜索接口自带 Image 字段（形如 http://imge.kugou.com/stdmusic/{size}/xxx.jpg）
        // {size} 替换为 240/400 即可缩放（实测 https 可用，与 http 同源同证书）
        picUrl: s.Image ? s.Image.replace('{size}', '400').replace(/^http:/, 'https:') : '',
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

const kugouPicCache = new Map();
async function kugouSongPic(songId, track = null) {
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
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://y.qq.com/',
    };

    // 方案 1 (首选)：现役稳定免签搜索接口 search_for_qq_cp
    // 实测无风控限制（相较于被废弃的 client_search_cp 与易触发 code:2001 风控的 musicu.fcg，该接口非常稳定且支持分页）
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
      logger.warn('SourceManager:tencentSearch', 'search_for_qq_cp request error', e.message);
    }

    // 方案 2 (备用)：若首选接口无结果，降级尝试 musicu.fcg (DoSearchForQQMusicDesktop)
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

    // 方案 3 (兜底)：若仍无结果，尝试 smartbox_new.fcg 联想热搜兜底
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
          return sItemList.map(s => ({
            id: s.mid || s.docid || '',
            name: s.name || '',
            artist: s.singer || '',
            album: '',
            duration: 0,
            fee: 0,
            _src: 'tencent',
            _platform: 'tencent',
            picUrl: s.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.mid}.jpg` : '',
          }));
        }
      } catch {}
    }

    if (!songList || !Array.isArray(songList)) {
      return [];
    }

    const songs = songList.map(s => {
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
        } else if (s.pay.payalbum === 1 || s.pay.pay_album === 1) {
          fee = 8;
        }
      }

      return {
        id: mid,
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
      };
    });

    return songs;
  } catch (e) {
    logger.error('SourceManager:tencentSearch', 'Search failed', e);
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

const tencentPicCache = new Map();
async function tencentSongPic(songmid) {
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
    logger.warn('SourceManager', 'tencentSongPic error', e.message);
    return '';
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

/**
 * 在线歌曲封面补拉（全平台统一入口）
 * 解决用户收藏/老歌单条目缺少 picUrl 导致播放时无封面的问题
 */
async function fetchOnlineSongPic(track) {
  if (!track) return '';
  if (track.picUrl || track.cover) return track.picUrl || track.cover;
  const platform = detectPlatform(track);
  const songId = track.songId || track.id;
  let url = '';
  try {
    if (platform === 'netease' && songId) {
      url = await neteaseSongPic(songId);
    } else if (platform === 'tencent' && songId) {
      url = await tencentSongPic(songId);
    } else if (platform === 'kugou') {
      url = await kugouSongPic(songId, track);
    }
    // 兜底：若直连平台接口未能获取到封面，且有歌名，进行同名极速检索补齐封面
    if (!url && track.name) {
      const kw = `${track.name} ${track.artist || ''}`.trim();
      const targetPlat = (platform && platform !== 'unknown') ? platform : 'tencent';
      const results = await musicSearch(targetPlat, kw, 0);
      const match = (results || []).find(s => s.picUrl);
      if (match) url = match.picUrl;
      if (!url) {
        const altPlat = targetPlat === 'netease' ? 'tencent' : 'netease';
        const altResults = await musicSearch(altPlat, kw, 0);
        const altMatch = (altResults || []).find(s => s.picUrl);
        if (altMatch) url = altMatch.picUrl;
      }
    }
  } catch (e) {
    logger.warn('SourceManager', 'fetchOnlineSongPic error', e.message);
  }
  return url;
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
    const _log = (label) => logger.info('SourceManager:musicSongUrl', `+${Date.now() - _t0}ms ${label}`);
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

        // 第二步: WebView 沙箱（传入平台与歌曲元数据，支持五平台与规范ID）
        _log('LX: fallback to WebView');
        url = null;
        if (isSandboxReady()) {
          _log('LX: sandbox ready, getLxMusicUrlWebView start');
          url = await getLxMusicUrlWebView(sourceId, songId, '128k', platform, song);
          _log(`LX: getLxMusicUrlWebView done: ${url ? 'has url' : 'null'}`);
        } else {
          _log('LX: sandbox not ready, waitForSandboxReady(5000)');
          const waited = await waitForSandboxReady(5000);
          _log(`LX: waitForSandboxReady result: ${waited}`);
          if (waited) {
            url = await getLxMusicUrlWebView(sourceId, songId, '128k', platform, song);
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
// 多音源级联自动切换调度器 (Cascade Resolver)
// =====================================================================

/**
 * 智能检测歌曲所属平台
 * 优先根据明确的 platform/_src/source 字段，其次根据歌曲 ID 特征
 * @param {object} song 歌曲对象
 * @returns {string} 'netease' | 'tencent' | 'kuwo' | 'kugou'
 */
export function detectPlatform(song) {
  if (!song) return 'netease';
  const rawPlat = song._platform || song._src || song.platform || song.source;
  if (rawPlat && ['netease', 'tencent', 'kuwo', 'kugou'].includes(rawPlat)) {
    return rawPlat;
  }
  const idStr = String(song.songId || song.id || song.hash || song.mid || '');
  if (idStr.includes('|') || /^[A-Fa-f0-9]{32}$/.test(idStr)) {
    return 'kugou';
  }
  if (idStr.startsWith('MUSIC_') || (song.KMARK !== undefined && song.KMARK !== null)) {
    return 'kuwo';
  }
  if (/^00[0-9a-zA-Z]{12}$/.test(idStr)) {
    return 'tencent';
  }
  return 'netease';
}

function withTimeout(promise, ms, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
    ),
  ]);
}

/**
 * 跨搜索来源使用自定义(LX)音源解析
 * 当原平台（如网易云）无法解析或无版权时，在其他平台（酷狗、酷我、QQ等）检索同名同歌手曲目，
 * 并继续使用用户启用的自定义音源（LX Source）尝试解析播放。
 * 严格杜绝官方 API 跨平台偷换/降级，杜绝 11 秒提示音。
 *
 * @param {object} song 原歌曲对象
 * @param {string} preferredLxSourceId 首选自定义音源 ID（如 'lx:xxx'）
 * @param {string} quality 音质
 * @returns {Promise<{url: string, isLocal: boolean, sourceId: string, sourceName: string, switched: boolean, matchedSong: object}|null>}
 */
async function searchFallbackWithLxSource(song, preferredLxSourceId = '', quality = 'standard') {
  if (!song) return null;
  const title = song.name || song.title || '';
  const artist = song.artist || '';
  if (!title) return null;

  const originalPlatform = detectPlatform(song);
  const rawArtist = (artist || '').split(/[/,、&|;；]/)[0] || '';
  const cleanArtist = rawArtist.replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').trim().toLowerCase();
  const cleanTargetName = title.replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').toLowerCase();
  const keyword = `${title} ${cleanArtist}`.trim();

  // 获取所有可用的自定义音源列表（按优先级：首选自定义源排在最前）
  let customSources = [];
  try {
    const registry = await loadRegistry();
    const enabledCustoms = registry.filter(e => e && e.enabled !== false);
    if (preferredLxSourceId && preferredLxSourceId.startsWith('lx:')) {
      const prefId = preferredLxSourceId.slice(3);
      const prefEntry = enabledCustoms.find(e => e.id === prefId);
      const others = enabledCustoms.filter(e => e.id !== prefId);
      customSources = (prefEntry ? [prefEntry, ...others] : enabledCustoms).map(e => ({
        id: 'lx:' + e.id,
        name: e.name || '自定义音源',
      }));
    } else {
      customSources = enabledCustoms.map(e => ({
        id: 'lx:' + e.id,
        name: e.name || '自定义音源',
      }));
    }
  } catch (e) {
    logger.error('SourceManager', 'searchFallbackWithLxSource failed to load registry', e);
  }

  if (customSources.length === 0) {
    logger.info('SourceManager', 'searchFallbackWithLxSource: No enabled custom sources available for cross-platform matching');
    return null;
  }

  const isStrictMatch = (s) => {
    if (!s || !s.name) return false;
    const sNameClean = (s.name || '').replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').toLowerCase();
    const nameMatches = sNameClean === cleanTargetName || sNameClean.includes(cleanTargetName) || cleanTargetName.includes(sNameClean);
    if (!nameMatches) return false;
    if (cleanArtist) {
      const sArtistClean = (s.artist || '').replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').toLowerCase();
      return sArtistClean.includes(cleanArtist) || cleanArtist.includes(sArtistClean);
    }
    return true;
  };

  const platforms = ['kugou', 'kuwo', 'netease', 'tencent'].filter(p => p !== originalPlatform);
  const platNames = { kugou: '酷狗', kuwo: '酷我', netease: '网易云', tencent: 'QQ音乐' };

  for (const plat of platforms) {
    try {
      let songs = [];
      if (plat === 'kugou') songs = await kugouSearch(keyword, 0, 5);
      else if (plat === 'kuwo') songs = await kuwoSearch(keyword, 0, 5);
      else if (plat === 'netease') songs = await neteaseSearch(keyword, 0, 5);
      else if (plat === 'tencent') songs = await tencentSearch(keyword, 0, 5);

      if (songs && songs.length > 0) {
        const match = songs.find(isStrictMatch);
        if (match && match.id) {
          logger.info('SourceManager', `searchFallbackWithLxSource matched on ${plat}: ${match.name} - ${match.artist} (id: ${match.id})`);
          // 依次尝试用户启用的自定义音源解析此匹配曲目
          for (const cSource of customSources) {
            try {
              const res = await withTimeout(
                _musicSongUrlImpl(cSource.id, match.id, plat, match, quality),
                10000,
                `fallback-${plat}-${cSource.name}`
              );
              if (res && res.url && typeof res.url === 'string' && res.url.startsWith('http')) {
                logger.info('SourceManager', `searchFallbackWithLxSource success: [${plat}] via [${cSource.name}]`);
                return {
                  url: res.url,
                  isLocal: false,
                  sourceId: cSource.id,
                  sourceName: `${cSource.name} (${platNames[plat] || plat})`,
                  switched: true,
                  matchedSong: match,
                };
              }
            } catch (err) {
              logger.warn('SourceManager', `searchFallbackWithLxSource try [${cSource.name}] failed on ${plat}: ${err.message}`);
            }
          }
        }
      }
    } catch (e) {
      logger.warn('SourceManager', `searchFallbackWithLxSource error on ${plat}: ${e.message}`);
    }
  }

  return null;
}

const pendingCascadeMap = new Map();

/**
 * 多音源级联解析调度器
 * 严格遵循用户原则：
 * 1. 优先当前选定音源（若为 LX 自定义音源，给足 15 秒超时，绝不因沙箱延迟被误杀）
 * 2. 次选用户导入的其他已启用自定义音源（各 10 秒超时）
 * 3. 跨搜索平台切换：在其他平台同名匹配，并使用自定义音源进行解析（绝不调用官方跨平台API偷换曲目）
 * 4. 官方非 VIP 原平台兜底：仅当原曲非 VIP（fee !== 1 && fee !== 8）时允许播放原平台普通直链
 * 5. 若均无法解析，返回 null，播放器提示无法播放
 *
 * @param {object} song 歌曲对象
 * @param {string} currentPlaySource 当前选中的音源 (official | lx:xxx)
 * @param {string} quality 音质
 * @returns {Promise<{url: string, isLocal: boolean, sourceId: string, sourceName: string, switched: boolean}|null>}
 */
async function resolvePlayableUrlCascade(song, currentPlaySource = 'official', quality = 'standard') {
  if (!song) return null;
  const songId = song.songId || song.id;
  const platform = detectPlatform(song);
  const title = song.name || song.title || '';
  const artist = song.artist || '';

  const cascadeKey = `${currentPlaySource}_${platform}_${songId || title}`;
  if (pendingCascadeMap.has(cascadeKey)) {
    return pendingCascadeMap.get(cascadeKey);
  }

  const cascadePromise = (async () => {
    logger.info('SourceManager', `Cascade start for "${title}" (${songId}) [platform=${platform}, primary=${currentPlaySource}]`);

    // ==========================================
    // 【第 1 梯队】：当前选定的音源 (Primary Source)
    // ==========================================
    if (songId) {
      try {
        const isLx = currentPlaySource.startsWith('lx:');
        // 自定义音源给 15 秒充足超时（沙箱跨进程+外部脚本请求耗时较长），官方源给 5 秒
        const timeoutMs = isLx ? 15000 : 5000;
        logger.info('SourceManager', `Cascade Tier 1: Trying primary source [${currentPlaySource}] with timeout ${timeoutMs}ms`);
        const primaryRes = await withTimeout(
          _musicSongUrlImpl(currentPlaySource, songId, platform, song, quality),
          timeoutMs,
          `Tier1-${currentPlaySource}`
        );
        if (primaryRes && primaryRes.url && primaryRes.url.startsWith('http')) {
          logger.info('SourceManager', `Cascade Tier 1: Success with primary [${currentPlaySource}]`);
          return {
            url: primaryRes.url,
            isLocal: primaryRes.isLocal || false,
            sourceId: currentPlaySource,
            sourceName: '',
            switched: false,
          };
        }
      } catch (e) {
        logger.warn('SourceManager', `Cascade Tier 1 failed: ${e.message}`);
      }
    }

    // ==========================================
    // 【第 2 梯队】：用户导入的其他已启用自定义音源 (Custom Sources)
    // ==========================================
    try {
      const registry = await loadRegistry();
      const currentLxId = currentPlaySource.startsWith('lx:') ? currentPlaySource.slice(3) : null;
      const customCandidates = registry.filter(e => e && e.enabled !== false && e.id !== currentLxId);

      if (customCandidates.length > 0 && songId) {
        logger.info('SourceManager', `Cascade Tier 2: Found ${customCandidates.length} custom sources to try`);
        for (const entry of customCandidates) {
          try {
            logger.info('SourceManager', `Cascade Tier 2: Trying [${entry.name}] (${entry.id})`);
            const customRes = await withTimeout(
              _musicSongUrlImpl('lx:' + entry.id, songId, platform, song, quality),
              10000,
              `Tier2-${entry.name}`
            );
            if (customRes && customRes.url && customRes.url.startsWith('http')) {
              logger.info('SourceManager', `Cascade Tier 2: Success with [${entry.name}]`);
              return {
                url: customRes.url,
                isLocal: false,
                sourceId: 'lx:' + entry.id,
                sourceName: entry.name || '自定义音源',
                switched: true,
              };
            }
          } catch (e) {
            logger.warn('SourceManager', `Cascade Tier 2 [${entry.name}] failed: ${e.message}`);
          }
        }
      }
    } catch (e) {
      logger.error('SourceManager', 'Cascade Tier 2 registry error', e);
    }

    // ==========================================
    // 【第 3 梯队】：跨搜索来源切换（使用自定义音源进行同名严格解析）
    // 杜绝官方跨平台偷换，只在其他平台检索后由用户导入的音源解析
    // ==========================================
    try {
      logger.info('SourceManager', `Cascade Tier 3: Trying cross-search-platform with LX source for "${title}" - "${artist}"`);
      const crossLxRes = await searchFallbackWithLxSource(song, currentPlaySource, quality);
      if (crossLxRes && crossLxRes.url && crossLxRes.url.startsWith('http')) {
        logger.info('SourceManager', `Cascade Tier 3: Success with ${crossLxRes.sourceName}`);
        return crossLxRes;
      }
    } catch (e) {
      logger.warn('SourceManager', `Cascade Tier 3 error: ${e.message}`);
    }

    // ==========================================
    // 【第 4 梯队】：原平台官方免费曲目兜底
    // 严格限制：非 VIP 曲目（fee !== 1 && fee !== 8），且绝不跨平台降级
    // ==========================================
    const isVip = song.fee === 1 || song.fee === 8;
    if (!isVip && songId) {
      try {
        logger.info('SourceManager', `Cascade Tier 4: Trying official non-VIP link on platform [${platform}]`);
        const offRes = await withTimeout(
          getOfficialUrl(platform, songId, song, quality),
          4000,
          `Tier4-official-${platform}`
        );
        if (offRes && offRes.url && offRes.url.startsWith('http')) {
          logger.info('SourceManager', `Cascade Tier 4: Success with official platform [${platform}]`);
          return {
            url: offRes.url,
            isLocal: false,
            sourceId: 'official',
            sourceName: '官方免费源',
            switched: currentPlaySource !== 'official',
          };
        }
      } catch (e) {
        logger.warn('SourceManager', `Cascade Tier 4 failed: ${e.message}`);
      }
    } else if (isVip) {
      logger.info('SourceManager', `Cascade Tier 4 skipped: Song is VIP (fee=${song.fee}), official API cannot play`);
    }

    // ==========================================
    // 【第 5 梯队】：全部音源均无法播放
    // ==========================================
    logger.warn('SourceManager', `Cascade: All sources exhausted for "${title}" (${songId})`);
    return null;
  })().finally(() => {
    pendingCascadeMap.delete(cascadeKey);
  });

  pendingCascadeMap.set(cascadeKey, cascadePromise);
  return cascadePromise;
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
  tencentLyrics,
  kugouLyrics,
  kuwoLyrics,
  searchFallbackLyrics,
  searchFallbackWithLxSource,
  resolvePlayableUrlCascade,
  tencentSongPic,
  kugouSongPic,
  fetchOnlineSongPic,
};

export default {
  detectPlatform,
  musicSearch,
  musicSongUrl,
  resolvePlayableUrlCascade,
  searchFallbackWithLxSource,
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
  tencentLyrics,
  kugouLyrics,
  kuwoLyrics,
  searchFallbackLyrics,
  tencentSongPic,
  kugouSongPic,
  fetchOnlineSongPic,
};
