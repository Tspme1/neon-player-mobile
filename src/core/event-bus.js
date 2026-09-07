// 事件总线 — 核心模块间唯一通信机制
// 所有 core 模块通过 event-bus 通信，不直接互相调用（播放控制除外）

// === 事件名常量 ===
export const EVENTS = {
  // 播放状态变化
  PLAYBACK_STATE_CHANGE: 'playback:state-change',
  PLAYBACK_TRACK_CHANGE: 'playback:track-change',
  PLAYBACK_QUEUE_CHANGE: 'playback:queue-change',
  // 播放控制（来自 media-session 通知栏按钮）
  PLAYBACK_CONTROL: 'playback:control',
  // 歌词
  LYRICS_LOADED: 'lyrics:loaded',
  LYRICS_HIGHLIGHT: 'lyrics:highlight',
  // 封面（切歌后异步补拉到封面时触发，UI/通知栏据此刷新）
  COVER_UPDATE: 'cover:update',
  // 收藏
  FAVORITE_TOGGLE: 'favorite:toggle',
  FAVORITE_STATE_CHANGE: 'favorite:state-change',
  // 缓存
  CACHE_UPDATED: 'cache:updated',
  // 音源
  SOURCE_CHANGED: 'source:changed',
  SOURCE_IMPORTED: 'source:imported',
  SOURCE_DELETED: 'source:deleted',
};

// === 事件总线实现 ===
const listeners = new Map();

/**
 * 注册事件监听器
 * @param {string} event 事件名
 * @param {function} callback 回调函数
 * @returns {function} 取消监听的函数
 */
export function on(event, callback) {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  listeners.get(event).add(callback);

  // 返回取消函数
  return () => off(event, callback);
}

/**
 * 注册一次性事件监听器（触发后自动移除）
 * @param {string} event 事件名
 * @param {function} callback 回调函数
 * @returns {function} 取消监听的函数
 */
export function once(event, callback) {
  const wrapper = (...args) => {
    off(event, wrapper);
    callback(...args);
  };
  return on(event, wrapper);
}

/**
 * 移除事件监听器
 * @param {string} event 事件名
 * @param {function} callback 回调函数
 */
export function off(event, callback) {
  const set = listeners.get(event);
  if (set) {
    set.delete(callback);
    if (set.size === 0) {
      listeners.delete(event);
    }
  }
}

/**
 * 触发事件
 * @param {string} event 事件名
 * @param {...any} args 传递给监听器的参数
 */
export function emit(event, ...args) {
  const set = listeners.get(event);
  if (!set || set.size === 0) return;

  // 复制一份，防止在回调中修改 set 导致迭代异常
  const callbacks = Array.from(set);
  for (const cb of callbacks) {
    try {
      cb(...args);
    } catch (e) {
      console.error(`[EventBus] Error in listener for "${event}":`, e.message);
    }
  }
}

/**
 * 清除指定事件的所有监听器（或清除全部）
 * @param {string} [event] 事件名，不传则清除所有
 */
export function clear(event) {
  if (event) {
    listeners.delete(event);
  } else {
    listeners.clear();
  }
}

export default { on, once, off, emit, clear, EVENTS };
