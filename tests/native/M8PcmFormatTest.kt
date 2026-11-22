package com.m8apps.m8live

fun main() {
  check(M8PcmFormat.fromSetup(22050, 24000) == 22050)
  check(M8PcmFormat.fromSetup(0, 24000) == 24000)
  check(M8PcmFormat.fromMime("audio/pcm;rate=22050", 24000) == 22050)
  check(M8PcmFormat.fromMime("audio/pcm; rate=24000", 22050) == 24000)
  check(M8PcmFormat.fromMime("audio/pcm", 24000) == 24000)
  for (mime in listOf("audio/pcm;rate=99999", "audio/pcm;rate=invalid")) {
    check(runCatching { M8PcmFormat.fromMime(mime, 24000) }.isFailure)
  }
  println("Native PCM format JVM checks passed: Spark, legacy, MIME negotiation and rejection.")
}
