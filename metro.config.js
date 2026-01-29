const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Use a relative path for input to avoid Windows absolute path issues with NativeWind v4
module.exports = withNativeWind(config, { input: "./global.css" });
