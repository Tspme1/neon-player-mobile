// 设置页 — 对应 PC 版设置弹窗
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, TextInput, Share
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';

import { HEADER_PADDING_TOP } from '../theme/safearea';
import { useTheme } from '../theme/useTheme';
import { usePlayerStore } from '../store/useStore';
import { loadFavorites, saveFavorites, loadSettings, saveSettings } from '../core/storage';
import { ChevronLeftIcon, TrashIcon } from '../components/icons';
import { importFromUrl, importFromFile, deleteSource, setSourceEnabled, updateSource, loadRegistry } from '../core/source-manager';
import { getCacheSize, clearCache } from '../core/cache-manager';
import { formatCacheSize } from '../utils/format';
import { checkForUpdate, shouldShowUpdateDialog, getCurrentVersionName, clearSkippedVersion } from '../core/updater';
import { isMediaNotificationEnabled, setMediaNotificationEnabled } from '../core/media-session';

const BUILTIN_SOURCES = [
  { id: 'netease', label: '网易云音乐' },
  { id: 'tencent', label: 'QQ音乐' },
  { id: 'kuwo', label: '酷我音乐' },
  { id: 'kugou', label: '酷狗音乐' },
];

const CACHE_LIMITS = [
  { value: 500, label: '500 MB' },
  { value: 1024, label: '1 GB' },
  { value: 2048, label: '2 GB' },
  { value: 0, label: '无限制' },
];

export default function SettingsScreen({ visible, onClose }) {
  const { colors } = useTheme();

  const { setToast, themeMode, setThemeMode, allowMixWithOthers, setAllowMixWithOthers, favorites } = usePlayerStore();

  const [cacheSize, setCacheSize] = useState('0 B (0 个文件)');
  const [cacheLimit, setCacheLimit] = useState(500);
  const [customSources, setCustomSources] = useState([]);
  const [sourceMgmtVisible, setSourceMgmtVisible] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [mediaNotificationOn, setMediaNotificationOn] = useState(true);

  useEffect(() => {
    if (visible) loadSettingsToUI();
  }, [visible]);

  if (!visible) return null;

  const loadSettingsToUI = async () => {
    try {
      const settings = await loadSettings();
      setCacheLimit(settings.cacheLimitMB || 500);
      // Load from registry
      const entries = await loadRegistry();
      setCustomSources(entries);
      // 计算实际缓存大小
      const { totalSize, fileCount } = await getCacheSize();
      setCacheSize(`${formatCacheSize(totalSize)} (${fileCount} 个文件)`);
      // 获取当前版本名
      const vName = await getCurrentVersionName();
      setAppVersion(vName);
      // 获取通知栏控件开关状态
      const mediaEnabled = await isMediaNotificationEnabled();
      setMediaNotificationOn(mediaEnabled);
    } catch (e) {
      console.error('Load settings error:', e);
    }
  };

  const handleToggleMediaNotification = async (enabled) => {
    setMediaNotificationOn(enabled);
    await setMediaNotificationEnabled(enabled);
    setToast(enabled ? '通知栏控件已开启' : '通知栏控件已关闭');
  };

  const handleClearCache = () => {
    Alert.alert(
      '清理缓存',
      '确定要清理音乐缓存吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定',
          onPress: async () => {
            await clearCache();
            setCacheSize('0 B (0 个文件)');
            setToast('缓存已清理');
          }
        }
      ]
    );
  };

  const handleCacheLimitChange = async (limit) => {
    setCacheLimit(limit);
    const settings = await loadSettings();
    settings.cacheLimitMB = limit;
    await saveSettings(settings);
    setToast(`缓存限制已更新为 ${limit === 0 ? '无限制' : limit + ' MB'}`);
  };

  const handleToggleCustomSource = async (src) => {
    await setSourceEnabled(src.id, src.enabled === false);
    const entries = await loadRegistry();
    setCustomSources(entries);
  };

  const handleDeleteSource = (src) => {
    Alert.alert(
      '删除音源',
      `确定要删除「${src.name}」吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            await deleteSource(src.id);
            setToast('音源已删除');
            const entries = await loadRegistry();
            setCustomSources(entries);
          }
        }
      ]
    );
  };

  const handleUpdateSource = async (src) => {
    setToast('正在更新音源...');
    const result = await updateSource(src.id);
    if (result.success) {
      setToast('音源已更新');
      const entries = await loadRegistry();
      setCustomSources(entries);
    } else {
      setToast(result.error || '更新失败');
    }
  };

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return;
    console.log('[SettingsScreen] handleImportUrl START, setImporting(true)');
    setImporting(true);
    console.log('[SettingsScreen] importing should be true now');
    setToast('正在导入音源...');
    const t0 = Date.now();
    console.log('[SettingsScreen] calling importFromUrl...');
    const result = await importFromUrl(importUrl.trim(), (msg) => {
      console.log('[SettingsScreen] onProgress:', msg, 'elapsed:', Date.now() - t0, 'ms');
      setToast(msg);
    });
    console.log('[SettingsScreen] importFromUrl returned in', Date.now() - t0, 'ms, success:', result.success, result.error || '');
    setImporting(false);
    console.log('[SettingsScreen] setImporting(false) done');
    if (result.success) {
      setToast(`✅ 音源「${result.entry.name}」导入成功`);
      setImportUrl('');
      const entries = await loadRegistry();
      setCustomSources(entries);
      // 自动切换到新导入的音源作为播放音源
      const newSourceId = 'lx:' + result.entry.id;
      await usePlayerStore.getState().setPlaySource(newSourceId);
      setToast(`已切换到播放音源「${result.entry.name}」`);
    } else {
      setToast(`❌ ${result.error || '导入失败'}`);
    }
  };

  const handleImportFile = async () => {
    setImporting(true);
    setToast('正在选择文件...');
    const result = await importFromFile((msg) => {
      setToast(msg);
    });
    setImporting(false);
    if (result.canceled) {
      setToast('');
      return;
    }
    if (result.success) {
      setToast(`✅ 音源「${result.entry.name}」导入成功`);
      const entries = await loadRegistry();
      setCustomSources(entries);
      // 自动切换到新导入的音源作为播放音源
      const newSourceId = 'lx:' + result.entry.id;
      await usePlayerStore.getState().setPlaySource(newSourceId);
      setToast(`已切换到播放音源「${result.entry.name}」`);
    } else {
      setToast(`❌ ${result.error || '导入失败'}`);
    }
  };

  // === 导出喜欢清单 ===
  const handleExportFavorites = async () => {
    if (!favorites || favorites.length === 0) {
      setToast('喜欢清单为空');
      return;
    }
    const json = JSON.stringify({
      type: 'neon-player-favorites',
      version: 1,
      exportedAt: new Date().toISOString(),
      count: favorites.length,
      favorites: favorites,
    }, null, 2);
    try {
      await Share.share({
        message: json,
        title: 'Neon Player 喜欢清单',
      });
    } catch (e) {
      setToast('导出失败: ' + e.message);
    }
  };

  // === 导入喜欢清单 ===
  const handleImportFavorites = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const file = result.assets[0];
      let content;
      try {
        content = await FileSystem.readAsStringAsync(file.uri, { encoding: 'utf8' });
      } catch {
        try {
          content = await FileSystem.readAsStringAsync(file.uri);
        } catch (e2) {
          setToast('读取文件失败');
          return;
        }
      }
      let data;
      try {
        data = JSON.parse(content);
      } catch {
        setToast('文件格式错误，请选择 JSON 文件');
        return;
      }
      if (!data || !data.favorites || !Array.isArray(data.favorites)) {
        setToast('文件内容无效，不是有效的喜欢清单');
        return;
      }
      Alert.alert(
        '导入喜欢清单',
        `检测到 ${data.favorites.length} 首歌曲，请选择导入方式：`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '合并',
            onPress: async () => {
              const existing = await loadFavorites();
              const existingIds = new Set(existing.map(f => f.id));
              const newOnes = data.favorites.filter(f => !existingIds.has(f.id));
              const merged = [...existing, ...newOnes];
              await saveFavorites(merged);
              usePlayerStore.getState().setFavorites(merged);
              setToast(`已合并导入 ${newOnes.length} 首歌曲（共 ${merged.length} 首）`);
            },
          },
          {
            text: '替换',
            onPress: async () => {
              await saveFavorites(data.favorites);
              usePlayerStore.getState().setFavorites(data.favorites);
              setToast(`已替换为 ${data.favorites.length} 首歌曲`);
            },
          },
        ],
      );
    } catch (e) {
      setToast('导入失败: ' + (e.message || '未知错误'));
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    // 清除之前跳过的版本，允许重新检查
    await clearSkippedVersion();
    const info = await checkForUpdate();
    setCheckingUpdate(false);

    if (!info) {
      setToast('检查更新失败，请稍后重试');
      return;
    }
    if (!info.hasUpdate) {
      setToast('当前已是最新版本');
      return;
    }
    if (!(await shouldShowUpdateDialog(info))) {
      setToast('当前已是最新版本');
      return;
    }
    // 有更新 — 通过 store 触发弹窗
    usePlayerStore.setState({
      showToast: true,
      toastMessage: `发现新版本 v${info.versionName}，请在更新弹窗中确认`,
    });
    // 通知 App 层显示弹窗
    usePlayerStore.setState({ pendingUpdateInfo: info });
  };

  return (
    <View style={[styles.overlay, { backgroundColor: colors.bgPrimary }]}>
      <View style={styles.container}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onClose} style={styles.backBtn}>
              <ChevronLeftIcon width={20} height={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.title, { color: colors.textPrimary }]}>⚙ 设置</Text>
            <View style={{ width: 36 }} />
          </View>

          <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 40 }}>
            {/* === 主题模式 === */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>🎨 主题模式</Text>
              <View style={[styles.row, { borderColor: colors.border }]}>
                <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>外观</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[
                    { value: 'light', label: '白天' },
                    { value: 'dark', label: '黑夜' },
                    { value: 'auto', label: '自动' },
                  ].map(opt => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.themeOptionBtn,
                        themeMode === opt.value
                          ? { backgroundColor: colors.accent }
                          : { backgroundColor: colors.bgTertiary, borderWidth: 1, borderColor: colors.border }
                      ]}
                      onPress={() => setThemeMode(opt.value)}
                    >
                      <Text style={{
                        color: themeMode === opt.value ? '#fff' : colors.textSecondary,
                        fontSize: 13,
                        fontWeight: '600',
                      }}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            {/* === 播放设置 === */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>🎧 播放设置</Text>
              <View style={[styles.row, { borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>通知栏媒体控件</Text>
                  <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>在通知栏显示播放/暂停/上下曲按钮</Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.toggleBtn,
                    mediaNotificationOn
                      ? { backgroundColor: colors.accent }
                      : { backgroundColor: colors.bgTertiary, borderWidth: 1, borderColor: colors.border }
                  ]}
                  onPress={() => handleToggleMediaNotification(!mediaNotificationOn)}
                >
                  <Text style={{ color: mediaNotificationOn ? '#fff' : colors.textMuted, fontSize: 13, fontWeight: '600' }}>
                    {mediaNotificationOn ? '开' : '关'}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.row, { borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>与其他应用同时播放</Text>
                  <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>开启后不会暂停其他音乐应用</Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.toggleBtn,
                    allowMixWithOthers
                      ? { backgroundColor: colors.accent }
                      : { backgroundColor: colors.bgTertiary, borderWidth: 1, borderColor: colors.border }
                  ]}
                  onPress={() => setAllowMixWithOthers(!allowMixWithOthers)}
                >
                  <Text style={{ color: allowMixWithOthers ? '#fff' : colors.textMuted, fontSize: 13, fontWeight: '600' }}>
                    {allowMixWithOthers ? '开' : '关'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* === 音乐缓存 === */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>📦 音乐缓存</Text>
              <View style={[styles.row, { borderColor: 'transparent' }]}>
                <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>当前缓存大小</Text>
                <Text style={[styles.rowValue, { color: colors.textMuted }]}>{cacheSize}</Text>
              </View>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.accent }]}
                onPress={handleClearCache}
              >
                <TrashIcon width={14} height={14} color="#fff" />
                <Text style={styles.actionBtnTextWhite}>清理缓存</Text>
              </TouchableOpacity>
              <Text style={[styles.subLabel, { color: colors.textSecondary, marginTop: 12 }]}>缓存限制大小</Text>
              <View style={styles.cacheOptions}>
                {CACHE_LIMITS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.cacheOpt,
                      cacheLimit === opt.value
                        ? { backgroundColor: colors.accent }
                        : { backgroundColor: colors.bgTertiary, borderWidth: 1, borderColor: colors.border }
                    ]}
                    onPress={() => handleCacheLimitChange(opt.value)}
                  >
                    <Text style={{
                      color: cacheLimit === opt.value ? '#fff' : colors.textSecondary,
                      fontSize: 12,
                    }}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* === 音源管理 === */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>🎵 音源管理</Text>
              <Text style={[styles.subLabel, { color: colors.textSecondary }]}>内置音源</Text>
              {BUILTIN_SOURCES.map(src => (
                <View key={src.id} style={[styles.sourceRow, { borderColor: colors.border, backgroundColor: colors.bgTertiary }]}>
                  <Text style={{ color: '#1abc9c', fontSize: 16 }}>✅</Text>
                  <Text style={[styles.sourceName, { color: colors.textPrimary }]}>{src.label}</Text>
                  <Text style={[styles.sourceTag, { color: colors.textMuted }]}>内置</Text>
                </View>
              ))}
              <Text style={[styles.subLabel, { color: colors.textSecondary, marginTop: 12 }]}>导入音源</Text>
              <View style={[styles.importRow, { borderColor: colors.border, backgroundColor: colors.bgTertiary }]}>
                <TextInput
                  style={[styles.importInput, { color: colors.textPrimary }]}
                  placeholder="输入音源 URL 或 lx-music:// 链接"
                  placeholderTextColor={colors.textMuted}
                  value={importUrl}
                  onChangeText={setImportUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!importing}
                />
                <TouchableOpacity
                  style={[styles.importBtn, { backgroundColor: colors.accent, opacity: importing ? 0.4 : 1 }]}
                  onPress={handleImportUrl}
                  disabled={importing}
                >
                  <Text style={styles.importBtnText}>URL导入</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.fileImportBtn, { borderColor: colors.accent, opacity: importing ? 0.4 : 1 }]}
                onPress={handleImportFile}
                disabled={importing}
              >
                <Text style={[styles.fileImportBtnText, { color: colors.accent }]}>
                  📁 从文件导入 (.js)
                </Text>
              </TouchableOpacity>
              <Text style={[styles.subLabel, { color: colors.textSecondary, marginTop: 12 }]}>自定义音源</Text>
              {customSources.length === 0 ? (
                <View style={styles.emptyBlock}>
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>暂无导入音源</Text>
                </View>
              ) : (
                customSources.map((src, idx) => (
                  <View key={src.id || idx} style={[styles.sourceRow, { borderColor: colors.border, backgroundColor: colors.bgTertiary }]}>
                    <Text style={{ color: src.enabled !== false ? '#1abc9c' : colors.textMuted, fontSize: 16 }}>
                      {src.enabled !== false ? '✅' : '⭕'}
                    </Text>
                    <View style={styles.sourceInfo}>
                      <Text style={[styles.sourceName, { color: colors.textPrimary }]}>{src.name}</Text>
                      <Text style={[styles.sourceDesc, { color: colors.textMuted }]}>{src.description || src.author || ''}</Text>
                    </View>
                    <View style={styles.sourceActions}>
                      <TouchableOpacity onPress={() => handleToggleCustomSource(src)}>
                        <Text style={[styles.sourceAction, { color: src.enabled !== false ? colors.textMuted : colors.accent }]}>
                          {src.enabled !== false ? '禁用' : '启用'}
                        </Text>
                      </TouchableOpacity>
                      {src.origin_url ? (
                        <TouchableOpacity onPress={() => handleUpdateSource(src)}>
                          <Text style={[styles.sourceAction, { color: colors.accent }]}>更新</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity onPress={() => handleDeleteSource(src)}>
                        <Text style={[styles.sourceAction, { color: '#e74c3c' }]}>删除</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* === 喜欢清单 === */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>❤ 喜欢清单</Text>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.accent }]}
                onPress={handleExportFavorites}
              >
                <Text style={styles.actionBtnTextWhite}>📤 导出喜欢清单</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.bgTertiary, borderWidth: 1, borderColor: colors.border, marginTop: 8 }]}
                onPress={handleImportFavorites}
              >
                <Text style={[styles.actionBtnText, { color: colors.textPrimary }]}>📥 导入喜欢清单</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* === 关于 === */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>ℹ 关于</Text>
              <View style={[styles.row, { borderColor: colors.border }]}>
                <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>当前版本</Text>
                <Text style={[styles.rowValue, { color: colors.textMuted }]}>v{appVersion}</Text>
              </View>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.accent, opacity: checkingUpdate ? 0.6 : 1 }]}
                onPress={handleCheckUpdate}
                disabled={checkingUpdate}
              >
                <Text style={styles.actionBtnTextWhite}>
                  {checkingUpdate ? '检查中...' : '🔍 检查更新'}
                </Text>
              </TouchableOpacity>
              <Text style={[styles.aboutText, { color: colors.textMuted, marginTop: 12 }]}>
                Neon Player v{appVersion} — 移动端音乐播放器{'\n'}
                基于 React Native + Expo
              </Text>
            </View>
          </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: HEADER_PADDING_TOP,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  body: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  rowLabel: {
    fontSize: 14,
  },
  rowValue: {
    fontSize: 13,
  },
  subLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 10,
  },
  actionBtnTextWhite: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  cacheOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cacheOpt: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  divider: {
    height: 0.5,
    marginHorizontal: 20,
    marginVertical: 4,
  },
  // 音源管理
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 0.5,
    borderRadius: 8,
    marginBottom: 6,
  },
  sourceInfo: {
    flex: 1,
  },
  sourceName: {
    fontSize: 14,
    fontWeight: '500',
  },
  sourceDesc: {
    fontSize: 11,
    marginTop: 2,
  },
  sourceTag: {
    fontSize: 12,
  },
  sourceAction: {
    fontSize: 13,
    fontWeight: '500',
  },
  sourceActions: {
    flexDirection: 'row',
    gap: 10,
  },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 0.5,
    borderRadius: 8,
    marginBottom: 8,
  },
  importInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 6,
  },
  importBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  importBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  fileImportBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  fileImportBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
  emptyBlock: {
    alignItems: 'center',
    paddingVertical: 16,
    backgroundColor: 'rgba(0,0,0,0.03)',
    borderRadius: 8,
  },
  aboutText: {
    fontSize: 13,
    lineHeight: 20,
  },
  toggleBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 44,
    alignItems: 'center',
  },
  themeOptionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 56,
    alignItems: 'center',
  },
});
