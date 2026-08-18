/**
 * Home screen — shows today's reminder suggestion.
 * One person from one circle is suggested based on the weighted algorithm.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useDatabase } from '../../src/context/DatabaseContext';
import { useCircles } from '../../src/hooks/useCircles';
import { useSettings } from '../../src/hooks/useSettings';
import { LoadingView } from '../../src/components/LoadingView';
import { CirclePeopleRepository } from '../../src/db/repositories/CirclePeopleRepository';
import { ReminderHistoryRepository } from '../../src/db/repositories/ReminderHistoryRepository';
import { ReminderEngine } from '../../src/services/ReminderEngine';
import type { Circle, CirclePerson } from '../../src/types/circle';
import { avatarColor, colors, initials, radii, shadow } from '../../src/theme';

interface ActiveSuggestion {
  circle: Circle;
  person: CirclePerson;
  historyId: number;
}

export default function HomeScreen() {
  const { db, isReady } = useDatabase();
  const { circles, isLoading: circlesLoading, refresh: refreshCircles } = useCircles();
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
      const result: CirclePerson | null = engine.select(
        people,
        circle.reminderFrequency,
        lastPersonId,
        sessionExcluded,
        new Date().toISOString()
      );

      if (!result) {
        setSuggestion(null);
        setSuggestionLoading(false);
        return;
      }

      // Record the suggestion as 'shown'
      const history = await historyRepo.record({
        circleId: circle.id,
        circlePersonId: result.id,
        action: 'shown',
      });
      await peopleRepo.recordSuggestion(result.id, history.suggestedAt);

      setSuggestion({ circle, person: result, historyId: history.id });
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

  // Data can change while this screen is unfocused (circle created,
  // people added) — reload circles every time Home regains focus.
  useFocusEffect(
    useCallback(() => {
      if (isReady) {
        refreshCircles();
      }
    }, [isReady, refreshCircles])
  );

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

  // First launch → walk through onboarding before anything else
  if (!settings.onboardingCompleted) {
    return <Redirect href="/onboarding" />;
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
        <Text style={styles.subheader}>Someone is waiting to hear from you 💜</Text>

        <View style={styles.card} testID="suggestion-card">
          <View style={styles.circleBadge}>
            <Text style={styles.circleLabel} accessibilityLabel={`Circle: ${suggestion.circle.name}`}>
              {suggestion.circle.name}
            </Text>
          </View>
          <View
            style={[styles.avatar, { backgroundColor: avatarColor(suggestion.person.displayName) }]}
          >
            <Text style={styles.avatarText}>{initials(suggestion.person.displayName)}</Text>
          </View>
          <Text style={styles.personName} accessibilityRole="header">
            {suggestion.person.displayName}
          </Text>
          {suggestion.person.phoneNumber && (
            <Text style={styles.phone} accessibilityLabel={`Phone: ${suggestion.person.phoneNumber}`}>
              {suggestion.person.phoneNumber}
            </Text>
          )}
          <Text style={styles.nudge}>A quick call or message makes their day.</Text>
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
        <Text style={styles.emptyTitle}>You&apos;re all caught up!</Text>
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
    backgroundColor: colors.bg,
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
    fontSize: 32,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 6,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subheader: {
    fontSize: 15,
    color: colors.inkSoft,
    textAlign: 'center',
    marginBottom: 28,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: 28,
    marginBottom: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.card,
  },
  circleBadge: {
    backgroundColor: colors.primarySoft,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 18,
  },
  circleLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    ...shadow.soft,
  },
  avatarText: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '800',
  },
  personName: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 2,
    textAlign: 'center',
  },
  phone: {
    fontSize: 15,
    color: colors.inkSoft,
    marginTop: 4,
  },
  nudge: {
    fontSize: 14,
    color: colors.inkFaint,
    marginTop: 14,
    textAlign: 'center',
  },
  actions: {
    gap: 12,
  },
  actionButton: {
    borderRadius: radii.md,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  doneButton: {
    backgroundColor: colors.primary,
    ...shadow.soft,
  },
  doneButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  elseButton: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  elseButtonText: {
    color: colors.primary,
    fontSize: 17,
    fontWeight: '700',
  },
  skipButton: {
    backgroundColor: 'transparent',
  },
  skipButtonText: {
    color: colors.inkSoft,
    fontSize: 15,
  },
  settingsLink: {
    marginTop: 32,
    alignItems: 'center',
  },
  settingsLinkText: {
    color: colors.inkSoft,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 12,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 16,
    color: colors.inkSoft,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
});
