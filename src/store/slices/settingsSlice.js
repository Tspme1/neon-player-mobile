/**
 * Zustand Slice: 全局应用配置与双轴音源设置 (Settings Slice)
 */

import * as PlayerEngine from '../../core/player-engine';
import { loadSettings, saveSettings } from '../../core/storage';

export const createSettingsSlice = (set, get) => ({
  currentSource: 'netease',
  searchSource: 'netease',   // 左轴：搜索来源
  playSource: 'official',    // 右轴：播放音源
  themeMode: 'auto',         // 'light' | 'dark' | 'auto'
  musicQuality: 'standard',  // 'low' | 'standard' | 'high' | 'lossless'
  allowMixWithOthers: false,
  enableCrossPlatformFailover: true,

  setCurrentSource: async (source) => {
    set({ currentSource: source });
    PlayerEngine.setCurrentSource(source);
    try {
      const settings = await loadSettings();
      settings.currentSource = source;
      if (source.startsWith('lx:')) {
        settings.playSource = source;
      } else {
        settings.searchSource = source;
        settings.playSource = 'official';
      }
      await saveSettings(settings);
    } catch (e) {
      console.error('[SettingsSlice] Failed to persist currentSource:', e);
    }
  },

  setSearchSource: async (source) => {
    set({ searchSource: source, currentSource: source });
    PlayerEngine.setCurrentSource(source);
    try {
      const settings = await loadSettings();
      settings.searchSource = source;
      settings.currentSource = source;
      await saveSettings(settings);
    } catch (e) {
      console.error('[SettingsSlice] Failed to persist searchSource:', e);
    }
  },

  setPlaySource: async (source) => {
    set({ playSource: source, currentSource: source });
    PlayerEngine.setCurrentSource(source);
    try {
      const settings = await loadSettings();
      settings.playSource = source;
      settings.currentSource = source;
      await saveSettings(settings);
    } catch (e) {
      console.error('[SettingsSlice] Failed to persist playSource:', e);
    }
  },

  setThemeMode: async (mode) => {
    set({ themeMode: mode });
    try {
      const settings = await loadSettings();
      settings.themeMode = mode;
      await saveSettings(settings);
    } catch (e) {
      console.error('[SettingsSlice] Failed to persist themeMode:', e);
    }
  },

  setMusicQuality: async (quality) => {
    set({ musicQuality: quality });
    try {
      const settings = await loadSettings();
      settings.musicQuality = quality;
      await saveSettings(settings);
    } catch (e) {
      console.error('[SettingsSlice] Failed to persist musicQuality:', e);
    }
  },

  setAllowMixWithOthers: async (value) => {
    set({ allowMixWithOthers: value });
    PlayerEngine.setAllowMixWithOthers(value);
    try {
      const settings = await loadSettings();
      settings.allowMixWithOthers = value;
      await saveSettings(settings);
    } catch (e) {
      console.error('[SettingsSlice] Failed to persist allowMixWithOthers:', e);
    }
  },

  setEnableCrossPlatformFailover: async (value) => {
    set({ enableCrossPlatformFailover: value });
    try {
      const settings = await loadSettings();
      settings.enableCrossPlatformFailover = value;
      await saveSettings(settings);
    } catch (e) {
      console.error('[SettingsSlice] Failed to persist enableCrossPlatformFailover:', e);
    }
  },
});
