/**
 * Zustand Slice: 播放控制与实时状态镜像 (Player Slice)
 */

import * as PlayerEngine from '../../core/player-engine';

export const createPlayerSlice = (set, get) => ({
  // === 播放状态（从 player-engine 镜像） ===
  isPlaying: false,
  position: 0,
  duration: 0,
  currentOnlineSong: null,
  volume: 0.8,
  isMuted: false,

  // === 歌词 ===
  lyricsData: [],
  currentLyricIndex: -1,

  // === 封面（当前播放曲目，来自搜索直出/异步补拉） ===
  currentCoverUrl: null,

  // === 播放控制 Actions（代理到 PlayerEngine 单一事实源） ===
  togglePlay() {
    PlayerEngine.togglePlay();
  },

  playTrack(index) {
    PlayerEngine.playTrack(index);
  },

  playOnlineSong(song, index) {
    PlayerEngine.playOnlineSong(song, index);
  },

  playPrevious() {
    PlayerEngine.playPrevious();
  },

  playNext() {
    PlayerEngine.playNext();
  },

  seekTo(positionMs) {
    PlayerEngine.seekTo(positionMs);
  },

  cleanup() {
    PlayerEngine.cleanup();
  },

  setVolume(vol) {
    PlayerEngine.setVolume(vol);
    set({ volume: vol, isMuted: vol === 0 });
  },

  toggleMute() {
    PlayerEngine.toggleMute();
    set({ volume: PlayerEngine.getVolume(), isMuted: PlayerEngine.getIsMuted() });
  },

  initVolume() {
    return PlayerEngine.initVolume().then(() => {
      set({ volume: PlayerEngine.getVolume(), isMuted: PlayerEngine.getIsMuted() });
    });
  },
});
