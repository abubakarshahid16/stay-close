const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow .wasm files to be bundled as binary assets (needed by expo-sqlite web)
config.resolver.assetExts.push('wasm');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs'];

// Stub only truly mobile-only native modules on web
const WEB_STUBS = [
  'react-native-reanimated',
  'react-native-gesture-handler',
  'react-native-screens',
];

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    if (WEB_STUBS.some(s => moduleName === s || moduleName.startsWith(s + '/'))) {
      return { type: 'empty' };
    }
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
