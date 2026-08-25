// LX 音源 WebView 沙箱 — HTML 内容
// 在 WebView 中执行 jsjiami 混淆脚本, 绕过 Hermes 的 new Function 限制
// fetch 请求通过 postMessage 代理到 RN 端 (避免 CORS)

// CryptoJS CDN (内联到 WebView 中)
const CRYPTOJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js';
const CRYPTOJS_CDN_BACKUP = 'https://cdn.bootcdn.net/ajax/libs/crypto-js/4.2.0/crypto-js.min.js';

const SANDBOX_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="${CRYPTOJS_CDN}"></script>
<script src="${CRYPTOJS_CDN_BACKUP}"></script>
<script>
// CryptoJS 加载检测: 如果两个 CDN 都失败, 通知 RN 端注入
window.addEventListener('load', function() {
  if (!window.CryptoJS) {
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'cryptojs_missing'}));
  }
});
</script>
</head><body><script>
(function() {
  var _listeners = {};
  var _inited = false;
  var _fetchCallbacks = {};
  var _fetchCounter = 0;

  // ====== 沙箱环境 ======
  function getCryptoJS() {
    return window.CryptoJS || (typeof require === 'function' ? require('crypto-js') : null);
  }

  var sandbox = {
    console: {
      log: function() {},
      warn: function() {},
      error: function() {
        try {
          var args = Array.prototype.slice.call(arguments).map(function(a) {
            return typeof a === 'object' ? JSON.stringify(a) : String(a);
          });
          window.ReactNativeWebView.postMessage(JSON.stringify({type:'log', level:'error', args: args.join(' ')}));
        } catch(e) {}
      },
      info: function() {}, debug: function() {}, group: function() {}, groupEnd: function() {},
      time: function() {}, timeEnd: function() {}, dir: function() {},
    },
    setTimeout: function(fn, ms) { return setTimeout(fn, Math.min(ms || 0, 5000)); },
    clearTimeout: clearTimeout,
    setInterval: function(fn, ms) { return setInterval(fn, ms); },
    clearInterval: clearInterval,
    JSON: JSON, Math: Math,
    parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    Object: Object, Array: Array, String: String, Number: Number,
    Boolean: Boolean, RegExp: RegExp, Error: Error, Promise: Promise,
    Map: Map, Set: Set, Symbol: Symbol,
    atob: atob, btoa: btoa,
    Date: Date,
  };

  // crypto
  sandbox.crypto = {
    MD5: function(s) { var C = getCryptoJS(); return C ? C.MD5(s).toString() : s; },
    SHA256: function(s) { var C = getCryptoJS(); return C ? C.SHA256(s).toString() : s; },
    createHash: function(alg) {
      return {
        update: function(data) {
          return {
            digest: function(enc) {
              var C = getCryptoJS(); if (!C) return '';
              if (alg === 'md5') return C.MD5(data).toString();
              if (alg === 'sha256') return C.SHA256(data).toString();
              return '';
            }
          };
        }
      };
    },
    createCipheriv: function(mode, key, iv) {
      var C = getCryptoJS();
      var keyStr = typeof key === 'string' ? key : (C ? C.enc.Utf8.parse(key) : key);
      var ivStr = iv ? (typeof iv === 'string' ? iv : (C ? C.enc.Utf8.parse(iv) : iv)) : null;
      return {
        update: function(data) {
          return {
            final: function() {
              if (!C) return '';
              try {
                var wordArray = typeof data === 'string' ? C.enc.Utf8.parse(data) : data;
                if (mode.includes('cbc')) {
                  var enc = C.AES.encrypt(wordArray, keyStr, { iv: ivStr, mode: C.mode.CBC });
                  return C.enc.Base64.parse(enc.toString());
                }
                return C.AES.encrypt(wordArray, keyStr, { mode: C.mode.ECB }).ciphertext;
              } catch(e) { return ''; }
            }
          };
        }
      };
    },
    publicEncrypt: function() { return ''; },
    constants: { RSA_PKCS1_PADDING: 1 },
    randomBytes: function(size) {
      var arr = [];
      for (var i = 0; i < size; i++) arr.push(Math.floor(Math.random() * 256));
      return arr;
    },
  };

  sandbox.Buffer = {
    from: function(data, enc) {
      if (typeof data === 'string') {
        if (enc === 'base64') { try { return atob(data); } catch(e) { return data; } }
        return data;
      }
      return data;
    },
    isBuffer: function(b) { return typeof b === 'object' && b !== null; },
    concat: function(list) { return list.join(''); },
    alloc: function(size) { return new Array(size).fill(0); },
  };

  sandbox.require = function(mod) {
    if (mod === 'crypto') return sandbox.crypto;
    if (mod === 'crypto-js') return getCryptoJS() || sandbox.crypto;
    if (mod === 'events') {
      var EE = function() {};
      EE.prototype.on = function() { return this; };
      EE.prototype.emit = function() { return this; };
      EE.prototype.once = function() { return this; };
      EE.prototype.off = function() { return this; };
      EE.prototype.removeListener = function() { return this; };
      EE.prototype.addListener = function() { return this; };
      EE.EventEmitter = EE; EE.Event = EE;
      return EE;
    }
    if (mod === 'zlib') return { deflate: function() { return ''; }, inflate: function() { return ''; } };
    return {};
  };

  // lx API
  sandbox.lx = {
    EVENT_NAMES: { inited: 'inited', request: 'request', updateAlert: 'updateAlert', error: 'error' },
    send: function(event, data) {
      if (event === 'inited') {
        _inited = true;
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'inited'}));
      }
    },
    on: function(event, callback) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(callback);
    },
    request: function(url, options, callback) {
      var reqId = 'fetch_' + (++_fetchCounter);
      _fetchCallbacks[reqId] = callback;
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'log', args: '[LX WV lx.request] ' + (options && options.method || 'GET') + ' ' + url}));
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'fetch',
        reqId: reqId,
        url: url,
        method: (options && options.method) || 'GET',
        headers: (options && options.headers) || {},
        body: (options && options.body) || null,
      }));
    },
    env: 'mobile',
    version: '2.10.0',
    currentScriptInfo: '{}',
    utils: {
      buffer: {
        from: function(d, enc) { return sandbox.Buffer.from(d, enc); },
        concat: function(list) { return sandbox.Buffer.concat(list); },
        isBuffer: function(b) { return sandbox.Buffer.isBuffer(b); },
        bufToString: function(b, enc) { return typeof b === 'string' ? b : String(b); },
      },
      crypto: sandbox.crypto,
      zlib: { deflate: function() { return ''; }, inflate: function() { return ''; } },
      MD5: sandbox.crypto.MD5,
      sha256: sandbox.crypto.SHA256,
      base64: {
        encode: function(s) { try { return btoa(s); } catch(e) { return ''; } },
        decode: function(s) { try { return atob(s); } catch(e) { return ''; } },
      },
      encryptStr: {
        aes: function(str, key, iv) {
          var C = getCryptoJS(); if (!C) return str;
          try {
            var keyWA = typeof key === 'string' ? C.enc.Utf8.parse(key) : key;
            var ivWA = iv ? (typeof iv === 'string' ? C.enc.Utf8.parse(iv) : iv) : null;
            return C.AES.encrypt(str, keyWA, { iv: ivWA, mode: C.mode.CBC }).toString();
          } catch(e) { return ''; }
        },
        rsa: function() { return ''; },
      },
    },
  };

  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.Event = function() {};

  // ====== 执行音源脚本 ======
  window._lxExec = function(code) {
    try {
      var keys = Object.keys(sandbox);
      var values = keys.map(function(k) { return sandbox[k]; });
      var fn = new Function(keys, code);
      fn.apply(null, values);
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'exec_done', inited: _inited, handlerCount: (_listeners['request']||[]).length}));
    } catch(e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'exec_error', error: e.message, stack: e.stack ? String(e.stack).slice(0, 500) : ''}));
    }
  };

  // ====== 调用 handler ======
  window._lxRequest = function(reqId, action, source, infoJson) {
    var handlers = _listeners['request'] || [];
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'log', args: '[LX WV handler] called, handlers=' + handlers.length + ' action=' + action + ' source=' + source}));
    if (handlers.length === 0) {
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'request_result', reqId: reqId, result: null}));
      return;
    }
    var info;
    try { info = JSON.parse(infoJson); } catch(e) { info = {}; }
    var handler = handlers[0];
    try {
      var handlerResult = handler({source: source, action: action, info: info, requestId: reqId});
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'log', args: '[LX WV handler] returned type=' + typeof handlerResult + ' isPromise=' + (handlerResult && typeof handlerResult.then === 'function')}));
      Promise.resolve(handlerResult)
        .then(function(result) {
          window.ReactNativeWebView.postMessage(JSON.stringify({type:'log', args: '[LX WV handler] resolved: ' + (result === null ? 'null' : typeof result === 'string' ? result.slice(0,100) : JSON.stringify(result).slice(0,100))}));
          var resultStr;
          try { resultStr = JSON.stringify(result); } catch(e) { resultStr = 'null'; }
          window.ReactNativeWebView.postMessage(JSON.stringify({type:'request_result', reqId: reqId, result: resultStr ? JSON.parse(resultStr) : null}));
        })
        .catch(function(err) {
          var errDetail = err ? (err.message || err.toString() || JSON.stringify(err)) : 'undefined';
          var errStack = err && err.stack ? String(err.stack).slice(0,300) : 'no stack';
          window.ReactNativeWebView.postMessage(JSON.stringify({type:'log', args: '[LX WV handler] error: ' + errDetail + ' | stack: ' + errStack}));
          window.ReactNativeWebView.postMessage(JSON.stringify({type:'request_result', reqId: reqId, result: null, error: errDetail}));
        });
    } catch(e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'log', args: '[LX WV handler] throw: ' + e.message}));
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'request_result', reqId: reqId, result: null, error: e.message}));
    }
  };

  // ====== fetch 结果回调 ======
  window._lxFetchResult = function(reqId, error, body, status, headers) {
    var cb = _fetchCallbacks[reqId];
    if (cb) {
      delete _fetchCallbacks[reqId];
      try {
        var parsedBody = body;
        try { parsedBody = JSON.parse(body); } catch(e) {}
        cb(error, { body: parsedBody, status: status, statusCode: status, headers: headers || {} });
      } catch(e) {
        cb(e.message, { body: null, status: 500, statusCode: 500, headers: {} });
      }
    }
  };

  // 标记沙箱就绪
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'ready'}));
})();
</script></body></html>`;

export { SANDBOX_HTML };
