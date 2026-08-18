const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs'];

// Heavy native-only modules stubbed on web to cut bundle size by ~60%
const WEB_STUBS = [
  'react-native-reanimated',
  'react-native-gesture-handler',
  'react-native-screens',
  'react-native-safe-area-context',
];

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    // Stub .wasm files (expo-sqlite web worker)
    if (moduleName.endsWith('.wasm')) {
      return { type: 'empty' };
    }
    // Stub heavy native-only packages
    if (WEB_STUBS.some(stub => moduleName === stub || moduleName.startsWith(stub + '/'))) {
      return { type: 'empty' };
    }
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
