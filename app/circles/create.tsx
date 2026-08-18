/**
 * Create Circle screen — modal for naming a circle and choosing reminder frequency.
 */
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useDatabase } from '../../src/context/DatabaseContext';
import { CircleRepository } from '../../src/db/repositories/CircleRepository';
import { REMINDER_FREQUENCY_LABELS } from '../../src/types/circle';
import type { ReminderFrequency } from '../../src/types/circle';

const FREQUENCIES: ReminderFrequency[] = [
  'daily',
  'every_3_days',
  'weekly',
  'every_2_weeks',
  'monthly',
];

export default function CreateCircleScreen() {
  const { db } = useDatabase();
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<ReminderFrequency>('weekly');
  const [isSaving, setIsSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Circle name is required');
      return;
    }
    if (trimmedName.length > 100) {
      setNameError('Name must be 100 characters or fewer');
      return;
    }
    setNameError('');

    if (!db) return;
    setIsSaving(true);
    try {
      const repo = new CircleRepository(db);
      await repo.create({ name: trimmedName, reminderFrequency: frequency });
      router.back();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not create circle.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Circle Name</Text>
          <TextInput
            style={[styles.input, nameError ? styles.inputError : null]}
            value={name}
            onChangeText={(t) => { setName(t); setNameError(''); }}
            placeholder="e.g. Family, Close Friends, Work"
            placeholderTextColor="#C7C7CC"
            maxLength={100}
            returnKeyType="done"
            accessibilityLabel="Circle name"
            accessibilityHint="Enter a name for this circle"
            testID="circle-name-input"
            autoFocus
          />
          {nameError ? (
            <Text style={styles.errorText} accessibilityRole="alert">{nameError}</Text>
          ) : null}

          <Text style={styles.label}>Reminder Frequency</Text>
          <View style={styles.frequencies} testID="frequency-picker">
            {FREQUENCIES.map((freq) => (
              <TouchableOpacity
                key={freq}
                style={[styles.freqOption, freq === frequency && styles.freqSelected]}
                onPress={() => setFrequency(freq)}
                accessibilityRole="radio"
                accessibilityState={{ selected: freq === frequency }}
                accessibilityLabel={REMINDER_FREQUENCY_LABELS[freq]}
                testID={`freq-option-${freq}`}
              >
                <Text
                  style={[
                    styles.freqText,
                    freq === frequency && styles.freqTextSelected,
                  ]}
                >
                  {REMINDER_FREQUENCY_LABELS[freq]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.createButton, isSaving && styles.buttonDisabled]}
            onPress={handleCreate}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel="Create circle"
            accessibilityState={{ disabled: isSaving }}
            testID="create-circle-button"
          >
            <Text style={styles.createButtonText}>
              {isSaving ? 'Creating…' : 'Create Circle'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F9F9F9',
  },
  content: {
    padding: 24,
    paddingTop: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 20,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    fontSize: 17,
    color: '#1A1A1A',
    borderWidth: 1.5,
    borderColor: '#E5E5EA',
  },
  inputError: {
    borderColor: '#FF3B30',
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 13,
    marginTop: 6,
  },
  frequencies: {
    gap: 8,
  },
  freqOption: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: '#E5E5EA',
  },
  freqSelected: {
    borderColor: '#4A90E2',
    backgroundColor: '#EBF4FF',
  },
  freqText: {
    fontSize: 16,
    color: '#1A1A1A',
  },
  freqTextSelected: {
    color: '#4A90E2',
    fontWeight: '600',
  },
  createButton: {
    backgroundColor: '#4A90E2',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 32,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
});
