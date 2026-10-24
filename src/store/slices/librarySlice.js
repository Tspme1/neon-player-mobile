/**
 * Zustand Slice: 收藏曲库、自建歌单与本地曲库 (Library Slice)
 */

import * as PlayerEngine from '../../core/player-engine';
import * as MediaSession from '../../core/media-session';
import {
  saveFavorites,
  toggleFavorite,
  isFavorited,
  savePlaylist,
  saveCustomPlaylists,
  createPlaylistObject,
  addTrackToPlaylistData,
  removeTrackFromPlaylistData,
} from '../../core/storage';

export const createLibrarySlice = (set, get) => ({
  favorites: [],
  customPlaylists: [],
  currentPlaylistId: 'favorites', // 'favorites' 或自建歌单 id
  addToPlaylistModalVisible: false,
  trackToAdd: null,
  localLibrary: [],

  setFavorites(favs) {
    set({ favorites: favs });
    PlayerEngine.setFavorites(favs);
    MediaSession.setFavoritesRef(favs);
    saveFavorites(favs);
  },

  setCustomPlaylists(playlists) {
    set({ customPlaylists: playlists });
    saveCustomPlaylists(playlists);
  },

  setCurrentPlaylistId(id) {
    set({ currentPlaylistId: id || 'favorites' });
  },

  createPlaylist(name) {
    const newPlaylist = createPlaylistObject(name);
    const updated = [newPlaylist, ...get().customPlaylists];
    set({ customPlaylists: updated, currentPlaylistId: newPlaylist.id });
    saveCustomPlaylists(updated);
    get().setToast(`已创建歌单「${newPlaylist.name}」`);
    return newPlaylist;
  },

  deletePlaylist(playlistId) {
    const list = get().customPlaylists;
    const target = list.find(p => p.id === playlistId);
    const updated = list.filter(p => p.id !== playlistId);
    const currentId = get().currentPlaylistId;
    const nextCurrentId = currentId === playlistId ? 'favorites' : currentId;
    set({ customPlaylists: updated, currentPlaylistId: nextCurrentId });
    saveCustomPlaylists(updated);
    if (target) {
      get().setToast(`已删除歌单「${target.name}」`);
    }
  },

  renamePlaylist(playlistId, newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed) return;
    const updated = get().customPlaylists.map(p => {
      if (p.id === playlistId) {
        return { ...p, name: trimmed, updatedAt: Date.now() };
      }
      return p;
    });
    set({ customPlaylists: updated });
    saveCustomPlaylists(updated);
    get().setToast(`歌单已重命名为「${trimmed}」`);
  },

  addTrackToPlaylist(playlistId, track) {
    if (playlistId === 'favorites') {
      const favs = [...get().favorites];
      const added = toggleFavorite(track, favs);
      get().setFavorites(added);
      get().setToast(isFavorited(track, added) ? '已加入我喜欢' : '已从我喜欢移除');
      return true;
    }

    const list = [...get().customPlaylists];
    const target = list.find(p => p.id === playlistId);
    if (!target) return false;

    const added = addTrackToPlaylistData(target, track);
    if (added) {
      set({ customPlaylists: list });
      saveCustomPlaylists(list);
      get().setToast(`已添加到「${target.name}」`);
      return true;
    } else {
      get().setToast(`歌曲已在「${target.name}」中`);
      return false;
    }
  },

  removeTrackFromPlaylist(playlistId, trackIdOrSongId) {
    if (playlistId === 'favorites') {
      const favs = [...get().favorites];
      const idx = favs.findIndex(f => f.id === trackIdOrSongId || f.songId === trackIdOrSongId || f.path === trackIdOrSongId);
      if (idx >= 0) {
        favs.splice(idx, 1);
        get().setFavorites(favs);
        get().setToast('已从我喜欢移除');
      }
      return;
    }

    const list = [...get().customPlaylists];
    const target = list.find(p => p.id === playlistId);
    if (!target) return;

    removeTrackFromPlaylistData(target, trackIdOrSongId);
    set({ customPlaylists: list });
    saveCustomPlaylists(list);
    get().setToast('已从歌单移除');
  },

  openAddToPlaylist(track) {
    set({ trackToAdd: track, addToPlaylistModalVisible: true });
  },

  closeAddToPlaylist() {
    set({ addToPlaylistModalVisible: false, trackToAdd: null });
  },

  setLocalLibrary(library) {
    set({ localLibrary: library });
    savePlaylist(library);
  },
});
