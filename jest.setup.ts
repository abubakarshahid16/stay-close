// Global Jest setup for Stay Close
// The __mocks__/ directory at project root is automatically used by Jest
// for manual mocks of node_modules — no factory function needed.

jest.mock('expo-sqlite');
jest.mock('expo-contacts');
jest.mock('expo-notifications');
jest.mock('expo-file-system');
jest.mock('expo-sharing');
jest.mock('expo-router');
jest.mock('expo-document-picker');

// Silence React Native warnings in tests
global.console = {
  ...console,
  warn: jest.fn(),
};
