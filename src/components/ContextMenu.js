// 长按上下文菜单组件 — 跟随手指位置弹出
import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Dimensions } from 'react-native';
import { useTheme } from '../theme/useTheme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
const MENU_WIDTH = 180;
const MENU_MARGIN = 8;

export default function ContextMenu({ visible, onClose, title, actions, x, y }) {
  const { colors } = useTheme();

  // 计算菜单位置：默认在触摸点附近，避免超出屏幕边界
  let menuLeft = (x || SCREEN_WIDTH / 2) + 16;
  let menuTop = (y || SCREEN_HEIGHT / 2) - 40;

  // 右边界溢出时显示在触摸点左侧
  if (menuLeft + MENU_WIDTH > SCREEN_WIDTH - MENU_MARGIN) {
    menuLeft = (x || SCREEN_WIDTH / 2) - MENU_WIDTH - 16;
  }
  // 左边界溢出时贴边
  if (menuLeft < MENU_MARGIN) {
    menuLeft = MENU_MARGIN;
  }

  // 估算菜单高度（标题 + 每项约 48px）
  const estimatedHeight = (title ? 40 : 0) + (actions ? actions.length * 48 : 0) + 8;
  // 底部溢出时上移
  if (menuTop + estimatedHeight > SCREEN_HEIGHT - MENU_MARGIN) {
    menuTop = SCREEN_HEIGHT - MENU_MARGIN - estimatedHeight;
  }
  if (menuTop < MENU_MARGIN) {
    menuTop = MENU_MARGIN;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={[
          styles.menu,
          {
            backgroundColor: colors.bgSecondary,
            borderColor: colors.border,
            position: 'absolute',
            left: menuLeft,
            top: menuTop,
          }
        ]}>
          {title ? (
            <Text style={[styles.title, { color: colors.textMuted }]} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          {actions.map((action, index) => {
            const IconComp = action.icon;
            const iconColor = action.destructive ? '#e74c3c' : colors.textPrimary;
            return (
              <TouchableOpacity
                key={index}
                style={styles.actionBtn}
                onPress={() => {
                  onClose();
                  setTimeout(() => action.onPress(), 100);
                }}
              >
                {IconComp ? (
                  <View style={styles.actionIconWrap}>
                    {React.isValidElement(IconComp) ? (
                      IconComp
                    ) : typeof IconComp === 'function' ? (
                      <IconComp size={16} color={iconColor} strokeWidth={2} />
                    ) : null}
                  </View>
                ) : null}
                <Text style={[
                  styles.actionText,
                  { color: action.destructive ? '#e74c3c' : colors.textPrimary }
                ]}>
                  {action.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  menu: {
    width: MENU_WIDTH,
    borderRadius: 12,
    borderWidth: 0.5,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  title: {
    fontSize: 13,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  actionIconWrap: {
    marginRight: 10,
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontSize: 15,
  },
});
