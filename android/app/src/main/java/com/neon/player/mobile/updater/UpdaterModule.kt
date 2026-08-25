package com.neon.player.mobile.updater

import android.content.Context
import android.util.Log
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

class UpdaterModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "UpdaterModule"

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build()

    @ReactMethod
    fun getVersionCode(promise: Promise) {
        try {
            val pInfo = reactApplicationContext.packageManager
                .getPackageInfo(reactApplicationContext.packageName, 0)
            val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                pInfo.longVersionCode.toInt()
            } else {
                @Suppress("DEPRECATION")
                pInfo.versionCode
            }
            promise.resolve(code)
        } catch (e: Exception) {
            promise.reject("GET_VERSION_ERROR", e.message)
        }
    }

    @ReactMethod
    fun getVersionName(promise: Promise) {
        try {
            val pInfo = reactApplicationContext.packageManager
                .getPackageInfo(reactApplicationContext.packageName, 0)
            promise.resolve(pInfo.versionName ?: "unknown")
        } catch (e: Exception) {
            promise.reject("GET_VERSION_ERROR", e.message)
        }
    }

    @ReactMethod
    fun checkUpdate(url: String, currentVersionCode: Int, promise: Promise) {
        try {
            val request = Request.Builder().url(url).build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                promise.resolve(null)
                return
            }

            val body = response.body?.string()
            if (body.isNullOrEmpty()) {
                promise.resolve(null)
                return
            }

            val json = JSONObject(body)
            val serverVersionCode = json.optInt("versionCode", 0)
            val versionName = json.optString("versionName", "")
            val apkUrl = json.optString("apkUrl", "")
            val updateMessage = json.optString("updateMessage", "")
            val forceUpdate = json.optBoolean("forceUpdate", false)

            val result = Arguments.createMap()
            result.putBoolean("hasUpdate", serverVersionCode > currentVersionCode)
            result.putInt("versionCode", serverVersionCode)
            result.putString("versionName", versionName)
            result.putString("apkUrl", apkUrl)
            result.putString("updateMessage", updateMessage)
            result.putBoolean("forceUpdate", forceUpdate)

            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("CHECK_UPDATE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun downloadApk(url: String, promise: Promise) {
        try {
            val request = Request.Builder().url(url).build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                promise.reject("DOWNLOAD_FAILED", "HTTP ${response.code}")
                return
            }

            val body = response.body ?: run {
                promise.reject("DOWNLOAD_FAILED", "Empty response body")
                return
            }

            val contentLength = body.contentLength()
            val apkFile = File(reactApplicationContext.filesDir, "update.apk")

            body.byteStream().use { input ->
                FileOutputStream(apkFile).use { output ->
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    var totalRead = 0L
                    var lastProgress = -1

                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        output.write(buffer, 0, bytesRead)
                        totalRead += bytesRead

                        if (contentLength > 0) {
                            val progress = ((totalRead * 100) / contentLength).toInt()
                            // 每变化 5% 才发一次事件，减少 JS bridge 压力
                            if (progress / 5 != lastProgress / 5) {
                                lastProgress = progress
                                sendProgressEvent(progress)
                            }
                        }
                    }
                    output.flush()
                }
            }

            // 下载完成，发 100%
            sendProgressEvent(100)
            promise.resolve(apkFile.absolutePath)
        } catch (e: Exception) {
            sendProgressEvent(-1)
            promise.reject("DOWNLOAD_FAILED", e.message)
        }
    }

    @ReactMethod
    fun fetchText(url: String, promise: Promise) {
        try {
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                .header("Accept", "*/*")
                .header("Accept-Encoding", "identity")
                .build()
            Log.d("UpdaterModule", "[fetchText] start enqueue: $url")
            client.newCall(request).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                    Log.d("UpdaterModule", "[fetchText] onFailure: ${e.message}")
                    promise.reject("FETCH_ERROR", e.message)
                }
                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                    Log.d("UpdaterModule", "[fetchText] onResponse: code=${response.code}")
                    try {
                        if (!response.isSuccessful) {
                            promise.reject("FETCH_ERROR", "HTTP " + response.code)
                            return
                        }
                        val body = response.body?.string()
                        if (body.isNullOrEmpty()) {
                            promise.reject("FETCH_ERROR", "Empty response")
                            return
                        }
                        Log.d("UpdaterModule", "[fetchText] success, length=${body.length}")
                        promise.resolve(body)
                    } catch (e: Exception) {
                        Log.d("UpdaterModule", "[fetchText] body error: ${e.message}")
                        promise.reject("FETCH_ERROR", e.message)
                    }
                }
            })
        } catch (e: Exception) {
            Log.d("UpdaterModule", "[fetchText] exception: ${e.message}")
            promise.reject("FETCH_ERROR", e.message)
        }
    }

    @ReactMethod
    fun installApk(filePath: String, promise: Promise) {
        try {
            val file = File(filePath)
            if (!file.exists()) {
                promise.reject("INSTALL_FAILED", "APK file not found: $filePath")
                return
            }

            val intent = Intent(Intent.ACTION_VIEW)
            val uri: Uri

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                uri = FileProvider.getUriForFile(
                    reactApplicationContext,
                    "${reactApplicationContext.packageName}.provider",
                    file
                )
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } else {
                @Suppress("DEPRECATION")
                uri = Uri.fromFile(file)
            }

            intent.setDataAndType(uri, "application/vnd.android.package-archive")
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("INSTALL_FAILED", e.message)
        }
    }

    private fun sendProgressEvent(progress: Int) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("updateDownloadProgress", progress)
    }

    @ReactMethod
    fun downloadToMusicDir(url: String, fileName: String, promise: Promise) {
        try {
            val downloadClient = OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(300, TimeUnit.SECONDS)
                .retryOnConnectionFailure(false)
                .build()
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                .header("Accept", "*/*")
                .build()

            downloadClient.newCall(request).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                    promise.reject("DOWNLOAD_ERROR", e.message)
                }
                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                    try {
                        if (!response.isSuccessful) {
                            promise.reject("DOWNLOAD_ERROR", "HTTP " + response.code)
                            return
                        }
                        val safeName = fileName.replace('/', '_').replace('\\', '_').replace(':', '_').replace('*', '_').replace('?', '_').replace('"', '_').replace('<', '_').replace('>', '_').replace('|', '_').take(100)
                        if (!safeName.endsWith(".mp3")) {
                            // 确保有扩展名
                        }
                        
                        val resolver = reactApplicationContext.contentResolver
                        val contentValues = android.content.ContentValues().apply {
                            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, safeName)
                            put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "audio/mpeg")
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                                put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS + "/NeonPlayer")
                                put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1)
                            }
                        }
                        
                        val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            android.provider.MediaStore.Downloads.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL)
                        } else {
                            android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                        }
                        
                        val itemUri = resolver.insert(collection, contentValues)
                        if (itemUri == null) {
                            promise.reject("DOWNLOAD_ERROR", "Cannot create MediaStore entry")
                            return
                        }
                        
                        val input = response.body?.byteStream()
                        if (input == null) {
                            resolver.delete(itemUri, null, null)
                            promise.reject("DOWNLOAD_ERROR", "Empty response body")
                            return
                        }
                        
                        val output = resolver.openOutputStream(itemUri)
                        if (output == null) {
                            resolver.delete(itemUri, null, null)
                            promise.reject("DOWNLOAD_ERROR", "Cannot open output stream")
                            return
                        }
                        
                        input.copyTo(output)
                        output.flush()
                        output.close()
                        input.close()
                        
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            val updateValues = android.content.ContentValues().apply {
                                put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0)
                            }
                            resolver.update(itemUri, updateValues, null, null)
                        }
                        
                        Log.d("UpdaterModule", "[downloadToMusicDir] saved to: $itemUri")
                        promise.resolve(safeName)
                    } catch (e: Exception) {
                        Log.d("UpdaterModule", "[downloadToMusicDir] error: ${e.message}")
                        promise.reject("DOWNLOAD_ERROR", e.message)
                    }
                }
            })
        } catch (e: Exception) {
            promise.reject("DOWNLOAD_ERROR", e.message)
        }
    }

    @ReactMethod
    fun openDownloadFolder(promise: Promise) {
        try {
            // 方式1: 尝试用 FileProvider + ACTION_VIEW 打开 NeonPlayer 目录
            try {
                val downloadDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
                val neonDir = File(downloadDir, "NeonPlayer")
                if (!neonDir.exists()) neonDir.mkdirs()
                val uri = FileProvider.getUriForFile(
                    reactApplicationContext,
                    "${reactApplicationContext.packageName}.provider",
                    neonDir
                )
                val intent = Intent(Intent.ACTION_VIEW)
                intent.setDataAndType(uri, "*/*")
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
                reactApplicationContext.startActivity(intent)
                promise.resolve(true)
                return
            } catch (e1: Exception) {
                Log.d("UpdaterModule", "openDownloadFolder method1 failed: ${e1.message}")
            }
            // 方式2: 打开系统 Download 目录
            try {
                val intent = Intent(Intent.ACTION_VIEW)
                intent.setDataAndType(android.net.Uri.parse("content://downloads/public_downloads"), "*/*")
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactApplicationContext.startActivity(intent)
                promise.resolve(true)
                return
            } catch (e2: Exception) {
                Log.d("UpdaterModule", "openDownloadFolder method2 failed: ${e2.message}")
            }
            // 方式3: 打开文件管理器
            val intent = Intent(Intent.ACTION_GET_CONTENT)
            intent.setType("*/*")
            intent.addCategory(Intent.CATEGORY_OPENABLE)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.d("UpdaterModule", "openDownloadFolder failed: ${e.message}")
            promise.reject("OPEN_ERROR", e.message)
        }
    }
}
