/**
 * 多音源级联解析、跨源搜索聚合、封面补拉、跨源歌词兜底调度器 (Cascade Resolver)
 * 从原 source-manager.js 解耦，并通过 storage.getSettingsSync() 彻底消除与 Zustand Store 的循环依赖
 */

import logger from '../logger';
import { detectPlatform } from '../models/track';
import { withTimeout } from '../http/http-client';
import { getSettingsSync } from '../storage';
import {
  neteaseSearch,
  neteaseSongUrl,
  neteaseLyrics,
  neteaseSongPic,
} from '../providers/netease-provider';
import {
  tencentSearch,
  tencentSongUrl,
  tencentSongPic,
} from '../providers/tencent-provider';
import {
  kuwoSearch,
  kuwoSongUrl,
} from '../providers/kuwo-provider';
import {
  kugouSearch,
  kugouSongUrl,
  kugouLyrics,
  kugouSongPic,
} from '../providers/kugou-provider';
import {
  miguSearch,
  miguSongUrl,
} from '../providers/migu-provider';
import {
  loadRegistry,
  resolveLxPlayUrl,
} from '../providers/lx-provider';

// =====================================================================
// 跨源同名搜索歌词兜底 (多源智能校验，杜绝曲目串音)
// =====================================================================

export async function searchFallbackLyrics(name, artist) {
  if (!name) return { lrc: '', tlyric: '' };
  try {
    const rawArtist = (artist || '').split(/[/,、&|;；]/)[0] || '';
    const cleanArtist = rawArtist.replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').trim();
    const keyword = `${name} ${cleanArtist}`.trim();
    console.log(`[CascadeResolver] searchFallbackLyrics keyword: "${keyword}" (original: "${name}" - "${artist}")`);

    const cleanTargetName = name.replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').toLowerCase();
    const rawTargetLower = (name || '').toLowerCase();
    const noiseKeywords = ['伴奏', 'instrumental', 'inst', '纯音乐', 'dj版', 'remix'];

    const isCandidateGood = (s) => {
      const sNameClean = (s.name || '').replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').toLowerCase();
      if (!sNameClean) return false;

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

    // 优先尝试酷狗搜索（曲库与歌词匹配度最高）
    try {
      const kgSongs = await kugouSearch(keyword, 0, 8);
      if (kgSongs && kgSongs.length > 0) {
        const matchingSongs = kgSongs.filter(isCandidateGood);
        const kgMatch = matchingSongs.find(s => (s.name || '').replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').toLowerCase() === cleanTargetName) || matchingSongs[0];

        if (kgMatch) {
          console.log(`[CascadeResolver] searchFallbackLyrics KuGou match found: ${kgMatch.name} - ${kgMatch.artist}`);
          const result = await kugouLyrics(kgMatch);
          if (result && result.lrc) {
            return result;
          }
        }
      }
    } catch (e) {
      console.warn('[CascadeResolver] searchFallbackLyrics KuGou error:', e.message);
    }

    // 尝试网易云搜索
    try {
      const wySongs = await neteaseSearch(keyword, 8);
      if (wySongs && wySongs.length > 0) {
        const matchingSongs = wySongs.filter(isCandidateGood);
        const wyMatch = matchingSongs.find(s => (s.name || '').replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').toLowerCase() === cleanTargetName) || matchingSongs[0];

        if (wyMatch) {
          console.log(`[CascadeResolver] searchFallbackLyrics NetEase match found: ${wyMatch.name} - ${wyMatch.artist}`);
          const result = await neteaseLyrics(wyMatch.id);
          if (result && result.lrc) {
            return result;
          }
        }
      }
    } catch (e) {
      console.warn('[CascadeResolver] searchFallbackLyrics NetEase error:', e.message);
    }
  } catch (e) {
    console.error('[CascadeResolver] searchFallbackLyrics error:', e.message);
  }
  return { lrc: '', tlyric: '' };
}

// =====================================================================
// 统一搜索入口（双轴模式 + 聚合搜索）
// =====================================================================

export async function musicSearch(searchSource, keyword, page = 0) {
  try {
    if (searchSource === 'aggregate') {
      const platforms = ['netease', 'tencent', 'kuwo', 'kugou'];
      const results = await Promise.allSettled(
        platforms.map(p => searchByPlatform(p, keyword, page))
      );
      return mergeSearchResults(results, platforms);
    }
    if (searchSource.startsWith('lx:')) {
      const results = await neteaseSearch(keyword, page * 30);
      return results.map(s => ({ ...s, _src: searchSource, _platform: 'netease' }));
    }
    return await searchByPlatform(searchSource, keyword, page);
  } catch (e) {
    console.error('[CascadeResolver] Search error:', e.message);
    return [];
  }
}

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
    case 'migu':
      return (await miguSearch(keyword)).map(s => ({ ...s, _platform: 'migu' }));
    default:
      return [];
  }
}

function mergeSearchResults(results, platforms) {
  const merged = [];
  const seen = new Map();

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
// 在线歌曲封面补拉（全平台统一入口）
// =====================================================================

export async function fetchOnlineSongPic(track) {
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
    logger.warn('CascadeResolver', 'fetchOnlineSongPic error', e.message);
  }
  return url;
}

// =====================================================================
// 统一 URL 获取入口与官方 API 分发
// =====================================================================

const pendingUrlRequests = new Map();

export async function musicSongUrl(playSource, songOrId, song) {
  let platform, songId, songObj;

  if (typeof songOrId === 'object' && songOrId !== null) {
    songObj = songOrId;
    songId = songObj.songId || songObj.id;
    platform = songObj._platform || songObj._src || 'netease';
    if (typeof platform === 'string' && platform.startsWith('lx:')) platform = 'netease';
  } else {
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

  // 通过 storage 同步内存缓存读取音质，消除对 useStore 的循环依赖
  const settings = getSettingsSync();
  const quality = settings?.musicQuality || 'standard';

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
    const _log = (label) => logger.info('CascadeResolver:musicSongUrl', `+${Date.now() - _t0}ms ${label}`);
    _log(`musicSongUrl: playSource=${playSource} platform=${platform} songId=${songId}`);

    // ===== LX 音源播放 =====
    if (playSource.startsWith('lx:')) {
      const sourceId = playSource.slice(3);
      return await resolveLxPlayUrl(sourceId, songId, platform, song, quality, getOfficialUrl);
    }

    // ===== 官方 API 播放 =====
    if (playSource === 'official' || !playSource.startsWith('lx:')) {
      return await getOfficialUrl(platform, songId, song, quality);
    }

    return null;
  } catch (e) {
    console.error('[CascadeResolver] Song URL error:', e.message);
    return null;
  }
}

export async function getOfficialUrl(platform, songId, song, quality = 'standard') {
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
      { const u = await kuwoSongUrl(songId, song); _log(`kuwoSongUrl result: ${u ? u.substring(0, 80) : 'null'}`); result = { url: u, isLocal: false }; }
      break;
    case 'kugou':
      _log('official: kugouSongUrl');
      { const u = await kugouSongUrl(songId); _log(`kugouSongUrl result: ${u ? u.substring(0, 80) : 'null'}`); result = { url: u, isLocal: false }; }
      break;
    case 'migu':
      _log('official: miguSongUrl');
      { const u = await miguSongUrl(songId, song); result = { url: u, isLocal: false }; }
      break;
    default:
      _log('official: unknown platform, fallback netease');
      result = await neteaseSongUrl(songId, quality);
      break;
  }
  if (!result || (result.url && !result.url.startsWith('http'))) return null;
  if (result.url === null || result.url === undefined || result.url === '') return null;
  return result;
}

// =====================================================================
// 多音源级联自动切换调度器 (Cascade Resolver)
// =====================================================================

export async function searchFallbackWithLxSource(song, preferredLxSourceId = '', quality = 'standard') {
  if (!song) return null;
  const title = song.name || song.title || '';
  const artist = song.artist || '';
  if (!title) return null;

  const originalPlatform = detectPlatform(song);
  const rawArtist = (artist || '').split(/[/,、&|;；]/)[0] || '';
  const cleanArtist = rawArtist.replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').trim().toLowerCase();
  const cleanTargetName = title.replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '').toLowerCase();
  const keyword = `${title} ${cleanArtist}`.trim();

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
    logger.error('CascadeResolver', 'searchFallbackWithLxSource failed to load registry', e);
  }

  if (customSources.length === 0) {
    logger.info('CascadeResolver', 'searchFallbackWithLxSource: No enabled custom sources available for cross-platform matching');
    return null;
  }

  const DIRTY_KEYWORDS = [
    '伴奏', '伴奏版', '伴奏带', '伴唱', '消音',
    'instrumental', 'inst', 'offvocal', 'off vocal', 'karaoke',
    'tvversion', 'tvsize', 'tv version', 'tv size',
    '片段', '铃声', 'remix', 'dj版', '加速版', '降调版', '升调版', '现场版'
  ];

  const isStrictMatch = (s) => {
    if (!s || !s.name) return false;
    const sRawName = (s.name || '').toLowerCase();
    const sNameClean = sRawName.replace(/[\s'"`~()（）\-_/\\\[\]!！]/g, '');
    const nameMatches = sNameClean === cleanTargetName || sNameClean.includes(cleanTargetName) || cleanTargetName.includes(sNameClean);
    if (!nameMatches) return false;

    for (const kw of DIRTY_KEYWORDS) {
      if (!cleanTargetName.includes(kw) && (sNameClean.includes(kw) || sRawName.includes(kw))) {
        logger.info('CascadeResolver', `searchFallbackWithLxSource: rejected dirty match "${s.name}" (matched negative kw: "${kw}")`);
        return false;
      }
    }

    if (song.duration && s.duration && Math.abs(song.duration - s.duration) > 25) {
      logger.info('CascadeResolver', `searchFallbackWithLxSource: rejected duration mismatch "${s.name}" (target: ${song.duration}s, candidate: ${s.duration}s)`);
      return false;
    }

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
          logger.info('CascadeResolver', `searchFallbackWithLxSource matched on ${plat}: ${match.name} - ${match.artist} (id: ${match.id})`);
          for (const cSource of customSources) {
            try {
              const res = await withTimeout(
                _musicSongUrlImpl(cSource.id, match.id, plat, match, quality),
                4500,
                `fallback-${plat}-${cSource.name}`
              );
              if (res && res.url && typeof res.url === 'string' && res.url.startsWith('http')) {
                logger.info('CascadeResolver', `searchFallbackWithLxSource success: [${plat}] via [${cSource.name}]`);
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
              logger.warn('CascadeResolver', `searchFallbackWithLxSource try [${cSource.name}] failed on ${plat}: ${err.message}`);
            }
          }
        }
      }
    } catch (e) {
      logger.warn('CascadeResolver', `searchFallbackWithLxSource error on ${plat}: ${e.message}`);
    }
  }

  return null;
}

const pendingCascadeMap = new Map();

export async function resolvePlayableUrlCascade(song, currentPlaySource = 'official', quality = 'standard') {
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
    logger.info('CascadeResolver', `Cascade start for "${title}" (${songId}) [platform=${platform}, primary=${currentPlaySource}]`);

    // 【第 1 梯队】：当前选定的音源 (Primary Source)
    if (songId) {
      try {
        const isLx = currentPlaySource.startsWith('lx:');
        const timeoutMs = isLx ? 10000 : 4000;
        logger.info('CascadeResolver', `Cascade Tier 1: Trying primary source [${currentPlaySource}] with timeout ${timeoutMs}ms`);
        const primaryRes = await withTimeout(
          _musicSongUrlImpl(currentPlaySource, songId, platform, song, quality),
          timeoutMs,
          `Tier1-${currentPlaySource}`
        );
        if (primaryRes && primaryRes.url && primaryRes.url.startsWith('http')) {
          logger.info('CascadeResolver', `Cascade Tier 1: Success with primary [${currentPlaySource}]`);
          return {
            url: primaryRes.url,
            isLocal: primaryRes.isLocal || false,
            sourceId: currentPlaySource,
            sourceName: '',
            switched: false,
          };
        }
      } catch (e) {
        logger.warn('CascadeResolver', `Cascade Tier 1 failed: ${e.message}`);
      }
    }

    // 【第 2 梯队】：用户导入的其他已启用自定义音源 (Custom Sources)
    try {
      const registry = await loadRegistry();
      const currentLxId = currentPlaySource.startsWith('lx:') ? currentPlaySource.slice(3) : null;
      const customCandidates = registry.filter(e => e && e.enabled !== false && e.id !== currentLxId);

      if (customCandidates.length > 0 && songId) {
        logger.info('CascadeResolver', `Cascade Tier 2: Found ${customCandidates.length} custom sources to try`);
        for (const entry of customCandidates) {
          try {
            logger.info('CascadeResolver', `Cascade Tier 2: Trying [${entry.name}] (${entry.id})`);
            const customRes = await withTimeout(
              _musicSongUrlImpl('lx:' + entry.id, songId, platform, song, quality),
              4500,
              `Tier2-${entry.name}`
            );
            if (customRes && customRes.url && customRes.url.startsWith('http')) {
              logger.info('CascadeResolver', `Cascade Tier 2: Success with [${entry.name}]`);
              return {
                url: customRes.url,
                isLocal: false,
                sourceId: 'lx:' + entry.id,
                sourceName: entry.name || '自定义音源',
                switched: true,
              };
            }
          } catch (e) {
            logger.warn('CascadeResolver', `Cascade Tier 2 [${entry.name}] failed: ${e.message}`);
          }
        }
      }
    } catch (e) {
      logger.error('CascadeResolver', 'Cascade Tier 2 registry error', e);
    }

    // 【第 3 梯队】：跨搜索来源切换（使用自定义音源进行同名严格解析）
    // 通过 storage.getSettingsSync() 读取跨平台容灾配置，无循环依赖
    let allowCrossFailover = true;
    try {
      const settings = getSettingsSync();
      if (settings && settings.enableCrossPlatformFailover === false) {
        allowCrossFailover = false;
      }
    } catch {
      allowCrossFailover = true;
    }

    if (allowCrossFailover) {
      try {
        logger.info('CascadeResolver', `Cascade Tier 3: Trying cross-search-platform with LX source for "${title}" - "${artist}"`);
        const crossLxRes = await searchFallbackWithLxSource(song, currentPlaySource, quality);
        if (crossLxRes && crossLxRes.url && crossLxRes.url.startsWith('http')) {
          logger.info('CascadeResolver', `Cascade Tier 3: Success with ${crossLxRes.sourceName}`);
          return crossLxRes;
        }
      } catch (e) {
        logger.warn('CascadeResolver', `Cascade Tier 3 error: ${e.message}`);
      }
    } else {
      logger.info('CascadeResolver', 'Cascade Tier 3 skipped: Cross-platform failover is disabled by user setting');
    }

    // 【第 4 梯队】：原平台官方免费曲目兜底
    // 注意：网易云 fee=8 代表普通音质免费播放（仅高品/无损需会员），只有 fee=1 (VIP) 或 fee=4 (付费数字专辑) 才是真正受限曲目
    const isVip = song.fee === 1 || song.fee === 4;
    if (!isVip && songId) {
      try {
        logger.info('CascadeResolver', `Cascade Tier 4: Trying official non-VIP link on platform [${platform}]`);
        const offRes = await withTimeout(
          getOfficialUrl(platform, songId, song, quality),
          4000,
          `Tier4-official-${platform}`
        );
        if (offRes && offRes.url && offRes.url.startsWith('http')) {
          logger.info('CascadeResolver', `Cascade Tier 4: Success with official platform [${platform}]`);
          return {
            url: offRes.url,
            isLocal: false,
            sourceId: 'official',
            sourceName: '官方免费源',
            switched: currentPlaySource !== 'official',
          };
        }
      } catch (e) {
        logger.warn('CascadeResolver', `Cascade Tier 4 failed: ${e.message}`);
      }
    } else if (isVip) {
      logger.info('CascadeResolver', `Cascade Tier 4 skipped: Song is VIP (fee=${song.fee}), official API cannot play`);
    }

    // 【第 5 梯队】：全部音源均无法播放
    logger.warn('CascadeResolver', `Cascade: All sources exhausted for "${title}" (${songId})`);
    return null;
  })().finally(() => {
    pendingCascadeMap.delete(cascadeKey);
  });

  pendingCascadeMap.set(cascadeKey, cascadePromise);
  return cascadePromise;
}
