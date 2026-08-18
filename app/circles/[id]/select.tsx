/**
 * Contact selection screen — search contacts, tap to add to circle.
 * Contacts are loaded from the device; only name + phone are used.
 * No contacts are uploaded anywhere.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
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

export default function SelectContactScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db } = useDatabase();
  const circleId = Number(id);

  // Guard: invalid route param
  if (!id || isNaN(circleId)) {
    router.back();
    return null;
  }

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
