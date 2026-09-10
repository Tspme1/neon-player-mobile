// 空状态 — 支持统一 SVG 矢量图标与经典兜底
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { MusicIcon, SearchIcon, FolderIcon, FlameIcon, ListIcon, HeartIcon } from './icons';

export default function EmptyState({ icon = '🎵', title, hint }) {
  const { colors } = useTheme();

  const renderIcon = () => {
    if (React.isValidElement(icon)) return icon;
    if (typeof icon === 'function') {
      const IconComponent = icon;
      return <IconComponent width={52} height={52} color={colors.textMuted} strokeWidth={1.5} />;
    }

    const iconSize = 52;
    const iconColor = colors.textMuted;
    const strokeWidth = 1.5;

    if (icon === 'music' || icon === '🎵') {
      return <MusicIcon width={iconSize} height={iconSize} color={iconColor} strokeWidth={strokeWidth} />;
    }
    if (icon === 'search' || icon === '🔍') {
      return <SearchIcon width={iconSize} height={iconSize} color={iconColor} strokeWidth={strokeWidth} />;
    }
    if (icon === 'folder' || icon === '📁') {
      return <FolderIcon width={iconSize} height={iconSize} color={iconColor} strokeWidth={strokeWidth} />;
    }
    if (icon === 'flame' || icon === '🔥') {
      return <FlameIcon width={iconSize} height={iconSize} color={iconColor} strokeWidth={strokeWidth} />;
    }
    if (icon === 'list' || icon === '📋') {
      return <ListIcon width={iconSize} height={iconSize} color={iconColor} strokeWidth={strokeWidth} />;
    }
    if (icon === 'heart' || icon === '❤️') {
      return <HeartIcon width={iconSize} height={iconSize} color={iconColor} strokeWidth={strokeWidth} />;
    }

    return <Text style={styles.iconText}>{icon}</Text>;
  };

  return (
    <View style={styles.container}>
      <View style={styles.iconWrapper}>
        {renderIcon()}
      </View>
      <Text style={[styles.title, { color: colors.textMuted }]}>{title}</Text>
      {hint ? <Text style={[styles.hint, { color: colors.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    opacity: 0.65,
  },
  iconWrapper: {
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 48,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
  },
  hint: {
    fontSize: 13,
    marginTop: 6,
  },
});
