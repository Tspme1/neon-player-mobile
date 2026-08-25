// NeonPlayer Mobile — App 入口（重构版）
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, Platform, BackHandler, ToastAndroid } from 'react-native';

import { useTheme } from './src/theme/useTheme';
import { usePlayerStore, initApp } from './src/store/useStore';

import LocalScreen from './src/screens/LocalScreen';
import OnlineScreen from './src/screens/OnlineScreen';
import FavoritesScreen from './src/screens/FavoritesScreen';
import DiscoverScreen from './src/screens/DiscoverScreen';
import QueueScreen from './src/screens/QueueScreen';
import SettingsScreen from './src/screens/SettingsScreen';

import MiniPlayer from './src/components/MiniPlayer';
import FullPlayer from './src/components/FullPlayer';
import Toast from './src/components/Toast';
import LxSandbox from './src/components/LxSandbox';
import UpdateDialog from './src/components/UpdateDialog';
import { WebViewFetcher } from './src/components/WebViewFetcher';

import { MusicIcon, SearchIcon, HeartIcon, CompassIcon, ListIcon } from './src/components/icons';
import { tabBarHeight } from './src/theme/spacing';
import { checkForUpdate, shouldShowUpdateDialog } from './src/core/updater';

const TABS = [
  { id: 'local', label: '本地', icon: MusicIcon, component: LocalScreen },
  { id: 'online', label: '搜索', icon: SearchIcon, component: OnlineScreen },
  { id: 'favorites', label: '喜欢', icon: HeartIcon, component: FavoritesScreen },
  { id: 'discover', label: '发现', icon: CompassIcon, component: DiscoverScreen },
  { id: 'queue', label: '列表', icon: ListIcon, component: QueueScreen },
];

export default function App() {
  const { colors, isDark } = useTheme();

  const [activeTab, setActiveTab] = useState('favorites');
  const [fullPlayerVisible, setFullPlayerVisible] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateDialogVisible, setUpdateDialogVisible] = useState(false);
  const [bottomInset] = useState(0);
  const lastBackPressed = useRef(0);

  const { settingsVisible, showToast, toastMessage, pendingUpdateInfo, currentIndex, playlist, isRoaming, roamIndex, roamPlaylist } = usePlayerStore();

  // MiniPlayer 是否显示（有当前曲目时才显示）
  const hasTrack = (isRoaming && roamIndex >= 0 && roamIndex < roamPlaylist.length) ||
    (!isRoaming && currentIndex >= 0 && currentIndex < playlist.length);
  const miniPlayerHeight = hasTrack ? 64 : 0;

  useEffect(() => {
    initApp();

    // 启动后静默检查更新（延迟 3 秒）
    setTimeout(async () => {
      const info = await checkForUpdate();
      if (info && await shouldShowUpdateDialog(info)) {
        setUpdateInfo(info);
        setUpdateDialogVisible(true);
      }
    }, 3000);
  }, []);

  // === Android 返回键处理 ===
  // 层级优先级：UpdateDialog > SettingsScreen > FullPlayer > 主界面双击退出
  useEffect(() => {
    const handler = () => {
      // 1. 更新弹窗打开时，拦截返回键
      if (updateDialogVisible) return true;
      // 2. 设置页打开时，关闭设置页
      if (usePlayerStore.getState().settingsVisible) {
        usePlayerStore.setState({ settingsVisible: false });
        return true;
      }
      // 3. 全屏播放器打开时，关闭播放器
      if (fullPlayerVisible) {
        setFullPlayerVisible(false);
        return true;
      }
      // 4. 主界面：5秒内按两次返回键才退出
      const now = Date.now();
      if (now - lastBackPressed.current < 5000) {
        return false; // 让系统处理（退出 APP）
      }
      lastBackPressed.current = now;
      if (Platform.OS === 'android') {
        ToastAndroid.show('再按一次返回键退出', ToastAndroid.SHORT);
      }
      return true;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [updateDialogVisible, fullPlayerVisible]);

  // === Toast 同步 ===
  useEffect(() => {
    if (showToast) {
      setToastMsg(toastMessage);
      setToastVisible(true);
    }
  }, [showToast, toastMessage]);

  const handleToastDismiss = () => {
    setToastVisible(false);
    usePlayerStore.setState({ showToast: false });
  };

  // === 更新弹窗 ===
  useEffect(() => {
    if (pendingUpdateInfo) {
      setUpdateInfo(pendingUpdateInfo);
      setUpdateDialogVisible(true);
      usePlayerStore.setState({ pendingUpdateInfo: null });
    }
  }, [pendingUpdateInfo]);

  // 激进方案：只渲染当前 active Screen
  const ActiveScreen = TABS.find(t => t.id === activeTab)?.component || LocalScreen;

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.bgPrimary} />
      <View style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
        <View style={[styles.content, { paddingBottom: tabBarHeight + miniPlayerHeight }]}>
          <ActiveScreen />
        </View>

        <View style={[styles.miniPlayerWrap, { bottom: tabBarHeight }]}>
          <MiniPlayer onPress={() => setFullPlayerVisible(true)} />
        </View>

        <View style={[styles.tabBar, { backgroundColor: colors.glassBgStrong, borderTopColor: colors.border }]}>
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={styles.tabBtn}
                onPress={() => setActiveTab(tab.id)}
              >
                <Icon width={22} height={22} color={isActive ? colors.accent : colors.textMuted} />
                <Text style={{
                  color: isActive ? colors.accent : colors.textMuted,
                  fontSize: 10,
                  marginTop: 2,
                }}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <FullPlayer
          visible={fullPlayerVisible}
          onClose={() => setFullPlayerVisible(false)}
          onQueuePress={() => {
            setFullPlayerVisible(false);
            setActiveTab('queue');
          }}
        />

        <Toast message={toastMsg} visible={toastVisible} onDismiss={handleToastDismiss} />
        <LxSandbox />
        <WebViewFetcher />

        <UpdateDialog
          visible={updateDialogVisible}
          updateInfo={updateInfo}
          onClose={() => setUpdateDialogVisible(false)}
        />

        {settingsVisible && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 }}>
            <SettingsScreen
              visible={settingsVisible}
              onClose={() => usePlayerStore.setState({ settingsVisible: false })}
            />
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  miniPlayerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    height: tabBarHeight,
    borderTopWidth: 1,
    paddingBottom: Platform.OS === 'ios' ? 4 : 6,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
});
