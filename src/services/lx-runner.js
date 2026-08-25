// LX 音源运行器 — 移动端版，用 Function 构造器替代子进程
// v4: 修复 jsjiami.com.v7 反调试死循环问题
import { loadRegistry, readSourceCode } from '../core/source-manager';
import CryptoJS from 'crypto-js';
import { patchAntiDebug } from './anti-debug-patch';
import { NativeModules } from 'react-native';

// ===== 沙箱实例缓存 =====
const runnerCache = new Map();
const RUNNER_TTL = 5 * 60 * 1000;

const REQUEST_TIMEOUT = 10000;
const TOTAL_TIMEOUT = 25000;
const INIT_TIMEOUT = 1500;
// 沙箱同步执行时间上限 (防止 while(true) 死循环冻结主线程)
const SANDBOX_EXEC_LIMIT = 5000; // 5秒

// ===== 沙箱执行时间守卫 =====
// 原理: jsjiami.com.v7 反调试使用 while(!![]){} 死循环
// 在 Hermes 引擎中某个环境检测条件为 true 时触发
// 方案: 劫持 Date.now() 和性能计数器, 当同步执行时间超过限制时抛出异常
function createTimeGuard() {
  const startTime = Date.now();
  let checkCount = 0;
  let disabled = false;

  return {
    // 替换 Date.now / Date.prototype.getTime
    guardedNow() {
      if (disabled) return Date.now();
      checkCount++;
      // 每 1000 次调用检查一次 (避免频繁检查影响性能)
      if (checkCount % 1000 === 0) {
        if (Date.now() - startTime > SANDBOX_EXEC_LIMIT) {
          throw new Error('[LX] Sandbox execution time limit exceeded (anti-debug trap detected)');
        }
      }
      return Date.now();
    },
    // 检查是否超时 (在循环关键点调用)
    check() {
      if (disabled) return;
      if (Date.now() - startTime > SANDBOX_EXEC_LIMIT) {
        throw new Error('[LX] Sandbox execution time limit exceeded');
      }
    },
    // 禁用守卫 (初始化完成后调用)
    disable() { disabled = true; },
    elapsed() { return Date.now() - startTime; },
  };
}

// 沙箱模板
function createSandbox(scriptInfo, jsCode) {
  let callbackId = 0;
  const listeners = {};
  const timeGuard = createTimeGuard();

  // 劫持 Date — 让混淆代码的 Date.now() 调用经过守卫
  const OriginalDate = Date;
  function GuardedDate(...args) {
    if (args.length === 0) {
      // new Date() — 返回当前时间
      return new OriginalDate(timeGuard.guardedNow());
    }
    return new OriginalDate(...args);
  }
  GuardedDate.now = () => timeGuard.guardedNow();
  GuardedDate.prototype = OriginalDate.prototype;
  GuardedDate.parse = OriginalDate.parse;
  GuardedDate.UTC = OriginalDate.UTC;

  const sandbox = {
    console: {
      log: () => {},
      warn: () => {},
      error: (...a) => console.error('[LX]', ...a),
      info: () => {},
      debug: () => {},
      group: () => {},
      groupEnd: () => {},
      time: () => {},
      timeEnd: () => {},
      dir: () => {},
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    JSON,
    Date: GuardedDate,  // 注入劫持的 Date
    Math,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Promise,
    Map,
    Set,
  };

  // crypto-js
  sandbox.crypto = {
    MD5: (s) => CryptoJS.MD5(s).toString(),
    SHA256: (s) => CryptoJS.SHA256(s).toString(),
    createHash: (alg) => ({
      update: (data) => ({
        digest: (enc) => {
          if (alg === 'md5') return CryptoJS.MD5(data).toString();
          if (alg === 'sha256') return CryptoJS.SHA256(data).toString();
          return '';
        }
      })
    }),
    createCipheriv: (mode, key, iv) => {
      const keyStr = typeof key === 'string' ? key : CryptoJS.enc.Utf8.parse(key);
      const ivStr = iv ? (typeof iv === 'string' ? iv : CryptoJS.enc.Utf8.parse(iv)) : null;
      return {
        update: (data) => ({
          final: () => {
            try {
              const wordArray = typeof data === 'string' ? CryptoJS.enc.Utf8.parse(data) : data;
              if (mode.includes('cbc')) {
                const encrypted = CryptoJS.AES.encrypt(wordArray, keyStr, { iv: ivStr, mode: CryptoJS.mode.CBC });
                return CryptoJS.enc.Base64.parse(encrypted.toString());
              }
              return CryptoJS.AES.encrypt(wordArray, keyStr, { mode: CryptoJS.mode.ECB }).ciphertext;
            } catch { return ''; }
          }
        })
      };
    },
    publicEncrypt: () => '',
    constants: { RSA_PKCS1_PADDING: 1 },
    randomBytes: (size) => {
      const words = [];
      for (let i = 0; i < size; i++) words.push(Math.floor(Math.random() * 256));
      return words;
    },
  };
  sandbox.Buffer = {
    from: (data, enc) => {
      if (typeof data === 'string') {
        if (enc === 'base64') {
          try { return CryptoJS.enc.Base64.parse(data).toString(CryptoJS.enc.Utf8); } catch { return data; }
        }
        return data;
      }
      return data;
    },
    isBuffer: (b) => typeof b === 'object' && b !== null,
    concat: (list) => list.join(''),
    alloc: (size) => new Array(size).fill(0),
  };
  sandbox.require = (mod) => {
    if (mod === 'crypto') return sandbox.crypto;
    if (mod === 'crypto-js') return CryptoJS;
    if (mod === 'events') {
      const EE = function() {};
      EE.prototype.on = function() { return this; };
      EE.prototype.emit = function() { return this; };
      EE.prototype.once = function() { return this; };
      EE.prototype.off = function() { return this; };
      EE.prototype.removeListener = function() { return this; };
      EE.prototype.addListener = function() { return this; };
      EE.EventEmitter = EE;
      EE.Event = EE;
      return EE;
    }
    if (mod === 'zlib') return { deflate: () => '', inflate: () => '' };
    return {};
  };

  // lx API
  sandbox.lx = {
    EVENT_NAMES: { inited: 'inited', request: 'request', updateAlert: 'updateAlert', error: 'error' },
    send(event, data) {
      if (event === 'inited') {
        sandbox._inited = true;
        timeGuard.disable();  // 初始化完成, 禁用时间守卫
      }
    },
    on(event, callback) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(callback);
    },
    request(url, options, callback) {
      let opts = {
        method: (options && options.method) || 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ...(options && options.headers || {}) },
      };
      if (options && options.body) {
        opts.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      }
      // 优先使用原生 OkHttp（后台 JS fetch 可能被挂起）
      const useNative = opts.method === 'GET' && !opts.body && NativeModules.MediaModule && NativeModules.MediaModule.nativeHttpGet;
      if (useNative) {
        NativeModules.MediaModule.nativeHttpGet(url, JSON.stringify(opts.headers))
          .then(text => {
            const headers = {};
            let body;
            try { body = JSON.parse(text); } catch { body = text; }
            callback(null, { body, status: 200, statusCode: 200, headers });
          })
          .catch(err => {
            // 回退到 JS fetch
            fetch(url, opts).then(async (res) => {
              const text = await res.text();
              const headers = {};
              res.headers.forEach((v, k) => headers[k] = v);
              let body;
              try { body = JSON.parse(text); } catch { body = text; }
              callback(null, { body, status: res.status, statusCode: res.status, headers });
            }).catch(err2 => {
              callback(err2.message || String(err2), { body: null, status: 500, statusCode: 500, headers: {} });
            });
          });
      } else {
        fetch(url, opts).then(async (res) => {
          const text = await res.text();
          const headers = {};
          res.headers.forEach((v, k) => headers[k] = v);
          let body;
          try { body = JSON.parse(text); } catch { body = text; }
          callback(null, { body, status: res.status, statusCode: res.status, headers });
        }).catch(err => {
          callback(err.message || String(err), { body: null, status: 500, statusCode: 500, headers: {} });
        });
      }
    },
    env: 'mobile',
    version: '2.10.0',
    currentScriptInfo: scriptInfo,
    utils: {
      buffer: {
        from: (d, enc) => sandbox.Buffer.from(d, enc),
        concat: (list) => sandbox.Buffer.concat(list),
        isBuffer: (b) => sandbox.Buffer.isBuffer(b),
        bufToString: (b, enc) => typeof b === 'string' ? b : String(b),
      },
      crypto: sandbox.crypto,
      zlib: { deflate: () => '', inflate: () => '' },
      MD5: sandbox.crypto.MD5,
      sha256: sandbox.crypto.SHA256,
      base64: {
        encode: (s) => { try { return CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(s)); } catch { return ''; } },
        decode: (s) => { try { return CryptoJS.enc.Base64.parse(s).toString(CryptoJS.enc.Utf8); } catch { return ''; } },
      },
      encryptStr: {
        aes: (str, key, iv) => {
          try {
            const keyWA = typeof key === 'string' ? CryptoJS.enc.Utf8.parse(key) : key;
            const ivWA = iv ? (typeof iv === 'string' ? CryptoJS.enc.Utf8.parse(iv) : iv) : null;
            return CryptoJS.AES.encrypt(str, keyWA, { iv: ivWA, mode: CryptoJS.mode.CBC }).toString();
          } catch { return ''; }
        },
        rsa: () => '',
      },
    },
  };

  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.Event = function() {};

  // 执行脚本 — 时间守卫保护
  try {
    const keys = Object.keys(sandbox);
    const values = keys.map(k => sandbox[k]);
    console.log('[LX] Creating Function, jsCode length:', jsCode.length);
    const fn = new Function(...keys, jsCode);
    console.log('[LX] Function created, executing (with time guard)...');
    fn(...values);
    timeGuard.disable();  // 正常完成, 禁用守卫
    console.log('[LX] Script executed OK, inited:', sandbox._inited, 'handlers:', (listeners['request'] || []).length, `(${timeGuard.elapsed()}ms)`);
  } catch (e) {
    const isTimeTrap = e.message && e.message.includes('time limit exceeded');
    console.error('[LX] Script execution error:', e.message, `(${timeGuard.elapsed()}ms)`);
    if (isTimeTrap) {
      console.error('[LX] Anti-debug while(true) trap detected and neutralized!');
    }
    // 即使触发时间守卫, 脚本可能已注册了部分 handler, 继续流程
    timeGuard.disable();
  }

  return {
    sandbox,
    listeners,
    async request(action, info) {
      const requestId = `req_${Date.now()}_${callbackId++}`;
      const handlers = listeners['request'] || [];
      console.log(`[LX] request: action=${action} handlers=${handlers.length} requestId=${requestId}`);
      if (handlers.length === 0) return null;

      for (const handler of handlers) {
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`handler timeout (${REQUEST_TIMEOUT}ms)`)), REQUEST_TIMEOUT)
          );
          console.log('[LX] Calling handler...');
          const result = await Promise.race([handler({ source: 'wy', action, info, requestId }), timeoutPromise]);
          console.log('[LX] Handler returned:', typeof result, result ? String(result).slice(0, 100) : 'null');

          if (result == null) return null;
          if (typeof result === 'string') return result;
          if (result.url && typeof result.url === 'string') return result.url;
          return null;
        } catch (e) {
          console.error('[LX] Handler error/timeout:', e.message);
          return null;
        }
      }
      return null;
    },
    isInited() { return sandbox._inited === true; }
  };
}

// 等待沙箱初始化
async function waitForInit(runner) {
  if (runner.isInited()) {
    console.log('[LX] Already inited, skip wait');
    return;
  }

  console.log('[LX] Waiting for init...');
  const start = Date.now();
  while (Date.now() - start < INIT_TIMEOUT) {
    if (runner.isInited()) {
      console.log(`[LX] Init detected after ${Date.now() - start}ms`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.log(`[LX] Init timeout after ${INIT_TIMEOUT}ms, proceeding anyway`);
}

// 获取或创建缓存的 runner
async function getOrCreateRunner(sourceId) {
  const cached = runnerCache.get(sourceId);
  if (cached && (Date.now() - cached.timestamp) < RUNNER_TTL) {
    console.log(`[LX] Reusing cached runner for ${sourceId}`);
    return cached.runner;
  }

  console.log(`[LX] Creating new runner for ${sourceId}`);
  const entries = await loadRegistry();
  console.log(`[LX] Registry loaded, ${entries.length} entries`);
  const entry = entries.find(e => e.id === sourceId);
  if (!entry) throw new Error('音源不存在: ' + sourceId);
  console.log(`[LX] Found entry: ${entry.name}`);

  const rawCode = await readSourceCode(sourceId);
  if (!rawCode) throw new Error('音源代码未找到: ' + sourceId);
  console.log(`[LX] Source code loaded, ${rawCode.length} bytes`);

  // 预处理: 移除 jsjiami.com.v7 反调试死循环
  const jsCode = patchAntiDebug(rawCode);
  if (jsCode !== rawCode) {
    console.log(`[LX] Anti-debug patch applied, code size: ${rawCode.length} -> ${jsCode.length}`);
  }

  const scriptInfo = JSON.stringify({
    name: entry.name, description: entry.description || '',
    version: entry.version || '1.0.0', author: entry.author || '',
    homepage: entry.homepage || '', rawScript: ''
  });

  console.log('[LX] Creating sandbox...');
  let runner;
  try {
    runner = createSandbox(scriptInfo, jsCode);
    console.log('[LX] Sandbox created, waiting for init...');
    await waitForInit(runner);
  } catch (e) {
    console.error('[LX] createSandbox threw:', e.message);
    runner = {
      sandbox: {}, listeners: {},
      async request() { return null; },
      isInited() { return true; }
    };
  }

  runnerCache.set(sourceId, { runner, timestamp: Date.now() });
  console.log(`[LX] Runner cached for ${sourceId}`);
  return runner;
}

export async function getLxMusicUrl(sourceId, songId, quality = '128k') {
  const t0 = Date.now();
  const log = (msg) => console.log(`[LX][getLxMusicUrl][${sourceId}] songId=${songId} q=${quality} +${Date.now() - t0}ms | ${msg}`);
  log('开始');

  const totalTimeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('音源响应超时（25s）')), TOTAL_TIMEOUT)
  );

  const mainWork = (async () => {
    log('获取/创建 runner...');
    const runner = await getOrCreateRunner(sourceId);
    log('runner ready');

    const musicInfo = {
      id: `wy_${songId}`, source: 'wy',
      meta: { songId: String(songId), albumId: '', albumName: '' },
      songmid: String(songId), hash: String(songId),
      name: '', singer: ''
    };

    const qualities = [quality, '128k', '320k'];
    for (const q of qualities) {
      if (Date.now() - t0 > TOTAL_TIMEOUT - 2000) {
        log('接近总超时, 停止重试');
        break;
      }
      log(`尝试音质: ${q}`);
      try {
        const url = await runner.request('musicUrl', { musicInfo, type: q });
        if (url && typeof url === 'string' && url.startsWith('http')) {
          log(`成功获取 URL: ${url.slice(0, 80)}...`);
          return url;
        }
        log(`音质 ${q} 未返回有效 URL: ${url}`);
      } catch (e) {
        log(`音质 ${q} 失败: ${e.message}`);
      }
    }
    log('所有音质尝试完毕, 未获取到有效 URL');
    return null;
  })();

  try {
    return await Promise.race([mainWork, totalTimeoutPromise]);
  } catch (e) {
    log(`失败: ${e.message}`);
    return null;
  }
}

export function clearRunnerCache(sourceId) {
  if (sourceId) {
    runnerCache.delete(sourceId);
  } else {
    runnerCache.clear();
  }
}
