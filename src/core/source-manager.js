/**
 * 多源音乐管理器门面 (SourceManager Facade)
 *
 * 架构重构说明 (Phase 1)：
 * 原 2154 行上帝模块已按职责拆分为：
 * - 领域模型与平台检测：src/core/models/track.js
 * - 统一原生优先网络层：src/core/http/http-client.js
 * - 独立平台音源驱动：src/core/providers/{netease,tencent,kuwo,kugou,migu,lx}-provider.js
 * - 级联容灾与聚合调度：src/core/resolver/cascade-resolver.js
 *
 * 本文件保留完整命名导出与默认导出，确保业务层与引擎层 100% 零感无缝兼容。
 */

import { detectPlatform } from './models/track';
import { fetchJSON, fetchText } from './http/http-client';
import {
  neteaseSearch,
  neteaseSongUrl,
  neteaseLyrics,
  neteaseSongPic,
  neteaseToplist,
  neteaseToplistDetail,
  neteaseShuffleSongs,
} from './providers/netease-provider';
import {
  tencentSearch,
  tencentSongUrl,
  tencentLyrics,
  tencentSongPic,
} from './providers/tencent-provider';
import {
  kuwoSearch,
  kuwoSongUrl,
  kuwoLyrics,
} from './providers/kuwo-provider';
import {
  kugouSearch,
  kugouSongUrl,
  kugouLyrics,
  kugouSongPic,
} from './providers/kugou-provider';
import {
  miguSearch,
  miguSongUrl,
} from './providers/migu-provider';
import {
  parseMetadata,
  generateSourceId,
  parseLxProtocol,
  loadRegistry,
  saveRegistry,
  readSourceCode,
  writeSourceCode,
  deleteSourceCode,
  importFromUrl,
  importFromFile,
  deleteSource,
  setSourceEnabled,
  updateSource,
} from './providers/lx-provider';
import {
  musicSearch,
  musicSongUrl,
  resolvePlayableUrlCascade,
  searchFallbackWithLxSource,
  searchFallbackLyrics,
  fetchOnlineSongPic,
} from './resolver/cascade-resolver';

export {
  detectPlatform,
  fetchJSON,
  fetchText,
  musicSearch,
  musicSongUrl,
  resolvePlayableUrlCascade,
  searchFallbackWithLxSource,
  searchFallbackLyrics,
  fetchOnlineSongPic,
  importFromUrl,
  importFromFile,
  deleteSource,
  setSourceEnabled,
  updateSource,
  parseMetadata,
  generateSourceId,
  parseLxProtocol,
  loadRegistry,
  saveRegistry,
  readSourceCode,
  writeSourceCode,
  deleteSourceCode,
  neteaseSearch,
  neteaseSongUrl,
  neteaseLyrics,
  neteaseSongPic,
  neteaseToplist,
  neteaseToplistDetail,
  neteaseShuffleSongs,
  tencentSearch,
  tencentSongUrl,
  tencentLyrics,
  tencentSongPic,
  kuwoSearch,
  kuwoSongUrl,
  kuwoLyrics,
  kugouSearch,
  kugouSongUrl,
  kugouLyrics,
  kugouSongPic,
  miguSearch,
  miguSongUrl,
};

export default {
  detectPlatform,
  musicSearch,
  musicSongUrl,
  resolvePlayableUrlCascade,
  searchFallbackWithLxSource,
  importFromUrl,
  importFromFile,
  deleteSource,
  setSourceEnabled,
  updateSource,
  fetchText,
  fetchJSON,
  parseMetadata,
  generateSourceId,
  parseLxProtocol,
  loadRegistry,
  saveRegistry,
  readSourceCode,
  writeSourceCode,
  deleteSourceCode,
  neteaseSearch,
  neteaseSongUrl,
  neteaseLyrics,
  neteaseSongPic,
  neteaseToplist,
  neteaseToplistDetail,
  neteaseShuffleSongs,
  tencentSearch,
  tencentSongUrl,
  tencentLyrics,
  tencentSongPic,
  kuwoSearch,
  kuwoSongUrl,
  kuwoLyrics,
  kugouSearch,
  kugouSongUrl,
  kugouLyrics,
  kugouSongPic,
  miguSearch,
  miguSongUrl,
  searchFallbackLyrics,
  fetchOnlineSongPic,
};
