const { getDefaultConfig } = require('expo/metro-config');

// Default Expo config. The previous product carried a .wasm asset rule for the
// expo-sqlite web engine; web is not a V1 target (docs/PRODUCT.md §7), so that
// rule is gone.
module.exports = getDefaultConfig(__dirname);
