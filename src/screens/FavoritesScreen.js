// 我喜欢的音乐页
import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';

import { HEADER_PADDING_TOP } from '../theme/safearea';
import { useTheme } from '../theme/useTheme';
import { usePlayerStore } from '../store/useStore';
import { isFavorited, toggleFavorite } from '../core/storage';
import TrackItem from '../components/TrackItem';
import EmptyState from '../components/EmptyState';
import { SettingsIcon } from '../components/icons';

export default function FavoritesScreen() {
  const { colors } = useTheme();

  const {
    favorites, setFavorites, setQueue, playTrack, playOnlineSong,
    setToast, currentIndex, queueSource
  } = usePlayerStore();

  const handlePlay = (track, index) => {
    const sourceArr = favorites.map(f => ({ ...f }));
    setQueue('favorites', sourceArr, index);
    if (track.type === 'online') {
      playOnlineSong({ ...track, songId: track.songId || track.id }, index);
    } else {
      playTrack(index);
    }
  };

  const handleUnfav = (track) => {
    const newFavs = toggleFavorite(track, [...favorites]);
    setFavorites(newFavs);
    setToast('已从我喜欢移除');
  };

  const renderItem = ({ item, index }) => {
    const isCurrent = queueSource === 'favorites' && index === currentIndex;
    return (
      <TrackItem
        index={index}
        name={item.type === 'online' ? `${item.name} - ${item.artist || ''}` : item.name}
        duration={item.duration}
        fee={item.fee}
        isOnline={item.type === 'online'}
        isPlaying={isCurrent}
        isFavorited={true}
        onPress={() => handlePlay(item, index)}
        onFavPress={() => handleUnfav(item)}
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>我喜欢的</Text>
        <Text style={[styles.count, { color: colors.textMuted }]}>{favorites.length} 首</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={[styles.settingsBtn, { borderColor: colors.border }]}
          onPress={() => usePlayerStore.setState({ settingsVisible: true })}
        >
          <SettingsIcon width={16} height={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      {favorites.length === 0 ? (
        <EmptyState icon="❤️" title="还没有喜欢的音乐" hint="点击歌曲旁边的爱心收藏" />
      ) : (
        <FlatList
          data={favorites}
          renderItem={renderItem}
          keyExtractor={(item, index) => `${item.id || item.path || 'fav'}_${index}`}
          contentContainerStyle={{ paddingBottom: 80 }}
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
