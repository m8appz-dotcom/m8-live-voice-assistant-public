package com.m8apps.m8live

/** The PCM source rate must follow the relay, including the legacy provider. */
internal object M8PcmFormat {
  private val supportedRates = setOf(16000, 22050, 24000, 44100, 48000)

  fun fromSetup(announced: Int, fallback: Int): Int =
    validate(if (announced == 0) fallback else announced)

  fun fromMime(mime: String, fallback: Int): Int {
    val value = Regex("(?:^|;)\\s*rate=([^;]+)").find(mime)?.groupValues?.get(1)
    return validate(if (value == null) fallback else value.trim().toIntOrNull() ?: 0)
  }

  private fun validate(rate: Int): Int {
    require(rate in supportedRates) { "Unsupported PCM sample rate" }
    return rate
  }
}
