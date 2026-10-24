/**
 * Zustand Slice: UI 状态、搜索结果与发现页缓存 (UI Slice)
 */

export const createUiSlice = (set, get) => ({
  // === 搜索结果 ===
  searchResultsData: [],

  // === 发现页 ===
  toplistData: [],
  toplistDetailData: null,
  hotData: [],
  discoverSubTab: 'toplist',
  activeTab: 'local',

  // === UI 弹窗与 Toast 状态 ===
  settingsVisible: false,
  showToast: false,
  toastMessage: '',
  toastAction: null,
  pendingUpdateInfo: null,

  setToast(msg, action = null) {
    set({ showToast: true, toastMessage: msg, toastAction: action || null });
    if (msg) {
      if (window._toastTimer) clearTimeout(window._toastTimer);
      window._toastTimer = setTimeout(() => set({ showToast: false, toastAction: null }), action ? 4500 : 3000);
    }
  },

  setSettingsVisible(visible) {
    set({ settingsVisible: visible });
  },

  setSearchResults(results) {
    set({ searchResultsData: results });
  },

  setToplistData(data) {
    set({ toplistData: data });
  },

  setToplistDetailData(data) {
    set({ toplistDetailData: data });
  },

  setHotData(data) {
    set({ hotData: data });
  },

  setDiscoverSubTab(tab) {
    set({ discoverSubTab: tab });
  },

  setActiveTab(tab) {
    set({ activeTab: tab });
  },
});
