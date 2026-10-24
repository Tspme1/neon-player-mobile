/**
 * Zustand Slice: 播放队列与漫游状态 (Queue Slice)
 *
 * 彻底收敛队列控制权：所有队列增删改（包括"下一首播放"与"从队列移除"）
 * 统一经由 PlayerEngine 原语操作并自动广播 PLAYBACK_QUEUE_CHANGE 事件，消除 Store 与 Engine 状态撕裂。
 */

import * as PlayerEngine from '../../core/player-engine';
import { loadSettings, saveSettings } from '../../core/storage';

export const createQueueSlice = (set, get) => ({
  currentIndex: -1,
  playlist: [],
  queueSource: null,
  playMode: 'sequence',
  isRoaming: false,
  roamPlaylist: [],
  roamIndex: -1,

  setQueue(source, tracks, startIndex) {
    PlayerEngine.setQueue(source, tracks, startIndex);
  },

  appendToQueue(source, tracks) {
    PlayerEngine.appendToQueue(source, tracks);
  },

  insertNextInQueue(track) {
    return PlayerEngine.insertNextInQueue(track);
  },

  removeFromQueue(index) {
    return PlayerEngine.removeFromQueue(index);
  },

  cyclePlayMode() {
    const mode = PlayerEngine.cyclePlayMode();
    set({ playMode: mode });
    loadSettings().then(settings => {
      settings.playMode = mode;
      saveSettings(settings);
    }).catch(() => {});
    return mode;
  },

  startRoam() {
    PlayerEngine.startRoam();
  },

  stopRoam() {
    PlayerEngine.stopRoam();
  },

  playRoamSong(index) {
    PlayerEngine.playRoamSong(index);
  },
});
