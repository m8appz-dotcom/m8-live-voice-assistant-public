import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (file) =>
  readFileSync(new URL("../" + file, import.meta.url), "utf8");
test("manually maintained Android identity, declared permissions and version match app configuration", () => {
  const app = JSON.parse(read("app.json")).expo,
    gradle = read("android/app/build.gradle"),
    manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.equal(
    gradle.match(/applicationId\s+['"]([^'"]+)/)[1],
    app.android.package,
  );
  assert.equal(gradle.match(/versionName\s+['"]([^'"]+)/)[1], app.version);
  for (const permission of app.android.permissions)
    assert.ok(
      manifest.includes("android.permission." + permission),
      "Missing native permission " + permission,
    );
});
test("Android Auto and device-control sources remain registered without regenerating native assets", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml"),
    application = read(
      "android/app/src/main/java/com/m8apps/m8live/MainApplication.kt",
    );
  assert.ok(application.includes("add(M8DeviceControlPackage())"));
  for (const service of [
    "M8CarAppService",
    "M8AccessibilityService",
    "M8NotificationListenerService",
  ])
    assert.ok(manifest.includes(service));
  assert.ok(
    read("android/app/src/main/java/com/m8apps/m8live/M8CarAppService.kt")
      .length > 100,
  );
});
test("Android Gradle wrapper follows the installed React Native toolchain", () => {
  const native = read("android/gradle/wrapper/gradle-wrapper.properties").match(
    /^distributionUrl=(.+)$/m,
  )[1];
  const expected = read(
    "node_modules/@react-native/gradle-plugin/gradle/wrapper/gradle-wrapper.properties",
  ).match(/^distributionUrl=(.+)$/m)[1];
  assert.equal(native.trim(), expected.trim());
});
