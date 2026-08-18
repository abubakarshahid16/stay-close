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
import { avatarColor, colors, initials, radii, shadow } from '../../src/theme';

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
      <CircleAvatar name={circle.name} />
      <View style={styles.rowContent}>
        <Text style={styles.rowName}>{circle.name}</Text>
        <Text style={styles.rowFreq}>{REMINDER_FREQUENCY_LABELS[circle.reminderFrequency]}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function CircleAvatar({ name }: { name: string }) {
  return (
    <View style={[styles.rowAvatar, { backgroundColor: avatarColor(name) }]}>
      <Text style={styles.rowAvatarText}>{initials(name)}</Text>
    </View>
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
    backgroundColor: colors.bg,
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
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.5,
  },
  addButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radii.pill,
    ...shadow.soft,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 10,
  },
  row: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.soft,
  },
  rowAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowAvatarText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
  rowContent: {
    flex: 1,
  },
  rowName: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 2,
  },
  rowFreq: {
    fontSize: 13,
    color: colors.inkSoft,
  },
  chevron: {
    fontSize: 24,
    color: colors.inkFaint,
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
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 10,
  },
  emptyBody: {
    fontSize: 15,
    color: colors.inkSoft,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  emptyButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 26,
    paddingVertical: 13,
    borderRadius: radii.md,
    ...shadow.soft,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
