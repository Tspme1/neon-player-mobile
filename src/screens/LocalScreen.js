// 本地音乐页
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { HEADER_PADDING_TOP } from '../theme/safearea';
import { useTheme } from '../theme/useTheme';
import { usePlayerStore } from '../store/useStore';
import { savePlaylist, loadPlaylist, toggleFavorite, isFavorited } from '../core/storage';
import TrackItem from '../components/TrackItem';
import EmptyState from '../components/EmptyState';
import { PlusIcon } from '../components/icons';
import ContextMenu from '../components/ContextMenu';
import logger from '../core/logger';

export default function LocalScreen() {
  const { colors } = useTheme();

  const {
    localLibrary, setLocalLibrary, favorites, setFavorites,
    setQueue, playTrack, setToast, currentIndex, queueSource,
    playlist
  } = usePlayerStore();

  const [menuVisible, setMenuVisible] = useState(false);
  const [menuTrack, setMenuTrack] = useState(null);
  const [menuIndex, setMenuIndex] = useState(-1);

  useEffect(() => {
    (async () => {
      const saved = await loadPlaylist();
      if (saved.length > 0) {
        // 验证缓存文件是否存在，不存在则回退到原始路径
        const validated = [];
        for (const t of saved) {
          if (t.cachedPath) {
            const info = await FileSystem.getInfoAsync(t.cachedPath);
            if (info.exists && info.size > 0) {
              validated.push({ ...t, path: t.cachedPath });
            } else if (t.originalUri) {
              // 缓存被清了，回退到原始路径
              validated.push({ ...t, path: t.originalUri });
            }
          } else {
            validated.push({ ...t, type: 'local' });
          }
        }
        setLocalLibrary(validated.map(t => ({ ...t, type: 'local' })));
      }
    })();
  }, []);

  const handleAddFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        multiple: true,
        copyToCacheDirectory: false,
      });
      if (!result.canceled && result.assets) {
        const storageDir = (FileSystem.documentDirectory || FileSystem.cacheDirectory) + 'local-music/';
        await FileSystem.makeDirectoryAsync(storageDir, { intermediates: true }).catch(() => {});

        const newTracks = [];
        for (const a of result.assets) {
          const safeName = a.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const persistentPath = storageDir + Date.now() + '_' + safeName;
          try {
            await FileSystem.copyAsync({ from: a.uri, to: persistentPath });
            newTracks.push({
              path: persistentPath,
              cachedPath: persistentPath,
              originalUri: a.uri,
              name: a.name,
              type: 'local',
            });
          } catch (copyErr) {
            console.error('copy failed for', a.name, copyErr);
            // 复制失败则直接用原始 URI
            newTracks.push({
              path: a.uri,
              originalUri: a.uri,
              name: a.name,
              type: 'local',
            });
          }
        }
        if (newTracks.length > 0) {
          const updated = [...localLibrary, ...newTracks];
          setLocalLibrary(updated);
          await savePlaylist(updated);
          logger.info('LocalScreen', 'handleAddFiles success', { count: newTracks.length });
          setToast(`已添加 ${newTracks.length} 首歌曲`);
        } else {
          logger.warn('LocalScreen', 'handleAddFiles zero tracks');
          setToast('导入失败');
        }
      }
    } catch (e) {
      logger.error('LocalScreen', 'handleAddFiles error', e);
      setToast('添加文件失败');
    }
  };

  const handlePlay = (index) => {
    setQueue('local', localLibrary, index);
    playTrack(index);
  };

  const handleFav = (track) => {
    const newFavs = toggleFavorite(track, [...favorites]);
    setFavorites(newFavs);
    setToast(isFavorited(track, favorites) ? '已从我喜欢移除' : '已加入我喜欢');
  };

  const handleDelete = (index) => {
    const track = localLibrary[index];
    // 删除缓存文件
    if (track.cachedPath) {
      FileSystem.deleteAsync(track.cachedPath, { idempotent: true }).catch(() => {});
    }
    const updated = [...localLibrary];
    updated.splice(index, 1);
    setLocalLibrary(updated);
    savePlaylist(updated);
    setToast('已删除');

    // 如果删除的是当前播放曲目，停止播放
    if (queueSource === 'local' && index === currentIndex) {
      usePlayerStore.getState().cleanup();
      usePlayerStore.setState({ isPlaying: false, currentOnlineSong: null, lyricsData: [] });
    }
    setMenuVisible(false);
  };

  const handlePlayNext = (index) => {
    const track = localLibrary[index];
    // 添加到播放列表下一首位置
    const { playlist, currentIndex } = usePlayerStore.getState();
    const newPlaylist = [...playlist];
    // 在当前曲目后面插入
    const insertAt = currentIndex + 1;
    // 避免重复
    if (!newPlaylist.some(t => t.path === track.path)) {
      newPlaylist.splice(insertAt, 0, { ...track, type: 'local' });
      usePlayerStore.setState({ playlist: newPlaylist });
      setToast('已添加到下一首播放');
    } else {
      setToast('该曲目已在播放列表中');
    }
    setMenuVisible(false);
  };

  const handleLongPress = (track, index) => {
    setMenuTrack(track);
    setMenuIndex(index);
    setMenuVisible(true);
  };

  const renderItem = ({ item, index }) => {
    const isCurrent = queueSource === 'local' && index === currentIndex;
    const fav = favorites.some(f => f.path === item.path);
    return (
      <TrackItem
        index={index}
        name={item.name}
        isPlaying={isCurrent}
        isFavorited={fav}
        onPress={() => handlePlay(index)}
        onFavPress={() => handleFav(item)}
        onLongPress={() => handleLongPress(item, index)}
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>本地音乐</Text>
        <Text style={[styles.count, { color: colors.textMuted }]}>{localLibrary.length} 首</Text>
        <TouchableOpacity style={[styles.addBtn, { borderColor: colors.border }]} onPress={handleAddFiles}>
          <PlusIcon width={16} height={16} color={colors.accent} />
          <Text style={[styles.addBtnText, { color: colors.accent }]}>添加</Text>
        </TouchableOpacity>
      </View>
      {localLibrary.length === 0 ? (
        <EmptyState icon="📁" title="还没有本地音乐" hint="点击右上角添加音频文件" />
      ) : (
        <FlatList
          data={localLibrary}
          renderItem={renderItem}
          keyExtractor={(item, index) => `${item.path || index}`}
          contentContainerStyle={{ paddingBottom: 80 }}
        />
      )}
      <ContextMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        title={menuTrack?.name || ''}
        actions={[
          { label: '📑 添加到歌单', onPress: () => usePlayerStore.getState().openAddToPlaylist(menuTrack) },
          { label: '▶ 下一首播放', onPress: () => handlePlayNext(menuIndex) },
          { label: '🗑 删除', onPress: () => handleDelete(menuIndex), destructive: true },
        ]}
      />
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
    paddingBottom: 12,
    gap: 8,
  },
  title: { fontSize: 22, fontWeight: '700' },
  count: { fontSize: 13, flex: 1 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  addBtnText: { fontSize: 13, fontWeight: '600' },
});
