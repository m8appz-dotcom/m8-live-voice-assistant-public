package com.m8apps.m8live.device

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

class M8AccessibilityService : AccessibilityService() {
  companion object {
    @Volatile var instance: M8AccessibilityService? = null
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
  override fun onInterrupt() {}

  fun global(action: String): Boolean {
    val code = when (action.lowercase()) {
      "back" -> GLOBAL_ACTION_BACK
      "home" -> GLOBAL_ACTION_HOME
      "recents" -> GLOBAL_ACTION_RECENTS
      "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
      "quick_settings", "quicksettings" -> GLOBAL_ACTION_QUICK_SETTINGS
      "power_dialog", "power" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) GLOBAL_ACTION_POWER_DIALOG else -1
      "lock_screen", "lock" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) GLOBAL_ACTION_LOCK_SCREEN else -1
      else -> -1
    }
    return code != -1 && performGlobalAction(code)
  }

  fun tap(x: Float, y: Float): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
    val path = Path().apply { moveTo(x, y) }
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0, 80))
      .build()
    return dispatchGesture(gesture, null, null)
  }

  fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
    val path = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs.coerceIn(80, 3000)))
      .build()
    return dispatchGesture(gesture, null, null)
  }

  fun typeText(text: String): Boolean {
    val focused = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
    val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
    return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
  }

  fun clickText(query: String, exact: Boolean = false): Boolean {
    val root = rootInActiveWindow ?: return false
    val needle = query.trim().lowercase()
    if (needle.isEmpty()) return false
    val target = findNode(root) { node ->
      val values = listOf(
        node.text?.toString().orEmpty(),
        node.contentDescription?.toString().orEmpty(),
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) node.viewIdResourceName.orEmpty() else ""
      ).map { it.trim().lowercase() }.filter { it.isNotEmpty() }
      values.any { value -> if (exact) value == needle else value.contains(needle) }
    } ?: return false
    return performNodeClick(target)
  }

  fun waitForText(query: String, timeoutMs: Long = 4000, exact: Boolean = false): JSONObject {
    val deadline = System.currentTimeMillis() + timeoutMs.coerceIn(250, 15000)
    val needle = query.trim().lowercase()
    while (System.currentTimeMillis() <= deadline) {
      val root = rootInActiveWindow
      if (root != null && needle.isNotEmpty()) {
        val target = findNode(root) { node ->
          val values = listOf(
            node.text?.toString().orEmpty(),
            node.contentDescription?.toString().orEmpty(),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) node.viewIdResourceName.orEmpty() else ""
          ).map { it.trim().lowercase() }.filter { it.isNotEmpty() }
          values.any { value -> if (exact) value == needle else value.contains(needle) }
        }
        if (target != null) {
          val r = Rect()
          target.getBoundsInScreen(r)
          return JSONObject().put("ok", true).put("found", true).put("text", target.text?.toString() ?: "").put("description", target.contentDescription?.toString() ?: "").put("bounds", JSONObject().apply {
            put("left", r.left); put("top", r.top); put("right", r.right); put("bottom", r.bottom); put("centerX", r.centerX()); put("centerY", r.centerY())
          })
        }
      }
      try { Thread.sleep(150) } catch (_: InterruptedException) { break }
    }
    return JSONObject().put("ok", false).put("found", false).put("error", "Text not found before timeout")
  }

  fun screenTree(maxNodes: Int = 80): JSONObject {
    val root = rootInActiveWindow
    val out = JSONObject()
    out.put("packageName", root?.packageName?.toString() ?: "")
    out.put("className", root?.className?.toString() ?: "")
    val nodes = JSONArray()
    if (root != null) collect(root, nodes, maxNodes.coerceIn(1, 200), 0)
    out.put("nodes", nodes)
    out.put("truncated", nodes.length() >= maxNodes)
    return out
  }

  private fun findNode(node: AccessibilityNodeInfo, predicate: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
    if (predicate(node)) return node
    for (i in 0 until node.childCount) {
      val child = node.getChild(i) ?: continue
      val found = findNode(child, predicate)
      if (found != null) return found
    }
    return null
  }

  private fun performNodeClick(node: AccessibilityNodeInfo): Boolean {
    var current: AccessibilityNodeInfo? = node
    while (current != null) {
      if (current.isClickable && current.isEnabled) return current.performAction(AccessibilityNodeInfo.ACTION_CLICK)
      current = current.parent
    }
    val r = Rect()
    node.getBoundsInScreen(r)
    return tap(r.centerX().toFloat(), r.centerY().toFloat())
  }

  private fun collect(node: AccessibilityNodeInfo, nodes: JSONArray, maxNodes: Int, depth: Int) {
    if (nodes.length() >= maxNodes) return
    val r = Rect()
    node.getBoundsInScreen(r)
    val text = node.text?.toString()?.trim().orEmpty()
    val desc = node.contentDescription?.toString()?.trim().orEmpty()
    if (text.isNotEmpty() || desc.isNotEmpty() || node.isClickable || node.isEditable || node.isFocused) {
      nodes.put(JSONObject().apply {
        put("text", text)
        put("description", desc)
        put("className", node.className?.toString() ?: "")
        put("packageName", node.packageName?.toString() ?: "")
        put("clickable", node.isClickable)
        put("editable", node.isEditable)
        put("focused", node.isFocused)
        put("enabled", node.isEnabled)
        put("depth", depth)
        put("bounds", JSONObject().apply {
          put("left", r.left); put("top", r.top); put("right", r.right); put("bottom", r.bottom)
          put("centerX", r.centerX()); put("centerY", r.centerY())
        })
      })
    }
    for (i in 0 until node.childCount) {
      node.getChild(i)?.let { child -> collect(child, nodes, maxNodes, depth + 1) }
      if (nodes.length() >= maxNodes) return
    }
  }
}
