// Mock for expo-contacts

export const PermissionStatus = {
  GRANTED: 'granted',
  DENIED: 'denied',
  UNDETERMINED: 'undetermined',
  RESTRICTED: 'restricted',
} as const;

export const requestPermissionsAsync = jest.fn().mockResolvedValue({
  status: 'granted',
  granted: true,
});

export const getPermissionsAsync = jest.fn().mockResolvedValue({
  status: 'granted',
  granted: true,
});

export const getContactsAsync = jest.fn().mockResolvedValue({
  data: [],
  hasNextPage: false,
  hasPreviousPage: false,
});

export const getContactByIdAsync = jest.fn().mockResolvedValue(null);

export const Fields = {
  ID: 'id',
  Name: 'name',
  PhoneNumbers: 'phoneNumbers',
  Image: 'image',
  ImageAvailable: 'imageAvailable',
} as const;

export const SortTypes = {
  FirstName: 'firstName',
  LastName: 'lastName',
  UserDefault: 'userDefault',
} as const;

export default {
  PermissionStatus,
  requestPermissionsAsync,
  getPermissionsAsync,
  getContactsAsync,
  getContactByIdAsync,
  Fields,
  SortTypes,
};
