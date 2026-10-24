/**
 * Phase 3: AndroidX Media3 (ExoPlayer) 原生音频桥接适配器 (Media3Sound)
 *
 * 提供与 expo-av Audio.Sound 100% 兼容的异步方法签名，底层直接驱动原生单例 NativeExoPlayer：
 * - 零解码器重建开销：全局复用单一 ExoPlayer 实例与 OkHttpDataSource 连接池
 * - 会话隔离防竞态：每个 Media3Sound 实例绑定唯一 sessionId，旧实例 unload 绝不误停新曲目
 * - 自动容灾回退：若运行环境不存在原生 MediaModule.exoLoad，自动无缝回退至 expo-av
 */

import { NativeModules, DeviceEventEmitter, Platform } from 'react-native';
import { Audio } from 'expo-av';
import logger from '../logger';

const { MediaModule } = NativeModules;

let _globalExoSessionId = 100;
let _activeExoSessionId = 0;

export function isMedia3Supported() {
  return Platform.OS === 'android' && !!MediaModule && typeof MediaModule.exoLoad === 'function';
}

export function setMedia3MixWithOthers(allowMix) {
  if (isMedia3Supported() && typeof MediaModule.exoSetMixWithOthers === 'function') {
    MediaModule.exoSetMixWithOthers(!!allowMix).catch(() => {});
  }
}

export class Media3Sound {
  constructor() {
    this._sessionId = ++_globalExoSessionId;
    this._onStatusUpdate = null;
    this._lastStatus = null;
    this._unloaded = false;
    this._volume = 0.8;
    this._isLooping = false;
    this._loadPending = null;
    this._sub = null;
  }

  _ensureListener() {
    if (this._sub) return;
    this._sub = DeviceEventEmitter.addListener('NativeExoStatus', (evt) => {
      if (!evt || evt.sessionId !== this._sessionId || this._unloaded) return;

      // 处理 loadAsync 阶段的状态决议
      if (this._loadPending) {
        if (evt.error) {
          const { reject, timer } = this._loadPending;
          clearTimeout(timer);
          this._loadPending = null;
          reject(new Error(evt.error));
          return;
        }
        // STATE_READY (3) 代表解码器与流头部已就绪
        if (evt.playbackState === 3) {
          const { resolve, timer } = this._loadPending;
          clearTimeout(timer);
          this._loadPending = null;
          resolve(evt);
        }
      }

      const status = {
        isLoaded: !!evt.isLoaded,
        isPlaying: !!evt.isPlaying,
        isBuffering: !!evt.isBuffering,
        positionMillis: evt.positionMillis || 0,
        durationMillis: evt.durationMillis || 0,
        playableDurationMillis: evt.bufferedPositionMillis || 0,
        didJustFinish: !!evt.didJustFinish,
        isLooping: this._isLooping,
        error: evt.error || undefined,
      };
      this._lastStatus = status;

      if (this._onStatusUpdate) {
        try {
          this._onStatusUpdate(status);
        } catch (e) {
          logger.warn('Media3Sound', 'onPlaybackStatusUpdate callback error', e?.message);
        }
      }
    });
  }

  setOnPlaybackStatusUpdate(cb) {
    this._onStatusUpdate = cb;
    if (cb && this._lastStatus && !this._unloaded) {
      const snap = this._lastStatus;
      Promise.resolve().then(() => {
        if (!this._unloaded && this._onStatusUpdate === cb) {
          cb(snap);
        }
      });
    }
  }

  async loadAsync(source, initialStatus = {}) {
    if (this._unloaded) throw new Error('Sound instance already unloaded');
    const uri = source?.uri || '';
    if (!uri) throw new Error('Missing audio URI');

    this._isLooping = !!initialStatus.isLooping;
    if (typeof initialStatus.volume === 'number') {
      this._volume = initialStatus.volume;
    }

    _activeExoSessionId = this._sessionId;
    this._ensureListener();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._loadPending) {
          this._loadPending = null;
          reject(new Error('Media3 ExoPlayer prepare timeout (12000ms)'));
        }
      }, 12000);

      this._loadPending = { resolve, reject, timer };

      MediaModule.exoLoad(
        uri,
        this._sessionId,
        this._isLooping,
        this._volume,
        false
      ).catch((err) => {
        if (this._loadPending) {
          clearTimeout(this._loadPending.timer);
          this._loadPending = null;
          reject(err);
        }
      });
    });
  }

  async playAsync() {
    if (this._unloaded || _activeExoSessionId !== this._sessionId) return;
    await MediaModule.exoPlay();
  }

  async pauseAsync() {
    if (this._unloaded || _activeExoSessionId !== this._sessionId) return;
    await MediaModule.exoPause();
  }

  async stopAsync() {
    if (this._unloaded || _activeExoSessionId !== this._sessionId) return;
    await MediaModule.exoStop();
  }

  async unloadAsync() {
    this._unloaded = true;
    this._onStatusUpdate = null;
    if (this._loadPending) {
      clearTimeout(this._loadPending.timer);
      this._loadPending.reject(new Error('Unloaded during loadAsync'));
      this._loadPending = null;
    }
    if (this._sub) {
      this._sub.remove();
      this._sub = null;
    }
    if (_activeExoSessionId === this._sessionId) {
      try {
        await MediaModule.exoStop();
      } catch {}
    }
  }

  async setPositionAsync(positionMs) {
    if (this._unloaded || _activeExoSessionId !== this._sessionId) return;
    await MediaModule.exoSeek(Math.max(0, Number(positionMs) || 0));
  }

  async setVolumeAsync(vol) {
    this._volume = Math.max(0, Math.min(1, Number(vol) || 0));
    if (this._unloaded || _activeExoSessionId !== this._sessionId) return;
    await MediaModule.exoSetVolume(this._volume);
  }

  async setIsLoopingAsync(isLooping) {
    this._isLooping = !!isLooping;
    if (this._unloaded || _activeExoSessionId !== this._sessionId) return;
    await MediaModule.exoSetLooping(this._isLooping);
  }
}

export function createAudioSound() {
  if (isMedia3Supported()) {
    return new Media3Sound();
  }
  return new Audio.Sound();
}
