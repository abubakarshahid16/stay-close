const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite runs as WebAssembly in a browser, so the .wasm file has to be
// bundled as a binary asset. Without this the web build loads but the database
// never opens — which was the single largest source of bugs in the previous
// web version of this app.
config.resolver.assetExts.push('wasm');

module.exports = config;
