const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow .wasm files to be bundled as binary assets (expo-sqlite web engine)
config.resolver.assetExts.push('wasm');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs'];

module.exports = config;
