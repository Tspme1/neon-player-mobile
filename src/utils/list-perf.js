/**
 * Phase 4: 虚拟列表 (FlatList) 60fps/120fps 高帧率渲染调优配置
 */

export const TRACK_LIST_PERF_PROPS = {
  initialNumToRender: 15,
  maxToRenderPerBatch: 12,
  windowSize: 7,
  updateCellsBatchingPeriod: 40,
  removeClippedSubviews: true,
};
