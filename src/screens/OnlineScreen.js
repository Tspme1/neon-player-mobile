// 在线搜索页
import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, ScrollView, TextInput, Alert, Linking, BackHandler } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { HEADER_PADDING_TOP } from '../theme/safearea';
import { useTheme } from '../theme/useTheme';
import { usePlayerStore } from '../store/useStore';
import { musicSearch, musicSongUrl, importFromUrl, importFromFile, deleteSource, setSourceEnabled, updateSource, loadRegistry } from '../core/source-manager';
import { isFavorited, toggleFavorite, loadSettings, saveSettings } from '../core/storage';
import { downloadAndCache } from '../core/cache-manager';
import TrackItem from '../components/TrackItem';
import SearchBar from '../components/SearchBar';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import ContextMenu from '../components/ContextMenu';
import { ChevronDownIcon, SettingsIcon } from '../components/icons';

const SEARCH_SOURCES = [
  { id: 'netease', label: '网易云音乐' },
  { id: 'tencent', label: 'QQ音乐' },
  { id: 'kuwo', label: '酷我音乐' },
  { id: 'kugou', label: '酷狗音乐' },
  { id: 'aggregate', label: '聚合搜索' },
];

export default function OnlineScreen() {
  const { colors } = useTheme();

  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchPage, setSearchPage] = useState(0);
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [playDropdownOpen, setPlayDropdownOpen] = useState(false);
  const [sourceMgmtVisible, setSourceMgmtVisible] = useState(false);
  const [customSources, setCustomSources] = useState([]);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuTrack, setMenuTrack] = useState(null);
  const [menuIndex, setMenuIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const {
    searchResultsData, setSearchResults,
    searchSource, playSource,
    setSearchSource, setPlaySource,
    setQueue, playOnlineSong, favorites, setFavorites, setToast
  } = usePlayerStore();

  // Load custom sources from registry on mount
  const reloadCustomSources = useCallback(async () => {
    const entries = await loadRegistry();
    setCustomSources(entries);
    // Also sync to settings for backward compat
    try {
      const settings = await loadSettings();
      settings.customSources = entries;
      await saveSettings(settings);
    } catch (e) {
      console.error('[OnlineScreen] Failed to sync customSources:', e);
    }
  }, []);

  React.useEffect(() => {
    reloadCustomSources();
  }, []);

  // 音源管理 Modal 打开时拦截返回键
  useEffect(() => {
    if (!sourceMgmtVisible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSourceMgmtVisible(false);
      return true;
    });
    return () => sub.remove();
  }, [sourceMgmtVisible]);

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setHasSearched(true);
    setSearchPage(0);
    setSearchDropdownOpen(false);
    setPlayDropdownOpen(false);
    try {
      const results = await musicSearch(searchSource, keyword.trim());
      setSearchResults(results);
      if (results.length === 0) setToast('未找到相关歌曲');
    } catch (e) {
      setToast('搜索失败');
    }
    setLoading(false);
  };

  const [loadingMore, setLoadingMore] = useState(false);
  const handleLoadMore = async () => {
    if (loadingMore || loading || searchSource === 'aggregate') return;
    const nextPage = searchPage + 1;
    setLoadingMore(true);
    try {
      const more = await musicSearch(searchSource, keyword.trim(), nextPage);
      if (more.length > 0) {
        setSearchResults([...searchResultsData, ...more]);
        setSearchPage(nextPage);
      }
    } catch (e) {
      // silent fail
    }
    setLoadingMore(false);
  };

  const handlePlay = (song, index) => {
    const sourceArr = searchResultsData.map(s => ({ ...s, type: 'online', songId: s.id }));
    setQueue('search', sourceArr, index);
    playOnlineSong({ ...song, _platform: song._platform }, index);
  };

  const handleDownload = async (song) => {
    if (!song) { setMenuVisible(false); return; }
    setToast('正在获取下载链接...');
    try {
      const songId = song.id || song.songId;
      if (!songId) { setToast('无法获取歌曲ID'); setMenuVisible(false); return; }
      const urlData = await musicSongUrl(currentSource, songId, song);
      if (!urlData || !urlData.url) {
        setToast('无法获取下载链接');
        setMenuVisible(false);
        return;
      }
      setToast('正在下载到 Download/NeonPlayer...');
      const { NativeModules } = require('react-native');
      const fileName = `${song.name || 'unknown'} - ${song.artist || ''}.mp3`.trim();
      await NativeModules.UpdaterModule.downloadToMusicDir(urlData.url, fileName);
      setToast(`「${song.name}」已下载到 Download/NeonPlayer`);
    } catch (e) {
      setToast('下载失败: ' + (e.message || ''));
    }
    setMenuVisible(false);
  };

  const handlePlayNext = (song, index) => {
    const track = { ...song, type: 'online', songId: song.id };
    const { playlist, currentIndex } = usePlayerStore.getState();
    const newPlaylist = [...playlist];
    const insertAt = currentIndex + 1;
    if (!newPlaylist.some(t => t.songId === song.id)) {
      newPlaylist.splice(insertAt, 0, track);
      usePlayerStore.setState({ playlist: newPlaylist });
      setToast('已添加到下一首播放');
    } else {
      setToast('该歌曲已在播放列表中');
    }
    setMenuVisible(false);
  };

  const handleOpenDownloadDir = async () => {
    try {
      const { NativeModules } = require('react-native');
      await NativeModules.UpdaterModule.openDownloadFolder();
    } catch (e) {
      setToast('无法打开文件管理器: ' + (e.message || ''));
    }
    setMenuVisible(false);
  };

  const handleLongPress = (song, index) => {
    setMenuTrack(song);
    setMenuIndex(index);
    setMenuVisible(true);
  };
  const handleLongPressWithPos = (song, index, x, y) => {
    setMenuTrack(song);
    setMenuIndex(index);
    setMenuPos({ x, y });
    setMenuVisible(true);
  };
  const handleFav = (song) => {

    const track = { ...song, type: 'online', songId: song.id };
    const newFavs = toggleFavorite(track, [...favorites]);
    setFavorites(newFavs);
    setToast(isFavorited(track, favorites) ? '已从我喜欢移除' : '已加入我喜欢');
  };

  const handleSelectSearchSource = async (sourceId) => {
    await setSearchSource(sourceId);
    setSearchDropdownOpen(false);
  };

  const handleSelectPlaySource = async (sourceId) => {
    await setPlaySource(sourceId);
    setPlayDropdownOpen(false);
  };

  const handleToggleCustomSource = async (src) => {
    await setSourceEnabled(src.id, src.enabled === false);
    await reloadCustomSources();
  };
  const handleDeleteSource = (src) => {
    Alert.alert(
      '删除音源',
      `确定要删除「${src.name}」吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            await deleteSource(src.id);
            setToast('音源已删除');
            reloadCustomSources();
          }
        }
      ]
    );
  };

  const handleUpdateSource = async (src) => {
    setToast('正在更新音源...');
    const result = await updateSource(src.id);
    if (result.success) {
      setToast('音源已更新');
      reloadCustomSources();
    } else {
      setToast(result.error || '更新失败');
    }
  };

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    setToast('正在导入音源...');
    const result = await importFromUrl(importUrl.trim(), (msg) => {
      setToast(msg);
    });
    setImporting(false);
    if (result.success) {
      setImportUrl('');
      await reloadCustomSources();
      // 自动切换到新导入的音源作为播放音源
      const newSourceId = 'lx:' + result.entry.id;
      await setPlaySource(newSourceId);
      setToast(`已切换到播放音源「${result.entry.name}」`);
    } else {
      setToast(result.error || '导入失败');
    }
  };

  const handleImportFile = async () => {
    setImporting(true);
    setToast('正在选择文件...');
    const result = await importFromFile((msg) => {
      setToast(msg);
    });
    setImporting(false);
    if (result.canceled) {
      setToast('');
      return;
    }
    if (result.success) {
      await reloadCustomSources();
      // 自动切换到新导入的音源作为播放音源
      const newSourceId = 'lx:' + result.entry.id;
      await setPlaySource(newSourceId);
      setToast(`已切换到播放音源「${result.entry.name}」`);
    } else {
      setToast(result.error || '导入失败');
    }
  };

  // 播放音源列表：官方API + 启用的 LX 音源
  const playSources = [
    { id: 'official', label: '官方API' },
    ...customSources.filter(s => s.enabled !== false).map(s => ({ id: 'lx:' + s.id, label: s.name }))
  ];

  const searchLabel = SEARCH_SOURCES.find(s => s.id === searchSource)?.label || searchSource;
  const playLabel = playSources.find(s => s.id === playSource)?.label || playSource;

  const renderItem = ({ item, index }) => {
    const fav = isFavorited({ ...item, type: 'online', songId: item.id }, favorites);
    return (
      <TrackItem
        index={index}
        name={`${item.name} - ${item.artist || ''}`}
        duration={item.duration}
        fee={item.fee}
        isOnline
        isFavorited={fav}
        onPress={() => handlePlay(item, index)}
        onFavPress={() => handleFav(item)}
        onLongPress={(e) => {
          const { pageX, pageY } = e.nativeEvent;
          handleLongPressWithPos(item, index, pageX, pageY);
        }}
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>在线搜索</Text>
      </View>
      <View style={styles.searchWrap}>
        <SearchBar
          value={keyword}
          onChangeText={setKeyword}
          onSubmit={handleSearch}
        />
      </View>
      {/* 双轴选择器：搜索来源 + 播放音源 */}
      <View style={styles.dualSourceRow}>
        {/* 左轴：搜索来源 */}
        <View style={styles.sourceCol}>
          <Text style={[styles.sourceColLabel, { color: colors.textMuted }]}>搜索来源</Text>
          <TouchableOpacity
            style={[styles.sourceDropdownBtn, { backgroundColor: colors.bgTertiary, borderColor: colors.border }]}
            onPress={() => { setSearchDropdownOpen(!searchDropdownOpen); setPlayDropdownOpen(false); }}
          >
            <Text style={[styles.sourceDropdownText, { color: colors.textPrimary }]} numberOfLines={1}>
              {searchLabel}
            </Text>
            <ChevronDownIcon width={14} height={14} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        {/* 右轴：播放音源 */}
        <View style={styles.sourceCol}>
          <Text style={[styles.sourceColLabel, { color: colors.textMuted }]}>播放音源</Text>
          <TouchableOpacity
            style={[styles.sourceDropdownBtn, { backgroundColor: colors.bgTertiary, borderColor: colors.border }]}
            onPress={() => { setPlayDropdownOpen(!playDropdownOpen); setSearchDropdownOpen(false); }}
          >
            <Text style={[styles.sourceDropdownText, { color: colors.textPrimary }]} numberOfLines={1}>
              {playLabel}
            </Text>
            <ChevronDownIcon width={14} height={14} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        {/* 音源管理按钮 */}
        <TouchableOpacity
          style={[styles.mgmtBtn, { borderColor: colors.border, alignSelf: 'flex-end' }]}
          onPress={() => setSourceMgmtVisible(true)}
        >
          <SettingsIcon width={14} height={14} color={colors.textSecondary} />
          <Text style={[styles.mgmtBtnText, { color: colors.textSecondary }]}>管理</Text>
        </TouchableOpacity>
        {/* 搜索来源下拉列表 */}
        {searchDropdownOpen && (
          <View style={[styles.dropdownList, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
            <ScrollView nestedScrollEnabled style={{ maxHeight: 240 }}>
              {SEARCH_SOURCES.map(src => (
                <TouchableOpacity
                  key={src.id}
                  style={[
                    styles.dropdownListItem,
                    searchSource === src.id && { backgroundColor: colors.accent }
                  ]}
                  onPress={() => handleSelectSearchSource(src.id)}
                >
                  <Text style={{
                    color: searchSource === src.id ? '#fff' : colors.textPrimary,
                    fontSize: 14,
                  }}>
                    {src.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        {/* 播放音源下拉列表 */}
        {playDropdownOpen && (
          <View style={[styles.dropdownList, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
            <ScrollView nestedScrollEnabled style={{ maxHeight: 240 }}>
              {playSources.map(src => (
                <TouchableOpacity
                  key={src.id}
                  style={[
                    styles.dropdownListItem,
                    playSource === src.id && { backgroundColor: colors.accent }
                  ]}
                  onPress={() => handleSelectPlaySource(src.id)}
                >
                  <Text style={{
                    color: playSource === src.id ? '#fff' : colors.textPrimary,
                    fontSize: 14,
                  }}>
                    {src.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
      {/* Results */}
      {searchResultsData.length > 0 ? (
        <FlatList
          data={searchResultsData}
          renderItem={renderItem}
          keyExtractor={(item, index) => `${item.id}_${index}`}
          contentContainerStyle={{ paddingBottom: 80 }}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <Spinner text="加载更多..." /> : null}
        />
      ) : loading ? (
        <Spinner text="搜索中..." />
      ) : hasSearched ? (
        <EmptyState icon="🔍" title="未找到相关歌曲" />
      ) : (
        <EmptyState icon="🎵" title="搜索你想听的音乐" />
      )}

      {/* 音源管理弹窗 */}
      <Modal visible={sourceMgmtVisible} animationType="slide" transparent>
        <View style={styles.mgmtOverlay}>
          <View style={[styles.mgmtDialog, { backgroundColor: colors.bgSecondary }]}>
            <View style={[styles.mgmtHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.mgmtTitle, { color: colors.textPrimary }]}>🎵 音源管理</Text>
              <TouchableOpacity onPress={() => setSourceMgmtVisible(false)}>
                <Text style={[styles.closeText, { color: colors.textMuted }]}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.mgmtBody}>
              <Text style={[styles.mgmtTip, { color: colors.textMuted }]}>
                💡 导入的音源作为「播放音源」使用，搜索来源在搜索页选择。支持 lx-music 格式 JS 脚本（本地文件或直链 URL）
              </Text>
              {/* URL 导入 */}
              <Text style={[styles.mgmtSectionLabel, { color: colors.textSecondary }]}>导入音源</Text>
              <View style={[styles.importRow, { borderColor: colors.border, backgroundColor: colors.bgTertiary }]}>
                <TextInput
                  style={[styles.importInput, { color: colors.textPrimary }]}
                  placeholder="输入音源 URL 或 lx-music:// 链接"
                  placeholderTextColor={colors.textMuted}
                  value={importUrl}
                  onChangeText={setImportUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={[styles.importBtn, { backgroundColor: colors.accent, opacity: importing ? 0.4 : 1 }]}
                  onPress={handleImportUrl}
                  disabled={importing}
                >
                  <Text style={styles.importBtnText}>URL导入</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.fileImportBtn, { borderColor: colors.accent, opacity: importing ? 0.4 : 1 }]}
                onPress={handleImportFile}
                disabled={importing}
              >
                <Text style={[styles.fileImportBtnText, { color: colors.accent }]}>📁 从文件导入 (.js)</Text>
              </TouchableOpacity>

              {/* 自定义音源列表 */}
              <Text style={[styles.mgmtSectionLabel, { color: colors.textSecondary, marginTop: 12 }]}>自定义音源</Text>
              {customSources.length === 0 ? (
                <View style={styles.mgmtEmpty}>
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>暂无导入音源</Text>
                </View>
              ) : (
                customSources.map((src, idx) => (
                  <View key={src.id || idx} style={[styles.sourceRow2, { borderColor: colors.border, backgroundColor: colors.bgTertiary }]}>
                    <Text style={{ color: src.enabled !== false ? '#1abc9c' : colors.textMuted, fontSize: 16 }}>
                      {src.enabled !== false ? '✅' : '⭕'}
                    </Text>
                    <View style={styles.sourceInfo}>
                      <Text style={[styles.sourceName, { color: colors.textPrimary }]}>{src.name}</Text>
                      <Text style={[styles.sourceDesc, { color: colors.textMuted }]}>{src.description || src.author || ''}</Text>
                    </View>
                    <View style={styles.sourceActions}>
                      <TouchableOpacity onPress={() => handleToggleCustomSource(src)}>
                        <Text style={[styles.sourceAction, { color: src.enabled !== false ? colors.textMuted : colors.accent }]}>
                          {src.enabled !== false ? '禁用' : '启用'}
                        </Text>
                      </TouchableOpacity>
                      {src.origin_url ? (
                        <TouchableOpacity onPress={() => handleUpdateSource(src)}>
                          <Text style={[styles.sourceAction, { color: colors.accent }]}>更新</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity onPress={() => handleDeleteSource(src)}>
                        <Text style={[styles.sourceAction, { color: '#e74c3c' }]}>删除</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <ContextMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        title={menuTrack ? `${menuTrack.name} - ${menuTrack.artist || ''}` : ''}
        x={menuPos.x}
        y={menuPos.y}
        actions={[
          { label: '⬇ 下载', onPress: () => handleDownload(menuTrack) },
          { label: '▶ 下一首播放', onPress: () => handlePlayNext(menuTrack, menuIndex) },
          { label: '📂 打开下载路径', onPress: () => handleOpenDownloadDir() },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingTop: HEADER_PADDING_TOP,
    paddingBottom: 8,
  },
  title: { fontSize: 22, fontWeight: '700' },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  dualSourceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  sourceCol: {
    flex: 1,
    minWidth: 0,
  },
  sourceColLabel: {
    fontSize: 11,
    marginBottom: 4,
  },
  sourceLabel: {
    fontSize: 13,
  },
  sourceDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  sourceDropdownText: {
    fontSize: 13,
    flex: 1,
    marginRight: 6,
  },
  mgmtBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 0,
  },
  mgmtBtnText: {
    fontSize: 12,
  },
  // 内联下拉列表
  dropdownList: {
    position: 'absolute',
    top: '100%',
    left: 12,
    right: 12,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    zIndex: 50,
  },
  dropdownListItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  // 音源管理弹窗
  mgmtOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mgmtDialog: {
    width: '90%',
    maxHeight: '70%',
    borderRadius: 12,
    overflow: 'hidden',
    flex: 1,
  },
  mgmtHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  mgmtTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  closeText: {
    fontSize: 24,
  },
  mgmtBody: {
    flex: 1,
    paddingHorizontal: 16,
  },
  mgmtTip: {
    fontSize: 12,
    paddingVertical: 12,
  },
  mgmtSectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  mgmtEmpty: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  sourceRow2: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 0.5,
    borderRadius: 8,
    marginBottom: 6,
  },
  sourceInfo: {
    flex: 1,
  },
  sourceName: {
    fontSize: 14,
    fontWeight: '500',
  },
  sourceDesc: {
    fontSize: 11,
    marginTop: 2,
  },
  sourceBuiltin: {
    fontSize: 12,
  },
  sourceAction: {
    fontSize: 13,
    fontWeight: '500',
  },
  sourceActions: {
    flexDirection: 'row',
    gap: 10,
  },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 0.5,
    borderRadius: 8,
    marginBottom: 8,
  },
  importInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 6,
  },
  importBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  importBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  fileImportBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  fileImportBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
  mgmtFooter: {
    padding: 16,
    borderTopWidth: 1,
  },
});
