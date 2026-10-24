// Toast 提示
import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useTheme } from '../theme/useTheme';

export default function Toast({ message, visible, onDismiss, action }) {
  const { colors } = useTheme();
  const opacity = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(opacity, { toValue: 1, useNativeDriver: true, tension: 60, friction: 8 }).start();
      const timer = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start();
        setTimeout(onDismiss, 300);
      }, action ? 3500 : 2000);
      return () => clearTimeout(timer);
    }
  }, [visible, message, action]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, { opacity }, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
      <Text style={[styles.text, { color: colors.textPrimary }]} numberOfLines={2}>{message}</Text>
      {action && action.label ? (
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => {
            try { action.onPress?.(); } catch {}
            onDismiss?.();
          }}
        >
          <Text style={[styles.actionText, { color: colors.accent }]}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 140,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '90%',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 9999,
  },
  text: {
    fontSize: 14,
    flexShrink: 1,
  },
  actionBtn: {
    marginLeft: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
