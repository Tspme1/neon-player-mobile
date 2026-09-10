// 迷你播放栏 — 对应桌面端 .player-bar
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { PlayIcon, PauseIcon, NextIcon, HeartIcon, MusicIcon } from './icons';
import { usePlayerStore } from '../store/useStore';
import { isFavorited as checkFavorited, toggleFavorite as toggleFav } from '../core/storage';

// 封面缩略图：key=coverUri 重挂载时失败标记自动重置
function CoverThumb({ uri, bg, iconColor }) {
  const [failed, setFailed] = useState(false);
  if (!uri || failed) {
    return (
      <View style={[styles.cover, { backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }]}>
        <MusicIcon width={22} height={22} color={iconColor || '#888'} strokeWidth={1.8} />
      </View>
    );
  }
  return (
    <View style={[styles.cover, { backgroundColor: bg, overflow: 'hidden' }]}>
      <Image
        source={{ uri }}
        style={styles.coverImg}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    </View>
  );
}

export default function MiniPlayer({ onPress }) {
  const { colors } = useTheme();

  const { playlist, currentIndex, isPlaying, isRoaming, roamIndex, roamPlaylist, favorites, currentCoverUrl } = usePlayerStore();
  const { togglePlay, playNext, setFavorites, setToast } = usePlayerStore();

  // Determine current track
  let track = null;
  if (isRoaming && roamIndex >= 0 && roamIndex < roamPlaylist.length) {
    track = { ...roamPlaylist[roamIndex], type: 'online', songId: roamPlaylist[roamIndex].id };
  } else if (currentIndex >= 0 && currentIndex < playlist.length) {
    track = playlist[currentIndex];
  }

  if (!track) return null;

  const coverUri = currentCoverUrl || track.picUrl || track.cover || null;
  const fav = checkFavorited(track, favorites);

  const handleFav = () => {
    const newFavs = toggleFav(track, [...favorites]);
    setFavorites(newFavs);
    setToast(fav ? '已从我喜欢移除' : '已加入我喜欢');
  };

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: colors.glassBgStrong, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.9}
    >
      {/* Cover（有封面显示图片，失败回落占位；key 切换自动重置） */}
      <CoverThumb key={coverUri || 'none'} uri={coverUri} bg={colors.bgTertiary} iconColor={colors.textMuted} />

      {/* Info */}
      <View style={styles.info}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {track.name}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>
          {track.artist || (track.type === 'online' ? '在线音乐' : '本地音乐')}
        </Text>
      </View>

      {/* Fav */}
      <TouchableOpacity style={styles.btn} onPress={handleFav}>
        <HeartIcon filled={fav} width={20} height={20} color={fav ? colors.accent : colors.textMuted} />
      </TouchableOpacity>

      {/* Play/Pause */}
      <TouchableOpacity style={styles.btn} onPress={togglePlay}>
        {isPlaying ? (
          <PauseIcon width={24} height={24} color={colors.textPrimary} />
        ) : (
          <PlayIcon width={24} height={24} color={colors.textPrimary} />
        )}
      </TouchableOpacity>

      {/* Next */}
      <TouchableOpacity style={styles.btn} onPress={() => playNext(true)}>
        <NextIcon width={22} height={22} color={colors.textPrimary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    paddingHorizontal: 12,
    gap: 8,
    borderTopWidth: 1,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverImg: {
    width: '100%',
    height: '100%',
  },
  info: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
  },
  btn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
