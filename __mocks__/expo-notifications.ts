// Mock for expo-notifications

export const requestPermissionsAsync = jest.fn().mockResolvedValue({
  status: 'granted',
  granted: true,
});

export const getPermissionsAsync = jest.fn().mockResolvedValue({
  status: 'granted',
  granted: true,
});

export const scheduleNotificationAsync = jest.fn().mockResolvedValue('mock-notification-id');

export const cancelScheduledNotificationAsync = jest.fn().mockResolvedValue(undefined);

export const cancelAllScheduledNotificationsAsync = jest.fn().mockResolvedValue(undefined);

export const getAllScheduledNotificationsAsync = jest.fn().mockResolvedValue([]);

export const setNotificationHandler = jest.fn();

export const addNotificationReceivedListener = jest.fn().mockReturnValue({
  remove: jest.fn(),
});

export const addNotificationResponseReceivedListener = jest.fn().mockReturnValue({
  remove: jest.fn(),
});

export const removeNotificationSubscription = jest.fn();

export const SchedulableTriggerInputTypes = {
  TIME_INTERVAL: 'timeInterval',
  CALENDAR: 'calendar',
  DAILY: 'daily',
  WEEKLY: 'weekly',
} as const;

export const AndroidImportance = {
  DEFAULT: 3,
  HIGH: 4,
  MAX: 5,
} as const;

export const setNotificationCategoryAsync = jest.fn().mockResolvedValue(undefined);

export default {
  requestPermissionsAsync,
  getPermissionsAsync,
  scheduleNotificationAsync,
  cancelScheduledNotificationAsync,
  cancelAllScheduledNotificationsAsync,
  getAllScheduledNotificationsAsync,
  setNotificationHandler,
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
  removeNotificationSubscription,
  SchedulableTriggerInputTypes,
  AndroidImportance,
  setNotificationCategoryAsync,
};
