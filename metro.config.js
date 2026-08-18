// Metro configuration
// https://docs.expo.dev/guides/customizing-metro/
//
// The wasm asset support is required for expo-sqlite on web
// (it ships a wa-sqlite.wasm binary that Metro must treat as an asset).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle .wasm files as assets (required by expo-sqlite web support)
config.resolver.assetExts.push('wasm');

// Add COOP/COEP headers on the dev server so SharedArrayBuffer-based
// SQLite features work during `expo start --web`.
config.server = config.server || {};
const previousEnhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const wrapped = (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    return middleware(req, res, next);
  };
  return previousEnhanceMiddleware ? previousEnhanceMiddleware(wrapped, server) : wrapped;
};

module.exports = config;
