/**
 * Lint config.
 *
 * The `overrides` blocks mechanically enforce the layering rules in
 * docs/ARCHITECTURE.md §2.1. The previous product violated four of them — its
 * home screen ran selection, wrote history, and queried the database on every
 * render. Encoding the rules here is what stops that recurring.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'react-native'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  settings: { react: { version: 'detect' } },
  env: { 'react-native/react-native': true, es2022: true, node: true },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
  },
  overrides: [
    {
      // The domain is pure. It may not reach for the platform, the UI
      // framework, or any adapter. This is what keeps it testable in plain
      // Node with no device and no database.
      files: ['src/domain/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['expo', 'expo-*', 'expo/*'], message: 'Domain must not depend on Expo. Use a port in src/ports.' },
              { group: ['react', 'react-*', 'react-native', 'react-native-*'], message: 'Domain must not depend on React or React Native.' },
              { group: ['**/adapters/**'], message: 'Domain must not import adapters. Depend on a port instead.' },
              { group: ['**/app/**'], message: 'Domain must not import the application layer. Dependencies point inward.' },
            ],
          },
        ],
      },
    },
    {
      // The application layer orchestrates use cases. It may use ports and the
      // domain, but must not bind to a concrete platform adapter.
      files: ['src/app/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['expo', 'expo-*', 'expo/*'], message: 'Application layer must depend on ports, not Expo directly.' },
              { group: ['**/adapters/**'], message: 'Application layer must depend on ports, not concrete adapters.' },
            ],
          },
        ],
      },
    },
    {
      // Time and randomness are injected everywhere except the adapters that
      // provide them (docs/ARCHITECTURE.md §4.1, §4.2). A stray Date.now() in
      // the scheduler makes its tests untrustworthy.
      files: ['src/domain/**/*.ts', 'src/app/**/*.ts', 'app/**/*.tsx', 'app/**/*.ts'],
      rules: {
        'no-restricted-properties': [
          'error',
          { object: 'Date', property: 'now', message: 'Inject the Clock port instead of reading the system clock.' },
          { object: 'Math', property: 'random', message: 'Inject the Random port instead of calling Math.random().' },
        ],
        'no-restricted-syntax': [
          'error',
          {
            selector: "NewExpression[callee.name='Date'][arguments.length=0]",
            message: 'Inject the Clock port instead of constructing the current Date.',
          },
        ],
      },
    },
    {
      // Screens render and dispatch. They must not contain domain logic or
      // touch persistence — the specific mistake the old product made.
      files: ['app/**/*.tsx', 'app/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['**/adapters/persistence/**'], message: 'Screens must go through a use case, never a repository.' },
              { group: ['expo-sqlite'], message: 'Screens must not touch the database.' },
            ],
          },
        ],
      },
    },
    {
      // Test helpers and specs may construct fakes freely.
      files: ['__tests__/**/*.ts', 'src/testing/**/*.ts'],
      env: { jest: true },
      rules: {
        'no-restricted-properties': 'off',
        'no-restricted-syntax': 'off',
      },
    },
  ],
  ignorePatterns: [
    'node_modules/',
    'android/',
    'ios/',
    'dist/',
    'coverage/',
    '.expo/',
    'babel.config.js',
    'jest.config.js',
    'metro.config.js',
  ],
};
