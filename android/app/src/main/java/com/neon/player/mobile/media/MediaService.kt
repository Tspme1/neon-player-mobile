package com.neon.player.mobile.media

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.media.session.MediaSessionManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media.session.MediaButtonReceiver
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.neon.player.mobile.MainActivity
import com.neon.player.mobile.R
import okhttp3.Cache
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class MediaService : Service() {

    companion object {
        var reactContext: com.facebook.react.bridge.ReactContext? = null
        @Volatile
        var instance: MediaService? = null

        private const val CHANNEL_ID = "neon_media_playback"
        private const val NOTIFICATION_ID = 1

        const val ACTION_START = "neon.player.START_SERVICE"
        const val ACTION_STOP = "neon.player.STOP_SERVICE"
        const val ACTION_UPDATE = "neon.player.UPDATE"
        const val ACTION_PLAY = "neon.player.PLAY"
        const val ACTION_PAUSE = "neon.player.PAUSE"
        const val ACTION_NEXT = "neon.player.NEXT"
        const val ACTION_PREV = "neon.player.PREV"
        const val ACTION_STOP_PLAYBACK = "neon.player.STOP_PLAYBACK"
        const val ACTION_FAVORITE = "neon.player.FAVORITE"

        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"
        const val EXTRA_ARTWORK = "artwork"
        const val EXTRA_DURATION = "duration"
        const val EXTRA_IS_PLAYING = "isPlaying"
        const val EXTRA_POSITION = "position"
        const val EXTRA_IS_FAVORITED = "isFavorited"
    }

    private var mediaSession: MediaSessionCompat? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var receiverRegistered = false
    private var httpClient: OkHttpClient? = null
    private val executor = Executors.newSingleThreadExecutor()

    // Current state (internal so LogServer can inspect)
    internal var currentTitle: String = ""
    internal var currentArtist: String = ""
    internal var currentArtworkUrl: String = ""
    internal var currentArtworkBitmap: Bitmap? = null
    internal var currentDuration: Long = 0L
    internal var currentIsPlaying: Boolean = false
    internal var currentPosition: Long = 0L
    internal var currentIsFavorited: Boolean = false

    private fun sendControlEvent(eventName: String) {
        val ctx = reactContext
        if (ctx == null) return
        try {
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("MediaControlEvent", eventName)
        } catch (e: Exception) {
            // silent
        }
    }

    private val broadcastReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                ACTION_PLAY -> sendControlEvent("play")
                ACTION_PAUSE -> sendControlEvent("pause")
                ACTION_NEXT -> sendControlEvent("next")
                ACTION_PREV -> sendControlEvent("prev")
                ACTION_STOP_PLAYBACK -> {
                    sendControlEvent("stop")
                    stopForeground(STOP_FOREGROUND_REMOVE)
                }
                ACTION_FAVORITE -> sendControlEvent("favorite")
            }
        }
    }

    // 耳机断开/蓝牙耳机关闭时自动暂停
    private var noisyReceiverRegistered = false
    private val becomingNoisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                MediaModule.lastNoisyTime = System.currentTimeMillis()
                Log.i("MediaService", "ACTION_AUDIO_BECOMING_NOISY received! Disconnecting headset, sending noisy_pause & pause")
                sendControlEvent("noisy_pause")
                sendControlEvent("pause")
                currentIsPlaying = false
                updateMediaSession()
                updateNotification()
            }
        }
    }

    private val mediaSessionCallback = object : MediaSessionCompat.Callback() {
        override fun onPlay() { sendControlEvent("play") }
        override fun onPause() { sendControlEvent("pause") }
        override fun onSkipToNext() { sendControlEvent("next") }
        override fun onSkipToPrevious() { sendControlEvent("prev") }
        override fun onStop() { sendControlEvent("stop") }
        override fun onSeekTo(pos: Long) {
            sendControlEvent("seek:$pos")
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        LogServer.start(this)

        // Create notification channel
        val channel = NotificationChannel(
            CHANNEL_ID,
            "音乐播放",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            setShowBadge(false)
        }
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(channel)

        // WakeLock to keep CPU alive for JS engine
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NeonPlayer::MediaService")
        wakeLock?.acquire(12 * 60 * 60 * 1000L) // 12 hours max

        // MediaSession
        mediaSession = MediaSessionCompat(this, "NeonPlayer").apply {
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
            setCallback(mediaSessionCallback)
            isActive = true
        }

        // BroadcastReceiver for notification actions
        ensureBroadcastReceiver()
        registerNoisyReceiver()

        // OkHttpClient for artwork loading with 20MB disk cache
        httpClient = OkHttpClient.Builder()
            .cache(Cache(File(cacheDir, "okhttp-covers"), 20L * 1024 * 1024))
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }

    private fun ensureBroadcastReceiver() {
        if (receiverRegistered) return
        val filter = IntentFilter().apply {
            addAction(ACTION_PLAY)
            addAction(ACTION_PAUSE)
            addAction(ACTION_NEXT)
            addAction(ACTION_PREV)
            addAction(ACTION_STOP_PLAYBACK)
            addAction(ACTION_FAVORITE)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(broadcastReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(broadcastReceiver, filter)
        }
        receiverRegistered = true
    }

    private fun registerNoisyReceiver() {
        if (noisyReceiverRegistered) return
        val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(becomingNoisyReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(becomingNoisyReceiver, filter)
        }
        noisyReceiverRegistered = true
    }

    private fun unregisterNoisyReceiver() {
        if (!noisyReceiverRegistered) return
        try {
            unregisterReceiver(becomingNoisyReceiver)
        } catch (e: Exception) {
            // silent
        }
        noisyReceiverRegistered = false
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                startForeground(NOTIFICATION_ID, buildNotification())
            }
            ACTION_STOP -> {
                cleanup()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_UPDATE -> {
                val oldTitle = currentTitle
                val oldArtist = currentArtist
                val oldArtwork = currentArtworkUrl
                val oldDuration = currentDuration
                val oldIsPlaying = currentIsPlaying
                val oldIsFavorited = currentIsFavorited

                intent.getStringExtra(EXTRA_TITLE)?.let { currentTitle = it }
                intent.getStringExtra(EXTRA_ARTIST)?.let { currentArtist = it }
                val artwork = intent.getStringExtra(EXTRA_ARTWORK)
                if (artwork != null) {
                    if (artwork != currentArtworkUrl) {
                        currentArtworkUrl = artwork
                        currentArtworkBitmap = null
                        if (artwork.isNotEmpty()) {
                            loadArtworkAsync(artwork)
                        }
                    }
                }
                intent.getDoubleExtra(EXTRA_DURATION, currentDuration.toDouble()).let { currentDuration = it.toLong() }
                intent.getBooleanExtra(EXTRA_IS_PLAYING, currentIsPlaying).let { currentIsPlaying = it }
                intent.getDoubleExtra(EXTRA_POSITION, currentPosition.toDouble()).let { currentPosition = it.toLong() }
                intent.getBooleanExtra(EXTRA_IS_FAVORITED, currentIsFavorited).let { currentIsFavorited = it }

                val metadataChanged = currentTitle != oldTitle || currentArtist != oldArtist || currentArtworkUrl != oldArtwork || currentDuration != oldDuration
                val playStateChanged = currentIsPlaying != oldIsPlaying
                val favChanged = currentIsFavorited != oldIsFavorited

                // 更新 MediaSession（用于系统锁屏和通知栏原生基于 PlaybackState 自动插值推算进度条）
                updateMediaSession()

                // 核心性能优化：仅在曲目元数据、播放/暂停状态或喜欢状态改变时，才通知系统重建通知栏 UI (nm.notify)
                // 严禁在每 100ms 进度更新时调用 updateNotification()，彻底终结 Binder 跨进程 IPC 轰炸与界面冻结
                if (metadataChanged || playStateChanged || favChanged) {
                    updateNotification()
                }
            }
        }
        return START_STICKY
    }

    private fun updateMediaSession() {
        val ms = mediaSession ?: return

        ms.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDuration * 1000)
                .apply {
                    currentArtworkBitmap?.let { putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) }
                }
                .build()
        )

        val state = if (currentIsPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        ms.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or
                    PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_PLAY_PAUSE or
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                    PlaybackStateCompat.ACTION_STOP or
                    PlaybackStateCompat.ACTION_SEEK_TO
                )
                .setState(state, currentPosition * 1000, 1.0f)
                .build()
        )
    }

    private fun buildNotification(): Notification {
        val contentIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPI = PendingIntent.getActivity(
            this, 0, contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val playPauseIcon = if (currentIsPlaying) R.drawable.ic_media_pause else R.drawable.ic_media_play
        val playPauseLabel = if (currentIsPlaying) "暂停" else "播放"

        val favoriteIcon = if (currentIsFavorited) R.drawable.ic_heart_filled else R.drawable.ic_heart_outline
        val favoriteLabel = if (currentIsFavorited) "取消喜欢" else "喜欢"

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_logo)
            .setContentTitle(currentTitle.ifEmpty { "Neon Player" })
            .setContentText(currentArtist)
            .setContentIntent(contentPI)
            .setOngoing(currentIsPlaying)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(R.drawable.ic_media_previous, "上一曲", buildAction(ACTION_PREV))
            .addAction(playPauseIcon, playPauseLabel, buildAction(if (currentIsPlaying) ACTION_PAUSE else ACTION_PLAY))
            .addAction(R.drawable.ic_media_next, "下一曲", buildAction(ACTION_NEXT))
            .addAction(favoriteIcon, favoriteLabel, buildAction(ACTION_FAVORITE))
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession?.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )

        currentArtworkBitmap?.let { builder.setLargeIcon(it) }

        return builder.build()
    }

    private fun buildAction(action: String): PendingIntent {
        // 用隐式 Intent（只设 action + package），不指定 component class
        // 这样 sendBroadcast 才能按 IntentFilter 匹配到动态注册的 BroadcastReceiver
        val intent = Intent(action).apply { setPackage(packageName) }
        return PendingIntent.getBroadcast(
            this, action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun loadArtworkAsync(url: String) {
        val client = httpClient ?: return
        executor.execute {
            try {
                // file:// URI（本地音乐内嵌封面）直接解码，不走 OkHttp
                if (url.startsWith("file://")) {
                    val path = url.removePrefix("file://")
                    val bitmap = BitmapFactory.decodeFile(path)
                    if (bitmap != null) {
                        currentArtworkBitmap = bitmap
                        updateMediaSession()
                        updateNotification()
                    }
                    return@execute
                }

                val request = Request.Builder().url(url).build()
                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        val bytes = response.body?.bytes()
                        if (bytes != null && bytes.isNotEmpty()) {
                            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                            if (bitmap != null) {
                                currentArtworkBitmap = bitmap
                                updateMediaSession()
                                updateNotification()
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                // silent
            }
        }
    }

    private fun updateNotification() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun cleanup() {
        if (receiverRegistered) {
            try { unregisterReceiver(broadcastReceiver) } catch (e: Exception) {}
            receiverRegistered = false
        }
        unregisterNoisyReceiver()
        mediaSession?.let {
            it.isActive = false
            it.release()
        }
        mediaSession = null
        currentArtworkBitmap = null
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(NOTIFICATION_ID)
        stopForeground(STOP_FOREGROUND_REMOVE)
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
    }

    override fun onDestroy() {
        cleanup()
        if (instance == this) {
            instance = null
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

/**
 * 嵌入式超轻量 HTTP 日志与诊断服务 (供 AI 与本地实时调试调阅)
 * 监听内部端口 18088，无连接时阻塞在 OS 内核 accept()，CPU 占用 0.00%
 */
object LogServer {
    private var serverSocket: java.net.ServerSocket? = null
    private var serverThread: Thread? = null
    @Volatile
    private var isRunning = false

    fun start(context: Context) {
        if (isRunning) return
        isRunning = true
        val appContext = context.applicationContext
        serverThread = Thread({
            try {
                val ss = java.net.ServerSocket(18088, 50, java.net.InetAddress.getByName("0.0.0.0")).apply {
                    reuseAddress = true
                }
                serverSocket = ss
                Log.i("LogServer", "NeonPlayer LogServer listening on http://0.0.0.0:18088")
                while (isRunning && !ss.isClosed) {
                    try {
                        val client = ss.accept()
                        handleClient(client, appContext)
                    } catch (e: Exception) {
                        if (!isRunning) break
                    }
                }
            } catch (e: Exception) {
                Log.w("LogServer", "LogServer failed to start on 18088: ${e.message}")
            }
        }, "Neon-LogServer").apply {
            isDaemon = true
            start()
        }
    }

    fun stop() {
        isRunning = false
        try {
            serverSocket?.close()
        } catch (e: Exception) {}
        serverSocket = null
        serverThread = null
    }

    private fun handleClient(client: java.net.Socket, context: Context) {
        Thread({
            try {
                client.soTimeout = 5000
                val reader = java.io.BufferedReader(java.io.InputStreamReader(client.getInputStream()))
                val requestLine = reader.readLine() ?: return@Thread
                val parts = requestLine.split(" ")
                val uri = if (parts.size > 1) parts[1] else "/"

                val (statusCode, contentType, bodyBytes) = when {
                    uri.startsWith("/ping") -> {
                        val json = "{\"status\":\"ok\",\"app\":\"NeonPlayer\",\"version\":\"1.00.017\",\"timestamp\":${System.currentTimeMillis()}}"
                        Triple("200 OK", "application/json; charset=utf-8", json.toByteArray(Charsets.UTF_8))
                    }
                    uri.startsWith("/logs/today") -> {
                        val today = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())
                        val logFile = java.io.File(context.filesDir, "logs/app_$today.log")
                        if (logFile.exists()) {
                            val bytes = logFile.readBytes()
                            Triple("200 OK", "text/plain; charset=utf-8", bytes)
                        } else {
                            val msg = "Today log file not found at: ${logFile.absolutePath}"
                            Triple("404 Not Found", "text/plain; charset=utf-8", msg.toByteArray(Charsets.UTF_8))
                        }
                    }
                    uri.startsWith("/logs") -> {
                        var limit = 200
                        val qIndex = uri.indexOf("limit=")
                        if (qIndex != -1) {
                            val limitStr = uri.substring(qIndex + 6).split("&")[0]
                            limit = limitStr.toIntOrNull() ?: 200
                        }
                        val logs = MediaModule.getNativeLogs(limit)
                        val content = if (logs.isEmpty()) "(No logs recorded in memory buffer yet)" else logs.joinToString("\n")
                        Triple("200 OK", "text/plain; charset=utf-8", content.toByteArray(Charsets.UTF_8))
                    }
                    uri.startsWith("/cache") -> {
                        val cacheDir = java.io.File(context.filesDir, "music-cache")
                        val files = cacheDir.listFiles() ?: emptyArray()
                        val cacheArr = org.json.JSONArray()
                        var totalBytes = 0L
                        for (f in files) {
                            if (!f.name.endsWith(".tmp")) {
                                totalBytes += f.length()
                                val fObj = org.json.JSONObject().apply {
                                    put("name", f.name)
                                    put("size", f.length())
                                    put("lastModified", f.lastModified())
                                }
                                cacheArr.put(fObj)
                            }
                        }
                        val resObj = org.json.JSONObject().apply {
                            put("cacheDir", cacheDir.absolutePath)
                            put("fileCount", cacheArr.length())
                            put("totalSizeMB", String.format(java.util.Locale.US, "%.2f", totalBytes / (1024.0 * 1024.0)))
                            put("files", cacheArr)
                        }
                        Triple("200 OK", "application/json; charset=utf-8", resObj.toString(2).toByteArray(Charsets.UTF_8))
                    }
                    uri.startsWith("/status") -> {
                        val svc = MediaService.instance
                        val statusObj = org.json.JSONObject().apply {
                            put("app", "Neon Player")
                            put("version", "1.00.017")
                            put("title", svc?.currentTitle ?: "")
                            put("artist", svc?.currentArtist ?: "")
                            put("isPlaying", svc?.currentIsPlaying ?: false)
                            put("duration", svc?.currentDuration ?: 0L)
                            put("position", svc?.currentPosition ?: 0L)
                            put("isFavorited", svc?.currentIsFavorited ?: false)
                            put("bufferedLogLines", MediaModule.getNativeLogs(1000).size)
                        }
                        Triple("200 OK", "application/json; charset=utf-8", statusObj.toString(2).toByteArray(Charsets.UTF_8))
                    }
                    else -> {
                        val help = """
===================================================
Neon Player Mobile v1.00.017 Diagnostic API
===================================================
Available Endpoints:
  GET /logs         - Retrieve recent logs (?limit=200)
  GET /logs/today   - Retrieve entire today's log file
  GET /status       - Current playback and service status (JSON)
  GET /ping         - Health check & version info
===================================================
""".trimIndent()
                        Triple("200 OK", "text/plain; charset=utf-8", help.toByteArray(Charsets.UTF_8))
                    }
                }

                val out = client.getOutputStream()
                val responseHeader = "HTTP/1.1 $statusCode\r\n" +
                        "Content-Type: $contentType\r\n" +
                        "Content-Length: ${bodyBytes.size}\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" +
                        "Connection: close\r\n\r\n"
                out.write(responseHeader.toByteArray(Charsets.UTF_8))
                out.write(bodyBytes)
                out.flush()
            } catch (e: Exception) {
                // connection error or client disconnect
            } finally {
                try { client.close() } catch (e: Exception) {}
            }
        }, "Neon-LogClient").start()
    }
}

