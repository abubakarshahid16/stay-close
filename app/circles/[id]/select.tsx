/**
 * Add People screen — pick people from device contacts (iOS/Android),
 * or add someone manually (all platforms, and the only path on web or
 * when contact permission is declined).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDatabase } from '../../../src/context/DatabaseContext';
import { CirclePeopleRepository } from '../../../src/db/repositories/CirclePeopleRepository';
import { contactService } from '../../../src/services/ContactService';
import { LoadingView } from '../../../src/components/LoadingView';
import type { DeviceContact } from '../../../src/types/contact';
import { showAlert } from '../../../src/utils/dialogs';

type PermissionState = 'unknown' | 'granted' | 'denied' | 'unavailable';

let manualIdCounter = 0;
function manualIdentifier(): string {
  manualIdCounter += 1;
  return `manual-${Date.now()}-${manualIdCounter}`;
}

export default function AddPeopleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const circleId = Number(id);
  const { db, isReady } = useDatabase();

  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [contacts, setContacts] = useState<DeviceContact[]>([]);
  const [existingIdentifiers, setExistingIdentifiers] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Manual entry state
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  const loadExisting = useCallback(async () => {
    if (!db || !Number.isFinite(circleId)) return;
    const identifiers = await new CirclePeopleRepository(db).getAllContactIdentifiersForCircle(
      circleId
    );
    setExistingIdentifiers(new Set(identifiers));
  }, [db, circleId]);

  const loadContacts = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!contactService.isAvailable()) {
        setPermission('unavailable');
        return;
      }
      const status = await contactService.getPermissionStatus();
      if (!status.granted) {
        setPermission('denied');
        return;
      }
      setPermission('granted');
      setContacts(await contactService.loadContacts());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isReady) {
      loadExisting();
      loadContacts();
    }
  }, [isReady, loadExisting, loadContacts]);

  const requestPermission = useCallback(async () => {
    const result = await contactService.requestPermission();
    if (result.granted) {
      setPermission('granted');
      setIsLoading(true);
      try {
        setContacts(await contactService.loadContacts());
      } finally {
        setIsLoading(false);
      }
    } else {
      setPermission(contactService.isAvailable() ? 'denied' : 'unavailable');
    }
  }, []);

  const filtered = useMemo(
    () => contactService.filterContacts(contacts, query),
    [contacts, query]
  );

  const toggleContact = useCallback((contactId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  }, []);

  const addSelected = useCallback(async () => {
    if (!db || selectedIds.size === 0 || isSaving) return;
    setIsSaving(true);
    try {
      const repo = new CirclePeopleRepository(db);
      for (const contactId of selectedIds) {
        const contact = contacts.find((c) => c.id === contactId);
        if (!contact || existingIdentifiers.has(contact.id)) continue;
        await repo.add({
          circleId,
          contactIdentifier: contact.id,
          displayName: contact.name,
          phoneNumber: contact.phoneNumbers[0]?.number ?? null,
        });
      }
      router.back();
    } catch (err) {
      showAlert('Could not add people', err instanceof Error ? err.message : undefined);
    } finally {
      setIsSaving(false);
    }
  }, [db, selectedIds, isSaving, contacts, existingIdentifiers, circleId]);

  const addManual = useCallback(async () => {
    const name = manualName.trim();
    if (!name) {
      setManualError('Name is required');
      return;
    }
    if (!db || isSaving) return;
    setManualError(null);
    setIsSaving(true);
    try {
      await new CirclePeopleRepository(db).add({
        circleId,
        contactIdentifier: manualIdentifier(),
        displayName: name,
        phoneNumber: manualPhone.trim() || null,
      });
      setManualName('');
      setManualPhone('');
      setAddedCount((count) => count + 1);
      await loadExisting();
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Could not add person');
    } finally {
      setIsSaving(false);
    }
  }, [db, isSaving, manualName, manualPhone, circleId, loadExisting]);

  if (!isReady || isLoading) return <LoadingView />;

  const manualSection = (
    <View style={styles.manualCard} testID="manual-add-section">
      <Text style={styles.manualTitle}>Add someone manually</Text>
      <TextInput
        style={styles.input}
        value={manualName}
        onChangeText={(value) => {
          setManualName(value);
          if (manualError) setManualError(null);
        }}
        placeholder="Name"
        placeholderTextColor="#A8A5B8"
        accessibilityLabel="Person name"
        testID="manual-name-input"
      />
      <TextInput
        style={styles.input}
        value={manualPhone}
        onChangeText={setManualPhone}
        placeholder="Phone (optional)"
        placeholderTextColor="#A8A5B8"
        keyboardType="phone-pad"
        accessibilityLabel="Person phone number"
        testID="manual-phone-input"
      />
      {manualError && (
        <Text style={styles.error} accessibilityRole="alert" testID="manual-add-error">
          {manualError}
        </Text>
      )}
      <TouchableOpacity
        style={[styles.secondaryButton, isSaving && styles.disabled]}
        onPress={addManual}
        disabled={isSaving}
        accessibilityRole="button"
        accessibilityLabel="Add person"
        testID="manual-add-button"
      >
        <Text style={styles.secondaryButtonText}>Add Person</Text>
      </TouchableOpacity>
      {addedCount > 0 && (
        <Text style={styles.addedNote} testID="manual-added-note">
          {addedCount} {addedCount === 1 ? 'person' : 'people'} added
        </Text>
      )}
    </View>
  );

  // Contacts unavailable (web) or permission denied → manual entry only
  if (permission !== 'granted') {
    return (
      <View style={styles.safe}>
        <FlatList
          data={[]}
          renderItem={null}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              <View style={styles.noticeCard} testID="contacts-unavailable-notice">
                <Text style={styles.noticeTitle}>
                  {permission === 'unavailable'
                    ? 'Contact picker is not available in the browser'
                    : 'Contacts permission not granted'}
                </Text>
                <Text style={styles.noticeBody}>
                  {permission === 'unavailable'
                    ? 'You can still add people manually below. On the Android app you can pick straight from your contacts.'
                    : 'Allow contact access to pick people from your address book, or add them manually below.'}
                </Text>
                {permission === 'denied' && (
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={requestPermission}
                    accessibilityRole="button"
                    accessibilityLabel="Allow contacts access"
                    testID="allow-contacts-button"
                  >
                    <Text style={styles.primaryButtonText}>Allow Contacts</Text>
                  </TouchableOpacity>
                )}
              </View>
              {manualSection}
              <TouchableOpacity
                style={styles.doneLink}
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Done adding people"
                testID="done-button"
              >
                <Text style={styles.doneLinkText}>Done</Text>
              </TouchableOpacity>
            </View>
          }
        />
      </View>
    );
  }

  return (
    <View style={styles.safe}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Search contacts…"
              placeholderTextColor="#A8A5B8"
              accessibilityLabel="Search contacts"
              testID="contact-search-input"
            />
            {filtered.length === 0 && (
              <Text style={styles.emptyText} testID="no-contacts">
                {contacts.length === 0
                  ? 'No contacts found on this device.'
                  : 'No contacts match your search.'}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const alreadyAdded = existingIdentifiers.has(item.id);
          const selected = selectedIds.has(item.id);
          return (
            <TouchableOpacity
              style={[styles.contactRow, selected && styles.contactRowSelected]}
              onPress={() => !alreadyAdded && toggleContact(item.id)}
              disabled={alreadyAdded}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected, disabled: alreadyAdded }}
              accessibilityLabel={item.name}
              testID={`contact-row-${item.id}`}
            >
              <View style={styles.contactInfo}>
                <Text style={[styles.contactName, alreadyAdded && styles.contactNameMuted]}>
                  {item.name}
                </Text>
                {item.phoneNumbers[0] && (
                  <Text style={styles.contactPhone}>{item.phoneNumbers[0].number}</Text>
                )}
              </View>
              <Text style={styles.contactMark}>
                {alreadyAdded ? 'Added' : selected ? '✓' : ''}
              </Text>
            </TouchableOpacity>
          );
        }}
        ListFooterComponent={manualSection}
      />
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            (selectedIds.size === 0 || isSaving) && styles.disabled,
          ]}
          onPress={addSelected}
          disabled={selectedIds.size === 0 || isSaving}
          accessibilityRole="button"
          accessibilityLabel={`Add ${selectedIds.size} selected people`}
          testID="add-selected-button"
        >
          <Text style={styles.primaryButtonText}>
            {isSaving
              ? 'Adding…'
              : selectedIds.size > 0
                ? `Add ${selectedIds.size} ${selectedIds.size === 1 ? 'Person' : 'People'}`
                : 'Select people to add'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F7F6FB',
  },
  content: {
    padding: 20,
    paddingBottom: 24,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9E7F2',
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1E1B2E',
    marginBottom: 10,
  },
  emptyText: {
    color: '#6B6880',
    fontSize: 15,
    marginTop: 12,
    textAlign: 'center',
  },
  contactRow: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
    padding: 14,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  contactRowSelected: {
    borderColor: '#7C3AED',
    backgroundColor: '#F1EBFE',
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1E1B2E',
  },
  contactNameMuted: {
    color: '#A8A5B8',
  },
  contactPhone: {
    fontSize: 13,
    color: '#6B6880',
    marginTop: 2,
  },
  contactMark: {
    fontSize: 15,
    fontWeight: '600',
    color: '#7C3AED',
    marginLeft: 8,
  },
  footer: {
    padding: 16,
    borderTopWidth: 0.5,
    borderTopColor: '#E9E7F2',
    backgroundColor: '#F7F6FB',
  },
  primaryButton: {
    backgroundColor: '#7C3AED',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#7C3AED',
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  secondaryButtonText: {
    color: '#7C3AED',
    fontSize: 15,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  noticeCard: {
    backgroundColor: '#FFF8E6',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  noticeTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#8a6d1a',
    marginBottom: 6,
  },
  noticeBody: {
    fontSize: 14,
    color: '#6b5a20',
    lineHeight: 20,
  },
  manualCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
  },
  manualTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E1B2E',
    marginBottom: 12,
  },
  error: {
    color: '#EF4444',
    fontSize: 14,
    marginBottom: 8,
  },
  addedNote: {
    color: '#10B981',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 10,
    textAlign: 'center',
  },
  doneLink: {
    alignItems: 'center',
    paddingVertical: 18,
  },
  doneLinkText: {
    color: '#7C3AED',
    fontSize: 16,
    fontWeight: '600',
  },
});
