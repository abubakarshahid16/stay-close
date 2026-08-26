/**
 * Create a group and its schedule.
 *
 * Phase A: plain controls, preset choices, no pickers or date wheels. Enough to
 * exercise every cadence the domain supports (docs/PRODUCT.md §37).
 *
 * The one bit of real UX here is the caveat under people-per-cycle, because
 * "2 people every 7 days" is the single most misread part of the model
 * (docs/DOMAIN.md §4.1).
 */
import React, { useState } from 'react';
import { Alert, TextInput, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useContainer } from '../../src/ui/AppContext';
import {
  Body,
  Button,
  ErrorText,
  Heading,
  Screen,
  Spacer,
  Subheading,
} from '../../src/ui/basics';
import type { Cadence } from '../../src/domain/entities';
import { isErr } from '../../src/domain/shared/Result';

const CADENCES: readonly { value: Cadence; label: string; interval: number }[] = [
  { value: 'daily', label: 'Every day', interval: 1 },
  { value: 'every_x_days', label: 'Every few days', interval: 3 },
  { value: 'weekly', label: 'Weekly', interval: 1 },
  { value: 'every_x_weeks', label: 'Every few weeks', interval: 2 },
  { value: 'monthly', label: 'Monthly', interval: 1 },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/**
 * Every hour, and minutes in five-minute steps.
 *
 * This offered four fixed times (09:00, 12:00, 18:00, 21:00) with minutes
 * locked to zero, which was a UI restriction and nothing more: the domain has
 * always accepted any hour 0-23 and any minute 0-59
 * (src/domain/schedule/cadence.ts). Someone who wants a reminder at 07:30
 * could not ask for one.
 */
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/** Days of the month. Also previously a subset — 1, 5, 10, 15, 20, 25, 28, 31. */
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

const two = (n: number) => String(n).padStart(2, '0');

export default function CreateGroupScreen() {
  const app = useContainer();

  const [name, setName] = useState('');
  const [cadenceIndex, setCadenceIndex] = useState(2); // Weekly
  const [weekday, setWeekday] = useState(0);
  const [monthDay, setMonthDay] = useState(1);
  const [hour, setHour] = useState(21);
  const [minute, setMinute] = useState(0);
  const [interval, setInterval] = useState(3);
  const [peoplePerCycle, setPeoplePerCycle] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cadence = CADENCES[cadenceIndex];
  const needsWeekday = cadence.value === 'weekly' || cadence.value === 'every_x_weeks';
  const needsMonthDay = cadence.value === 'monthly';
  const needsInterval =
    cadence.value === 'every_x_days' || cadence.value === 'every_x_weeks';
  const intervalUnit = cadence.value === 'every_x_days' ? 'days' : 'weeks';

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const group = await app.groups.create(name);
      if (isErr(group)) {
        setError(group.error.detail);
        return;
      }

      const schedule = await app.schedules.create({
        groupId: group.value.id,
        peoplePerCycle,
        cadence: cadence.value,
        intervalCount: needsInterval ? interval : cadence.interval,
        weekday: needsWeekday ? weekday : null,
        monthDay: needsMonthDay ? monthDay : null,
        hour,
        minute,
      });

      if (isErr(schedule)) {
        // The group exists but has no schedule. Say so rather than pretending
        // the whole thing failed.
        Alert.alert(
          'Group created, schedule not set',
          `${schedule.error.detail} You can set a schedule from the group.`
        );
        router.replace(`/groups/${group.value.id}`);
        return;
      }

      // Ask for notification permission here, at the one moment the user has
      // unambiguously asked to be reminded of something.
      //
      // Nothing asked at all before this. ReconcileNotifications checks the
      // permission and quietly skips scheduling when it is not granted, and on
      // Android 13+ POST_NOTIFICATIONS starts denied until requested — so
      // reminders could never fire, and the app sat permanently in the
      // in-app-only degradation that was designed for someone who had DECLINED.
      //
      // Failure is deliberately ignored: a schedule that exists without
      // notifications still works through the in-app list, and the home screen
      // says so.
      try {
        const current = await app.notificationsProvider.permission();
        if (current.state !== 'granted' && current.canAskAgain) {
          await app.notificationsProvider.request();
        }
      } catch {
        // Nothing to do here; the home screen surfaces the resulting state.
      }

      // Straight into adding people — an empty group does nothing.
      router.replace(`/groups/${group.value.id}/add`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Heading>New group</Heading>
      <Body dim>Family, Close Friends, Old Colleagues — whatever fits.</Body>

      <Spacer size={8} />
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Group name"
        accessibilityLabel="Group name"
        style={styles.input}
        maxLength={100}
        autoFocus
      />
      {error ? <ErrorText>{error}</ErrorText> : null}

      <Subheading>How often</Subheading>
      <View style={styles.wrap}>
        {CADENCES.map((option, index) => (
          <Button
            key={option.value + String(index)}
            label={option.label}
            variant={index === cadenceIndex ? 'primary' : 'default'}
            onPress={() => {
              setCadenceIndex(index);
              // Sensible starting point per unit, still adjustable below.
              if (CADENCES[index].value === 'every_x_days') setInterval(3);
              if (CADENCES[index].value === 'every_x_weeks') setInterval(2);
            }}
          />
        ))}
      </View>

      {needsInterval ? (
        <>
          <Subheading>How many {intervalUnit}</Subheading>
          <View style={styles.row}>
            <Button
              label="−"
              accessibilityLabel={`One fewer ${intervalUnit}`}
              disabled={interval <= 1}
              onPress={() => setInterval((n) => Math.max(1, n - 1))}
            />
            <Body>
              Every {interval} {interval === 1 ? intervalUnit.slice(0, -1) : intervalUnit}
            </Body>
            <Button
              label="+"
              accessibilityLabel={`One more ${intervalUnit}`}
              disabled={interval >= 52}
              onPress={() => setInterval((n) => Math.min(52, n + 1))}
            />
          </View>
        </>
      ) : null}

      {needsWeekday ? (
        <>
          <Subheading>Which day</Subheading>
          <View style={styles.wrap}>
            {WEEKDAYS.map((label, index) => (
              <Button
                key={label}
                label={label}
                variant={index === weekday ? 'primary' : 'default'}
                onPress={() => setWeekday(index)}
              />
            ))}
          </View>
        </>
      ) : null}

      {needsMonthDay ? (
        <>
          <Subheading>Day of the month</Subheading>
          <View style={styles.wrap}>
            {MONTH_DAYS.map((day) => (
              <Button
                key={day}
                label={String(day)}
                variant={day === monthDay ? 'primary' : 'default'}
                onPress={() => setMonthDay(day)}
              />
            ))}
          </View>
          {monthDay > 28 ? (
            <Body dim>
              In shorter months this moves to the last day, then returns to the {monthDay}th.
            </Body>
          ) : null}
        </>
      ) : null}

      <Subheading>What time</Subheading>
      <Body>
        Reminders will arrive at{' '}
        <Body>
          {two(hour)}:{two(minute)}
        </Body>
      </Body>

      <Body dim>Hour</Body>
      <View style={styles.wrap}>
        {HOURS.map((value) => (
          <Button
            key={`h${value}`}
            label={two(value)}
            accessibilityLabel={`${two(value)} hours`}
            variant={value === hour ? 'primary' : 'default'}
            onPress={() => setHour(value)}
          />
        ))}
      </View>

      <Body dim>Minutes</Body>
      <View style={styles.wrap}>
        {MINUTES.map((value) => (
          <Button
            key={`m${value}`}
            label={two(value)}
            accessibilityLabel={`${two(value)} minutes past`}
            variant={value === minute ? 'primary' : 'default'}
            onPress={() => setMinute(value)}
          />
        ))}
      </View>

      <Subheading>How many people each time</Subheading>
      <View style={styles.row}>
        <Button
          label="−"
          onPress={() => setPeoplePerCycle((n) => Math.max(1, n - 1))}
          accessibilityHint="Fewer people per reminder"
        />
        <Body>{peoplePerCycle}</Body>
        <Button
          label="+"
          onPress={() => setPeoplePerCycle((n) => Math.min(10, n + 1))}
          accessibilityHint="More people per reminder"
        />
      </View>
      <Body dim>
        Stay Close picks this many each time — not everyone in the group. With more people in the
        group, each person simply comes up less often.
      </Body>

      <Spacer />
      <Button
        label={busy ? 'Creating…' : 'Create and add people'}
        variant="primary"
        disabled={busy || name.trim().length === 0}
        onPress={() => void submit()}
      />
    </Screen>
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
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
});
