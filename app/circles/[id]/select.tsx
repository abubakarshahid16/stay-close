/**
 * Add People screen.
 *
 * On iOS/Android, this reads the device's native contacts (never uploaded —
 * everything stays on-device). Web has no such API, so there it's a simple
 * manual "type a name" form instead — same result, works everywhere.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useDatabase } from '../../../src/context/DatabaseContext';
import { ContactService } from '../../../src/services/ContactService';
import { CirclePeopleRepository } from '../../../src/db/repositories/CirclePeopleRepository';
import { LoadingView } from '../../../src/components/LoadingView';
import type { DeviceContact } from '../../../src/types/contact';
import type { CirclePerson } from '../../../src/types/circle';

const IS_WEB = Platform.OS === 'web';

function genLocalId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `manual-${crypto.randomUUID()}`;
    }
  } catch {
    // fall through
  }
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function SelectContactScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db } = useDatabase();
  const circleId = Number(id);

  // Guard: invalid route param
  if (!id || isNaN(circleId)) {
    router.back();
    return null;
  }

  if (IS_WEB) {
    return <ManualAddScreen circleId={circleId} />;
  }

  return <DeviceContactsScreen circleId={circleId} />;
}

/** Web: no contacts API exists, so people are added by typing a name. */
function ManualAddScreen({ circleId }: { circleId: number }) {
  const { db } = useDatabase();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [added, setAdded] = useState<CirclePerson[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!db) return;
      const repo = new CirclePeopleRepository(db);
      const existing = await repo.findByCircleId(circleId);
      setAdded(existing);
      setIsLoading(false);
    })();
  }, [db, circleId]);

  const handleAdd = useCallback(async () => {
    if (!db) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setIsBusy(true);
    try {
      const repo = new CirclePeopleRepository(db);
      const person = await repo.add({
        circleId,
        contactIdentifier: genLocalId(),
        displayName: trimmed,
        phoneNumber: phone.trim() || null,
      });
      setAdded((prev) => [...prev, person].sort((a, b) => a.displayName.localeCompare(b.displayName)));
      setName('');
      setPhone('');
    } catch {
      Alert.alert('Error', 'Could not add this person.');
    } finally {
      setIsBusy(false);
    }
  }, [db, circleId, name, phone]);

  const handleRemove = useCallback(
    async (personId: number) => {
      if (!db) return;
      const repo = new CirclePeopleRepository(db);
      await repo.remove(personId);
      setAdded((prev) => prev.filter((p) => p.id !== personId));
    },
    [db]
  );

  if (isLoading) return <LoadingView />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor="#C7C7CC"
          accessibilityLabel="Person's name"
          testID="manual-name-input"
          returnKeyType="next"
        />
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="Phone number (optional)"
          placeholderTextColor="#C7C7CC"
          accessibilityLabel="Phone number"
          testID="manual-phone-input"
          keyboardType="phone-pad"
          returnKeyType="done"
          onSubmitEditing={handleAdd}
        />
        <TouchableOpacity
          style={[styles.addButton, (!name.trim() || isBusy) && styles.buttonDisabled]}
          onPress={handleAdd}
          disabled={!name.trim() || isBusy}
          accessibilityRole="button"
          accessibilityLabel="Add person"
          testID="manual-add-button"
        >
          <Text style={styles.addButtonText}>{isBusy ? 'Adding…' : 'Add Person'}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={added}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.contactRow}>
            <View style={styles.contactInfo}>
              <Text style={styles.contactName}>{item.displayName}</Text>
              {item.phoneNumber ? (
                <Text style={styles.contactPhone}>{item.phoneNumber}</Text>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={() => handleRemove(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.displayName}`}
              testID={`remove-person-${item.id}`}
            >
              <Text style={styles.removeLabel}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty} testID="manual-empty">
            <Text style={styles.emptyText}>No one added yet — type a name above.</Text>
          </View>
        }
      />

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.doneButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Done adding people"
          testID="done-button"
        >
          <Text style={styles.doneButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/** iOS/Android: read the device's native contact list. */
function DeviceContactsScreen({ circleId }: { circleId: number }) {
  const { db } = useDatabase();
  const [contacts, setContacts] = useState<DeviceContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    (async () => {
      const service = new ContactService();
      const status = await service.requestPermission();
      if (!status.granted) {
        setPermissionDenied(true);
        setIsLoading(false);
        return;
      }
      const loaded = await service.loadContacts();
      setContacts(loaded);
      setIsLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phoneNumbers?.some((p) => p.number?.includes(q))
    );
  }, [contacts, search]);

  const handleAdd = useCallback(
    async (contact: DeviceContact) => {
      if (!db) return;
      const repo = new CirclePeopleRepository(db);
      const primaryPhone = contact.phoneNumbers?.[0]?.number ?? null;
      try {
        await repo.add({
          circleId,
          contactIdentifier: contact.id,
          displayName: contact.name,
          phoneNumber: primaryPhone,
        });
        setAddedIds((prev) => new Set([...prev, contact.id]));
      } catch (err: unknown) {
        // Already in circle — ignore duplicate errors silently
        const msg = err instanceof Error ? err.message : '';
        if (!msg.toLowerCase().includes('unique')) {
          Alert.alert('Error', 'Could not add this person.');
        } else {
          setAddedIds((prev) => new Set([...prev, contact.id]));
        }
      }
    },
    [db, circleId]
  );

  if (isLoading) return <LoadingView />;

  if (permissionDenied) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.permission} testID="permission-denied">
          <Text style={styles.permTitle}>Contacts Access Needed</Text>
          <Text style={styles.permBody}>
            Stay Close needs access to your contacts to let you choose who to add to a circle.
            Your contacts are never uploaded — they stay on your device.
          </Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search contacts…"
        placeholderTextColor="#C7C7CC"
        accessibilityLabel="Search contacts"
        testID="contact-search"
        clearButtonMode="while-editing"
      />

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const added = addedIds.has(item.id);
          return (
            <TouchableOpacity
              style={[styles.contactRow, added && styles.contactRowAdded]}
              onPress={() => !added && handleAdd(item)}
              disabled={added}
              accessibilityRole="button"
              accessibilityState={{ disabled: added }}
              accessibilityLabel={added ? `${item.name}, added` : `Add ${item.name}`}
              testID={`contact-row-${item.id}`}
            >
              <View style={styles.contactInfo}>
                <Text style={styles.contactName}>{item.name}</Text>
                {item.phoneNumbers?.[0]?.number && (
                  <Text style={styles.contactPhone}>{item.phoneNumbers[0].number}</Text>
                )}
              </View>
              <Text style={[styles.addLabel, added && styles.addedLabel]}>
                {added ? 'Added ✓' : 'Add'}
              </Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty} testID="contacts-empty">
            <Text style={styles.emptyText}>No contacts found</Text>
          </View>
        }
      />

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.doneButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Done adding people"
          testID="done-button"
        >
          <Text style={styles.doneButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F9F9F9',
  },
  form: {
    padding: 16,
    gap: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  input: {
    backgroundColor: '#F9F9F9',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  addButton: {
    backgroundColor: '#4A90E2',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  removeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FF3B30',
  },
  search: {
    backgroundColor: '#fff',
    borderRadius: 10,
    margin: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    gap: 8,
  },
  contactRow: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  contactRowAdded: {
    backgroundColor: '#F0FFF4',
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1A1A1A',
  },
  contactPhone: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
  },
  addLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4A90E2',
  },
  addedLabel: {
    color: '#34C759',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  footer: {
    padding: 16,
    paddingBottom: 28,
  },
  doneButton: {
    backgroundColor: '#4A90E2',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  doneButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  permission: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  permTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 12,
    textAlign: 'center',
  },
  permBody: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  backButton: {
    backgroundColor: '#4A90E2',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
