// LX 自定义音源与注册表管理 Provider
// 负责自定义音源脚本解析、注册表持久化（升级至 NeonKV + AsyncStorage 混合引擎）、导入更新及原生快速通道
import { NativeModules } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import crypto from 'crypto-js';
import { fetchText, withTimeout } from '../http/http-client';
import { KEYS, kvGetAsync, kvSetAsync, kvRemoveAsync } from '../storage';
import { isSandboxReady, waitForSandboxReady, getLxMusicUrlWebView } from '../../services/lx-webview-manager';
import logger from '../logger';

// =====================================================================
// 原生层 LX 音源快速直连通道 (后台 WebView 不可用时的替代方案)
// =====================================================================

export async function nativeLxMusicUrl(songId, platform = 'netease', quality = 'standard') {
  if (platform !== 'netease') {
    return null;
  }
  const _t0 = Date.now();
  const _log = (label) => logger.info('LxProvider:nativeLx', `+${Date.now() - _t0}ms ${label}`);
  _log(`start songId=${songId} platform=${platform} quality=${quality}`);
  const src = 'netease';
  const brMap = { low: 128, standard: 320, high: 320, lossless: 320 };
  const br = brMap[quality] || 320;
  const apis = [
    `https://music-api.gdstudio.xyz/api.php?types=url&source=${src}&id=${songId}&br=${br}`,
    `https://api.cenguigui.cn/api/netease/music_v1.php?type=json&id=${songId}&level=standard`,
  ];

  for (let i = 0; i < apis.length; i++) {
    const apiUrl = apis[i];
    const maxAttempts = i === 0 ? 2 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const attemptLabel = maxAttempts > 1 ? ` (attempt ${attempt}/${maxAttempts})` : '';
        _log(`API ${i + 1}/${apis.length}${attemptLabel} start: ${apiUrl.substring(0, 80)}...`);
        if (!NativeModules.MediaModule || !NativeModules.MediaModule.nativeHttpGet) {
          _log('nativeHttpGet not available');
          break;
        }
        const headers = JSON.stringify({
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://music.163.com/',
        });
        const responseText = await withTimeout(
          NativeModules.MediaModule.nativeHttpGet(apiUrl, headers),
          2500,
          `nativeLx-api-${i + 1}${attempt > 1 ? '-retry' : ''}`
        );
        _log(`API ${i + 1}${attemptLabel} response: ${responseText ? responseText.substring(0, 120) : 'empty'}`);
        if (!responseText) {
          if (attempt < maxAttempts) continue;
          break;
        }

        let data;
        try {
          data = JSON.parse(responseText);
        } catch {
          if (attempt < maxAttempts) continue;
          break;
        }

        if (data.url && typeof data.url === 'string' && data.url.startsWith('http')) {
          _log(`API ${i + 1}${attemptLabel} OK: url found`);
          return data.url;
        }
        if (data.data && data.data.url) {
          _log(`API ${i + 1}${attemptLabel} OK: data.url found`);
          return data.data.url;
        }
        if (data.musicUrl) {
          _log(`API ${i + 1}${attemptLabel} OK: musicUrl found`);
          return data.musicUrl;
        }
        if (attempt < maxAttempts) continue;
      } catch (e) {
        _log(`API ${i + 1} error on attempt ${attempt}: ${e.message}`);
        if (attempt < maxAttempts) continue;
      }
    }
  }
  _log('all APIs exhausted, return null');
  return null;
}

// =====================================================================
// 元数据解析与协议处理
// =====================================================================

export function parseMetadata(jsCode) {
  if (jsCode.startsWith('\ufeff')) jsCode = jsCode.slice(1);
  const blockMatch = jsCode.match(/^\/\*[\s\S]+?\*\//);
  if (!blockMatch) return null;

  const blockText = blockMatch[0];
  const meta = { name: '', description: '', version: '', author: '', homepage: '' };
  const limits = { name: 24, description: 36, author: 56, homepage: 1024, version: 36 };

  const lineRegex = /^\s?\*\s?@(\w+)\s+(.+)$/gm;
  let match;
  while ((match = lineRegex.exec(blockText)) !== null) {
    const key = match[1];
    const val = match[2].trim();
    if (key in meta) {
      meta[key] = val.length > limits[key] ? val.slice(0, limits[key]) + '...' : val;
    }
  }

  if (!meta.name) {
    meta.name = `user_api_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  }
  return meta;
}

export function generateSourceId(jsCode) {
  const hash = crypto.MD5(jsCode).toString();
  return `user_api_${hash.slice(0, 8)}_${Date.now()}`;
}

export function parseLxProtocol(raw) {
  if (raw.startsWith('lx-music://import/url/')) {
    const encoded = raw.slice('lx-music://import/url/'.length);
    try {
      const decoded = decodeURIComponent(encoded);
      if (decoded.startsWith('http')) return decoded;
    } catch {}
    try {
      const decoded = global.atob ? global.atob(encoded) : encoded;
      if (decoded.startsWith('http')) return decoded;
    } catch {}
  }
  return raw;
}

// =====================================================================
// 注册表与脚本代码持久化 (NeonKV 内存+原生极速缓存)
// =====================================================================

export async function loadRegistry() {
  try {
    const json = await kvGetAsync(KEYS.SOURCE_REGISTRY);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

export async function saveRegistry(entries) {
  try {
    await kvSetAsync(KEYS.SOURCE_REGISTRY, JSON.stringify(entries));
  } catch (e) {
    console.error('[LxProvider] saveRegistry error:', e);
  }
}

export async function readSourceCode(sourceId) {
  try {
    return await kvGetAsync(KEYS.SOURCE_CODE_PREFIX + sourceId);
  } catch {
    return null;
  }
}

export async function writeSourceCode(sourceId, code) {
  try {
    await kvSetAsync(KEYS.SOURCE_CODE_PREFIX + sourceId, code);
  } catch (e) {
    console.error('[LxProvider] writeSourceCode error:', e);
  }
}

export async function deleteSourceCode(sourceId) {
  try {
    await kvRemoveAsync(KEYS.SOURCE_CODE_PREFIX + sourceId);
  } catch {}
}

// =====================================================================
// 音源导入 / 删除 / 启用 / 更新
// =====================================================================

export async function importFromUrl(url, onProgress) {
  try {
    onProgress?.('正在解析链接...');
    const realUrl = parseLxProtocol(url.trim());
    if (!realUrl.startsWith('http')) {
      return { success: false, error: '无效的 URL' };
    }

    onProgress?.('正在获取音源脚本...');
    const jsCode = await fetchText(realUrl);

    onProgress?.('正在解析音源信息...');
    const meta = parseMetadata(jsCode);
    if (!meta) return { success: false, error: '无效的音源文件（找不到头部注释块）' };

    onProgress?.('正在注册音源...');
    const srcId = generateSourceId(jsCode);
    const entries = await loadRegistry();
    if (entries.some(e => e.id === srcId)) {
      return { success: false, error: '该音源已存在' };
    }

    await writeSourceCode(srcId, jsCode);

    const entry = {
      id: srcId,
      name: meta.name,
      description: meta.description,
      version: meta.version,
      author: meta.author,
      homepage: meta.homepage,
      origin_url: realUrl,
      enabled: true,
      addedAt: Date.now(),
    };
    entries.push(entry);
    await saveRegistry(entries);
    return { success: true, entry };
  } catch (e) {
    console.error('[LxProvider] importFromUrl error:', e.message);
    return { success: false, error: e.message };
  }
}

export async function importFromFile(onProgress) {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/javascript',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets || result.assets.length === 0) {
      return { success: false, canceled: true };
    }

    onProgress?.('正在读取文件...');
    const file = result.assets[0];
    const response = await fetch(file.uri);
    const jsCode = await response.text();

    onProgress?.('正在解析音源信息...');
    const meta = parseMetadata(jsCode);
    if (!meta) return { success: false, error: '无效的音源文件（找不到头部注释块）' };

    onProgress?.('正在注册音源...');
    const srcId = generateSourceId(jsCode);
    const entries = await loadRegistry();
    if (entries.some(e => e.id === srcId)) {
      return { success: false, error: '该音源已存在' };
    }

    await writeSourceCode(srcId, jsCode);

    const entry = {
      id: srcId,
      name: meta.name,
      description: meta.description,
      version: meta.version,
      author: meta.author,
      homepage: meta.homepage,
      origin_url: '',
      enabled: true,
      addedAt: Date.now(),
    };
    entries.push(entry);
    await saveRegistry(entries);
    return { success: true, entry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function deleteSource(sourceId) {
  const entries = await loadRegistry();
  const idx = entries.findIndex(e => e.id === sourceId);
  if (idx >= 0) {
    await deleteSourceCode(sourceId);
    entries.splice(idx, 1);
    await saveRegistry(entries);
    return { success: true };
  }
  return { success: false, error: '音源不存在' };
}

export async function setSourceEnabled(sourceId, enabled) {
  const entries = await loadRegistry();
  const entry = entries.find(e => e.id === sourceId);
  if (entry) {
    entry.enabled = enabled;
    await saveRegistry(entries);
    return { success: true };
  }
  return { success: false, error: '音源不存在' };
}

export async function updateSource(sourceId) {
  try {
    const entries = await loadRegistry();
    const entry = entries.find(e => e.id === sourceId);
    if (!entry) return { success: false, error: '音源不存在' };
    if (!entry.origin_url) return { success: false, error: '该音源不是通过 URL 导入的，无法自动更新' };

    const jsCode = await fetchText(entry.origin_url);
    const meta = parseMetadata(jsCode);
    if (meta) {
      entry.name = meta.name || entry.name;
      entry.description = meta.description || entry.description;
      entry.version = meta.version || entry.version;
      entry.author = meta.author || entry.author;
      entry.homepage = meta.homepage || entry.homepage;
    }
    await writeSourceCode(sourceId, jsCode);
    await saveRegistry(entries);
    return { success: true, entry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// =====================================================================
// LX 音源多策略智能竞速解析器 (resolveLxPlayUrl)
// =====================================================================

function raceFirstValidUrl(promiseFactories) {
  return new Promise((resolve) => {
    let pending = promiseFactories.length;
    let resolved = false;

    if (pending === 0) {
      resolve(null);
      return;
    }

    promiseFactories.forEach((factory) => {
      Promise.resolve()
        .then(() => factory())
        .then((url) => {
          if (resolved) return;
          if (url && typeof url === 'string' && url.startsWith('http')) {
            resolved = true;
            resolve(url);
          } else {
            pending--;
            if (pending === 0 && !resolved) {
              resolve(null);
            }
          }
        })
        .catch(() => {
          if (resolved) return;
          pending--;
          if (pending === 0 && !resolved) {
            resolve(null);
          }
        });
    });
  });
}

export async function resolveLxPlayUrl(sourceId, songId, platform = 'netease', song = null, quality = 'standard', getOfficialUrl = null) {
  const _t0 = Date.now();
  const _log = (label) => logger.info('LxProvider:resolveLxPlayUrl', `+${Date.now() - _t0}ms ${label}`);
  try {
    let url = null;

    // 策略 1：网易云原生 API 与 WebView 沙箱智能并发竞速
    if (platform === 'netease') {
      if (isSandboxReady()) {
        _log('LX: netease detected, race nativeLxMusicUrl and WebView sandbox concurrently');
        url = await raceFirstValidUrl([
          () => nativeLxMusicUrl(songId, platform, quality),
          () => withTimeout(
            getLxMusicUrlWebView(sourceId, songId, '128k', platform, song),
            4000,
            'WebViewSandbox'
          ),
        ]);
        _log(`LX: netease race result: ${url ? 'has url' : 'null'}`);
      } else {
        _log('LX: netease detected, sandbox not ready, try nativeLxMusicUrl');
        url = await nativeLxMusicUrl(songId, platform, quality);
        _log(`LX: nativeLxMusicUrl done: ${url ? 'has url' : 'null'}`);
      }
    }

    // 策略 2：非网易云（如 QQ/酷狗/酷我），或网易竞速后仍未获得 URL，沙箱已就绪则走沙箱
    if ((!url || typeof url !== 'string' || !url.startsWith('http')) && isSandboxReady() && platform !== 'netease') {
      _log('LX: sandbox ready, getLxMusicUrlWebView start');
      try {
        url = await withTimeout(
          getLxMusicUrlWebView(sourceId, songId, '128k', platform, song),
          4000,
          'WebViewSandbox'
        );
        _log(`LX: getLxMusicUrlWebView done: ${url ? 'has url' : 'null'}`);
      } catch (we) {
        _log(`LX: getLxMusicUrlWebView failed/timeout: ${we.message}`);
      }
    }

    // 策略 3：若仍未获得 URL，且尚未尝试原生层（如其他平台），快速尝试原生层 HTTP (nativeLxMusicUrl)
    if ((!url || typeof url !== 'string' || !url.startsWith('http')) && platform !== 'netease') {
      _log('LX: try nativeLxMusicUrl (fallback)');
      url = await nativeLxMusicUrl(songId, platform, quality);
      _log(`LX: nativeLxMusicUrl done: ${url ? 'has url' : 'null'}`);
    }

    // 策略 4：若仍未获得 URL，且沙箱尚未就绪（如应用刚启动），等待沙箱启动完成兜底
    if ((!url || typeof url !== 'string' || !url.startsWith('http')) && !isSandboxReady()) {
      _log('LX: waiting for sandbox ready (fallback)');
      const waited = await waitForSandboxReady(3000);
      if (waited) {
        url = await getLxMusicUrlWebView(sourceId, songId, '128k', platform, song);
        _log(`LX: getLxMusicUrlWebView done: ${url ? 'has url' : 'null'}`);
      }
    }

    if (url && typeof url === 'string' && url.startsWith('http')) {
      // 检测 QQ 音乐试听版 URL（RS02 开头，只有 30秒-1分钟）
      if (platform === 'tencent' && url.includes('/RS02') && typeof getOfficialUrl === 'function') {
        _log('LX: QQ music preview URL detected (RS02), fallback to official API');
        const officialUrl = await getOfficialUrl('tencent', songId, song, quality);
        if (officialUrl && officialUrl.url) {
          _log('LX: QQ music official API fallback success');
          return officialUrl;
        }
        _log('LX: QQ music official API fallback also failed');
      } else {
        return { url, isLocal: false };
      }
    }

    _log('LX: all methods failed, return null');
    return null;
  } catch (e) {
    logger.error('LxProvider', 'resolveLxPlayUrl error', e.message);
    return null;
  }
}

export default {
  nativeLxMusicUrl,
  resolveLxPlayUrl,
  parseMetadata,
  generateSourceId,
  parseLxProtocol,
  loadRegistry,
  saveRegistry,
  readSourceCode,
  writeSourceCode,
  deleteSourceCode,
  importFromUrl,
  importFromFile,
  deleteSource,
  setSourceEnabled,
  updateSource,
};
