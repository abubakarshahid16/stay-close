/**
 * Manual person entry.
 *
 * The only way to add someone on web, where no address-book API exists
 * (WebContactProvider). Also the fallback on a phone when the user declines
 * contacts access but still wants to use the app — declining a permission
 * should not be a dead end (docs/DOMAIN.md §2.1).
 *
 * A person added this way is indistinguishable downstream from one imported
 * from a device, because identity anchors on the normalised phone number rather
 * than a platform id (docs/DATABASE.md §2.1).
 */
import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Body, Button, ErrorText, Spacer, Subheading } from './basics';
import { normaliseToE164 } from '../domain/contact/phone';

const REASON_TEXT: Record<string, string> = {
  EMPTY: 'Enter a phone number.',
  TOO_SHORT: 'That number looks too short.',
  TOO_LONG: 'That number looks too long.',
  NOT_A_NUMBER: 'That does not look like a phone number.',
  NO_COUNTRY_CODE:
    'Include the country code, like +44 7700 900123 — otherwise we cannot tell which country it is.',
};

export function ManualPersonForm({
  defaultCallingCode,
  onAdd,
  busy = false,
}: {
  /** Region for national-format numbers. Undefined means require +country. */
  defaultCallingCode?: string;
  onAdd: (input: { displayName: string; phoneE164: string }) => Promise<string | null>;
  busy?: boolean;
}) {
  const [name, setName] = useState('');
  const [rawNumber, setRawNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);

  async function submit() {
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError('Enter a name.');
      return;
    }

    // Normalise before saving: the stored number is the identity key, so a
    // malformed one would create a duplicate person or a dead WhatsApp link.
    const normalised = normaliseToE164(rawNumber, defaultCallingCode);
    if (!normalised.ok) {
      setError(REASON_TEXT[normalised.reason] ?? 'That number could not be understood.');
      return;
    }

    const failure = await onAdd({ displayName: trimmedName, phoneE164: normalised.e164 });
    if (failure) {
      setError(failure);
      return;
    }

    setAdded((previous) => [...previous, trimmedName]);
    setName('');
    setRawNumber('');
  }

  return (
    <View>
      <Subheading>Add someone by hand</Subheading>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Name"
        accessibilityLabel="Person's name"
        style={styles.input}
        maxLength={100}
      />
      <Spacer size={8} />
      <TextInput
        value={rawNumber}
        onChangeText={setRawNumber}
        placeholder="Phone number, e.g. +44 7700 900123"
        accessibilityLabel="Phone number including country code"
        style={styles.input}
        keyboardType="phone-pad"
        autoCorrect={false}
      />

      {error ? <ErrorText>{error}</ErrorText> : null}

      <Spacer size={8} />
      <Button
        label={busy ? 'Adding…' : 'Add person'}
        variant="primary"
        disabled={busy || name.trim().length === 0 || rawNumber.trim().length === 0}
        onPress={() => void submit()}
      />

      {added.length > 0 ? (
        <>
          <Spacer size={8} />
          <Body dim>
            Added: {added.join(', ')}
          </Body>
        </>
      ) : null}
    </View>
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
