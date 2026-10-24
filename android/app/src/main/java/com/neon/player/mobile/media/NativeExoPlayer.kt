package com.neon.player.mobile.media

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Phase 3: AndroidX Media3 (ExoPlayer) 原生单例音频引擎
 *
 * 优势：
 * 1. 全局复用单一 ExoPlayer 与底层硬件解码器，消除 expo-av 每次切歌销毁/重建 SimpleExoPlayer 的开销。
 * 2. 原生集成 OkHttpDataSource（连接池复用、自动携带 User-Agent、302 跨 CDN 重定向支持）与本地 file:///content:// 数据源。
 * 3. 原生级 AudioFocus 自动闪避、ACTION_AUDIO_BECOMING_NOISY 耳机拔出毫秒级硬件静音暂停、WAKE_MODE_NETWORK 息屏防断流。
 * 4. 实时同步 MediaService 锁屏通知栏进度，不受 JS 线程后台休眠影响。
 */
object NativeExoPlayer {
    private const val TAG = "NativeExoPlayer"
    const val EVENT_STATUS = "NativeExoStatus"

    private val mainHandler = Handler(Looper.getMainLooper())
    private var exoPlayer: ExoPlayer? = null
    private var appContext: Context? = null

    @Volatile
    var currentSessionId: Int = 0
        private set

    @Volatile
    private var currentUri: String = ""
    @Volatile
    private var volume: Float = 0.8f
    @Volatile
    private var isLooping: Boolean = false
    @Volatile
    private var allowMixWithOthers: Boolean = false
    @Volatile
    private var isPrepared: Boolean = false

    // 供诊断接口读取的实时状态快照
    @Volatile
    var snapState: Int = Player.STATE_IDLE
    @Volatile
    var snapIsPlaying: Boolean = false
    @Volatile
    var snapPositionMs: Long = 0L
    @Volatile
    var snapDurationMs: Long = 0L
    @Volatile
    var snapBufferedMs: Long = 0L
    @Volatile
    var snapAudioSessionId: Int = 0
    @Volatile
    var lastErrorMsg: String? = null

    private val streamHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .retryOnConnectionFailure(true)
            .build()
    }

    private val progressRunnable = object : Runnable {
        override fun run() {
            val player = exoPlayer ?: return
            if (player.isPlaying) {
                emitStatus(
                    sessionId = currentSessionId,
                    didJustFinish = false,
                    errorMsg = null
                )
                mainHandler.postDelayed(this, 200L)
            }
        }
    }

    private fun startProgressTicker() {
        mainHandler.removeCallbacks(progressRunnable)
        mainHandler.postDelayed(progressRunnable, 200L)
    }

    private fun stopProgressTicker() {
        mainHandler.removeCallbacks(progressRunnable)
    }

    private fun ensurePlayer(context: Context): ExoPlayer {
        exoPlayer?.let { return it }
        val ctx = context.applicationContext
        appContext = ctx

        val okHttpFactory = OkHttpDataSource.Factory(streamHttpClient)
            .setDefaultRequestProperties(
                mapOf(
                    "User-Agent" to "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                )
            )
        val dataSourceFactory = DefaultDataSource.Factory(ctx, okHttpFactory)
        val mediaSourceFactory = DefaultMediaSourceFactory(ctx).setDataSourceFactory(dataSourceFactory)

        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                15_000, // minBufferMs
                60_000, // maxBufferMs
                800,    // bufferForPlaybackMs (800ms 极速起播)
                2_000   // bufferForPlaybackAfterRebufferMs
            )
            .build()

        val audioAttrs = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        val player = ExoPlayer.Builder(ctx)
            .setMediaSourceFactory(mediaSourceFactory)
            .setLoadControl(loadControl)
            .setAudioAttributes(audioAttrs, !allowMixWithOthers)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()

        player.volume = volume
        player.repeatMode = if (isLooping) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF

        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                snapState = playbackState
                when (playbackState) {
                    Player.STATE_READY -> {
                        isPrepared = true
                        snapAudioSessionId = player.audioSessionId
                        emitStatus(currentSessionId, didJustFinish = false, errorMsg = null)
                    }
                    Player.STATE_BUFFERING -> {
                        emitStatus(currentSessionId, didJustFinish = false, errorMsg = null)
                    }
                    Player.STATE_ENDED -> {
                        stopProgressTicker()
                        emitStatus(currentSessionId, didJustFinish = true, errorMsg = null)
                    }
                    Player.STATE_IDLE -> {
                        stopProgressTicker()
                    }
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                snapIsPlaying = isPlaying
                if (isPlaying) {
                    startProgressTicker()
                } else {
                    stopProgressTicker()
                }
                emitStatus(currentSessionId, didJustFinish = false, errorMsg = null)
            }

            override fun onPlayerError(error: PlaybackException) {
                stopProgressTicker()
                val msg = "${error.errorCodeName}: ${error.message ?: "unknown"}"
                lastErrorMsg = msg
                Log.e(TAG, "ExoPlayer error [session=$currentSessionId]: $msg")
                MediaModule.appendNativeLog("[ERROR] [NativeExoPlayer] $msg (uri=$currentUri)")
                emitStatus(currentSessionId, didJustFinish = false, errorMsg = msg)
            }
        })

        exoPlayer = player
        Log.i(TAG, "AndroidX Media3 ExoPlayer initialized successfully")
        MediaModule.appendNativeLog("[INFO] [NativeExoPlayer] AndroidX Media3 ExoPlayer 1.4.1 engine initialized")
        return player
    }

    private fun parseMediaUri(rawUri: String): Uri {
        val trimmed = rawUri.trim()
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("content://")) {
            return Uri.parse(trimmed)
        }
        var cleanPath = trimmed.replace("\\", "/")
        while (cleanPath.startsWith("file://")) cleanPath = cleanPath.substring(7)
        while (cleanPath.startsWith("file:/")) cleanPath = cleanPath.substring(6)
        if (!cleanPath.startsWith("/")) cleanPath = "/$cleanPath"
        return Uri.fromFile(File(cleanPath))
    }

    fun loadAndPlay(
        context: Context,
        uriString: String,
        sessionId: Int,
        looping: Boolean,
        vol: Float,
        playWhenReady: Boolean,
        onComplete: (Boolean, String?) -> Unit
    ) {
        mainHandler.post {
            try {
                val player = ensurePlayer(context)
                stopProgressTicker()

                currentSessionId = sessionId
                currentUri = uriString
                isLooping = looping
                volume = vol.coerceIn(0f, 1f)
                isPrepared = false
                lastErrorMsg = null

                player.stop()
                player.clearMediaItems()
                player.volume = volume
                player.repeatMode = if (looping) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF

                val mediaUri = parseMediaUri(uriString)
                val mediaItem = MediaItem.fromUri(mediaUri)
                player.setMediaItem(mediaItem)
                player.playWhenReady = playWhenReady
                player.prepare()

                onComplete(true, null)
            } catch (e: Exception) {
                val err = e.message ?: "exoLoad exception"
                lastErrorMsg = err
                Log.e(TAG, "loadAndPlay error: $err", e)
                onComplete(false, err)
            }
        }
    }

    fun play(context: Context, onComplete: (Boolean, String?) -> Unit) {
        mainHandler.post {
            try {
                val player = ensurePlayer(context)
                if (player.playbackState == Player.STATE_ENDED) {
                    player.seekTo(0)
                } else if (player.playbackState == Player.STATE_IDLE && currentUri.isNotEmpty()) {
                    player.prepare()
                }
                player.play()
                onComplete(true, null)
            } catch (e: Exception) {
                onComplete(false, e.message)
            }
        }
    }

    fun pause(onComplete: (Boolean, String?) -> Unit) {
        mainHandler.post {
            try {
                exoPlayer?.pause()
                stopProgressTicker()
                onComplete(true, null)
            } catch (e: Exception) {
                onComplete(false, e.message)
            }
        }
    }

    fun stopAndUnload(onComplete: (Boolean, String?) -> Unit) {
        mainHandler.post {
            try {
                stopProgressTicker()
                isPrepared = false
                exoPlayer?.let {
                    it.playWhenReady = false
                    it.stop()
                    it.clearMediaItems()
                }
                snapIsPlaying = false
                snapPositionMs = 0L
                snapDurationMs = 0L
                snapBufferedMs = 0L
                onComplete(true, null)
            } catch (e: Exception) {
                onComplete(false, e.message)
            }
        }
    }

    fun seekTo(positionMs: Long, onComplete: (Boolean, String?) -> Unit) {
        mainHandler.post {
            try {
                val player = exoPlayer
                if (player != null) {
                    player.seekTo(positionMs.coerceAtLeast(0L))
                    emitStatus(currentSessionId, didJustFinish = false, errorMsg = null)
                }
                onComplete(true, null)
            } catch (e: Exception) {
                onComplete(false, e.message)
            }
        }
    }

    fun setVolume(vol: Float) {
        val clamped = vol.coerceIn(0f, 1f)
        volume = clamped
        mainHandler.post {
            exoPlayer?.volume = clamped
        }
    }

    fun setLooping(loop: Boolean) {
        isLooping = loop
        mainHandler.post {
            exoPlayer?.repeatMode = if (loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
        }
    }

    fun setAllowMixWithOthers(allowMix: Boolean) {
        allowMixWithOthers = allowMix
        mainHandler.post {
            val player = exoPlayer ?: return@post
            val audioAttrs = AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build()
            player.setAudioAttributes(audioAttrs, !allowMix)
        }
    }

    private fun emitStatus(sessionId: Int, didJustFinish: Boolean, errorMsg: String?) {
        val player = exoPlayer ?: return
        val pos = player.currentPosition.coerceAtLeast(0L)
        val rawDur = player.duration
        val dur = if (rawDur == C.TIME_UNSET || rawDur < 0L) 0L else rawDur
        val buf = player.bufferedPosition.coerceAtLeast(0L)
        val playing = player.isPlaying
        val buffering = player.playbackState == Player.STATE_BUFFERING
        val loaded = isPrepared || player.playbackState == Player.STATE_READY || player.playbackState == Player.STATE_BUFFERING || didJustFinish

        snapPositionMs = pos
        if (dur > 0) snapDurationMs = dur
        snapBufferedMs = buf
        snapIsPlaying = playing
        snapState = player.playbackState

        // 同步更新 MediaService 内存状态（息屏下锁屏进度条依然精准，MediaService 使用秒为单位）
        MediaService.instance?.let { svc ->
            svc.currentPosition = pos / 1000
            if (dur > 0) svc.currentDuration = dur / 1000
            svc.currentIsPlaying = playing
        }

        val reactCtx = MediaService.reactContext
        if (reactCtx != null && reactCtx.hasActiveReactInstance()) {
            try {
                val map = Arguments.createMap().apply {
                    putInt("sessionId", sessionId)
                    putInt("playbackState", player.playbackState)
                    putBoolean("isLoaded", loaded)
                    putBoolean("isPlaying", playing)
                    putBoolean("isBuffering", buffering)
                    putDouble("positionMillis", pos.toDouble())
                    putDouble("durationMillis", dur.toDouble())
                    putDouble("bufferedPositionMillis", buf.toDouble())
                    putBoolean("didJustFinish", didJustFinish)
                    if (errorMsg != null) {
                        putString("error", errorMsg)
                    }
                }
                reactCtx
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit(EVENT_STATUS, map)
            } catch (e: Exception) {
                // ignore bridge error when RN is reloading
            }
        }
    }

    fun getDiagnosticsJson(): JSONObject {
        val stateName = when (snapState) {
            Player.STATE_IDLE -> "IDLE"
            Player.STATE_BUFFERING -> "BUFFERING"
            Player.STATE_READY -> "READY"
            Player.STATE_ENDED -> "ENDED"
            else -> "UNKNOWN"
        }
        return JSONObject().apply {
            put("engine", "AndroidX-Media3-ExoPlayer-1.4.1")
            put("sessionId", currentSessionId)
            put("state", stateName)
            put("isPlaying", snapIsPlaying)
            put("positionMs", snapPositionMs)
            put("durationMs", snapDurationMs)
            put("bufferedPositionMs", snapBufferedMs)
            put("audioSessionId", snapAudioSessionId)
            put("volume", volume.toDouble())
            put("isLooping", isLooping)
            put("allowMixWithOthers", allowMixWithOthers)
            put("currentUri", if (currentUri.length > 100) currentUri.substring(0, 100) + "..." else currentUri)
            put("lastError", lastErrorMsg ?: JSONObject.NULL)
        }
    }
}
