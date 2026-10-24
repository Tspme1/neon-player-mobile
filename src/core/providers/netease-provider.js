// 网易云音乐 Provider (搜索 / 播放直链 / 歌词 / 封面补拉 / 排行榜 / 漫游)
import { fetchJSON } from '../http/http-client';
import { normalizeTrack } from '../models/track';

const neteasePicCache = new Map(); // songId -> picUrl | ''

export async function neteaseSearch(keyword, offset = 0, limit = 30) {
  const url = `https://music.163.com/api/search/get/web?csrf_token=&hlpretag=&hlposttag=&s=${encodeURIComponent(keyword)}&type=1&offset=${offset}&total=true&limit=${limit}`;
  const result = await fetchJSON(url);
  if (result.code === 200 && result.result && result.result.songs) {
    return result.result.songs.map(song => normalizeTrack({
      id: song.id,
      songId: song.id,
      name: song.name,
      artist: song.artists ? song.artists.map(a => a.name).join(', ') : '',
      album: song.album ? song.album.name : '',
      duration: Math.floor((song.duration || 0) / 1000),
      fee: song.fee || 0,
      _src: 'netease',
      _platform: 'netease',
    }, 'netease'));
  }
  return [];
}

export async function neteaseSongUrl(songId, quality = 'standard') {
  const outerUrl = `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
  try {
    const levelMap = { low: 'standard', standard: 'standard', high: 'exhigh', lossless: 'lossless' };
    const level = levelMap[quality] || 'standard';
    const apiUrl = `https://music.163.com/api/song/enhance/player/url/v1?ids=[${songId}]&level=${level}&encodeType=aac`;
    const result = await fetchJSON(apiUrl);
    if (result.code === 200 && result.data && result.data.length > 0 && result.data[0].url) {
      return { url: result.data[0].url, isLocal: false };
    }
  } catch {
    // fall through to outer URL
  }
  return { url: outerUrl, isLocal: false };
}

export async function neteaseLyrics(songId) {
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
    console.error('[NeteaseProvider] Lyrics error:', e.message);
  }
  return { lrc: '', tlyric: '' };
}

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
      let drop = neteasePicCache.size - 200;
      for (const k of neteasePicCache.keys()) {
        if (drop-- <= 0) break;
        neteasePicCache.delete(k);
      }
    }
    return pic;
  } catch (e) {
    console.error('[NeteaseProvider] Song pic error:', e.message);
    return '';
  }
}

export async function neteaseToplist() {
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
    console.error('[NeteaseProvider] Toplist error:', e.message);
  }
  return [];
}

export async function neteaseToplistDetail(toplistId) {
  try {
    const url = `https://music.163.com/api/v6/playlist/detail?id=${toplistId}&n=100`;
    const result = await fetchJSON(url);
    if (result.code === 200 && result.playlist && result.playlist.tracks) {
      return result.playlist.tracks.slice(0, 100).map(song => normalizeTrack({
        id: song.id,
        songId: song.id,
        name: song.name,
        artist: song.ar ? song.ar.map(a => a.name).join(', ') : '',
        album: song.al ? song.al.name : '',
        duration: Math.floor((song.dt || 0) / 1000),
        fee: song.fee || 0,
        picUrl: (song.al && song.al.picUrl) ? String(song.al.picUrl).replace(/^http:/, 'https:') + '?param=300y300' : '',
      }, 'netease'));
    }
  } catch (e) {
    console.error('[NeteaseProvider] Toplist detail error:', e.message);
  }
  return [];
}

export async function neteaseShuffleSongs() {
  try {
    const toplistIds = [3778678, 19723756, 3779629, 2884035];
    const songs = [];
    for (const id of toplistIds) {
      try {
        const url = `https://music.163.com/api/v6/playlist/detail?id=${id}&n=100`;
        const result = await fetchJSON(url);
        if (result.code === 200 && result.playlist && result.playlist.tracks) {
          result.playlist.tracks.slice(0, 15).forEach(song => {
            songs.push(normalizeTrack({
              id: song.id,
              songId: song.id,
              name: song.name,
              artist: song.ar ? song.ar.map(a => a.name).join(', ') : '',
              album: song.al ? song.al.name : '',
              duration: Math.floor((song.dt || 0) / 1000),
              fee: song.fee || 0,
              picUrl: (song.al && song.al.picUrl) ? String(song.al.picUrl).replace(/^http:/, 'https:') + '?param=300y300' : '',
            }, 'netease'));
          });
        }
      } catch {
        // skip failed
      }
    }
    for (let i = songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [songs[i], songs[j]] = [songs[j], songs[i]];
    }
    return songs.slice(0, 40);
  } catch (e) {
    console.error('[NeteaseProvider] Shuffle songs error:', e.message);
    return [];
  }
}

export default {
  neteaseSearch,
  neteaseSongUrl,
  neteaseLyrics,
  neteaseSongPic,
  neteaseToplist,
  neteaseToplistDetail,
  neteaseShuffleSongs,
};
