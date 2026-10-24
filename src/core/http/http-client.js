// 统一 HTTP 客户端与编解码工具
// 优先使用原生 MediaModule (OkHttp 共享连接池)，彻底摆脱隐藏 WebViewFetcher 的内存开销与后台冻结限制
import { NativeModules } from 'react-native';
import crypto from 'crypto-js';

/**
 * Promise 超时控制包装器
 */
export function withTimeout(promise, ms, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
    ),
  ]);
}

/**
 * 安全编码 URL（避免对已编码 URL 二次编码）
 */
export function safeEncodeUrl(url) {
  try {
    const decoded = decodeURIComponent(url);
    if (decoded !== url) return url;
    return encodeURI(url);
  } catch {
    return encodeURI(url);
  }
}

/**
 * 获取 JSON — 优先原生 OkHttp（后台 JS 被节流时仍可满速工作），回退 JS fetch
 */
export async function fetchJSON(url, options = {}) {
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://music.163.com',
  };
  const headers = { ...defaultHeaders, ...(options.headers || {}) };

  // 1. 优先使用原生 OkHttp
  try {
    if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
      const text = await NativeModules.MediaModule.nativeHttpGet(url, JSON.stringify(headers));
      return JSON.parse(text);
    }
  } catch {
    // native OkHttp failed, fall through to JS fetch
  }

  // 2. 回退到 JS fetch
  const res = await fetch(url, { ...options, headers });
  return res.json();
}

/**
 * 获取文本 — 优先原生 MediaModule.nativeHttpGet，回退 RN fetch / UpdaterModule / XHR
 */
export async function fetchText(url, options = {}) {
  const encodedUrl = safeEncodeUrl(url);
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
  const headers = { ...defaultHeaders, ...(options.headers || {}) };

  // 方案 1: 原生 MediaModule OkHttp（最快、零 WebView 内存占用、支持自定义请求头）
  try {
    if (NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet) {
      const text = await withTimeout(
        NativeModules.MediaModule.nativeHttpGet(encodedUrl, JSON.stringify(headers)),
        12000,
        'nativeHttpGet'
      );
      if (text && text.length > 0) return text;
    }
  } catch {
    // fall through
  }

  // 方案 2: 原生 UpdaterModule.fetchText（备用 OkHttp 客户端）
  try {
    if (NativeModules.UpdaterModule && NativeModules.UpdaterModule.fetchText) {
      const text = await withTimeout(
        NativeModules.UpdaterModule.fetchText(encodedUrl),
        15000,
        'UpdaterModule.fetchText'
      );
      if (text && text.length > 0) return text;
    }
  } catch {
    // fall through
  }

  // 方案 3: RN global.fetch + AbortController
  try {
    const controller = new global.AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await global.fetch(encodedUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    if (text && text.length > 0) return text;
  } catch {
    // fall through
  }

  // 方案 4: XMLHttpRequest 最后兜底
  return fetchTextViaXHR(encodedUrl, { ...options, headers }, 25000);
}

function fetchTextViaXHR(url, options, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'text';
    xhr.timeout = timeoutMs;

    const headers = options.headers || {};
    for (const key in headers) {
      try { xhr.setRequestHeader(key, headers[key]); } catch {}
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
      } else {
        reject(new Error('HTTP ' + xhr.status + ': ' + xhr.statusText));
      }
    };
    xhr.onerror = () => reject(new Error('网络请求失败（XHR onerror）'));
    xhr.ontimeout = () => reject(new Error('请求超时（' + timeoutMs + 'ms）'));
    xhr.send();
  });
}

/**
 * HTML 实体反转义工具 (参考 lx-music decodeName)
 */
export function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#32;/g, ' ')
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&#38;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&#40;/g, '(')
    .replace(/&#41;/g, ')')
    .replace(/&#58;/g, ':')
    .replace(/&#60;/g, '<')
    .replace(/&#62;/g, '>')
    .replace(/&#133;/g, '...');
}

/**
 * Base64 UTF-8 解码工具（多级容错）
 */
export function decodeBase64(str) {
  if (!str) return '';
  const clean = String(str).replace(/[\r\n\s]/g, '');
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(clean, 'base64').toString('utf8');
    }
  } catch {}
  try {
    if (typeof atob === 'function' && typeof TextDecoder !== 'undefined') {
      const binary = atob(clean);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
  } catch {}
  try {
    if (crypto && crypto.enc && crypto.enc.Base64) {
      const words = crypto.enc.Base64.parse(clean);
      const utf8 = words.toString(crypto.enc.Utf8);
      if (utf8) return utf8;
    }
  } catch {}
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const cClean = clean.replace(/=+$/, '');
    let bytes = [];
    for (let i = 0; i < cClean.length; i += 4) {
      const a = chars.indexOf(cClean[i]);
      const b = chars.indexOf(cClean[i + 1]);
      const c = cClean[i + 2] ? chars.indexOf(cClean[i + 2]) : 0;
      const d = cClean[i + 3] ? chars.indexOf(cClean[i + 3]) : 0;
      const n = (a << 18) | (b << 12) | (c << 6) | d;
      bytes.push((n >> 16) & 0xff);
      if (cClean[i + 2]) bytes.push((n >> 8) & 0xff);
      if (cClean[i + 3]) bytes.push(n & 0xff);
    }
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      const c = bytes[i++];
      if (c < 128) out += String.fromCharCode(c);
      else if (c > 191 && c < 224) out += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
      else if (c > 223 && c < 240) out += String.fromCharCode(((c & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
      else if (c > 239 && c < 248) {
        const cp = ((c & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
        out += String.fromCodePoint ? String.fromCodePoint(cp) : '';
      }
    }
    return out;
  } catch {}
  return '';
}

export default {
  withTimeout,
  safeEncodeUrl,
  fetchJSON,
  fetchText,
  decodeHtmlEntities,
  decodeBase64,
};
