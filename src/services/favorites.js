// 收藏管理 — 从桌面端 favorites.js 移植，存储改为 AsyncStorage
import AsyncStorage from '@react-native-async-storage/async-storage';

const FAVORITES_KEY = '@favorites';
const PLAYLIST_KEY = '@playlist';
const SETTINGS_KEY = '@settings';
const VOLUME_KEY = '@volume';

// === Favorites ===
export async function loadFavorites() {
  try {
    const json = await AsyncStorage.getItem(FAVORITES_KEY);
    return json ? JSON.parse(json) : [];
  } catch { return []; }
}

export async function saveFavorites(favorites) {
  try {
    await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch (e) {
    console.error('saveFavorites error:', e);
  }
}

// === Playlist (local library) ===
export async function loadPlaylist() {
  try {
    const json = await AsyncStorage.getItem(PLAYLIST_KEY);
    return json ? JSON.parse(json) : [];
  } catch { return []; }
}

export async function savePlaylist(playlist) {
  try {
    await AsyncStorage.setItem(PLAYLIST_KEY, JSON.stringify(playlist));
  } catch (e) {
    console.error('savePlaylist error:', e);
  }
}

// === Settings ===
export async function loadSettings() {
  try {
    const json = await AsyncStorage.getItem(SETTINGS_KEY);
    return json ? JSON.parse(json) : { currentSource: 'netease' };
  } catch { return { currentSource: 'netease' }; }
}

export async function saveSettings(settings) {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('saveSettings error:', e);
  }
}

// === Volume ===
export async function loadVolume() {
  try {
    const vol = await AsyncStorage.getItem(VOLUME_KEY);
    return vol !== null ? Math.max(0, Math.min(1, parseFloat(vol))) : 0.8;
  } catch { return 0.8; }
}

export async function saveVolume(volume) {
  try {
    await AsyncStorage.setItem(VOLUME_KEY, String(volume));
  } catch (e) {}
}

// === Favorite ID logic (from desktop favorites.js) ===
export function getFavoriteId(track) {
  if (track.type === 'online' || track.songId) {
    return 'online_' + (track.songId || track.id || '');
  }
  return 'local_' + (track.path || '');
}

export function isFavorited(track, favorites) {
  const id = getFavoriteId(track);
  const songId = track.songId || track.id;
  if (songId) {
    return favorites.some(f => f.id === id || (f.type === 'online' && f.songId === songId));
  }
  return favorites.some(f => f.id === id || (f.type !== 'online' && f.path === track.path));
}

export function toggleFavorite(track, favorites) {
  const id = getFavoriteId(track);
  const songId = track.songId || track.id;
  let idx = favorites.findIndex(f => f.id === id);
  if (idx < 0 && songId) {
    idx = favorites.findIndex(f => f.type === 'online' && f.songId === songId);
  } else if (idx < 0 && track.path) {
    idx = favorites.findIndex(f => f.type !== 'online' && f.path === track.path);
  }
  if (idx >= 0) {
    favorites.splice(idx, 1);
  } else {
    favorites.push({
      id: id,
      type: track.type || (track.path && (!track.songId || String(track.songId).startsWith('local_')) ? 'local' : 'online'),
      path: track.path || '',
      name: track.name || '',
      songId: track.songId || track.id || null,
      artist: track.artist || '',
      album: track.album || '',
      duration: track.duration || 0,
      fee: track.fee || 0,
      _src: track._src || null,
      _platform: track._platform || track._src || undefined,
      picUrl: track.picUrl || track.pic || track.coverUrl || track.cover || '',
      pic: track.pic || track.picUrl || track.coverUrl || track.cover || '',
      favoritedAt: Date.now()
    });
  }
  return favorites;
}
