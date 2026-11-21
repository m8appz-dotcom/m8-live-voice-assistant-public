package com.m8apps.m8live

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput

class M8CarMessagingReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_POST_TEST -> postCarMessage(
        context,
        intent.getStringExtra(EXTRA_TITLE) ?: "M8 Live",
        intent.getStringExtra(EXTRA_BODY) ?: "Boss, M8 Live está listo en Android Auto."
      )
      ACTION_REPLY -> {
        val reply = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(REMOTE_INPUT_KEY)?.toString().orEmpty()
        Log.i(TAG, "Android Auto voice reply received: $reply")
        postCarMessage(context, "M8 Live", if (reply.isBlank()) "Reply received." else "Recibí tu respuesta: $reply")
      }
      ACTION_MARK_READ -> {
        Log.i(TAG, "Android Auto mark-as-read received")
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
      }
    }
  }

  companion object {
    const val ACTION_POST_TEST = "com.m8apps.m8live.CAR_MESSAGE_TEST"
    private const val ACTION_REPLY = "com.m8apps.m8live.CAR_MESSAGE_REPLY"
    private const val ACTION_MARK_READ = "com.m8apps.m8live.CAR_MESSAGE_MARK_READ"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val REMOTE_INPUT_KEY = "m8_live_reply"
    private const val CHANNEL_ID = "m8_live_car_messages"
    private const val NOTIFICATION_ID = 8801
    private const val TAG = "M8CarMessaging"

    fun postCarMessage(context: Context, title: String, body: String) {
      ensureChannel(context)

      val self = Person.Builder().setName("Boss").setKey("boss").build()
      val sender = Person.Builder().setName(title.ifBlank { "M8 Live" }).setKey("m8-live").build()

      val replyIntent = Intent(context, M8CarMessagingReceiver::class.java).setAction(ACTION_REPLY)
      val replyPendingIntent = PendingIntent.getBroadcast(
        context,
        8802,
        replyIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag()
      )
      val remoteInput = RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel("Responder a M8 Live").build()
      val replyAction = NotificationCompat.Action.Builder(0, "Reply", replyPendingIntent)
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
        .setShowsUserInterface(false)
        .addRemoteInput(remoteInput)
        .build()

      val markReadIntent = Intent(context, M8CarMessagingReceiver::class.java).setAction(ACTION_MARK_READ)
      val markReadPendingIntent = PendingIntent.getBroadcast(
        context,
        8803,
        markReadIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val markReadAction = NotificationCompat.Action.Builder(0, "Mark read", markReadPendingIntent)
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
        .setShowsUserInterface(false)
        .build()

      val style = NotificationCompat.MessagingStyle(self)
        .setConversationTitle(title.ifBlank { "M8 Live" })
        .addMessage(body, System.currentTimeMillis(), sender)

      val notification = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(title.ifBlank { "M8 Live" })
        .setContentText(body)
        .setStyle(style)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setOnlyAlertOnce(false)
        .setAutoCancel(true)
        .addAction(replyAction)
        .addInvisibleAction(markReadAction)
        .build()

      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
      Log.i(TAG, "Posted Android Auto MessagingStyle notification: $body")
    }

    private fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(NotificationManager::class.java)
      val existing = manager.getNotificationChannel(CHANNEL_ID)
      if (existing != null) return
      val channel = NotificationChannel(CHANNEL_ID, "M8 Live car messages", NotificationManager.IMPORTANCE_HIGH)
      channel.description = "M8 Live messages optimized for Android Auto readout"
      manager.createNotificationChannel(channel)
    }

    private fun mutableFlag(): Int = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
  }
}
