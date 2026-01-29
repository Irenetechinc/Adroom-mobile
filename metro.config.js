const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// NativeWind v4 causes "Received protocol 'c:'" error on Windows when loaded via ESM.
// To avoid this locally while ensuring it works in the cloud (EAS), we conditionally load it.
const isEAS = process.env.EAS_BUILD === 'true';

if (isEAS) {
  // Cloud Build (Linux/Mac): Use NativeWind
  const { withNativeWind } = require("nativewind/metro");
  module.exports = withNativeWind(config, { input: "./global.css" });
} else {
  // Local Build (Windows): Skip NativeWind to prevent crash
  // NOTE: Styles might not regenerate locally on Windows, but this allows 'eas build' to run.
  module.exports = config;
}
