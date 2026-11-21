package com.m8apps.m8live.device

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONArray
import org.json.JSONObject

class M8DeviceControlModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName(): String = "M8DeviceControl"

  @ReactMethod
  fun status(promise: Promise) {
    val pm = ctx.packageManager
    val appCount = try { pm.getInstalledApplications(0).size } catch (_: Throwable) { -1 }
    promise.resolve(Arguments.makeNativeMap(mapOf(
      "ok" to true,
      "packageName" to ctx.packageName,
      "accessibilityEnabled" to (M8AccessibilityService.instance != null),
      "notificationListenerEnabled" to (M8NotificationListenerService.instance != null),
      "smsReadGranted" to hasReadSmsPermission(),
      "installedAppCount" to appCount
    )))
  }

  @ReactMethod
  fun openAccessibilitySettings(promise: Promise) = openSettings(Settings.ACTION_ACCESSIBILITY_SETTINGS, promise)

  @ReactMethod
  fun openNotificationListenerSettings(promise: Promise) = openSettings("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS", promise)

  @ReactMethod
  fun openAppDetailsSettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.parse("package:${ctx.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      ctx.startActivity(intent)
      promise.resolve(true)
    } catch (e: Throwable) { promise.reject("settings_failed", e.message, e) }
  }

  private fun openSettings(action: String, promise: Promise) {
    try {
      ctx.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (e: Throwable) { promise.reject("settings_failed", e.message, e) }
  }

  @ReactMethod
  fun listInstalledApps(max: Int, promise: Promise) {
    try {
      val pm = ctx.packageManager
      val arr = JSONArray()
      pm.getInstalledApplications(0)
        .sortedBy { pm.getApplicationLabel(it).toString().lowercase() }
        .take(max.coerceIn(1, 300))
        .forEach { app ->
          arr.put(JSONObject().apply {
            put("label", pm.getApplicationLabel(app).toString())
            put("packageName", app.packageName)
            put("system", (app.flags and android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0)
          })
        }
      promise.resolve(arr.toString())
    } catch (e: Throwable) { promise.reject("list_apps_failed", e.message, e) }
  }

  @ReactMethod
  fun openApp(packageName: String, promise: Promise) {
    try {
      val intent = ctx.packageManager.getLaunchIntentForPackage(packageName)
      if (intent == null) {
        promise.resolve(false)
        return
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(intent)
      promise.resolve(true)
    } catch (e: Throwable) { promise.reject("open_app_failed", e.message, e) }
  }

  @ReactMethod
  fun openUrl(url: String, promise: Promise) {
    try {
      val normalized = if (url.contains("://")) url else "https://$url"
      ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(normalized)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (e: Throwable) { promise.reject("open_url_failed", e.message, e) }
  }

  @ReactMethod
  fun shareText(text: String, title: String?, promise: Promise) {
    try {
      val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
      }
      val chooser = Intent.createChooser(send, title ?: "Share with M8 Live").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(chooser)
      promise.resolve(true)
    } catch (e: Throwable) { promise.reject("share_failed", e.message, e) }
  }

  @ReactMethod
  fun dialNumber(number: String, promise: Promise) {
    try {
      ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (e: Throwable) { promise.reject("dial_failed", e.message, e) }
  }

  @ReactMethod
  fun setClipboard(text: String, promise: Promise) {
    try {
      val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      cm.setPrimaryClip(ClipData.newPlainText("M8 Live", text))
      promise.resolve(true)
    } catch (e: Throwable) { promise.reject("clipboard_failed", e.message, e) }
  }

  @ReactMethod
  fun accessibilityGlobalAction(action: String, promise: Promise) {
    val service = M8AccessibilityService.instance
    if (service == null) { promise.resolve(false); return }
    promise.resolve(service.global(action))
  }

  @ReactMethod
  fun accessibilityTap(x: Double, y: Double, promise: Promise) {
    val service = M8AccessibilityService.instance
    if (service == null) { promise.resolve(false); return }
    promise.resolve(service.tap(x.toFloat(), y.toFloat()))
  }

  @ReactMethod
  fun accessibilitySwipe(x1: Double, y1: Double, x2: Double, y2: Double, durationMs: Int, promise: Promise) {
    val service = M8AccessibilityService.instance
    if (service == null) { promise.resolve(false); return }
    promise.resolve(service.swipe(x1.toFloat(), y1.toFloat(), x2.toFloat(), y2.toFloat(), durationMs.toLong()))
  }

  @ReactMethod
  fun accessibilityTypeText(text: String, promise: Promise) {
    val service = M8AccessibilityService.instance
    if (service == null) { promise.resolve(false); return }
    promise.resolve(service.typeText(text))
  }

  @ReactMethod
  fun accessibilityClickText(query: String, exact: Boolean, promise: Promise) {
    val service = M8AccessibilityService.instance
    if (service == null) { promise.resolve(false); return }
    promise.resolve(service.clickText(query, exact))
  }

  @ReactMethod
  fun accessibilityWaitForText(query: String, timeoutMs: Int, exact: Boolean, promise: Promise) {
    val service = M8AccessibilityService.instance
    if (service == null) { promise.resolve(JSONObject(mapOf("ok" to false, "error" to "Accessibility service is not enabled")).toString()); return }
    promise.resolve(service.waitForText(query, timeoutMs.toLong(), exact).toString())
  }

  @ReactMethod
  fun accessibilityScreenTree(maxNodes: Int, promise: Promise) {
    val service = M8AccessibilityService.instance
    if (service == null) { promise.resolve(JSONObject(mapOf("ok" to false, "error" to "Accessibility service is not enabled")).toString()); return }
    val out = service.screenTree(maxNodes)
    out.put("ok", true)
    promise.resolve(out.toString())
  }

  @ReactMethod
  fun activeNotifications(max: Int, promise: Promise) {
    val service = M8NotificationListenerService.instance
    if (service == null) { promise.resolve(JSONObject(mapOf("ok" to false, "error" to "Notification listener is not enabled")).toString()); return }
    val out = JSONObject().put("ok", true).put("notifications", service.activeNotificationsJson(max))
    promise.resolve(out.toString())
  }

  @ReactMethod
  fun readSmsInbox(max: Int, promise: Promise) {
    if (!hasReadSmsPermission()) {
      promise.resolve(JSONObject(mapOf("ok" to false, "error" to "READ_SMS permission is not granted")).toString())
      return
    }

    try {
      val arr = JSONArray()
      val projection = arrayOf(
        Telephony.Sms._ID,
        Telephony.Sms.ADDRESS,
        Telephony.Sms.BODY,
        Telephony.Sms.DATE,
        Telephony.Sms.READ,
        Telephony.Sms.TYPE,
        Telephony.Sms.THREAD_ID,
      )
      ctx.contentResolver.query(
        Telephony.Sms.CONTENT_URI,
        projection,
        null,
        null,
        "${Telephony.Sms.DATE} DESC"
      )?.use { cursor ->
        val limit = max.coerceIn(1, 200)
        while (cursor.moveToNext() && arr.length() < limit) {
          arr.put(JSONObject().apply {
            put("id", cursor.getString(cursor.getColumnIndexOrThrow(Telephony.Sms._ID)))
            put("address", cursor.getString(cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)) ?: "")
            put("body", cursor.getString(cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)) ?: "")
            put("date", cursor.getLong(cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)))
            put("read", cursor.getInt(cursor.getColumnIndexOrThrow(Telephony.Sms.READ)) == 1)
            put("type", cursor.getInt(cursor.getColumnIndexOrThrow(Telephony.Sms.TYPE)))
            put("threadId", cursor.getLong(cursor.getColumnIndexOrThrow(Telephony.Sms.THREAD_ID)))
          })
        }
      }
      promise.resolve(JSONObject().put("ok", true).put("messages", arr).toString())
    } catch (e: Throwable) { promise.reject("read_sms_failed", e.message, e) }
  }

  private fun hasReadSmsPermission(): Boolean =
    ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
}
