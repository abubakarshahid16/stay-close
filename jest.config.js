/**
 * Two projects, split by what they require to run.
 *
 * `unit`     — domain, application and simulation suites. Zero platform and
 *              zero native dependencies, so they run anywhere (docs/ARCHITECTURE.md §7).
 * `adapters` — persistence and platform adapter suites. These need a native
 *              SQLite build (better-sqlite3), which is an optionalDependency
 *              because it requires an MSVC toolchain on Windows. Contributors
 *              without one can still run the suites that matter.
 */
const shared = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': ['babel-jest', { configFile: './babel.config.js' }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: [
        '<rootDir>/__tests__/domain/**/*.test.ts',
        '<rootDir>/__tests__/app/**/*.test.ts',
        '<rootDir>/__tests__/simulation/**/*.test.ts',
      ],
    },
    {
      ...shared,
      displayName: 'adapters',
      testMatch: ['<rootDir>/__tests__/adapters/**/*.test.ts'],
    },
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/testing/**'],
  coverageReporters: ['text', 'lcov'],
  testTimeout: 15000,
};
