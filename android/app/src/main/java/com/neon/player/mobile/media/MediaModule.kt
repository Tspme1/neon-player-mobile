package com.neon.player.mobile.media

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.neon.player.mobile.media.MediaService
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class MediaModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "MediaModule"

    companion object {
        const val ACTION_START = "neon.player.START_SERVICE"
        const val ACTION_STOP = "neon.player.STOP_SERVICE"
        const val ACTION_UPDATE = "neon.player.UPDATE"
        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"
        const val EXTRA_ARTWORK = "artwork"
        const val EXTRA_DURATION = "duration"
        const val EXTRA_IS_PLAYING = "isPlaying"
        const val EXTRA_POSITION = "position"
        const val EXTRA_IS_FAVORITED = "isFavorited"

        // 全局耳机断开/拔出时间戳
        @Volatile
        var lastNoisyTime = 0L
    }

    private var isServiceRunning = false
    private var noisyReceiverRegistered = false

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                lastNoisyTime = System.currentTimeMillis()
                Log.i("MediaModule", "ACTION_AUDIO_BECOMING_NOISY received! (lastNoisyTime=$lastNoisyTime)")
                if (!isServiceRunning) {
                    try {
                        val emitter = reactApplicationContext
                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        emitter?.emit("MediaControlEvent", "noisy_pause")
                        emitter?.emit("MediaControlEvent", "pause")
                    } catch (e: Exception) {
                        // ignore
                    }
                }
            }
        }
    }

    init {
        MediaService.reactContext = reactContext
        try {
            val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                reactContext.registerReceiver(noisyReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                reactContext.registerReceiver(noisyReceiver, filter)
            }
            noisyReceiverRegistered = true
        } catch (e: Exception) {
            Log.w("MediaModule", "Failed to register noisy receiver: ${e.message}")
        }
    }

    // Cached metadata
    private var currentTitle: String = ""
    private var currentArtist: String = ""
    private var currentArtwork: String = ""
    private var currentDuration: Double = 0.0
    private var currentIsPlaying: Boolean = false
    private var currentPosition: Double = 0.0
    private var currentIsFavorited: Boolean = false

    // OkHttpClient for background URL fetching (independent of JS engine)
    private val urlClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    // OkHttpClient with cookie support for sources that require cookies (kuwo, kugou)
    private val cookieJar = SimpleCookieJar()
    private val cookieClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .cookieJar(cookieJar)
        .build()

    @ReactMethod
    fun initMediaSession() {
        MediaService.reactContext = reactApplicationContext
    }

    @ReactMethod
    fun updateNotification(
        title: String,
        artist: String,
        artwork: String,
        duration: Double,
        isPlaying: Boolean,
        position: Double,
        isFavorited: Boolean
    ) {
        currentTitle = title
        currentArtist = artist
        currentArtwork = artwork
        currentDuration = duration
        currentIsPlaying = isPlaying
        currentPosition = position
        currentIsFavorited = isFavorited

        if (isServiceRunning) {
            val intent = Intent(reactApplicationContext, MediaService::class.java).apply {
                action = ACTION_UPDATE
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_ARTIST, artist)
                putExtra(EXTRA_ARTWORK, artwork)
                putExtra(EXTRA_DURATION, duration)
                putExtra(EXTRA_IS_PLAYING, isPlaying)
                putExtra(EXTRA_POSITION, position)
                putExtra(EXTRA_IS_FAVORITED, isFavorited)
            }
            reactApplicationContext.startService(intent)
        }
    }

    @ReactMethod
    fun setMediaNotificationEnabled(enabled: Boolean) {
        if (enabled) {
            MediaService.reactContext = reactApplicationContext
            val startIntent = Intent(reactApplicationContext, MediaService::class.java).apply {
                action = ACTION_START
            }
            ContextCompat.startForegroundService(reactApplicationContext, startIntent)
            isServiceRunning = true
        } else {
            if (isServiceRunning) {
                val stopIntent = Intent(reactApplicationContext, MediaService::class.java).apply {
                    action = ACTION_STOP
                }
                reactApplicationContext.startService(stopIntent)
                isServiceRunning = false
            }
        }
    }

    @ReactMethod
    fun stopMediaSession() {
        if (isServiceRunning) {
            val stopIntent = Intent(reactApplicationContext, MediaService::class.java).apply {
                action = ACTION_STOP
            }
            reactApplicationContext.startService(stopIntent)
            isServiceRunning = false
        }
    }

    /**
     * 原生层通用 HTTP GET — 在后台 JS 引擎被挂起时使用
     * 所有音源（网易云/酷我/酷狗/咪咕/LX）均可使用此方法替代 JS fetch
     * 返回: 响应体字符串
     */
    @ReactMethod
    fun nativeHttpGet(url: String, headersJson: String, promise: Promise) {
        try {
            val builder = Request.Builder().url(url)
            // 解析 headers JSON
            if (headersJson.isNotEmpty()) {
                try {
                    val headers = JSONObject(headersJson)
                    for (key in headers.keys()) {
                        builder.header(key, headers.getString(key))
                    }
                } catch (e: Exception) {
                    // headers 解析失败，用默认 UA
                    builder.header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                }
            } else {
                builder.header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            }
            
            val request = builder.build()
            Log.d("MediaModule", "[nativeHttpGet] $url")
            
            urlClient.newCall(request).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                    Log.e("MediaModule", "[nativeHttpGet] failed: ${e.message}")
                    promise.reject("HTTP_GET_ERROR", e.message)
                }
                
                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                    try {
                        val body = response.body?.string()
                        if (body.isNullOrEmpty()) {
                            promise.reject("HTTP_GET_ERROR", "Empty response, HTTP ${response.code}")
                            return
                        }
                        Log.d("MediaModule", "[nativeHttpGet] success: ${body.length} chars, HTTP ${response.code}")
                        promise.resolve(body)
                    } catch (e: Exception) {
                        Log.e("MediaModule", "[nativeHttpGet] body error: ${e.message}")
                        promise.reject("HTTP_GET_ERROR", e.message)
                    }
                }
            })
        } catch (e: Exception) {
            Log.e("MediaModule", "[nativeHttpGet] exception: ${e.message}")
            promise.reject("HTTP_GET_ERROR", e.message)
        }
    }

    /**
     * 原生层 HTTP GET with cookie support — for sources that require cookies (kuwo, kugou)
     * Automatically collects and reuses cookies from responses.
     * Returns: response body string (also collects cookies for subsequent requests)
     */
    @ReactMethod
    fun nativeHttpGetWithCookies(url: String, headersJson: String, promise: Promise) {
        try {
            val builder = Request.Builder().url(url)
            if (headersJson.isNotEmpty()) {
                try {
                    val headers = JSONObject(headersJson)
                    for (key in headers.keys()) {
                        builder.header(key, headers.getString(key))
                    }
                } catch (e: Exception) {
                    builder.header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                }
            } else {
                builder.header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            }
            
            val request = builder.build()
            Log.d("MediaModule", "[nativeHttpGetWithCookies] $url")
            
            cookieClient.newCall(request).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                    Log.e("MediaModule", "[nativeHttpGetWithCookies] failed: ${e.message}")
                    promise.reject("HTTP_GET_ERROR", e.message)
                }
                
                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                    try {
                        val body = response.body?.string()
                        if (body.isNullOrEmpty()) {
                            promise.reject("HTTP_GET_ERROR", "Empty response, HTTP ${response.code}")
                            return
                        }
                        Log.d("MediaModule", "[nativeHttpGetWithCookies] success: ${body.length} chars, HTTP ${response.code}")
                        promise.resolve(body)
                    } catch (e: Exception) {
                        Log.e("MediaModule", "[nativeHttpGetWithCookies] body error: ${e.message}")
                        promise.reject("HTTP_GET_ERROR", e.message)
                    }
                }
            })
        } catch (e: Exception) {
            Log.e("MediaModule", "[nativeHttpGetWithCookies] exception: ${e.message}")
            promise.reject("HTTP_GET_ERROR", e.message)
        }
    }

    /**
     * 原生层下载文件到指定路径（后台缓存用）
     * 返回: 下载的文件路径
     */
    @ReactMethod
    fun downloadFile(url: String, destPath: String, promise: Promise) {
        try {
            // 去掉 file:// 前缀，java.io.File 不认 URI 协议前缀
            val cleanPath = if (destPath.startsWith("file://")) {
                destPath.substring(7)
            } else {
                destPath
            }
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                .header("Accept", "*/*")
                .build()
            
            urlClient.newCall(request).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                    Log.e("MediaModule", "[downloadFile] failed: ${e.message}")
                    promise.reject("DOWNLOAD_ERROR", e.message)
                }
                
                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                    try {
                        if (!response.isSuccessful) {
                            promise.reject("DOWNLOAD_ERROR", "HTTP ${response.code}")
                            return
                        }
                        val file = java.io.File(cleanPath)
                        file.parentFile?.mkdirs()
                        response.body?.byteStream()?.use { input ->
                            java.io.FileOutputStream(file).use { output ->
                                input.copyTo(output)
                                output.flush()
                            }
                        }
                        Log.d("MediaModule", "[downloadFile] success: $cleanPath (${file.length()} bytes)")
                        promise.resolve(cleanPath)
                    } catch (e: Exception) {
                        Log.e("MediaModule", "[downloadFile] error: ${e.message}")
                        promise.reject("DOWNLOAD_ERROR", e.message)
                    }
                }
            })
        } catch (e: Exception) {
            promise.reject("DOWNLOAD_ERROR", e.message)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for React Native NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for React Native NativeEventEmitter
    }

    // === Neon Player: allow mix with other apps ===
    // Note: This method is kept for JS compatibility but the actual mix-with-others
    // logic is handled in JS layer (auto-resume after audio focus interruption)
    @ReactMethod
    fun setSkipAudioFocus(skip: Boolean) {
        Log.d("MediaModule", "[setSkipAudioFocus] skip=$skip (handled in JS layer)")
    }

    // 同步判断最近 4 秒内是否有耳机断开/拔出事件
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun isRecentlyNoisy(): Boolean {
        return (System.currentTimeMillis() - lastNoisyTime) < 4000L
    }

    // 重置 Noisy 状态（如用户主动再次点击播放时）
    @ReactMethod
    fun resetNoisy() {
        lastNoisyTime = 0L
    }

    // === High-performance native log append without loading entire file into JS memory ===
    @ReactMethod
    fun appendToFile(filePath: String, content: String, promise: Promise) {
        try {
            val cleanPath = if (filePath.startsWith("file://")) {
                filePath.substring(7)
            } else {
                filePath
            }
            val file = java.io.File(cleanPath)
            file.parentFile?.mkdirs()
            java.io.FileOutputStream(file, true).use { fos ->
                java.io.OutputStreamWriter(fos, "UTF-8").use { writer ->
                    writer.write(content)
                    writer.flush()
                }
            }
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e("MediaModule", "[appendToFile] error: ${e.message}")
            promise.reject("APPEND_ERROR", e.message)
        }
    }

    override fun invalidate() {
        super.invalidate()
        if (noisyReceiverRegistered) {
            try {
                reactApplicationContext.unregisterReceiver(noisyReceiver)
            } catch (e: Exception) {
                // ignore
            }
            noisyReceiverRegistered = false
        }
    }
}

/**
 * Simple in-memory cookie jar for OkHttp — collects cookies from responses
 * and sends them back in subsequent requests to the same domain.
 */
class SimpleCookieJar : CookieJar {
    private val cookies = mutableListOf<Cookie>()
    private val lock = Any()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        synchronized(lock) {
            // Remove old cookies for same domain
            this.cookies.removeAll { it.domain == url.host }
            this.cookies.addAll(cookies)
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        synchronized(lock) {
            val now = System.currentTimeMillis()
            return cookies.filter { it.expiresAt > now && it.matches(url) }
        }
    }
}
