// 歌曲列表项 — 对应桌面端 .track-item
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { HeartIcon } from './icons';
import { vipBadge, formatTime } from '../utils/format';

export default function TrackItem({
  index,
  name,
  artist,
  duration,
  fee,
  isPlaying = false,
  isFavorited = false,
  isOnline = false,
  rankIcon,
  onPress,
  onFavPress,
  onDeletePress,
  onLongPress,
  showDelete = false,
}) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: isPlaying ? colors.bgTertiary : 'transparent' }]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.6}
    >
      {/* Index / Rank */}
      <View style={styles.indexCol}>
        {rankIcon ? (
          <Text style={[styles.rankText, { color: index < 3 ? (['#f5a623', '#999', '#cd7f32'][index] || colors.textMuted) : colors.textMuted }]}>
            {rankIcon}
          </Text>
        ) : isPlaying ? (
          <Text style={{ color: colors.accent, fontSize: 14 }}>♪</Text>
        ) : (
          <Text style={[styles.indexText, { color: colors.textMuted }]}>{index + 1}</Text>
        )}
      </View>

      {/* Info */}
      <View style={styles.infoCol}>
        <View style={styles.nameRow}>
          <Text
            style={[styles.name, { color: isPlaying ? colors.accent : colors.textPrimary }]}
            numberOfLines={1}
          >
            {name}
          </Text>
          {vipBadge(fee) && (
            <View style={[styles.badge, { backgroundColor: fee === 1 ? colors.vipGold : colors.vipAlbum }]}>
              <Text style={styles.badgeText}>{vipBadge(fee)}</Text>
            </View>
          )}
          {isOnline && (
            <View style={[styles.onlineBadge, { borderColor: colors.accent }]}>
              <Text style={[styles.onlineBadgeText, { color: colors.accent }]}>在线</Text>
            </View>
          )}
        </View>
        {artist ? (
          <Text style={[styles.artist, { color: colors.textMuted }]} numberOfLines={1}>
            {artist}
          </Text>
        ) : null}
      </View>

      {/* Duration */}
      {duration ? (
        <Text style={[styles.duration, { color: colors.textMuted }]}>
          {formatTime(duration)}
        </Text>
      ) : null}

      {/* Favorite button */}
      <TouchableOpacity style={styles.favBtn} onPress={onFavPress}>
        <HeartIcon filled={isFavorited} width={16} height={16} color={isFavorited ? colors.accent : colors.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  indexCol: {
    width: 28,
    alignItems: 'center',
  },
  indexText: {
    fontSize: 13,
  },
  rankText: {
    fontSize: 16,
    fontWeight: '700',
  },
  infoCol: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 14,
    flexShrink: 1,
  },
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '600',
  },
  onlineBadge: {
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  onlineBadgeText: {
    fontSize: 9,
  },
  artist: {
    fontSize: 12,
  },
  duration: {
    fontSize: 12,
  },
  favBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
