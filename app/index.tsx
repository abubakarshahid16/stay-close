/**
 * Home — today's reminders.
 *
 * The primary surface. One card per pending reminder, ordered overdue-first
 * then oldest-first, because the product is about the person you have neglected
 * longest (docs/DOMAIN.md §8.3).
 *
 * The four resolutions are laid out with deliberately unequal weight: Complete
 * is the point, Deprioritize is rare and consequential. Giving them equal
 * prominence would misrepresent the model (§7.2, §7.3).
 *
 * Nothing here infers contact. Launching WhatsApp or the dialer leaves the
 * reminder pending until the user explicitly confirms (§9).
 */
import React, { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useContainer } from '../src/ui/AppContext';
import {
  Body,
  Button,
  Card,
  Heading,
  Loading,
  Screen,
  Spacer,
  Subheading,
} from '../src/ui/basics';
import type { ReminderView } from '../src/usecases/reminders/ReminderUseCases';
import type { NotificationPermission } from '../src/ports/NotificationScheduler';
import { canOpenAppSettings, openAppSettings } from '../src/ui/openAppSettings';
import { isErr } from '../src/domain/shared/Result';
import type { ReminderId } from '../src/domain/shared/ids';

const CLASSIFICATION_LABEL: Record<string, string> = {
  overdue: 'Overdue',
  due: 'Due now',
  snoozed: 'Snoozed',
  resolved: 'Done',
};

export default function HomeScreen() {
  const app = useContainer();
  const [views, setViews] = useState<ReminderView[] | null>(null);
  const [groupCount, setGroupCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notifications, setNotifications] = useState<NotificationPermission | null>(null);

  const load = useCallback(async () => {
    const [pending, groups] = [
      await app.reminders.listPending(),
      await app.groups.list(),
    ];
    setViews(pending);
    setGroupCount(groups.length);

    // Checked on every focus rather than once: the user may have changed it in
    // Settings and come back, and a stale "notifications are off" warning is
    // worse than none.
    try {
      setNotifications(await app.notificationsProvider.permission());
    } catch {
      setNotifications(null);
    }
  }, [app]);

  // Reload on focus: returning from creating a group or adding people must not
  // show stale data. The previous product had exactly this bug.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  /**
   * Shown when reminders cannot actually reach the user.
   *
   * Without this the app fails silently: ReconcileNotifications skips
   * scheduling when the permission is not granted, so reminders simply never
   * arrive and nothing on screen says why. The in-app list still works, which
   * is the intended degradation — but it has to be stated, not assumed.
   */
  const NotificationWarning = () => {
    if (notifications === null || notifications.state === 'granted') return null;

    const terminal = !notifications.canAskAgain;
    return (
      <Card>
        <Subheading>Reminders will not notify you</Subheading>
        <Body dim>
          {terminal
            ? 'Notifications are turned off for Stay Close. You can turn them on in your device Settings. Until then, open the app to see who is due.'
            : 'Stay Close needs permission to send notifications. Without it, reminders only appear when you open the app.'}
        </Body>
        <Spacer />
        {terminal ? (
          // Requesting again is a silent no-op once the OS has stopped
          // prompting, so the only thing left that can actually change the
          // state is Settings.
          canOpenAppSettings ? (
            <Button
              label="Open Settings"
              variant="primary"
              onPress={() => void openAppSettings()}
            />
          ) : null
        ) : (
          <Button
            label="Turn on notifications"
            variant="primary"
            onPress={() => {
              void (async () => {
                try {
                  await app.notificationsProvider.request();
                } finally {
                  await load();
                  // Schedule anything already pending, so granting takes effect
                  // immediately rather than at the next app launch.
                  await app.notifications.run();
                }
              })();
            }}
          />
        )}
      </Card>
    );
  };

  /**
   * Lets the user confirm notifications reach this device without waiting for a
   * real reminder.
   *
   * Without it there is no way to tell a working setup from a silently blocked
   * one until the next scheduled time, which may be days away — and "silently
   * blocked" is exactly the state this app was in before it started asking for
   * permission at all.
   */
  const TestAlert = () => {
    if (notifications === null || notifications.state !== 'granted') return null;

    return (
      <>
        <Button
          label="Send a test reminder"
          variant="quiet"
          onPress={() => {
            void (async () => {
              const sent = await app.notificationsProvider.sendTest({
                title: 'Stay Close',
                body: 'Notifications are working. Real reminders will arrive like this.',
              });
              Alert.alert(
                sent ? 'Test sent' : 'Could not send',
                sent
                  ? 'It should appear in a few seconds. If it does not, check that notifications are allowed for Stay Close in your device Settings.'
                  : 'Your device refused to show the notification. Check that notifications are allowed for Stay Close in Settings.'
              );
            })();
          }}
        />
        <Spacer />
      </>
    );
  };

  const resolve = useCallback(
    async (action: 'complete' | 'skip' | 'deprioritize', id: ReminderId) => {
      setBusy(true);
      try {
        const result =
          action === 'complete'
            ? await app.reminders.complete(id)
            : action === 'skip'
              ? await app.reminders.skip(id)
              : await app.reminders.deprioritize(id);

        if (isErr(result)) {
          Alert.alert('Could not save', result.error.detail);
        } else {
          // Keep OS notifications in step with what is now pending.
          await app.notifications.run();
        }
        await load();
      } finally {
        setBusy(false);
      }
    },
    [app, load]
  );

  const snooze = useCallback(
    async (id: ReminderId) => {
      const options = await app.reminders.snoozeOptionsFor(id);
      if (isErr(options)) {
        Alert.alert('Could not snooze', options.error.detail);
        return;
      }

      const labels: Record<string, string> = {
        thirty_minutes: '30 minutes',
        one_hour: '1 hour',
        three_hours: '3 hours',
        tomorrow: 'Tomorrow',
        next_occurrence: 'Next scheduled time',
      };

      Alert.alert('Remind me again in', undefined, [
        // Only offer what can actually succeed — next_occurrence is absent when
        // the schedule is paused or deleted.
        ...options.value.map((option) => ({
          text: labels[option] ?? option,
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                const result = await app.reminders.snooze(id, option);
                if (isErr(result)) Alert.alert('Could not snooze', result.error.detail);
                else await app.notifications.run();
                await load();
              } finally {
                setBusy(false);
              }
            })();
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    },
    [app, load]
  );

  const contact = useCallback(
    async (method: 'call' | 'whatsApp', phoneE164: string) => {
      const result =
        method === 'call'
          ? await app.communication.call(phoneE164)
          : await app.communication.whatsApp(phoneE164);

      if (result.outcome === 'invalid-number') {
        Alert.alert('No usable number', 'This contact has no number we can dial.');
      } else if (result.outcome === 'no-handler') {
        Alert.alert('Not available', 'Nothing on this device can open that.');
      }
      // 'cancelled-or-failed' is deliberately silent: on iOS a cancelled
      // confirmation is indistinguishable from a failure, so showing an error
      // would often be wrong (docs/PLATFORM.md §5.3).
    },
    [app]
  );

  if (views === null) return <Loading label="Loading your reminders" />;

  if (groupCount === 0) {
    return (
      <Screen>
        <Heading>Welcome to Stay Close</Heading>
        <Body>
          Stay Close reminds you who to reach out to next, one person at a time. Everything stays
          on this device.
        </Body>
        <Spacer />
        <Body>Start by making a group — Family, Close Friends, anyone who matters.</Body>
        <Spacer />
        <Button
          label="Create a group"
          variant="primary"
          onPress={() => router.push('/groups/create')}
        />
      </Screen>
    );
  }

  if (views.length === 0) {
    return (
      <Screen>
        <Heading>Nobody to reach out to</Heading>
        <NotificationWarning />
        <Body>You are up to date. Stay Close will let you know when someone is due.</Body>
        <Spacer />
        <TestAlert />
        <Spacer />
        <Button label="Your groups" onPress={() => router.push('/groups')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Heading>Reach out to</Heading>

      <NotificationWarning />
      <TestAlert />

      {views.map((view) => (
        <View key={String(view.reminder.id)}>
          <Card>
            <Body dim>
              {CLASSIFICATION_LABEL[view.classification] ?? view.classification} ·{' '}
              {view.reminder.groupNameSnapshot}
            </Body>
            <Subheading>{view.displayName}</Subheading>

            {view.phoneE164 ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Call"
                    onPress={() => void contact('call', view.phoneE164)}
                    accessibilityHint="Opens your dialler. This does not mark the reminder done."
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="WhatsApp"
                    onPress={() => void contact('whatsApp', view.phoneE164)}
                    accessibilityHint="Opens WhatsApp. This does not mark the reminder done."
                  />
                </View>
              </View>
            ) : (
              <Body dim>No usable phone number for this person.</Body>
            )}

            <Button
              label="I reached out"
              variant="primary"
              disabled={busy}
              onPress={() => void resolve('complete', view.reminder.id)}
              accessibilityHint="Records that you contacted this person."
            />

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  label="Later"
                  variant="quiet"
                  disabled={busy}
                  onPress={() => void snooze(view.reminder.id)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Skip"
                  variant="quiet"
                  disabled={busy}
                  onPress={() => void resolve('skip', view.reminder.id)}
                  accessibilityHint="Keeps this person in your rotation for another time."
                />
              </View>
            </View>

            <Button
              label="Not for now"
              variant="quiet"
              disabled={busy}
              onPress={() => {
                // Consequential and open-ended, so it is confirmed.
                Alert.alert(
                  `Stop prioritising ${view.displayName}?`,
                  'They stay in your group and nothing is deleted, but Stay Close will not suggest them until you undo this.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Not for now',
                      onPress: () => void resolve('deprioritize', view.reminder.id),
                    },
                  ]
                );
              }}
            />
          </Card>
          <Spacer />
        </View>
      ))}

      <Button label="Your groups" variant="quiet" onPress={() => router.push('/groups')} />
    </Screen>
  );
}
