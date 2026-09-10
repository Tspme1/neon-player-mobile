// 更新弹窗组件
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  ActivityIndicator, Animated, Easing
} from 'react-native';
import { useTheme } from '../theme/useTheme';
import { RefreshCwIcon, AlertCircleIcon, CheckIcon } from './icons';
import {
  downloadApk, installApk, setSkippedVersion
} from '../core/updater';

export default function UpdateDialog({ visible, updateInfo, onClose }) {
  const { colors } = useTheme();

  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');
  const [dontRemind, setDontRemind] = useState(false);

  // 重置状态
  useEffect(() => {
    if (visible) {
      setDownloading(false);
      setProgress(0);
      setInstalling(false);
      setError('');
      setDontRemind(false);
    }
  }, [visible]);

  const handleUpdate = async () => {
    if (!updateInfo?.apkUrl) return;

    setDownloading(true);
    setError('');

    try {
      const path = await downloadApk(updateInfo.apkUrl, (p) => {
        if (p === -1) {
          setError('下载失败，请稍后重试');
          setDownloading(false);
        } else {
          setProgress(p);
        }
      });

      if (path) {
        setDownloading(false);
        setInstalling(true);
        // 短暂延迟，让 UI 切换到安装中状态
        setTimeout(() => {
          installApk(path);
        }, 500);
      }
    } catch (e) {
      setError(e.message || '下载失败');
      setDownloading(false);
    }
  };

  const handleSkip = async () => {
    // 勾选了"不再提醒"才记录
    if (dontRemind && updateInfo?.versionCode) {
      await setSkippedVersion(updateInfo.versionCode);
    }
    onClose();
  };

  if (!updateInfo || !updateInfo.hasUpdate) return null;

  const isForceUpdate = updateInfo.forceUpdate;

  return (
    <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={handleSkip}>
      <View style={[styles.overlay, { zIndex: 9999 }]}>
        <View style={[styles.dialog, { backgroundColor: colors.bgPrimary }]}>
          {/* 标题 */}
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <RefreshCwIcon size={20} color={colors.accent} />
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                发现新版本
              </Text>
            </View>
            <Text style={[styles.version, { color: colors.accent }]}>
              v{updateInfo.versionName}
            </Text>
          </View>

          {/* 更新内容 */}
          {updateInfo.updateMessage ? (
            <View style={[styles.msgBox, { backgroundColor: colors.bgTertiary }]}>
              <Text style={[styles.msgText, { color: colors.textSecondary }]}>
                {updateInfo.updateMessage}
              </Text>
            </View>
          ) : null}

          {/* 下载进度 */}
          {downloading ? (
            <View style={styles.progressSection}>
              <View style={styles.progressRow}>
                <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
                  下载中... {progress}%
                </Text>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
              <View style={[styles.progressBar, { backgroundColor: colors.bgTertiary }]}>
                <View
                  style={[styles.progressFill, {
                    backgroundColor: colors.accent,
                    width: `${progress}%`
                  }]}
                />
              </View>
            </View>
          ) : null}

          {/* 安装中 */}
          {installing ? (
            <View style={styles.progressSection}>
              <View style={styles.progressRow}>
                <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
                  正在打开安装界面...
                </Text>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            </View>
          ) : null}

          {/* 错误信息 */}
          {error ? (
            <View style={styles.errorRow}>
              <AlertCircleIcon size={14} color="#e74c3c" />
              <Text style={[styles.errorText, { color: '#e74c3c' }]}>
                {error}
              </Text>
            </View>
          ) : null}

          {/* "不再提醒" 选项 — 仅非强制更新时显示 */}
          {!isForceUpdate && !downloading && !installing ? (
            <TouchableOpacity
              style={styles.checkRow}
              onPress={() => setDontRemind(!dontRemind)}
            >
              <View style={[
                styles.checkbox,
                dontRemind
                  ? { backgroundColor: colors.accent, borderColor: colors.accent }
                  : { borderColor: colors.border }
              ]}>
                {dontRemind ? <CheckIcon size={12} color="#fff" strokeWidth={3} /> : null}
              </View>
              <Text style={[styles.checkLabel, { color: colors.textSecondary }]}>
                不再提醒此版本
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* 按钮区 */}
          {!downloading && !installing ? (
            <View style={styles.btnRow}>
              {!isForceUpdate ? (
                <TouchableOpacity
                  style={[styles.btn, styles.btnSecondary, { borderColor: colors.border }]}
                  onPress={handleSkip}
                >
                  <Text style={[styles.btnSecondaryText, { color: colors.textSecondary }]}>
                    暂不更新
                  </Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, { backgroundColor: colors.accent }]}
                onPress={handleUpdate}
              >
                <Text style={styles.btnPrimaryText}>
                  立即更新
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialog: {
    width: '86%',
    borderRadius: 16,
    padding: 24,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  version: {
    fontSize: 16,
    fontWeight: '600',
  },
  msgBox: {
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    maxHeight: 200,
  },
  msgText: {
    fontSize: 14,
    lineHeight: 22,
  },
  progressSection: {
    marginBottom: 16,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  checkLabel: {
    fontSize: 13,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    flex: 1.5,
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  btnSecondary: {
    borderWidth: 1,
  },
  btnSecondaryText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
