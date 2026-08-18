// Mock for expo-document-picker

export const getDocumentAsync = jest.fn().mockResolvedValue({
  canceled: true,
  assets: [],
});

export default {
  getDocumentAsync,
};
