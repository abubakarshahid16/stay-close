// Mock for expo-file-system

export const documentDirectory = 'file:///mock-documents/';
export const cacheDirectory = 'file:///mock-cache/';

export const readAsStringAsync = jest.fn().mockResolvedValue('{}');
export const writeAsStringAsync = jest.fn().mockResolvedValue(undefined);
export const deleteAsync = jest.fn().mockResolvedValue(undefined);
export const getInfoAsync = jest.fn().mockResolvedValue({ exists: false, isDirectory: false });
export const makeDirectoryAsync = jest.fn().mockResolvedValue(undefined);
export const copyAsync = jest.fn().mockResolvedValue(undefined);
export const moveAsync = jest.fn().mockResolvedValue(undefined);

export const EncodingType = {
  UTF8: 'utf8',
  Base64: 'base64',
} as const;

export default {
  documentDirectory,
  cacheDirectory,
  readAsStringAsync,
  writeAsStringAsync,
  deleteAsync,
  getInfoAsync,
  makeDirectoryAsync,
  copyAsync,
  moveAsync,
  EncodingType,
};
