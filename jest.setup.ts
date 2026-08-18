// Global Jest setup for Stay Close
// The __mocks__/ directory at project root is automatically used by Jest
// for manual mocks of node_modules — no factory function needed.

jest.mock('expo-sqlite');
jest.mock('expo-contacts');
jest.mock('expo-notifications');
jest.mock('expo-file-system');
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///mock-documents/',
  cacheDirectory: 'file:///mock-cache/',
  readAsStringAsync: jest.fn().mockResolvedValue('{}'),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false, isDirectory: false }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
}));
jest.mock('expo-sharing');
jest.mock('expo-router');

// Silence React Native warnings in tests
global.console = {
  ...console,
  warn: jest.fn(),
};
