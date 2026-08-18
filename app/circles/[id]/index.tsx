/**
 * Circle detail screen — rename, change frequency, manage people,
 * delete the circle.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useDatabase } from '../../../src/context/DatabaseContext';
import { CircleRepository } from '../../../src/db/repositories/CircleRepository';
import { CirclePeopleRepository } from '../../../src/db/repositories/CirclePeopleRepository';
import { notificationService } from '../../../src/services/NotificationService';
import { LoadingView } from '../../../src/components/LoadingView';
import { ErrorView } from '../../../src/components/ErrorView';
import {
  REMINDER_FREQUENCIES,
  REMINDER_FREQUENCY_LABELS,
} from '../../../src/types/circle';
import type { Circle, CirclePerson, ReminderFrequency } from '../../../src/types/circle';
import { MAX_CIRCLE_NAME_LENGTH } from '../../../src/utils/validation';
import { confirmAsync, showAlert } from '../../../src/utils/dialogs';

export default function CircleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const circleId = Number(id);
  const { db, isReady } = useDatabase();

  const [circle, setCircle] = useState<Circle | null>(null);
  const [people, setPeople] = useState<CirclePerson[]>([]);
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const load = useCallback(async () => {
    if (!db || !Number.isFinite(circleId)) return;
    setIsLoading(true);
    try {
      const circleRepo = new CircleRepository(db);
      const peopleRepo = new CirclePeopleRepository(db);
      const found = await circleRepo.findById(circleId);
      setCircle(found);
      setName(found?.name ?? '');
      setPeople(found ? await peopleRepo.findByCircleId(circleId) : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [db, circleId]);

  useEffect(() => {
    if (isReady) {
      load();
    }
  }, [isReady, load]);

  // Reload when focus returns (e.g. after adding people on the select screen)
  useFocusEffect(
    useCallback(() => {
      if (isReady) {
        load();
      }
    }, [isReady, load])
  );

  const saveName = useCallback(async () => {
    if (!db || !circle) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === circle.name) {
      setName(circle.name);
      return;
    }
    if (trimmed.length > MAX_CIRCLE_NAME_LENGTH) {
      showAlert('Name too long', 'Name must be 100 characters or fewer');
      setName(circle.name);
      return;
    }
    try {
      const updated = await new CircleRepository(db).update(circle.id, { name: trimmed });
      setCircle(updated);
      setName(updated.name);
    } catch (err) {
      showAlert('Could not rename circle', err instanceof Error ? err.message : undefined);
      setName(circle.name);
    }
  }, [db, circle, name]);

  const changeFrequency = useCallback(
    async (frequency: ReminderFrequency) => {
      if (!db || !circle || frequency === circle.reminderFrequency) return;
      try {
        const updated = await new CircleRepository(db).update(circle.id, {
          reminderFrequency: frequency,
        });
        setCircle(updated);
        await notificationService.rescheduleForCircle(updated);
      } catch (err) {
        showAlert('Could not update frequency', err instanceof Error ? err.message : undefined);
      }
    },
    [db, circle]
  );

  const removePerson = useCallback(
    async (person: CirclePerson) => {
      if (!db) return;
      const confirmed = await confirmAsync(
        'Remove person',
        `Remove ${person.displayName} from this circle?`,
        { confirmLabel: 'Remove', destructive: true }
      );
      if (!confirmed) return;
      try {
        await new CirclePeopleRepository(db).remove(person.id);
        setPeople((prev) => prev.filter((p) => p.id !== person.id));
      } catch {
        showAlert('Could not remove person');
      }
    },
    [db]
  );

  const deleteCircle = useCallback(async () => {
    if (!db || !circle) return;
    const confirmed = await confirmAsync(
      'Delete circle',
      `Delete "${circle.name}" and all its people and history? This cannot be undone.`,
      { confirmLabel: 'Delete', destructive: true }
    );
    if (!confirmed) return;
    setIsBusy(true);
    try {
      await new CircleRepository(db).delete(circle.id);
      await notificationService.cancelForCircle(circle.id);
      router.back();
    } catch {
      showAlert('Could not delete circle');
      setIsBusy(false);
    }
  }, [db, circle]);

  if (!isReady || isLoading) return <LoadingView />;
  if (loadError) return <ErrorView message={loadError.message} onRetry={load} />;

  if (!circle) {
    return (
      <View style={styles.missing} testID="circle-not-found">
        <Text style={styles.missingTitle}>Circle not found</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.primaryButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.safe}>
      <Stack.Screen options={{ title: circle.name }} />
      <FlatList
        data={people}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            <Text style={styles.label}>Circle name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              onBlur={saveName}
              onSubmitEditing={saveName}
              returnKeyType="done"
              maxLength={MAX_CIRCLE_NAME_LENGTH + 20}
              accessibilityLabel="Circle name"
              testID="circle-name-input"
            />

            <Text style={styles.label}>Reminder frequency</Text>
            <View
              style={styles.frequencyPicker}
              accessibilityRole="radiogroup"
              testID="frequency-picker"
            >
              {REMINDER_FREQUENCIES.map((freq) => {
                const selected = circle.reminderFrequency === freq;
                return (
                  <TouchableOpacity
                    key={freq}
                    style={[styles.freqChip, selected && styles.freqChipSelected]}
                    onPress={() => changeFrequency(freq)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={REMINDER_FREQUENCY_LABELS[freq]}
                    testID={`freq-option-${freq}`}
                  >
                    <Text
                      style={[styles.freqChipText, selected && styles.freqChipTextSelected]}
                    >
                      {REMINDER_FREQUENCY_LABELS[freq]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.peopleHeader}>
              <Text style={styles.label}>
                People ({people.length})
              </Text>
              <TouchableOpacity
                style={styles.addPeopleButton}
                onPress={() => router.push(`/circles/${circle.id}/select`)}
                accessibilityRole="button"
                accessibilityLabel="Add people"
                testID="add-people-button"
              >
                <Text style={styles.addPeopleButtonText}>+ Add People</Text>
              </TouchableOpacity>
            </View>

            {people.length === 0 && (
              <Text style={styles.emptyPeople} testID="empty-people">
                No one in this circle yet. Add people to start getting reminders.
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.personRow} testID={`person-row-${item.id}`}>
            <View style={styles.personInfo}>
              <Text style={styles.personName}>{item.displayName}</Text>
              {item.phoneNumber ? (
                <Text style={styles.personPhone}>{item.phoneNumber}</Text>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={() => removePerson(item)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.displayName}`}
              testID={`remove-person-${item.id}`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.removeText}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}
        ListFooterComponent={
          <TouchableOpacity
            style={[styles.deleteButton, isBusy && styles.disabled]}
            onPress={deleteCircle}
            disabled={isBusy}
            accessibilityRole="button"
            accessibilityLabel="Delete circle"
            testID="delete-circle-button"
          >
            <Text style={styles.deleteButtonText}>Delete Circle</Text>
          </TouchableOpacity>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F9F9F9',
  },
  content: {
    padding: 20,
    paddingBottom: 32,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 17,
    color: '#1A1A1A',
  },
  frequencyPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  freqChip: {
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#E5E5EA',
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  freqChipSelected: {
    borderColor: '#4A90E2',
    backgroundColor: '#EFF6FF',
  },
  freqChipText: {
    fontSize: 14,
    color: '#333',
  },
  freqChipTextSelected: {
    color: '#4A90E2',
    fontWeight: '600',
  },
  peopleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addPeopleButton: {
    backgroundColor: '#4A90E2',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  addPeopleButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyPeople: {
    color: '#8E8E93',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 8,
    marginBottom: 8,
  },
  personRow: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  personInfo: {
    flex: 1,
  },
  personName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1A1A1A',
  },
  personPhone: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
  },
  removeText: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: '500',
  },
  deleteButton: {
    marginTop: 32,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#FF3B30',
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  deleteButtonText: {
    color: '#FF3B30',
    fontSize: 16,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  missing: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#F9F9F9',
  },
  missingTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: '#4A90E2',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
