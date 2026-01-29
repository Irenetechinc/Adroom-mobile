const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

let withNativeWind;

try {
  // NativeWind v4 can cause issues on Windows with absolute paths ("protocol c:" error).
  // We strictly avoid loading it locally on Windows unless we are sure it's safe.
  // We ALWAYS load it on EAS Build (Linux/Mac).
  const isWindows = process.platform === 'win32';
  const isEAS = process.env.EAS_BUILD === 'true';

  if (!isWindows || isEAS) {
    console.log('🔌 Loading NativeWind configuration...');
    withNativeWind = require("nativewind/metro").withNativeWind;
  } else {
    console.log('⚠️  Windows detected: Skipping NativeWind to prevent build crash.');
  }
} catch (error) {
  console.warn('⚠️  Failed to load NativeWind:', error.message);
}

if (withNativeWind) {
  // Use absolute path for input to be safe
  const inputPath = path.join(__dirname, "global.css");
  module.exports = withNativeWind(config, { input: inputPath });
} else {
  module.exports = config;
}
