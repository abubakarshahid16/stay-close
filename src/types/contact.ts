export type ContactPermissionStatus = 'granted' | 'denied' | 'undetermined' | 'restricted';

export interface DeviceContact {
  id: string;
  name: string;
  phoneNumbers: PhoneNumber[];
}

export interface PhoneNumber {
  number: string;
  label?: string;
}

export interface ContactPermissionResult {
  status: ContactPermissionStatus;
  granted: boolean;
}
