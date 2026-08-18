/**
 * Home screen — shows today's reminder suggestion.
 * One person from one circle is suggested based on the weighted algorithm.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useDatabase } from '../../src/context/DatabaseContext';
import { useCircles } from '../../src/hooks/useCircles';
import { useSettings } from '../../src/hooks/useSettings';
import { LoadingView } from '../../src/components/LoadingView';
import { CircleRepository } from '../../src/db/repositories/CircleRepository';
import { CirclePeopleRepository } from '../../src/db/repositories/CirclePeopleRepository';
import { ReminderHistoryRepository } from '../../src/db/repositories/ReminderHistoryRepository';
import { ReminderEngine } from '../../src/services/ReminderEngine';
import type { Circle, CirclePerson } from '../../src/types/circle';
import type { ReminderSuggestion } from '../../src/types/reminder';

interface ActiveSuggestion {
  circle: Circle;
  person: CirclePerson;
  historyId: number;
}

export default function HomeScreen() {
  const { db, isReady } = useDatabase();
  const { circles, isLoading: circlesLoading } = useCircles();
  const { settings, isLoading: settingsLoading } = useSettings();
  const [suggestion, setSuggestion] = useState<ActiveSuggestion | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(true);
  const [sessionExcluded, setSessionExcluded] = useState<Set<number>>(new Set());

  const loadSuggestion = useCallback(async () => {
    if (!db || circles.length === 0) {
      setSuggestionLoading(false);
      setSuggestion(null);
      return;
    }

    setSuggestionLoading(true);
    try {
      const peopleRepo = new CirclePeopleRepository(db);
      const historyRepo = new ReminderHistoryRepository(db);
      const engine = new ReminderEngine();

      // Pick a circle (first one for now; rotate in future)
      const circle = circles[0];
      const people = await peopleRepo.findByCircleId(circle.id);
      if (people.length === 0) {
        setSuggestion(null);
        setSuggestionLoading(false);
        return;
      }

      const lastPersonId = await historyRepo.getLastSuggestedPersonId(circle.id);
      const result: ReminderSuggestion | null = engine.select(
        people,
        circle.reminderFrequency,
        lastPersonId,
        Array.from(sessionExcluded),
        new Date()
      );

      if (!result) {
        setSuggestion(null);
        setSuggestionLoading(false);
        return;
      }

      // Record the suggestion as 'shown'
      const history = await historyRepo.record({
        circleId: circle.id,
        circlePersonId: result.person.id,
        action: 'shown',
      });
      await peopleRepo.recordSuggestion(result.person.id, history.suggestedAt);

      setSuggestion({ circle, person: result.person, historyId: history.id });
    } catch {
      setSuggestion(null);
    } finally {
      setSuggestionLoading(false);
    }
  }, [db, circles, sessionExcluded]);

  useEffect(() => {
    if (isReady && !circlesLoading && !settingsLoading) {
      loadSuggestion();
    }
  }, [isReady, circlesLoading, settingsLoading, loadSuggestion]);

  const handleDone = useCallback(async () => {
    if (!db || !suggestion) return;
    const historyRepo = new ReminderHistoryRepository(db);
    await historyRepo.markCompleted(suggestion.historyId);
    // Move to next suggestion
    setSessionExcluded((prev) => new Set([...prev, suggestion.person.id]));
    loadSuggestion();
  }, [db, suggestion, loadSuggestion]);

  const handleSomeoneElse = useCallback(async () => {
    if (!db || !suggestion) return;
    const historyRepo = new ReminderHistoryRepository(db);
    await historyRepo.markReplaced(suggestion.historyId);
    setSessionExcluded((prev) => new Set([...prev, suggestion.person.id]));
    loadSuggestion();
  }, [db, suggestion, loadSuggestion]);

  const handleSkip = useCallback(async () => {
    if (!db || !suggestion) return;
    const historyRepo = new ReminderHistoryRepository(db);
    await historyRepo.markSkipped(suggestion.historyId);
    setSuggestion(null);
  }, [db, suggestion]);

  if (!isReady || circlesLoading || settingsLoading || suggestionLoading) {
    return <LoadingView />;
  }

  if (circles.length === 0) {
    return <EmptyState onCreateCircle={() => router.push('/circles/create')} />;
  }

  if (!suggestion) {
    return <AllDoneState onRefresh={() => { setSessionExcluded(new Set()); loadSuggestion(); }} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header} accessibilityRole="header">
          Stay Close
        </Text>

        <View style={styles.card} testID="suggestion-card">
          <Text style={styles.circleLabel} accessibilityLabel={`Circle: ${suggestion.circle.name}`}>
            {suggestion.circle.name}
          </Text>
          <Text style={styles.personName} accessibilityRole="header">
            {suggestion.person.displayName}
          </Text>
          {suggestion.person.phoneNumber && (
            <Text style={styles.phone} accessibilityLabel={`Phone: ${suggestion.person.phoneNumber}`}>
              {suggestion.person.phoneNumber}
            </Text>
          )}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.doneButton]}
            onPress={handleDone}
            accessibilityRole="button"
            accessibilityLabel="Mark as done — I reached out"
          >
            <Text style={styles.doneButtonText}>Done — I reached out ✓</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.elseButton]}
            onPress={handleSomeoneElse}
            accessibilityRole="button"
            accessibilityLabel="Show someone else"
          >
            <Text style={styles.elseButtonText}>Show someone else</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.skipButton]}
            onPress={handleSkip}
            accessibilityRole="button"
            accessibilityLabel="Skip for now"
          >
            <Text style={styles.skipButtonText}>Skip for now</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.settingsLink}
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
        >
          <Text style={styles.settingsLinkText}>Settings</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function EmptyState({ onCreateCircle }: { onCreateCircle: () => void }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.centeredContent} testID="empty-state">
        <Text style={styles.header}>Stay Close</Text>
        <Text style={styles.emptyTitle}>Create your first circle</Text>
        <Text style={styles.emptyBody}>
          A circle is a group of people you want to stay in touch with — family, friends, colleagues.
        </Text>
        <TouchableOpacity
          style={[styles.actionButton, styles.doneButton]}
          onPress={onCreateCircle}
          accessibilityRole="button"
          accessibilityLabel="Create a circle"
        >
          <Text style={styles.doneButtonText}>Create a Circle</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function AllDoneState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.centeredContent} testID="all-done-state">
        <Text style={styles.header}>Stay Close</Text>
        <Text style={styles.emptyTitle}>You're all caught up!</Text>
        <Text style={styles.emptyBody}>
          No more suggestions right now. Check back later.
        </Text>
        <TouchableOpacity
          style={[styles.actionButton, styles.elseButton]}
          onPress={onRefresh}
          accessibilityRole="button"
          accessibilityLabel="Show suggestions again"
        >
          <Text style={styles.elseButtonText}>Show Again</Text>
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
  content: {
    padding: 24,
    paddingTop: 48,
  },
  centeredContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  header: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 32,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  circleLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4A90E2',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  personName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  phone: {
    fontSize: 15,
    color: '#666',
    marginTop: 4,
  },
  actions: {
    gap: 12,
  },
  actionButton: {
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  doneButton: {
    backgroundColor: '#34C759',
  },
  doneButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  elseButton: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#4A90E2',
  },
  elseButtonText: {
    color: '#4A90E2',
    fontSize: 17,
    fontWeight: '600',
  },
  skipButton: {
    backgroundColor: 'transparent',
  },
  skipButtonText: {
    color: '#8E8E93',
    fontSize: 15,
  },
  settingsLink: {
    marginTop: 32,
    alignItems: 'center',
  },
  settingsLinkText: {
    color: '#8E8E93',
    fontSize: 14,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 12,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
});
