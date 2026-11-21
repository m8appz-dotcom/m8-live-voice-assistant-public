package com.m8apps.m8live.device

import android.app.Notification
import android.os.Build
import android.os.Bundle
import android.service.notification.NotificationListenerService
import org.json.JSONArray
import org.json.JSONObject

class M8NotificationListenerService : NotificationListenerService() {
  companion object {
    @Volatile var instance: M8NotificationListenerService? = null
  }

  override fun onListenerConnected() {
    super.onListenerConnected()
    instance = this
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  fun activeNotificationsJson(max: Int = 30): JSONArray {
    val arr = JSONArray()
    for (sbn in activeNotifications.take(max.coerceIn(1, 100))) {
      val n = sbn.notification
      val extras = n.extras
      arr.put(JSONObject().apply {
        put("key", sbn.key)
        put("packageName", sbn.packageName)
        put("postTime", sbn.postTime)
        put("category", n.category ?: "")
        put("title", extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: "")
        put("text", extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: "")
        put("subText", extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString() ?: "")
        put("bigText", extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: "")
        put("summaryText", extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)?.toString() ?: "")
        put("textLines", charSequenceArrayJson(extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)))
        put("messages", messagingStyleMessagesJson(extras))
      })
    }
    return arr
  }

  private fun charSequenceArrayJson(values: Array<CharSequence>?): JSONArray {
    val arr = JSONArray()
    values?.forEach { arr.put(it.toString()) }
    return arr
  }

  private fun messagingStyleMessagesJson(extras: Bundle): JSONArray {
    val out = JSONArray()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return out
    val bundles = extras.getParcelableArray(Notification.EXTRA_MESSAGES) ?: return out
    val messages = Notification.MessagingStyle.Message.getMessagesFromBundleArray(bundles)
    messages.forEach { message ->
      out.put(JSONObject().apply {
        put("text", message.text?.toString() ?: "")
        put("timestamp", message.timestamp)
        put("sender", message.senderPerson?.name?.toString() ?: message.sender?.toString().orEmpty())
      })
    }
    return out
  }
}
