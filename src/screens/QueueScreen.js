// 播放列表页
import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';

import { HEADER_PADDING_TOP } from '../theme/safearea';
import { useTheme } from '../theme/useTheme';
import { usePlayerStore } from '../store/useStore';
import { isFavorited, toggleFavorite } from '../core/storage';
import TrackItem from '../components/TrackItem';
import EmptyState from '../components/EmptyState';
import ContextMenu from '../components/ContextMenu';
import { SettingsIcon, FolderPlusIcon, PlayIcon, TrashIcon } from '../components/icons';

export default function QueueScreen() {
  const { colors } = useTheme();

  const {
    playlist, currentIndex, playTrack, favorites, setFavorites,
    setToast, isRoaming, roamIndex, roamPlaylist, setSettingsVisible
  } = usePlayerStore();

  const [menuVisible, setMenuVisible] = useState(false);
  const [menuTrack, setMenuTrack] = useState(null);
  const [menuIndex, setMenuIndex] = useState(-1);

  // 漫游模式下显示漫游列表
  const displayQueue = isRoaming ? roamPlaylist : playlist;
  const displayIndex = isRoaming ? roamIndex : currentIndex;

  const handlePlay = (index) => {
    if (isRoaming) {
      usePlayerStore.getState().playRoamSong(index);
    } else {
      playTrack(index);
    }
  };

  const handleFav = (track) => {
    const newFavs = toggleFavorite(track, [...favorites]);
    setFavorites(newFavs);
    setToast(isFavorited(track, favorites) ? '已从我喜欢移除' : '已加入我喜欢');
  };

  const handleRemove = (index) => {
    const { playlist, currentIndex } = usePlayerStore.getState();
    const newPlaylist = [...playlist];
    newPlaylist.splice(index, 1);
    let newCurrentIndex = currentIndex;
    if (index === currentIndex) {
      newCurrentIndex = -1;
      usePlayerStore.getState().cleanup();
      usePlayerStore.setState({ isPlaying: false, currentOnlineSong: null, lyricsData: [] });
    } else if (index < currentIndex) {
      newCurrentIndex--;
    }
    usePlayerStore.setState({ playlist: newPlaylist, currentIndex: newCurrentIndex });
    setMenuVisible(false);
  };

  const handlePlayNext = (index) => {
    const track = isRoaming ? roamPlaylist[index] : playlist[index];
    if (!track) return;
    const { playlist: pl, currentIndex: ci } = usePlayerStore.getState();
    const newPlaylist = [...pl];
    const insertAt = ci + 1;
    const trackId = track.songId || track.path || track.id;
    if (!newPlaylist.some(t => (t.songId || t.path || t.id) === trackId)) {
      newPlaylist.splice(insertAt, 0, { ...track });
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
    const isCurrent = index === displayIndex;
    const fav = isFavorited(item, favorites);
    const displayName = item.type === 'online' ? `${item.name} - ${item.artist || ''}` : item.name;
    return (
      <TrackItem
        index={index}
        name={displayName}
        isPlaying={isCurrent}
        isOnline={item.type === 'online'}
        isFavorited={fav}
        onPress={() => handlePlay(index)}
        onFavPress={() => handleFav(item)}
        onLongPress={() => handleLongPress(item, index)}
      />
    );
  };

  const menuTitle = menuTrack
    ? (menuTrack.type === 'online' ? `${menuTrack.name} - ${menuTrack.artist || ''}` : menuTrack.name)
    : '';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {isRoaming ? '漫游列表' : '播放列表'}
        </Text>
        <Text style={[styles.count, { color: colors.textMuted }]}>{displayQueue.length} 首</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={[styles.settingsBtn, { borderColor: colors.border }]}
          onPress={() => usePlayerStore.setState({ settingsVisible: true })}
        >
          <SettingsIcon width={16} height={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      {displayQueue.length === 0 ? (
        <EmptyState icon="📋" title="播放列表为空" hint="点击歌曲即可加入播放列表" />
      ) : (
        <FlatList
          data={displayQueue}
          renderItem={renderItem}
          keyExtractor={(item, index) => `${item.path || item.id || 'q'}_${index}`}
          contentContainerStyle={{ paddingBottom: 80 }}
        />
      )}
      <ContextMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        title={menuTitle}
        actions={[
          { label: '添加到歌单', icon: FolderPlusIcon, onPress: () => usePlayerStore.getState().openAddToPlaylist(menuTrack) },
          { label: '下一首播放', icon: PlayIcon, onPress: () => handlePlayNext(menuIndex) },
          { label: '从列表移除', icon: TrashIcon, onPress: () => handleRemove(menuIndex), destructive: true },
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
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: HEADER_PADDING_TOP,
    paddingBottom: 12,
  },
  title: { fontSize: 22, fontWeight: '700' },
  count: { fontSize: 13 },
  settingsBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
  },
});
