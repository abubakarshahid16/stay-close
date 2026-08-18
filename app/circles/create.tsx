/**
 * Create Circle screen — name + reminder frequency, then straight into
 * adding people. Presented as a modal from Home/Circles.
 */
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
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
import { notificationService } from '../../src/services/NotificationService';
import {
  REMINDER_FREQUENCIES,
  REMINDER_FREQUENCY_LABELS,
} from '../../src/types/circle';
import type { ReminderFrequency } from '../../src/types/circle';
import { MAX_CIRCLE_NAME_LENGTH } from '../../src/utils/validation';

export default function CreateCircleScreen() {
  const { db } = useDatabase();
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<ReminderFrequency>('weekly');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Circle name is required');
      return;
    }
    if (trimmed.length > MAX_CIRCLE_NAME_LENGTH) {
      setError('Name must be 100 characters or fewer');
      return;
    }
    if (!db || isSaving) return;

    setError(null);
    setIsSaving(true);
    try {
      const repo = new CircleRepository(db);
      const circle = await repo.create({ name: trimmed, reminderFrequency: frequency });

      // Best-effort local notification (no-op on web, never blocks creation)
      try {
        const permission = await notificationService.getPermissionStatus();
        if (permission.granted) {
          await notificationService.scheduleForCircle(circle);
        } else if (notificationService.isAvailable()) {
          const request = await notificationService.requestPermission();
          if (request.granted) {
            await notificationService.scheduleForCircle(circle);
          }
        }
      } catch {
        // Notifications must never block circle creation
      }

      // Go straight to adding people to the new circle
      router.replace(`/circles/${circle.id}/select`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create circle');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.safe}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>Circle name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={(value) => {
            setName(value);
            if (error) setError(null);
          }}
          placeholder="Family, Old friends, Mentors…"
          placeholderTextColor="#B0B0B6"
          autoFocus
          maxLength={MAX_CIRCLE_NAME_LENGTH + 20}
          accessibilityLabel="Circle name"
          testID="circle-name-input"
        />

        <Text style={styles.label}>How often should we remind you?</Text>
        <View
          style={styles.frequencyPicker}
          accessibilityRole="radiogroup"
          accessibilityLabel="Reminder frequency"
          testID="frequency-picker"
        >
          {REMINDER_FREQUENCIES.map((freq) => {
            const selected = frequency === freq;
            return (
              <TouchableOpacity
                key={freq}
                style={[styles.freqOption, selected && styles.freqOptionSelected]}
                onPress={() => setFrequency(freq)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={REMINDER_FREQUENCY_LABELS[freq]}
                testID={`freq-option-${freq}`}
              >
                <Text
                  style={[styles.freqOptionText, selected && styles.freqOptionTextSelected]}
                >
                  {REMINDER_FREQUENCY_LABELS[freq]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {error && (
          <Text style={styles.error} accessibilityRole="alert" testID="create-circle-error">
            {error}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.createButton, isSaving && styles.createButtonDisabled]}
          onPress={handleCreate}
          disabled={isSaving}
          accessibilityRole="button"
          accessibilityLabel="Create circle"
          testID="create-circle-button"
        >
          <Text style={styles.createButtonText}>
            {isSaving ? 'Creating…' : 'Create Circle'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          testID="cancel-create-circle"
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F9F9F9',
  },
  content: {
    padding: 24,
    paddingTop: 28,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 10,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: '#1A1A1A',
    marginBottom: 24,
  },
  frequencyPicker: {
    gap: 8,
    marginBottom: 24,
  },
  freqOption: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E5E5EA',
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  freqOptionSelected: {
    borderColor: '#4A90E2',
    backgroundColor: '#EFF6FF',
  },
  freqOptionText: {
    fontSize: 16,
    color: '#333',
  },
  freqOptionTextSelected: {
    color: '#4A90E2',
    fontWeight: '600',
  },
  error: {
    color: '#FF3B30',
    fontSize: 15,
    marginBottom: 16,
  },
  createButton: {
    backgroundColor: '#4A90E2',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 6,
  },
  cancelButtonText: {
    color: '#8E8E93',
    fontSize: 15,
  },
});
