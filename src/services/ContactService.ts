import * as ExpoContacts from 'expo-contacts';
import type { DeviceContact, ContactPermissionResult } from '../types/contact';

export class ContactService {
  async getPermissionStatus(): Promise<ContactPermissionResult> {
    const result = await ExpoContacts.getPermissionsAsync();
    return {
      status: result.status as ContactPermissionResult['status'],
      granted: result.granted,
    };
  }

  async requestPermission(): Promise<ContactPermissionResult> {
    const result = await ExpoContacts.requestPermissionsAsync();
    return {
      status: result.status as ContactPermissionResult['status'],
      granted: result.granted,
    };
  }

  async loadContacts(): Promise<DeviceContact[]> {
    const permission = await this.getPermissionStatus();
    if (!permission.granted) {
      return [];
    }

    const { data } = await ExpoContacts.getContactsAsync({
      fields: [
        ExpoContacts.Fields.Name,
        ExpoContacts.Fields.PhoneNumbers,
      ],
      sort: ExpoContacts.SortTypes.FirstName,
    });

    return data
      .filter((c) => c.id && c.name && c.name.trim().length > 0)
      .map((c) => ({
        id: c.id as string,
        name: c.name as string,
        phoneNumbers: (c.phoneNumbers ?? [])
          .filter((p) => p.number && p.number.trim().length > 0)
          .map((p) => ({
            number: p.number as string,
            label: p.label,
          })),
      }));
  }

  async refreshContact(contactId: string): Promise<DeviceContact | null> {
    try {
      const contact = await ExpoContacts.getContactByIdAsync(contactId, [
        ExpoContacts.Fields.Name,
        ExpoContacts.Fields.PhoneNumbers,
      ]);

      if (!contact || !contact.id || !contact.name) return null;

      return {
        id: contact.id,
        name: contact.name,
        phoneNumbers: (contact.phoneNumbers ?? [])
          .filter((p) => p.number && p.number.trim().length > 0)
          .map((p) => ({
            number: p.number as string,
            label: p.label,
          })),
      };
    } catch {
      return null;
    }
  }

  filterContacts(contacts: DeviceContact[], query: string): DeviceContact[] {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(q));
  }
}

export const contactService = new ContactService();
