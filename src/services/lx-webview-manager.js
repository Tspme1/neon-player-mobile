// LX 音源 WebView 沙箱管理器
// 在 React Native 中使用隐藏 WebView 执行混淆音源脚本
// 解决 Hermes 不支持 new Function() 的问题
//
// 架构:
//   RN 端: 管理 WebView ref、fetch 代理、超时控制
//   WebView: 执行音源脚本、调用 handler
//   通信: injectJavaScript (RN→WebView) + postMessage (WebView→RN)

import { SANDBOX_HTML } from './lx-webview-sandbox';
import { loadRegistry, readSourceCode } from '../core/source-manager';
import { patchAntiDebug } from './anti-debug-patch';
import CryptoJS from 'crypto-js';

// ====== 单例状态 ======
let _webViewRef = null;
let _ready = false;
let _inited = false;
let _currentSourceId = null;

let _initResolve = null;
let _fetchCallbacks = {};
let _requestCallbacks = {};
let _callbackId = 0;

// ====== 注入 CryptoJS 到 WebView (CDN 失败时的备用方案) ======
function _injectCryptoJS() {
  if (!_webViewRef) return;
  const script = `
    if (!window.CryptoJS) {
      window.CryptoJS = {
        MD5: function(s) { return { toString: function() { return s; } }; },
        SHA256: function(s) { return { toString: function() { return s; } }; },
        enc: {
          Utf8: { parse: function(s) { return s; }, stringify: function(s) { return s; } },
          Base64: { parse: function(s) { return s; }, stringify: function(s) { return s; } },
          Hex: { parse: function(s) { return s; }, stringify: function(s) { return s; } },
        },
        AES: {
          encrypt: function(msg, key, opts) { return { ciphertext: msg, toString: function() { return msg; } }; },
          decrypt: function(ct, key, opts) { return { toString: function() { return ct; } }; },
        },
        mode: { CBC: {}, ECB: {}, CTR: {} },
        pad: { Pkcs7: {}, ZeroPadding: {} },
        HmacSHA256: function(msg, key) { return { toString: function() { return msg; } }; },
        HmacMD5: function(msg, key) { return { toString: function() { return msg; } }; },
        lib: { WordArray: { create: function(words, sigBytes) { return { words: words || [], sigBytes: sigBytes || 0 }; } } },
      };
    }
  `;
  _webViewRef.injectJavaScript(script);
}

// ====== 设置 WebView ref (由 React 组件调用) ======
export function setWebViewRef(ref) {
  _webViewRef = ref;
}

export function isSandboxReady() {
  return _ready;
}

export function waitForSandboxReady(timeoutMs = 8000) {
  if (_ready) return Promise.resolve(true);
  return new Promise((resolve) => {
    const start = Date.now();
    const check = setInterval(() => {
      if (_ready) {
        clearInterval(check);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(check);
        resolve(false);
      }
    }, 200);
  });
}

export function isSandboxInited() {
  return _inited;
}

// ====== 重置状态 ======
export function resetSandbox() {
  _inited = false;
  _currentSourceId = null;
  _initResolve = null;
  _fetchCallbacks = {};
  _requestCallbacks = {};
}

// ====== 处理来自 WebView 的消息 ======
export function handleWebViewMessage(event) {
  let data;
  try {
    data = JSON.parse(event.nativeEvent.data);
  } catch(e) {
    return;
  }

  switch (data.type) {
    case 'ready':
      _ready = true;
      break;

    case 'inited':
      _inited = true;
      if (_initResolve) {
        _initResolve(true);
        _initResolve = null;
      }
      break;

    case 'exec_done':
      if (!_inited && _initResolve) {
        setTimeout(() => {
          if (_initResolve) {
            _initResolve(_inited);
            _initResolve = null;
          }
        }, 2000);
      }
      break;

    case 'exec_error':
      if (_initResolve) {
        _initResolve(false);
        _initResolve = null;
      }
      break;

    case 'fetch':
      _handleFetchRequest(data);
      break;

    case 'request_result':
      const cb = _requestCallbacks[data.reqId];
      if (cb) {
        cb(data.result);
        delete _requestCallbacks[data.reqId];
      }
      break;

    case 'cryptojs_missing':
      _injectCryptoJS();
      break;

    case 'log':
      break;
  }
}

// ====== 处理 WebView 发来的 fetch 请求 ======
async function _handleFetchRequest(data) {
  const { reqId, url, method, headers, body } = data;
  try {
    const opts = {
      method: method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers,
      },
    };
    if (body) opts.body = body;
    const res = await fetch(url, opts);
    const text = await res.text();
    const status = res.status;
    const resHeaders = {};
    res.headers.forEach((v, k) => { resHeaders[k] = v; });

    const escapedBody = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');
    const headersJson = JSON.stringify(resHeaders);
    const script = `window._lxFetchResult('${reqId}', null, '${escapedBody}', ${status}, ${headersJson});`;
    _webViewRef?.injectJavaScript(script);
  } catch (err) {
    const errMsg = (err.message || String(err)).replace(/'/g, "\\'");
    const script = `window._lxFetchResult('${reqId}', '${errMsg}', null, 500, {});`;
    _webViewRef?.injectJavaScript(script);
  }
}

// ====== 初始化音源脚本 ======
export async function initLxSource(sourceId) {
  const _t0 = Date.now();
  const _log = (label) => console.log(`[DBG] +${Date.now() - _t0}ms [initLx] ${label}`);
  if (_currentSourceId === sourceId && _inited) {
    _log('already inited, skip');
    return true;
  }
  if (!_webViewRef || !_ready) {
    _log(`skip: webViewRef=${!!_webViewRef} ready=${_ready}`);
    return false;
  }
  _log(`start: sourceId=${sourceId}`);

  _inited = false;
  _currentSourceId = sourceId;

  _log('loading registry');
  const entries = await loadRegistry();
  const entry = entries.find(e => e.id === sourceId);
  if (!entry) { _log('source not found'); throw new Error('音源不存在: ' + sourceId); }

  _log('reading source code');
  const rawCode = await readSourceCode(sourceId);
  if (!rawCode) { _log('source code not found'); throw new Error('音源代码未找到: ' + sourceId); }
  _log(`source code loaded: ${rawCode.length} chars`);

  const jsCode = patchAntiDebug(rawCode);
  const codeBody = jsCode.replace(/^\/\*[\s\S]*?\*\//, '').trim();
  _log(`code patched: ${codeBody.length} chars, injecting into WebView`);

  return new Promise((resolve) => {
    _initResolve = resolve;

    const escapedCode = codeBody
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r?\n/g, '\\n');

    const script = `window._lxExec('${escapedCode}');`;
    _webViewRef?.injectJavaScript(script);

    setTimeout(() => {
      if (_initResolve) {
        _initResolve(_inited);
        _initResolve = null;
      }
    }, 15000);
  });
}

// ====== 请求音乐 URL ======
export async function getLxMusicUrlWebView(sourceId, songId, quality = '128k', platform = 'netease') {
  const _t0 = Date.now();
  const _log = (label) => console.log(`[DBG] +${Date.now() - _t0}ms [webview] ${label}`);
  _log(`start: sourceId=${sourceId} songId=${songId} quality=${quality} platform=${platform}`);
  // 确保初始化
  if (_currentSourceId !== sourceId || !_inited) {
    _log('initLxSource needed');
    const ok = await initLxSource(sourceId);
    _log(`initLxSource result: ${ok}`);
    if (!ok) return null;
  }

  // LX 音源协议 source 标识符映射
  const lxSourceMap = {
    netease: 'wy',
    tencent: 'tx',
    kuwo: 'kw',
    kugou: 'kg',
    migu: 'mg',
  };
  const lxSource = lxSourceMap[platform] || 'wy';

  const musicInfo = {
    id: `${lxSource}_${songId}`,
    source: lxSource,
    meta: { songId: String(songId), albumId: '', albumName: '' },
    songmid: String(songId),
    hash: String(songId),
    name: '',
    singer: '',
  };

  const qualities = [quality, '128k', '320k'];
  for (const q of qualities) {
    try {
      _log(`_requestViaWebView quality=${q} lxSource=${lxSource}`);
      const url = await _requestViaWebView('musicUrl', musicInfo, lxSource, q);
      _log(`_requestViaWebView result: ${url ? (typeof url === 'string' ? url.substring(0, 60) : 'object') : 'null'}`);
      if (url && typeof url === 'string' && url.startsWith('http')) {
        return url;
      }
      if (url && typeof url === 'object' && url.url) {
        return url.url;
      }
    } catch (e) {
      _log(`quality=${q} error: ${e.message}`);
    }
  }
  _log('all qualities exhausted, return null');
  return null;
}

// ====== 通过 WebView 调用 handler ======
function _requestViaWebView(action, musicInfo, source, quality = '128k') {
  return new Promise((resolve) => {
    const reqId = `req_${Date.now()}_${_callbackId++}`;
    _requestCallbacks[reqId] = resolve;
    const _reqStart = Date.now();
    console.log(`[DBG] [webview] _requestViaWebView: reqId=${reqId} action=${action} source=${source} quality=${quality}`);

    const infoJson = JSON.stringify({ musicInfo, type: quality });
    const escapedInfo = infoJson.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const script = `window._lxRequest('${reqId}', '${action}', '${source}', '${escapedInfo}');`;
    _webViewRef?.injectJavaScript(script);

    setTimeout(() => {
      if (_requestCallbacks[reqId]) {
        console.log(`[DBG] [webview] _requestViaWebView TIMEOUT: reqId=${reqId} after ${Date.now() - _reqStart}ms`);
        _requestCallbacks[reqId](null);
        delete _requestCallbacks[reqId];
      }
    }, 15000);
  });
}

// ====== 清理 ======
export function clearSandbox() {
  resetSandbox();
  _webViewRef = null;
  _ready = false;
}
