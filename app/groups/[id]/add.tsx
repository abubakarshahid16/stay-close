/**
 * Add people to a group from the device address book.
 *
 * Two states need real care:
 *
 * - **Permission denied.** The app must explain and keep working, never dead-end
 *   (docs/DOMAIN.md §2.1).
 * - **Limited access (iOS 18).** The OS reports `granted` while exposing only a
 *   chosen subset. Presenting that as the whole address book would look like the
 *   app losing contacts, so it is called out explicitly
 *   (docs/PLATFORM.md §1.2).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, TextInput, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useContainer } from '../../../src/ui/AppContext';
import {
  Body,
  Button,
  Divider,
  Heading,
  ListRow,
  Loading,
  Screen,
  Spacer,
} from '../../../src/ui/basics';
import { ManualPersonForm } from '../../../src/ui/ManualPersonForm';
import type { ContactPermissionState, ResolvedContact } from '../../../src/ports/ContactProvider';
import { groupId as toGroupId } from '../../../src/domain/shared/ids';
import { isErr } from '../../../src/domain/shared/Result';

export default function AddPeopleScreen() {
  const app = useContainer();
  const params = useLocalSearchParams<{ id: string }>();
  const id = toGroupId(Number(params.id));

  const [permission, setPermission] = useState<ContactPermissionState | null>(null);
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [candidates, setCandidates] = useState<readonly ResolvedContact[]>([]);
  const [alreadyIn, setAlreadyIn] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const current = await app.contactsProvider.permission();
    setPermission(current.state);
    setCanAskAgain(current.canAskAgain);

    if (current.state !== 'granted' && current.state !== 'limited') {
      setCandidates([]);
      return;
    }

    setCandidates(await app.contactsProvider.list());

    // Existing members, keyed by normalised number so re-adding is visible as
    // already-added rather than silently doing nothing.
    const memberships = await app.groups.listMembers(id);
    const numbers = new Set<string>();
    for (const membership of memberships) {
      const contact = await app.uow.repositories.contacts.findById(membership.contactReferenceId);
      if (contact) numbers.add(contact.phoneE164);
    }
    setAlreadyIn(numbers);
  }, [app, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const usable = candidates.filter((c) => c.phones.some((p) => p.e164 !== null));
    if (!q) return usable;
    return usable.filter((c) => c.displayName.toLowerCase().includes(q));
  }, [candidates, query]);

  async function request() {
    const result = await app.contactsProvider.request();
    setPermission(result.state);
    setCanAskAgain(result.canAskAgain);
    if (result.state === 'granted' || result.state === 'limited') await load();
  }

  async function add(contact: ResolvedContact) {
    const e164 = contact.phones.find((p) => p.e164 !== null)?.e164;
    if (!e164) return;

    setBusy(true);
    try {
      const result = await app.groups.addMember(id, {
        phoneE164: e164,
        displayName: contact.displayName,
        nativeId: contact.nativeId,
      });
      if (isErr(result)) {
        Alert.alert('Could not add', result.error.detail);
        return;
      }
      setAlreadyIn((previous) => new Set([...previous, e164]));
    } finally {
      setBusy(false);
    }
  }

  async function addManually(input: { displayName: string; phoneE164: string }) {
    const result = await app.groups.addMember(id, { ...input, nativeId: null });
    if (isErr(result)) return result.error.detail;
    setAlreadyIn((previous) => new Set([...previous, input.phoneE164]));
    return null;
  }

  if (permission === null) return <Loading label="Checking contacts access" />;

  if (permission !== 'granted' && permission !== 'limited') {
    // 'unavailable' means the platform has no address book at all (web). The
    // others mean the user declined. Both must offer manual entry rather than
    // dead-ending.
    const noAddressBook = permission === 'unavailable';
    const terminal = permission === 'restricted' || !canAskAgain;

    return (
      <Screen>
        <Heading>Add people</Heading>

        {noAddressBook ? (
          <Body>
            This browser has no address book for Stay Close to read, so people are added by hand
            here. On a phone you can pick them straight from your contacts.
          </Body>
        ) : (
          <>
            <Body>
              Stay Close can read your address book so you can pick people from it. Your contacts
              never leave this device — there is no account and no server.
            </Body>
            <Spacer />
            {terminal ? (
              <Body dim>
                Contacts access is turned off for Stay Close. You can change it in your device
                Settings, or add people by hand below.
              </Body>
            ) : (
              <Button label="Allow contacts" variant="primary" onPress={() => void request()} />
            )}
          </>
        )}

        <Spacer />
        <ManualPersonForm onAdd={addManually} busy={busy} />

        <Spacer />
        <Button
          label="Done"
          variant="quiet"
          onPress={() => router.replace(`/groups/${params.id}`)}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Heading>Add people</Heading>

      {permission === 'limited' ? (
        <Body dim>
          You have shared only some contacts with Stay Close, so this list is not your whole
          address book. You can share more in your device Settings.
        </Body>
      ) : null}

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search contacts"
        accessibilityLabel="Search contacts"
        style={styles.input}
        autoCorrect={false}
      />

      {filtered.length === 0 ? (
        <Body dim>
          {candidates.length === 0
            ? 'No contacts with a usable phone number were found.'
            : 'No contacts match that search.'}
        </Body>
      ) : (
        filtered.map((contact) => {
          const e164 = contact.phones.find((p) => p.e164 !== null)?.e164 as string;
          const added = alreadyIn.has(e164);
          return (
            <React.Fragment key={contact.nativeId}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <ListRow title={contact.displayName} subtitle={e164} />
                </View>
                <Button
                  label={added ? 'Added' : 'Add'}
                  variant={added ? 'quiet' : 'default'}
                  disabled={added || busy}
                  onPress={() => void add(contact)}
                />
              </View>
              <Divider />
            </React.Fragment>
          );
        })
      )}

      <Spacer />
      <Button label="Done" variant="primary" onPress={() => router.replace(`/groups/${params.id}`)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 6,
    paddingHorizontal: 12,
    fontSize: 16,
  },
});
