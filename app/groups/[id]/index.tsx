/**
 * Group detail — members, schedule, and destructive actions.
 *
 * The deletion copy matters. docs/DOMAIN.md §3 guarantees that deleting a group
 * keeps the people, their history, and their other groups — so the confirmation
 * says exactly that, rather than a generic "this cannot be undone" that would
 * overstate the consequence and frighten the user off a reversible-feeling
 * action.
 */
import React, { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useContainer } from '../../../src/ui/AppContext';
import {
  Body,
  Button,
  Divider,
  Heading,
  ListRow,
  Loading,
  Screen,
  Spacer,
  Subheading,
} from '../../../src/ui/basics';
import { cyclesCaveat, describeSchedule } from '../../../src/ui/describeSchedule';
import type { ContactReference, Group, Schedule } from '../../../src/domain/entities';
import { groupId as toGroupId } from '../../../src/domain/shared/ids';
import { isErr } from '../../../src/domain/shared/Result';

interface Loaded {
  readonly group: Group;
  readonly schedule: Schedule | null;
  readonly members: readonly ContactReference[];
}

export default function GroupDetailScreen() {
  const app = useContainer();
  const params = useLocalSearchParams<{ id: string }>();
  const id = toGroupId(Number(params.id));

  const [state, setState] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const group = await app.groups.get(id);
    if (!group) {
      setMissing(true);
      return;
    }

    const memberships = await app.groups.listMembers(id);
    const members: ContactReference[] = [];
    for (const membership of memberships) {
      const contact = await app.uow.repositories.contacts.findById(membership.contactReferenceId);
      if (contact) members.push(contact);
    }

    const schedules = await app.schedules.forGroup(id);
    setState({
      group,
      schedule: schedules.find((s) => s.active) ?? schedules[0] ?? null,
      members,
    });
  }, [app, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (missing) {
    return (
      <Screen>
        <Heading>Group not found</Heading>
        <Body>It may have been deleted.</Body>
        <Spacer />
        <Button label="Back to groups" onPress={() => router.replace('/groups')} />
      </Screen>
    );
  }

  if (state === null) return <Loading label="Loading group" />;

  const { group, schedule, members } = state;
  const caveat = schedule ? cyclesCaveat(schedule, members.length) : null;

  async function removeMember(contact: ContactReference) {
    const result = await app.groups.removeMember(id, contact.id);
    if (isErr(result)) {
      Alert.alert('Could not remove', result.error.detail);
      return;
    }
    await app.notifications.run();
    await load();
  }

  async function togglePaused() {
    if (!schedule) return;
    const result = await app.schedules.setActive(schedule.id, !schedule.active);
    if (isErr(result)) {
      Alert.alert('Could not change', result.error.detail);
      return;
    }
    await app.notifications.run();
    await load();
  }

  async function deleteGroup() {
    const result = await app.groups.delete(id);
    if (isErr(result)) {
      Alert.alert('Could not delete', result.error.detail);
      return;
    }
    await app.notifications.run();
    router.replace('/groups');
  }

  return (
    <Screen>
      <Heading>{group.name}</Heading>

      <Subheading>Schedule</Subheading>
      {schedule ? (
        <>
          <Body>{describeSchedule(schedule)}</Body>
          {caveat ? <Body dim>{caveat}</Body> : null}
          <Spacer size={8} />
          <Button
            label={schedule.active ? 'Pause reminders' : 'Resume reminders'}
            onPress={() => void togglePaused()}
            accessibilityHint={
              schedule.active
                ? 'Stops future reminders. Nothing is deleted.'
                : 'Starts future reminders again.'
            }
          />
        </>
      ) : (
        <Body dim>No schedule yet, so this group will not produce reminders.</Body>
      )}

      <Subheading>
        {members.length} {members.length === 1 ? 'person' : 'people'}
      </Subheading>

      {members.length === 0 ? (
        <Body dim>Add someone to start getting reminders.</Body>
      ) : (
        members.map((contact) => (
          <React.Fragment key={String(contact.id)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <ListRow
                  title={contact.displayNameCache}
                  subtitle={
                    contact.availability === 'unavailable'
                      ? 'Not in your contacts any more'
                      : contact.phoneE164
                  }
                />
              </View>
              <Button
                label="Remove"
                variant="quiet"
                onPress={() => {
                  Alert.alert(
                    `Remove ${contact.displayNameCache}?`,
                    'They stay in your other groups, and their history is kept.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', onPress: () => void removeMember(contact) },
                    ]
                  );
                }}
              />
            </View>
            <Divider />
          </React.Fragment>
        ))
      )}

      <Spacer />
      <Button
        label="Add people"
        variant="primary"
        onPress={() => router.push(`/groups/${params.id}/add`)}
      />

      <Spacer size={24} />
      <Button
        label="Delete this group"
        variant="quiet"
        onPress={() => {
          Alert.alert(
            `Delete ${group.name}?`,
            'The people stay in your phone contacts and in any other groups, and your history with them is kept. Only this group and its reminders go.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete group', style: 'destructive', onPress: () => void deleteGroup() },
            ]
          );
        }}
      />
    </Screen>
  );
}
