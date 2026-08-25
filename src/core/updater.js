// APK 整包自更新服务 — 从 services/updater.js 复制，确认导入路径正确
import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { UpdaterModule } = NativeModules;
const SKIPPED_VERSION_KEY = '@skipped_version';

// 更新检查 URL（后续可配置）
const UPDATE_URL = 'https://gitee.com/tang-shupeng/neon-release/raw/master/update.json';

const eventEmitter = UpdaterModule ? new NativeEventEmitter(UpdaterModule) : null;

/**
 * 获取当前版本号 (versionCode)
 */
export async function getCurrentVersionCode() {
  if (!UpdaterModule) return 1;
  return await UpdaterModule.getVersionCode();
}

/**
 * 获取当前版本名 (versionName)
 */
export async function getCurrentVersionName() {
  if (!UpdaterModule) return '1.00.000';
  return await UpdaterModule.getVersionName();
}

/**
 * 检查更新
 * @returns {object|null} { hasUpdate, versionCode, versionName, apkUrl, updateMessage, forceUpdate } 或 null
 */
export async function checkForUpdate() {
  if (!UpdaterModule) return null;
  if (Platform.OS !== 'android') return null;

  try {
    const currentVC = await UpdaterModule.getVersionCode();
    const result = await UpdaterModule.checkUpdate(UPDATE_URL, currentVC);
    return result;
  } catch (e) {
    console.error('[Updater] checkForUpdate error:', e);
    return null;
  }
}

/**
 * 下载 APK
 * @param {string} url APK 下载地址
 * @param {function} onProgress (progress: number) => void  0-100
 * @returns {string} 本地文件路径
 */
export async function downloadApk(url, onProgress) {
  if (!UpdaterModule) throw new Error('UpdaterModule 不可用');

  // 监听下载进度
  let progressSub = null;
  if (eventEmitter && onProgress) {
    progressSub = eventEmitter.addListener('updateDownloadProgress', (progress) => {
      if (progress === -1) {
        onProgress(-1); // 安装失败
      } else {
        onProgress(progress);
      }
    });
  }

  try {
    const path = await UpdaterModule.downloadApk(url);
    return path;
  } finally {
    if (progressSub) progressSub.remove();
  }
}

/**
 * 安装 APK
 * @param {string} filePath 本地 APK 文件路径
 */
export function installApk(filePath) {
  if (!UpdaterModule) throw new Error('UpdaterModule 不可用');
  UpdaterModule.installApk(filePath);
}

/**
 * 获取被跳过的版本号
 */
export async function getSkippedVersion() {
  try {
    const v = await AsyncStorage.getItem(SKIPPED_VERSION_KEY);
    return v ? parseInt(v, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * 设置跳过的版本号
 */
export async function setSkippedVersion(versionCode) {
  try {
    await AsyncStorage.setItem(SKIPPED_VERSION_KEY, String(versionCode));
  } catch (e) {
    console.error('[Updater] setSkippedVersion error:', e);
  }
}

/**
 * 清除跳过的版本号（用户在设置页手动检查更新时调用）
 */
export async function clearSkippedVersion() {
  try {
    await AsyncStorage.removeItem(SKIPPED_VERSION_KEY);
  } catch (e) {
    console.error('[Updater] clearSkippedVersion error:', e);
  }
}

/**
 * 判断是否应该显示更新弹窗
 * @param {object} updateInfo checkForUpdate 的返回值
 * @returns {boolean}
 */
export async function shouldShowUpdateDialog(updateInfo) {
  if (!updateInfo || !updateInfo.hasUpdate) return false;

  // 强制更新总是显示
  if (updateInfo.forceUpdate) return true;

  // 检查用户是否已跳过该版本
  const skipped = await getSkippedVersion();
  if (skipped === updateInfo.versionCode) return false;

  return true;
}

export default {
  getCurrentVersionCode,
  getCurrentVersionName,
  checkForUpdate,
  downloadApk,
  installApk,
  getSkippedVersion,
  setSkippedVersion,
  clearSkippedVersion,
  shouldShowUpdateDialog,
};
