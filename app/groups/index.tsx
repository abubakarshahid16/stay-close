/**
 * Group list.
 *
 * Secondary to the home screen — configuration is infrequent and should not
 * compete with the primary action (docs/UI_UX_ROADMAP.md §1).
 */
import React, { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useContainer } from '../../src/ui/AppContext';
import { Body, Button, Divider, Heading, ListRow, Loading, Screen, Spacer } from '../../src/ui/basics';
import type { Group, Schedule } from '../../src/domain/entities';
import { describeSchedule } from '../../src/ui/describeSchedule';

interface Row {
  readonly group: Group;
  readonly memberCount: number;
  readonly schedule: Schedule | null;
}

export default function GroupsScreen() {
  const app = useContainer();
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    const groups = await app.groups.list();
    const built: Row[] = [];
    for (const group of groups) {
      const schedules = await app.schedules.forGroup(group.id);
      built.push({
        group,
        memberCount: await app.groups.memberCount(group.id),
        schedule: schedules.find((s) => s.active) ?? schedules[0] ?? null,
      });
    }
    setRows(built);
  }, [app]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (rows === null) return <Loading label="Loading your groups" />;

  return (
    <Screen>
      <Heading>Groups</Heading>

      {rows.length === 0 ? (
        <Body>
          A group is a set of people you want to stay in touch with, each with its own rhythm.
        </Body>
      ) : (
        rows.map((row) => (
          <React.Fragment key={String(row.group.id)}>
            <ListRow
              title={row.group.name}
              subtitle={`${row.memberCount} ${row.memberCount === 1 ? 'person' : 'people'} · ${
                row.schedule ? describeSchedule(row.schedule) : 'No schedule yet'
              }`}
              onPress={() => router.push(`/groups/${row.group.id}`)}
              accessibilityHint="Opens this group"
            />
            <Divider />
          </React.Fragment>
        ))
      )}

      <Spacer />
      <Button
        label="New group"
        variant="primary"
        onPress={() => router.push('/groups/create')}
      />
    </Screen>
  );
}
