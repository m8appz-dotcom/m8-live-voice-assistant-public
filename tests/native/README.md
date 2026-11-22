# Native PCM contract check

The Android Auto client applies the setup and PCM MIME sample rates before playback. Its pure Kotlin parser has a JVM check independent of an Android device:

```sh
kotlinc android/app/src/main/java/com/m8apps/m8live/M8PcmFormat.kt tests/native/M8PcmFormatTest.kt -include-runtime -d pcm-format-check.jar
java -jar pcm-format-check.jar
```

Use an existing compatible Kotlin compiler and Java 17. The check covers 22,050 Hz Spark, the 24,000 Hz legacy fallback, MIME negotiation and unsupported-rate rejection. It does not compile the Android framework bindings or establish physical device playback. Full Android/device acceptance remains separate.
