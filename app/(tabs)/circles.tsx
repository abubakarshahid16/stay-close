/**
 * Circles screen — lists all circles, tap to manage, + to create new.
 */
import React, { useCallback } from 'react';
import {
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useCircles } from '../../src/hooks/useCircles';
import { LoadingView } from '../../src/components/LoadingView';
import { ErrorView } from '../../src/components/ErrorView';
import { REMINDER_FREQUENCY_LABELS } from '../../src/types/circle';
import type { Circle } from '../../src/types/circle';

export default function CirclesScreen() {
  const { circles, isLoading, error, refresh } = useCircles();

  // Refresh whenever this tab regains focus (a circle may have been
  // created, renamed, or deleted on another screen).
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  if (isLoading) return <LoadingView />;
  if (error) return <ErrorView message={error.message} onRetry={refresh} />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          My Circles
        </Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push('/circles/create')}
          accessibilityRole="button"
          accessibilityLabel="Create new circle"
        >
          <Text style={styles.addButtonText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {circles.length === 0 ? (
        <EmptyCircles onCreateCircle={() => router.push('/circles/create')} />
      ) : (
        <FlatList
          data={circles}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <CircleRow
              circle={item}
              onPress={() => router.push(`/circles/${item.id}`)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function CircleRow({ circle, onPress }: { circle: Circle; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${circle.name}, ${REMINDER_FREQUENCY_LABELS[circle.reminderFrequency]} reminders`}
      testID={`circle-row-${circle.id}`}
    >
      <View style={styles.rowContent}>
        <Text style={styles.rowName}>{circle.name}</Text>
        <Text style={styles.rowFreq}>{REMINDER_FREQUENCY_LABELS[circle.reminderFrequency]}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function EmptyCircles({ onCreateCircle }: { onCreateCircle: () => void }) {
  return (
    <View style={styles.empty} testID="circles-empty">
      <Text style={styles.emptyTitle}>No circles yet</Text>
      <Text style={styles.emptyBody}>
        Create a circle to group people you want to stay in touch with.
      </Text>
      <TouchableOpacity
        style={styles.emptyButton}
        onPress={onCreateCircle}
        accessibilityRole="button"
        accessibilityLabel="Create your first circle"
      >
        <Text style={styles.emptyButtonText}>Create a Circle</Text>
      </TouchableOpacity>
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
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  addButton: {
    backgroundColor: '#4A90E2',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 10,
  },
  row: {
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
  rowContent: {
    flex: 1,
  },
  rowName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 2,
  },
  rowFreq: {
    fontSize: 13,
    color: '#8E8E93',
  },
  chevron: {
    fontSize: 22,
    color: '#C7C7CC',
    marginLeft: 8,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 10,
  },
  emptyBody: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  emptyButton: {
    backgroundColor: '#4A90E2',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
