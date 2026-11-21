const { withAndroidManifest } = require('@expo/config-plugins')

module.exports = function withAndroidAuto(config) {
  return withAndroidManifest(config, (mod) => mod)
}
