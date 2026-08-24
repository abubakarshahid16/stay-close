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
  { value: 'every_x_days', label: 'Every 3 days', interval: 3 },
  { value: 'weekly', label: 'Weekly', interval: 1 },
  { value: 'every_x_weeks', label: 'Every 2 weeks', interval: 2 },
  { value: 'monthly', label: 'Monthly', interval: 1 },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIMES = [9, 12, 18, 21];

export default function CreateGroupScreen() {
  const app = useContainer();

  const [name, setName] = useState('');
  const [cadenceIndex, setCadenceIndex] = useState(2); // Weekly
  const [weekday, setWeekday] = useState(0);
  const [monthDay, setMonthDay] = useState(1);
  const [hour, setHour] = useState(21);
  const [peoplePerCycle, setPeoplePerCycle] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cadence = CADENCES[cadenceIndex];
  const needsWeekday = cadence.value === 'weekly' || cadence.value === 'every_x_weeks';
  const needsMonthDay = cadence.value === 'monthly';

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
        intervalCount: cadence.interval,
        weekday: needsWeekday ? weekday : null,
        monthDay: needsMonthDay ? monthDay : null,
        hour,
        minute: 0,
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
            onPress={() => setCadenceIndex(index)}
          />
        ))}
      </View>

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
            {[1, 5, 10, 15, 20, 25, 28, 31].map((day) => (
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
      <View style={styles.wrap}>
        {TIMES.map((value) => (
          <Button
            key={value}
            label={`${String(value).padStart(2, '0')}:00`}
            variant={value === hour ? 'primary' : 'default'}
            onPress={() => setHour(value)}
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
