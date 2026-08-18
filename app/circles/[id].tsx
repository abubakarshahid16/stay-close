/**
 * Circle detail screen — shows members, allows adding people, rename, delete.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useDatabase } from '../../src/context/DatabaseContext';
import { CircleRepository } from '../../src/db/repositories/CircleRepository';
import { CirclePeopleRepository } from '../../src/db/repositories/CirclePeopleRepository';
import { LoadingView } from '../../src/components/LoadingView';
import { ErrorView } from '../../src/components/ErrorView';
import type { Circle, CirclePerson } from '../../src/types/circle';
import { REMINDER_FREQUENCY_LABELS } from '../../src/types/circle';

export default function CircleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db } = useDatabase();
  const [circle, setCircle] = useState<Circle | null>(null);
  const [people, setPeople] = useState<CirclePerson[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const circleId = Number(id);

  const load = useCallback(async () => {
    // Guard: invalid id or no db
    if (!db || !id || isNaN(circleId)) {
      router.back();
      return;
    }
    setIsLoading(true);
    try {
      const circleRepo = new CircleRepository(db);
      const peopleRepo = new CirclePeopleRepository(db);
      const [c, p] = await Promise.all([
        circleRepo.findById(circleId),
        peopleRepo.findByCircleId(circleId),
      ]);
      if (!c) {
        router.back();
        return;
      }
      setCircle(c);
      setPeople(p);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [db, circleId, id]);

  useEffect(() => { load(); }, [load]);

  const handleDeletePerson = useCallback(
    (person: CirclePerson) => {
      Alert.alert(
        'Remove Person',
        `Remove ${person.displayName} from this circle?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              if (!db) return;
              try {
                const repo = new CirclePeopleRepository(db);
                await repo.remove(person.id);
                setPeople((prev) => prev.filter((p) => p.id !== person.id));
              } catch {
                Alert.alert('Error', 'Could not remove this person. Please try again.');
              }
            },
          },
        ]
      );
    },
    [db]
  );

  const handleDeleteCircle = useCallback(() => {
    Alert.alert(
      'Delete Circle',
      `Delete "${circle?.name}" and all its members? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!db) return;
            try {
              const repo = new CircleRepository(db);
              await repo.delete(circleId);
              router.back();
            } catch {
              Alert.alert('Error', 'Could not delete this circle. Please try again.');
            }
          },
        },
      ]
    );
  }, [db, circle, circleId]);

  if (isLoading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={load} />;
  if (!circle) return null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title} accessibilityRole="header">{circle.name}</Text>
          <Text style={styles.freq}>{REMINDER_FREQUENCY_LABELS[circle.reminderFrequency]}</Text>
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push(`/circles/${circleId}/select`)}
          accessibilityRole="button"
          accessibilityLabel="Add people to this circle"
        >
          <Text style={styles.addButtonText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={people}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyPeople />}
        renderItem={({ item }) => (
          <PersonRow person={item} onDelete={() => handleDeletePerson(item)} />
        )}
      />

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDeleteCircle}
          accessibilityRole="button"
          accessibilityLabel={`Delete circle ${circle.name}`}
          testID="delete-circle-button"
        >
          <Text style={styles.deleteButtonText}>Delete Circle</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function PersonRow({ person, onDelete }: { person: CirclePerson; onDelete: () => void }) {
  return (
    <View
      style={styles.personRow}
      testID={`person-row-${person.id}`}
      accessibilityLabel={person.displayName}
    >
      <View style={styles.personInfo}>
        <Text style={styles.personName}>{person.displayName}</Text>
        {person.phoneNumber && (
          <Text style={styles.personPhone}>{person.phoneNumber}</Text>
        )}
      </View>
      <TouchableOpacity
        onPress={onDelete}
        hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${person.displayName}`}
        testID={`remove-person-${person.id}`}
      >
        <Text style={styles.removeText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );
}

function EmptyPeople() {
  return (
    <View style={styles.empty} testID="people-empty">
      <Text style={styles.emptyText}>No people in this circle yet.</Text>
      <Text style={styles.emptySubtext}>Tap + Add to add people from your contacts.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F9F9F9',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  freq: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 2,
  },
  addButton: {
    backgroundColor: '#4A90E2',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 8,
  },
  personRow: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  personInfo: {
    flex: 1,
  },
  personName: {
    fontSize: 16,
    fontWeight: '600',
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
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 6,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#8E8E93',
  },
  footer: {
    padding: 20,
    paddingBottom: 32,
  },
  deleteButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FF3B30',
  },
  deleteButtonText: {
    color: '#FF3B30',
    fontSize: 16,
    fontWeight: '600',
  },
});
