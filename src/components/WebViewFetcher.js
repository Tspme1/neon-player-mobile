/**
 * WebView Fetcher — 用隐藏 WebView 的 fetch API 获取文本
 * 绕过 RN OkHttp 网络栈，走 Chromium 网络栈（和浏览器一样快）
 *
 * 通信方式：
 * - RN → WebView：webViewRef.injectJavaScript() 直接执行 JS
 * - WebView → RN：window.ReactNativeWebView.postMessage() → onMessage 回调
 */
import { useRef } from 'react';
import { WebView } from 'react-native-webview';
import { View } from 'react-native';

let _webViewRef = null;
let _ready = false;
let _resolveMap = new Map(); // id -> {resolve, reject, timeout}
let _counter = 0;

const FETCH_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script>
// 供 injectJavaScript 调用的全局函数
window.__rnFetch = function(id, url, headersJson) {
  try {
    var headers = JSON.parse(headersJson || '{}');
    fetch(url, { method: 'GET', headers: headers })
      .then(function(resp) {
        return resp.text().then(function(text) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'fetchResult', id: id, ok: resp.ok, status: resp.status, text: text
          }));
        });
      })
      .catch(function(err) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'fetchError', id: id, error: err.message
        }));
      });
  } catch (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'fetchError', id: id, error: e.message
    }));
  }
};
// 通知 RN 已就绪
window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
</script>
</body>
</html>`;

export function setWebViewRef(ref) {
  _webViewRef = ref;
}

export function isFetcherReady() {
  return _ready;
}

export function waitForFetcherReady(timeout = 5000) {
  return new Promise((resolve) => {
    if (_ready) { resolve(true); return; }
    const start = Date.now();
    const check = setInterval(() => {
      if (_ready) {
        clearInterval(check);
        resolve(true);
      } else if (Date.now() - start > timeout) {
        clearInterval(check);
        resolve(false);
      }
    }, 200);
  });
}

/**
 * 用 WebView fetch 获取文本
 * @param {string} url
 * @param {object} options - { headers, timeout }
 * @returns {Promise<string>}
 */
export function fetchViaWebView(url, options = {}) {
  return new Promise(async (resolve, reject) => {
    if (!_webViewRef) {
      reject(new Error('WebView not initialized'));
      return;
    }

    const ready = await waitForFetcherReady(5000);
    if (!ready) {
      reject(new Error('WebView not ready (timeout)'));
      return;
    }

    const id = ++_counter;
    const timeout = options.timeout || 15000;

    const timeoutId = setTimeout(() => {
      if (_resolveMap.has(id)) {
        _resolveMap.delete(id);
        reject(new Error('WebView fetch timeout (' + timeout + 'ms)'));
      }
    }, timeout);

    _resolveMap.set(id, {
      resolve: (text) => {
        clearTimeout(timeoutId);
        _resolveMap.delete(id);
        resolve(text);
      },
      reject: (err) => {
        clearTimeout(timeoutId);
        _resolveMap.delete(id);
        reject(err);
      },
    });

    const headers = options.headers || {};
    const headersJson = JSON.stringify(headers).replace(/'/g, "\\'");
    // 转义 URL 中的单引号
    const safeUrl = url.replace(/'/g, "\\'");

    try {
      const jsCode = "window.__rnFetch(" + id + ", '" + safeUrl + "', '" + headersJson + "');";
      _webViewRef.injectJavaScript(jsCode);
    } catch (e) {
      clearTimeout(timeoutId);
      _resolveMap.delete(id);
      reject(new Error('WebView injectJavaScript failed: ' + e.message));
    }
  });
}

/**
 * 处理 WebView 返回的消息
 */
export function handleFetcherMessage(event) {
  try {
    const data = JSON.parse(event.nativeEvent.data);
    if (data.type === 'ready') {
      _ready = true;
      console.log('[WebViewFetcher] ready');
      return;
    }
    if (data.type === 'fetchResult') {
      const target = _resolveMap.get(data.id);
      if (target) {
        if (data.ok && data.text) {
          target.resolve(data.text);
        } else {
          target.reject(new Error('HTTP ' + data.status));
        }
      }
      return;
    }
    if (data.type === 'fetchError') {
      const target = _resolveMap.get(data.id);
      if (target) {
        target.reject(new Error(data.error));
      }
      return;
    }
  } catch (e) {
    console.log('[WebViewFetcher] parse message error:', e.message);
  }
}

/**
 * WebView Fetcher 组件 — 1x1 隐藏 WebView
 */
export function WebViewFetcher() {
  const webViewRef = useRef(null);

  return (
    <View style={{ width: 1, height: 1, position: 'absolute', opacity: 0 }}>
      <WebView
        ref={(ref) => {
          webViewRef.current = ref;
          setWebViewRef(ref);
        }}
        source={{ html: FETCH_HTML }}
        onMessage={handleFetcherMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        originWhitelist={['*']}
        style={{ width: 1, height: 1 }}
      />
    </View>
  );
}
