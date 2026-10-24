// 统一曲目领域模型 (Normalized Track Entity)
// 在数据进入系统的第一入口（搜索、榜单、歌单导入、本地文件、漫游）统一规范化字段，
// 同时完整保留向后兼容别名，彻底消除全链路防御性判断与字段歧义。

const VALID_PLATFORMS = ['netease', 'tencent', 'kuwo', 'kugou', 'migu'];

/**
 * 智能检测歌曲所属平台
 * 优先根据明确的 platform/_platform/_src/source 字段，其次根据歌曲 ID 特征识别
 * @param {object} song 歌曲对象
 * @returns {'netease' | 'tencent' | 'kuwo' | 'kugou' | 'migu'}
 */
export function detectPlatform(song) {
  if (!song) return 'netease';
  const rawPlat = song._platform || song.platform || song._src || song.source;
  if (rawPlat && VALID_PLATFORMS.includes(rawPlat)) {
    return rawPlat;
  }
  if (rawPlat === 'qq' || rawPlat === 'tx') return 'tencent';
  if (rawPlat === 'wy' || rawPlat === '163') return 'netease';
  if (rawPlat === 'kg') return 'kugou';
  if (rawPlat === 'kw') return 'kuwo';
  if (rawPlat === 'mg') return 'migu';

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

/**
 * 生成全局唯一的曲目识别 Key（用于去重、队列比对、封面竞态校验与收藏索引）
 * @param {object} track
 * @returns {string}
 */
export function getTrackUniqueKey(track) {
  if (!track) return '';
  const isLocal = track.type === 'local' || (!track.type && track.path && (!track.songId || String(track.songId).startsWith('local_')));
  if (isLocal) {
    return 'local_' + (track.path || track.cachedPath || track.uri || track.name || '');
  }
  const platform = detectPlatform(track);
  const rawId = String(track.songId || track.id || track.hash || track.mid || '');
  const cleanId = rawId.startsWith('online_') ? rawId.slice(7) : rawId;
  return `online_${platform}_${cleanId}`;
}

/**
 * 判断两首曲目是否为同一首
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function isSameTrack(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const keyA = getTrackUniqueKey(a);
  const keyB = getTrackUniqueKey(b);
  if (keyA && keyB && keyA === keyB) return true;

  const songIdA = a.songId || (a.type === 'online' ? a.id : null);
  const songIdB = b.songId || (b.type === 'online' ? b.id : null);
  if (songIdA && songIdB && String(songIdA) === String(songIdB)) return true;

  if (a.path && b.path && a.path === b.path) return true;
  return false;
}

/**
 * 将任意来源的异构歌曲对象标准化为统一 Track 实体
 * 同时保留旧版字段别名（name/title, picUrl/pic/cover, _platform/_src），确保 UI 100% 兼容
 * @param {object} raw 原始歌曲对象
 * @param {string} [defaultPlatform] 默认平台
 * @returns {object|null}
 */
export function normalizeTrack(raw, defaultPlatform = '') {
  if (!raw || typeof raw !== 'object') return null;

  const isLocal = raw.type === 'local' || (!raw.type && raw.path && (!raw.songId || String(raw.songId).startsWith('local_')));
  const type = isLocal ? 'local' : 'online';

  const rawId = raw.songId || raw.id || raw.mid || raw.hash || '';
  const cleanSongId = String(rawId).startsWith('online_') ? String(rawId).slice(7) : (rawId || null);

  const platform = isLocal
    ? 'local'
    : (defaultPlatform && VALID_PLATFORMS.includes(defaultPlatform) ? defaultPlatform : detectPlatform(raw));

  const name = (raw.name || raw.title || (isLocal && raw.path ? raw.path.split('/').pop() : '') || '未知歌曲').trim();
  const artist = (raw.artist || raw.singer || '').trim();
  const album = (raw.album || '').trim();
  const duration = Number(raw.duration) || 0;
  const fee = Number(raw.fee) || 0;
  const picUrl = raw.picUrl || raw.pic || raw.coverUrl || raw.cover || '';
  const path = raw.path || raw.cachedPath || raw.uri || '';

  const id = isLocal
    ? (raw.id && String(raw.id).startsWith('local_') ? raw.id : `local_${path}`)
    : (raw.id || cleanSongId);

  return {
    ...raw,
    id,
    songId: isLocal ? null : (cleanSongId || id),
    type,
    name,
    title: name,
    artist,
    album,
    duration,
    fee,
    path,
    platform,
    _platform: isLocal ? undefined : platform,
    _src: raw._src || (isLocal ? null : platform),
    picUrl,
    pic: picUrl,
    cover: picUrl,
  };
}

export default {
  detectPlatform,
  getTrackUniqueKey,
  isSameTrack,
  normalizeTrack,
};
