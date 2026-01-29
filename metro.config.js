const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// NativeWind v4 has issues with Windows absolute paths in Metro config
// See: https://github.com/nativewind/react-native-css/issues/246
const isWindows = process.platform === 'win32';
const isEAS = process.env.EAS_BUILD === 'true';

if (isWindows && !isEAS) {
  console.warn('⚠️  Windows detected: NativeWind Metro config skipped to prevent "protocol c:" error.');
  console.warn('⚠️  Styles may not be processed locally. Use WSL or Mac/Linux for full dev experience.');
  module.exports = config;
} else {
  module.exports = withNativeWind(config, { input: "./global.css" });
}
