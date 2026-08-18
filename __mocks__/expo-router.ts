// Mock for expo-router

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  dismiss: jest.fn(),
  dismissAll: jest.fn(),
};

export const useRouter = jest.fn(() => mockRouter);
export const useLocalSearchParams = jest.fn(() => ({}));
export const useSegments = jest.fn(() => []);
export const usePathname = jest.fn(() => '/');
export const useFocusEffect = jest.fn();
export const Redirect = () => null;

export const router = mockRouter;

export const Link = ({ children }: { children: React.ReactNode }) => children;

export const Stack = {
  Screen: () => null,
};

export const Tabs = {
  Screen: () => null,
};

export const Slot = () => null;

export default {
  useFocusEffect,
  Redirect,
  useRouter,
  useLocalSearchParams,
  useSegments,
  usePathname,
  router,
  Link,
  Stack,
  Tabs,
  Slot,
};
