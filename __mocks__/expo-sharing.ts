// Mock for expo-sharing

export const isAvailableAsync = jest.fn().mockResolvedValue(true);
export const shareAsync = jest.fn().mockResolvedValue(undefined);

export default {
  isAvailableAsync,
  shareAsync,
};
