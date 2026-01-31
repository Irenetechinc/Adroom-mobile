const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const isEAS = process.env.EAS_BUILD === 'true';

if (isEAS) {
  // Cloud Build (Linux/Mac): Use NativeWind
  console.log("🔌 Enabling NativeWind for EAS Build");
  const { withNativeWind } = require("nativewind/metro");
  module.exports = withNativeWind(config, { input: "./global.css" });
} else {
  // Local Build (Windows): Skip NativeWind to prevent crash
  console.log("⚠️  Skipping NativeWind for local build");
  module.exports = config;
}
