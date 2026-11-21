# Build Android en Bobi

## Resultado confirmado
- Host remoto: `bobi` (`BOBI-ALMAX`, Windows x86_64)
- Repo remoto: `C:\Users\video\openclaw\workspace\openclaw-live`
- APK generado en Bobi:
  - `C:\Users\video\openclaw\workspace\openclaw-live\android\app\build\outputs\apk\debug\app-debug.apk`
- Tamaño observado en Bobi:
  - `282.716.860 bytes`

## Motivo de usar Bobi
El host Spark ARM64 quedó bloqueado para build Android nativo porque el NDK invocado por Gradle usaba toolchain x86_64 y fallaba con:
- `.../ndk/.../prebuilt/linux-x86_64/bin/clang: Exec format error`

## Preparación en Bobi
Se validó y/o configuró:
- JDK 17 en:
  - `C:\Users\video\jdk17\jdk-17.0.10+7`
- Android SDK principal usado para build:
  - `C:\Users\video\android-sdk`
- Android emulator/AVD detectado también en:
  - `C:\Users\video\AppData\Local\Android\Sdk`
- NDK requerido por el proyecto:
  - `27.1.12297006`
- CMake instalado para el build:
  - `3.22.1`

## `android/local.properties` remoto
Se dejó apuntando al SDK/CMake de Bobi, con contenido equivalente a:

```properties
sdk.dir=C:\\Users\\video\\android-sdk
cmake.dir=C:\\Users\\video\\android-sdk\\cmake\\3.22.1
```

## Comando de build usado en Bobi
Desde `C:\Users\video\openclaw\workspace\openclaw-live\android`:

```cmd
gradlew.bat assembleDebug --console=plain --stacktrace
```

Con variables de entorno válidas para esa sesión:
- `JAVA_HOME=C:\Users\video\jdk17\jdk-17.0.10+7`
- `ANDROID_SDK_ROOT=C:\Users\video\android-sdk`
- `ANDROID_HOME=C:\Users\video\android-sdk`
- `NODE_ENV=production`

## Estado del emulador en Bobi
AVD encontrado:
- `Pixel_7_API34`

Bloqueo real detectado:

```text
Android Emulator hypervisor driver is not installed on this machine
```

Chequeo usado:

```cmd
C:\Users\video\AppData\Local\Android\Sdk\emulator\emulator.exe -accel-check
```

Consecuencia:
- el emulador no logra arrancar actualmente en Bobi
- por eso no se pudo completar todavía la instalación/arranque del APK dentro de ese emulador

## Notas no bloqueantes del build
- warnings de hard-link fallback: `Doing a slower copy instead`
- warnings de deprecations hacia Gradle 10
- el build final igualmente cerró con `BUILD SUCCESSFUL`
