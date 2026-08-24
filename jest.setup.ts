// Global Jest setup.
//
// Deliberately minimal. The domain, application and simulation suites have no
// platform dependencies at all (docs/ARCHITECTURE.md §7), so nothing needs
// mocking for them to run. Adapter suites mock the specific expo module they
// exercise, locally, in their own file — a global mock registry hides which
// test actually depends on which platform API.

// Keep test output readable without hiding errors.
global.console = {
  ...console,
  warn: jest.fn(),
};
