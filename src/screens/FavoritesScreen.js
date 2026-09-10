// 喜欢与自建歌单管理页
import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Modal,
  TextInput, Alert, TouchableWithoutFeedback, ScrollView
} from 'react-native';

import { HEADER_PADDING_TOP } from '../theme/safearea';
import { useTheme } from '../theme/useTheme';
import { usePlayerStore } from '../store/useStore';
import { isFavorited, toggleFavorite } from '../core/storage';
import TrackItem from '../components/TrackItem';
import EmptyState from '../components/EmptyState';
import ContextMenu from '../components/ContextMenu';
import { ChevronDownIcon, SettingsIcon, CloseIcon, PlusIcon, HeartIcon, FolderPlusIcon, PlayIcon, DownloadIcon, TrashIcon } from '../components/icons';
import { musicSongUrl } from '../core/source-manager';

export default function FavoritesScreen() {
  const { colors, isDark } = useTheme();

  const {
    favorites, setFavorites, customPlaylists, currentPlaylistId,
    setCurrentPlaylistId, createPlaylist, deletePlaylist, renamePlaylist,
    removeTrackFromPlaylist, openAddToPlaylist, setQueue, playTrack,
    playOnlineSong, setToast, currentIndex, queueSource, currentSource
  } = usePlayerStore();

  // === 歌单下拉弹窗开关 ===
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // === 弹窗状态 ===
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  // === 单曲长按菜单 ===
  const [trackMenuVisible, setTrackMenuVisible] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  // === 获取当前选中的歌单与曲目列表 ===
  const isDefaultFavorites = currentPlaylistId === 'favorites';
  const currentCustomPlaylist = !isDefaultFavorites
    ? customPlaylists.find(p => p.id === currentPlaylistId)
    : null;

  const currentTitle = isDefaultFavorites
    ? '我喜欢的'
    : (currentCustomPlaylist ? currentCustomPlaylist.name : '我喜欢的');

  const currentTracks = isDefaultFavorites
    ? favorites
    : (currentCustomPlaylist ? (currentCustomPlaylist.tracks || []) : favorites);

  const playlistCount = currentTracks.length;

  // === 播放歌曲 ===
  const handlePlay = (track, index) => {
    const queueId = isDefaultFavorites ? 'favorites' : currentPlaylistId;
    const sourceArr = currentTracks.map(f => ({ ...f }));
    setQueue(queueId, sourceArr, index);
    if (track.type === 'online') {
      playOnlineSong({ ...track, songId: track.songId || track.id }, index);
    } else {
      playTrack(index);
    }
  };

  // === 收藏/取消喜欢 ===
  const handleToggleFav = (track) => {
    const newFavs = toggleFavorite(track, [...favorites]);
    setFavorites(newFavs);
    setToast(isFavorited(track, newFavs) ? '已加入我喜欢' : '已从我喜欢移除');
  };

  // === 创建新歌单 ===
  const handleCreateSubmit = () => {
    const trimmed = newPlaylistName.trim();
    if (!trimmed) {
      Alert.alert('提示', '请输入歌单名称');
      return;
    }
    createPlaylist(trimmed);
    setNewPlaylistName('');
    setCreateModalVisible(false);
    setDropdownOpen(false);
  };

  // === 重命名歌单 ===
  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      Alert.alert('提示', '请输入歌单名称');
      return;
    }
    if (currentPlaylistId && currentPlaylistId !== 'favorites') {
      renamePlaylist(currentPlaylistId, trimmed);
    }
    setRenameModalVisible(false);
    setDropdownOpen(false);
  };

  // === 删除当前歌单 ===
  const handleDeletePlaylist = () => {
    if (isDefaultFavorites || !currentCustomPlaylist) return;
    Alert.alert(
      '删除歌单',
      `确定要删除歌单「${currentCustomPlaylist.name}」吗？（包含 ${playlistCount} 首歌曲）`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定删除',
          style: 'destructive',
          onPress: () => {
            deletePlaylist(currentPlaylistId);
            setDropdownOpen(false);
          },
        },
      ]
    );
  };

  // === 长按单曲菜单 ===
  const handleLongPress = (item, index, pageX, pageY) => {
    setSelectedTrack(item);
    setSelectedIndex(index);
    setMenuPos({ x: pageX, y: pageY });
    setTrackMenuVisible(true);
  };

  // === 单曲下载 ===
  const handleDownload = async (song) => {
    if (!song) { setTrackMenuVisible(false); return; }
    setToast('正在获取下载链接...');
    try {
      const songId = song.id || song.songId;
      if (!songId) { setToast('无法获取歌曲ID'); setTrackMenuVisible(false); return; }
      const source = currentSource || 'netease';
      const urlData = await musicSongUrl(source, songId, song);
      if (!urlData || !urlData.url) {
        setToast('无法获取下载链接');
        setTrackMenuVisible(false);
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
    setTrackMenuVisible(false);
  };

  // === 下一首播放 ===
  const handlePlayNextInQueue = (song) => {
    const track = { ...song, type: song.type || 'online', songId: song.songId || song.id };
    const { playlist, currentIndex } = usePlayerStore.getState();
    const newPlaylist = [...playlist];
    const insertAt = currentIndex + 1;
    if (!newPlaylist.some(t => (t.songId && t.songId === track.songId) || t.path === track.path)) {
      newPlaylist.splice(insertAt, 0, track);
      usePlayerStore.setState({ playlist: newPlaylist });
      setToast(`已添加「${song.name}」到下一首播放`);
    } else {
      setToast('歌曲已在播放队列中');
    }
    setTrackMenuVisible(false);
  };

  // === 渲染单首歌曲 ===
  const renderItem = ({ item, index }) => {
    const isCurrent = queueSource === (isDefaultFavorites ? 'favorites' : currentPlaylistId) && index === currentIndex;
    const isFav = isFavorited(item, favorites);
    return (
      <TrackItem
        index={index}
        name={item.name}
        artist={item.artist}
        album={item.album}
        duration={item.duration}
        fee={item.fee}
        isOnline={item.type === 'online' || !!item.songId}
        isPlaying={isCurrent}
        isFavorited={isFav}
        onPress={() => handlePlay(item, index)}
        onFavPress={() => handleToggleFav(item)}
        onLongPress={(e) => {
          const { pageX, pageY } = e.nativeEvent;
          handleLongPress(item, index, pageX, pageY);
        }}
      />
    );
  };

  // === 歌单列表项（纯净文字，无爱心与图标） ===
  const allPlaylistList = [
    { id: 'favorites', name: '我喜欢的', count: favorites.length },
    ...customPlaylists.map(p => ({
      id: p.id,
      name: p.name,
      count: p.tracks ? p.tracks.length : 0,
    })),
  ];

  const solidModalBg = isDark ? '#222222' : '#ffffff';
  const solidInputBg = isDark ? '#181818' : '#f5f5f5';

  return (
    <View style={styles.container}>
      {/* 顶部 Header：左侧标题+曲目数，中间空白区域下拉选择框，右侧设置图标 */}
      <View style={styles.header}>
        {/* 左侧：标题与曲目数（大字号保持完整显示） */}
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
            {currentTitle}
          </Text>
          <Text style={[styles.count, { color: colors.textMuted }]}>
            {playlistCount} 首
          </Text>
        </View>

        {/* 中间空白区域：下拉选择框（样式对齐搜索来源/播放音源） */}
        <View style={styles.headerMiddle}>
          <TouchableOpacity
            style={[
              styles.sourceDropdownBtn,
              { backgroundColor: colors.bgTertiary, borderColor: colors.border }
            ]}
            activeOpacity={0.7}
            onPress={() => setDropdownOpen(!dropdownOpen)}
          >
            <Text style={[styles.sourceDropdownText, { color: colors.textPrimary }]} numberOfLines={1}>
              {currentTitle}
            </Text>
            <ChevronDownIcon width={14} height={14} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* 右侧：设置按钮 */}
        <TouchableOpacity
          style={[styles.settingsBtn, { borderColor: colors.border }]}
          onPress={() => usePlayerStore.setState({ settingsVisible: true })}
        >
          <SettingsIcon width={16} height={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* 点击下拉框弹出的歌单管理界面：放屏幕正中间（不透明实体弹窗） */}
      {dropdownOpen && (
        <Modal
          visible={dropdownOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setDropdownOpen(false)}
        >
          <TouchableWithoutFeedback onPress={() => setDropdownOpen(false)}>
            <View style={styles.dropdownCenterBackdrop}>
              <TouchableWithoutFeedback>
                <View style={[
                  styles.dropdownCenterBox,
                  { backgroundColor: solidModalBg, borderColor: colors.border }
                ]}>
                  {/* 弹窗顶部标题栏 */}
                  <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.modalHeaderTitle, { color: colors.textPrimary }]}>选择歌单</Text>
                    <TouchableOpacity onPress={() => setDropdownOpen(false)} style={styles.closeBtn}>
                      <CloseIcon width={16} height={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  {/* 歌单列表 */}
                  <ScrollView nestedScrollEnabled style={{ maxHeight: 260 }}>
                    {allPlaylistList.map((item) => {
                      const isSelected = (item.id === currentPlaylistId) || (isDefaultFavorites && item.id === 'favorites');
                      return (
                        <TouchableOpacity
                          key={item.id}
                          style={[
                            styles.dropdownMenuItem,
                            isSelected && { backgroundColor: colors.accent }
                          ]}
                          onPress={() => {
                            setCurrentPlaylistId(item.id);
                            setDropdownOpen(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.dropdownItemText,
                              { color: isSelected ? '#fff' : colors.textPrimary, fontWeight: isSelected ? '700' : '500' }
                            ]}
                            numberOfLines={1}
                          >
                            {item.name}
                          </Text>
                          <Text
                            style={[
                              styles.dropdownItemCountText,
                              { color: isSelected ? 'rgba(255,255,255,0.85)' : colors.textMuted }
                            ]}
                          >
                            {item.count} 首
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {/* 底部操作快捷按钮栏 */}
                  <View style={[styles.dropdownActionsBar, { borderTopColor: colors.border }]}>
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={[styles.actionPillBtn, { backgroundColor: colors.accent }]}
                        onPress={() => {
                          setNewPlaylistName('');
                          setCreateModalVisible(true);
                        }}
                      >
                        <PlusIcon width={14} height={14} color="#fff" />
                        <Text style={styles.actionPillTextWhite}>新建歌单</Text>
                      </TouchableOpacity>

                      {!isDefaultFavorites && (
                        <TouchableOpacity
                          style={[styles.actionPillBtnOutline, { borderColor: colors.border }]}
                          onPress={() => {
                            setRenameValue(currentTitle);
                            setRenameModalVisible(true);
                          }}
                        >
                          <Text style={[styles.actionPillText, { color: colors.textPrimary }]}>重命名</Text>
                        </TouchableOpacity>
                      )}

                      {!isDefaultFavorites && (
                        <TouchableOpacity
                          style={[styles.actionPillBtnOutline, { borderColor: '#e74c3c44' }]}
                          onPress={handleDeletePlaylist}
                        >
                          <Text style={{ color: '#e74c3c', fontSize: 13, fontWeight: '600' }}>删除</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}

      {/* 歌曲列表 / 空状态 */}
      {playlistCount === 0 ? (
        <EmptyState
          icon="🎵"
          title={isDefaultFavorites ? '还没有收藏的音乐' : '歌单暂无歌曲'}
          hint={isDefaultFavorites ? '点击歌曲旁边的爱心收藏' : '从发现、搜索或排行榜中长按歌曲添加到此歌单'}
        />
      ) : (
        <FlatList
          data={currentTracks}
          renderItem={renderItem}
          keyExtractor={(item, index) => `${item.id || item.songId || item.path || 'track'}_${index}`}
          contentContainerStyle={{ paddingBottom: 80 }}
        />
      )}

      {/* ================= 新建歌单弹窗（放屏幕正中间，不透明实体卡片） ================= */}
      <Modal
        visible={createModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setCreateModalVisible(false)}>
          <View style={styles.inputModalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.inputModalBox, { backgroundColor: solidModalBg, borderColor: colors.border }]}>
                <Text style={[styles.inputModalTitle, { color: colors.textPrimary }]}>新建歌单</Text>
                <TextInput
                  style={[
                    styles.modalInput,
                    {
                      backgroundColor: solidInputBg,
                      color: colors.textPrimary,
                      borderColor: colors.border
                    }
                  ]}
                  placeholder="请输入歌单名称"
                  placeholderTextColor={colors.textMuted}
                  value={newPlaylistName}
                  onChangeText={setNewPlaylistName}
                  autoFocus
                  maxLength={30}
                />
                <View style={styles.inputModalBtns}>
                  <TouchableOpacity
                    style={[styles.modalBtn, { borderColor: colors.border }]}
                    onPress={() => setCreateModalVisible(false)}
                  >
                    <Text style={[styles.modalBtnText, { color: colors.textMuted }]}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: colors.accent, borderColor: colors.accent }]}
                    onPress={handleCreateSubmit}
                  >
                    <Text style={[styles.modalBtnText, { color: '#fff', fontWeight: '700' }]}>创建</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ================= 重命名歌单弹窗（放屏幕正中间，不透明实体卡片） ================= */}
      <Modal
        visible={renameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setRenameModalVisible(false)}>
          <View style={styles.inputModalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.inputModalBox, { backgroundColor: solidModalBg, borderColor: colors.border }]}>
                <Text style={[styles.inputModalTitle, { color: colors.textPrimary }]}>重命名歌单</Text>
                <TextInput
                  style={[
                    styles.modalInput,
                    {
                      backgroundColor: solidInputBg,
                      color: colors.textPrimary,
                      borderColor: colors.border
                    }
                  ]}
                  placeholder="请输入新歌单名称"
                  placeholderTextColor={colors.textMuted}
                  value={renameValue}
                  onChangeText={setRenameValue}
                  autoFocus
                  maxLength={30}
                />
                <View style={styles.inputModalBtns}>
                  <TouchableOpacity
                    style={[styles.modalBtn, { borderColor: colors.border }]}
                    onPress={() => setRenameModalVisible(false)}
                  >
                    <Text style={[styles.modalBtnText, { color: colors.textMuted }]}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: colors.accent, borderColor: colors.accent }]}
                    onPress={handleRenameSubmit}
                  >
                    <Text style={[styles.modalBtnText, { color: '#fff', fontWeight: '700' }]}>保存</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ================= 单曲长按上下文菜单 ================= */}
      {selectedTrack && (
        <ContextMenu
          visible={trackMenuVisible}
          onClose={() => setTrackMenuVisible(false)}
          title={`${selectedTrack.name} - ${selectedTrack.artist || ''}`}
          x={menuPos.x}
          y={menuPos.y}
          actions={[
            {
              label: isFavorited(selectedTrack, favorites) ? '从我喜欢移除' : '加入我喜欢',
              icon: HeartIcon,
              onPress: () => handleToggleFav(selectedTrack),
            },
            {
              label: '添加到歌单',
              icon: FolderPlusIcon,
              onPress: () => openAddToPlaylist(selectedTrack),
            },
            ...(!isDefaultFavorites ? [{
              label: '从本歌单移除',
              icon: TrashIcon,
              destructive: true,
              onPress: () => removeTrackFromPlaylist(currentPlaylistId, selectedTrack.id || selectedTrack.songId || selectedTrack.path),
            }] : []),
            {
              label: '下一首播放',
              icon: PlayIcon,
              onPress: () => handlePlayNextInQueue(selectedTrack),
            },
            {
              label: '下载歌曲',
              icon: DownloadIcon,
              onPress: () => handleDownload(selectedTrack),
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: HEADER_PADDING_TOP,
    paddingBottom: 10,
    gap: 8,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flexShrink: 0,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  count: {
    fontSize: 13,
  },
  headerMiddle: {
    flex: 1,
    paddingHorizontal: 6,
  },
  sourceDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    height: 36,
  },
  sourceDropdownText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    marginRight: 4,
  },
  settingsBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 0,
  },

  // 歌单选择弹窗（居中放置在屏幕正中间）
  dropdownCenterBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dropdownCenterBox: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 1,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  dropdownMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  dropdownItemText: {
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  dropdownItemCountText: {
    fontSize: 12,
  },
  dropdownActionsBar: {
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionPillBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  actionPillTextWhite: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  actionPillBtnOutline: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPillText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // 输入弹窗（深色遮罩 + 居中不透明实体卡片）
  inputModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  inputModalBox: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
  },
  inputModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 16,
  },
  modalInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    marginBottom: 18,
  },
  inputModalBtns: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  modalBtnText: {
    fontSize: 14,
  },
});