/**
 * Schema and migration tests (issues 006 / #17, 007 / #18).
 *
 * The history-preservation cases are the important ones. docs/DOMAIN.md §3 and
 * §10.2 require reminder and contact history to survive group deletion,
 * membership removal and native-contact deletion. A CASCADE in the wrong place
 * would silently destroy user data, and nothing else would catch it.
 */
import { NodeSqlDriver } from '../../src/testing/NodeSqlDriver';
import {
  migrate,
  getSchemaVersion,
  assertSchemaCurrent,
  LATEST_VERSION,
  MIGRATIONS,
} from '../../src/adapters/persistence/Database';

const NOW = '2026-08-16T21:00:00.000Z';

async function freshDb(): Promise<NodeSqlDriver> {
  const driver = new NodeSqlDriver(':memory:');
  await migrate(driver);
  return driver;
}

/** Minimal connected graph: contact, group, membership, schedule, reminder, event. */
async function seed(db: NodeSqlDriver) {
  const contact = await db.run(
    `INSERT INTO contact_references
       (native_id, phone_e164, display_name_cache, availability, created_at, updated_at)
     VALUES (?, ?, ?, 'available', ?, ?)`,
    ['native-1', '+447700900123', 'Ahmed', NOW, NOW]
  );
  const group = await db.run(
    `INSERT INTO groups (name, created_at, updated_at) VALUES (?, ?, ?)`,
    ['Family', NOW, NOW]
  );
  await db.run(
    `INSERT INTO memberships (group_id, contact_reference_id, active, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)`,
    [group.lastInsertRowId, contact.lastInsertRowId, NOW, NOW]
  );
  const schedule = await db.run(
    `INSERT INTO schedules
       (group_id, people_per_cycle, cadence, interval_count, weekday, hour, minute,
        anchor_at, active, created_at, updated_at)
     VALUES (?, 2, 'weekly', 1, 0, 21, 0, ?, 1, ?, ?)`,
    [group.lastInsertRowId, NOW, NOW, NOW]
  );
  const reminder = await db.run(
    `INSERT INTO reminder_instances
       (schedule_id, group_id, group_name_snapshot, contact_reference_id,
        occurrence_at, due_at, state, created_at, updated_at)
     VALUES (?, ?, 'Family', ?, ?, ?, 'completed', ?, ?)`,
    [
      schedule.lastInsertRowId,
      group.lastInsertRowId,
      contact.lastInsertRowId,
      NOW,
      NOW,
      NOW,
      NOW,
    ]
  );
  await db.run(
    `INSERT INTO contact_events
       (contact_reference_id, occurred_at, source, related_reminder_id, created_at)
     VALUES (?, ?, 'reminder_completion', ?, ?)`,
    [contact.lastInsertRowId, NOW, reminder.lastInsertRowId, NOW]
  );

  return {
    contactId: contact.lastInsertRowId,
    groupId: group.lastInsertRowId,
    scheduleId: schedule.lastInsertRowId,
    reminderId: reminder.lastInsertRowId,
  };
}

describe('migrate', () => {
  it('brings a fresh database to the latest version', async () => {
    const db = new NodeSqlDriver(':memory:');
    expect(await getSchemaVersion(db)).toBe(0);
    const version = await migrate(db);
    expect(version).toBe(LATEST_VERSION);
    await db.close();
  });

  it('creates every expected table', async () => {
    const db = await freshDb();
    const rows = await db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    );
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(
      [
        'app_settings',
        'contact_events',
        'contact_references',
        'groups',
        'memberships',
        'priority_states',
        'reminder_instances',
        'schedule_occurrences',
        'schedules',
      ].sort()
    );
    await db.close();
  });

  // migrate() runs on every launch, so a second run must be a no-op.
  it('is idempotent', async () => {
    const db = await freshDb();
    const ids = await seed(db);
    expect(await migrate(db)).toBe(LATEST_VERSION);
    expect(await migrate(db)).toBe(LATEST_VERSION);
    const remaining = await db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM reminder_instances WHERE id = ?',
      [ids.reminderId]
    );
    expect(remaining?.c).toBe(1);
    await db.close();
  });

  it('has strictly increasing, unique migration versions', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
  });

  it('assertSchemaCurrent passes when migrated and throws when not', async () => {
    const migrated = await freshDb();
    await expect(assertSchemaCurrent(migrated)).resolves.toBeUndefined();
    await migrated.close();

    const bare = new NodeSqlDriver(':memory:');
    await expect(assertSchemaCurrent(bare)).rejects.toThrow(/Schema version mismatch/);
    await bare.close();
  });
});

describe('history preservation', () => {
  it('keeps reminder history when its group is deleted', async () => {
    const db = await freshDb();
    const ids = await seed(db);

    await db.run('DELETE FROM groups WHERE id = ?', [ids.groupId]);

    const reminder = await db.get<{ id: number; group_id: number | null; group_name_snapshot: string }>(
      'SELECT id, group_id, group_name_snapshot FROM reminder_instances WHERE id = ?',
      [ids.reminderId]
    );
    expect(reminder).not.toBeNull();
    expect(reminder?.group_id).toBeNull(); // link cleared...
    expect(reminder?.group_name_snapshot).toBe('Family'); // ...but still readable
    await db.close();
  });

  it('keeps contact events when the group is deleted', async () => {
    const db = await freshDb();
    const ids = await seed(db);
    await db.run('DELETE FROM groups WHERE id = ?', [ids.groupId]);
    const count = await db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM contact_events WHERE contact_reference_id = ?',
      [ids.contactId]
    );
    expect(count?.c).toBe(1);
    await db.close();
  });

  it('cascades memberships and schedules when the group is deleted', async () => {
    const db = await freshDb();
    const ids = await seed(db);
    await db.run('DELETE FROM groups WHERE id = ?', [ids.groupId]);

    const memberships = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM memberships');
    const schedules = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM schedules');
    expect(memberships?.c).toBe(0);
    expect(schedules?.c).toBe(0);
    await db.close();
  });

  it('keeps the contact reference when the group is deleted', async () => {
    const db = await freshDb();
    const ids = await seed(db);
    await db.run('DELETE FROM groups WHERE id = ?', [ids.groupId]);
    const contact = await db.get<{ id: number }>(
      'SELECT id FROM contact_references WHERE id = ?',
      [ids.contactId]
    );
    expect(contact).not.toBeNull();
    await db.close();
  });

  it('refuses to delete a contact reference that history points at', async () => {
    const db = await freshDb();
    const ids = await seed(db);
    // A person who leaves the address book becomes unavailable, never absent.
    await expect(
      db.run('DELETE FROM contact_references WHERE id = ?', [ids.contactId])
    ).rejects.toThrow();
    await db.close();
  });
});

describe('constraints', () => {
  it('enforces foreign keys', async () => {
    const db = await freshDb();
    await expect(
      db.run(
        `INSERT INTO memberships (group_id, contact_reference_id, active, created_at, updated_at)
         VALUES (9999, 9999, 1, ?, ?)`,
        [NOW, NOW]
      )
    ).rejects.toThrow();
    await db.close();
  });

  it('prevents duplicate membership for the same person and group', async () => {
    const db = await freshDb();
    const ids = await seed(db);
    await expect(
      db.run(
        `INSERT INTO memberships (group_id, contact_reference_id, active, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?)`,
        [ids.groupId, ids.contactId, NOW, NOW]
      )
    ).rejects.toThrow();
    await db.close();
  });

  // The database-level half of scheduler idempotence (docs/DOMAIN.md §14.1).
  it('prevents a duplicate reminder for the same occurrence and person', async () => {
    const db = await freshDb();
    const ids = await seed(db);
    await expect(
      db.run(
        `INSERT INTO reminder_instances
           (schedule_id, group_id, group_name_snapshot, contact_reference_id,
            occurrence_at, due_at, state, created_at, updated_at)
         VALUES (?, ?, 'Family', ?, ?, ?, 'pending', ?, ?)`,
        [ids.scheduleId, ids.groupId, ids.contactId, NOW, NOW, NOW, NOW]
      )
    ).rejects.toThrow();
    await db.close();
  });

  it('prevents processing the same schedule occurrence twice', async () => {
    const db = await freshDb();
    const ids = await seed(db);
    await db.run(
      `INSERT INTO schedule_occurrences (schedule_id, occurrence_at, generated_at, selected_count)
       VALUES (?, ?, ?, 0)`,
      [ids.scheduleId, NOW, NOW]
    );
    await expect(
      db.run(
        `INSERT INTO schedule_occurrences (schedule_id, occurrence_at, generated_at, selected_count)
         VALUES (?, ?, ?, 0)`,
        [ids.scheduleId, NOW, NOW]
      )
    ).rejects.toThrow();
    await db.close();
  });

  it('deduplicates people by phone number', async () => {
    const db = await freshDb();
    await seed(db);
    await expect(
      db.run(
        `INSERT INTO contact_references
           (native_id, phone_e164, display_name_cache, availability, created_at, updated_at)
         VALUES ('native-2', '+447700900123', 'Ahmed Khan', 'available', ?, ?)`,
        [NOW, NOW]
      )
    ).rejects.toThrow();
    await db.close();
  });

  it('allows a null native_id, since identifiers churn', async () => {
    const db = await freshDb();
    await expect(
      db.run(
        `INSERT INTO contact_references
           (native_id, phone_e164, display_name_cache, availability, created_at, updated_at)
         VALUES (NULL, '+447700900999', 'Unresolved', 'unavailable', ?, ?)`,
        [NOW, NOW]
      )
    ).resolves.toBeDefined();
    await db.close();
  });

  it.each([
    ['empty group name', `INSERT INTO groups (name, created_at, updated_at) VALUES ('   ', ?, ?)`],
  ])('rejects %s', async (_label, sql) => {
    const db = await freshDb();
    await expect(db.run(sql, [NOW, NOW])).rejects.toThrow();
    await db.close();
  });

  it('rejects a schedule asking for fewer than one person', async () => {
    const db = await freshDb();
    const ids = await seed(db);
    await expect(
      db.run(
        `INSERT INTO schedules
           (group_id, people_per_cycle, cadence, interval_count, hour, minute,
            anchor_at, active, created_at, updated_at)
         VALUES (?, 0, 'weekly', 1, 21, 0, ?, 1, ?, ?)`,
        [ids.groupId, NOW, NOW, NOW]
      )
    ).rejects.toThrow();
    await db.close();
  });

  it('rejects an unknown cadence', async () => {
    const db = await freshDb();
    const ids = await seed(db);
    await expect(
      db.run(
        `INSERT INTO schedules
           (group_id, people_per_cycle, cadence, interval_count, hour, minute,
            anchor_at, active, created_at, updated_at)
         VALUES (?, 1, 'bi_weekly', 1, 21, 0, ?, 1, ?, ?)`,
        [ids.groupId, NOW, NOW, NOW]
      )
    ).rejects.toThrow();
    await db.close();
  });

  it('rejects an out-of-range hour', async () => {
    const db = await freshDb();
    const ids = await seed(db);
    await expect(
      db.run(
        `INSERT INTO schedules
           (group_id, people_per_cycle, cadence, interval_count, hour, minute,
            anchor_at, active, created_at, updated_at)
         VALUES (?, 1, 'daily', 1, 24, 0, ?, 1, ?, ?)`,
        [ids.groupId, NOW, NOW, NOW]
      )
    ).rejects.toThrow();
    await db.close();
  });

  it('rejects an unknown reminder state', async () => {
    const db = await freshDb();
    const ids = await seed(db);
    await expect(
      db.run(
        `INSERT INTO reminder_instances
           (schedule_id, group_id, group_name_snapshot, contact_reference_id,
            occurrence_at, due_at, state, created_at, updated_at)
         VALUES (?, ?, 'Family', ?, '2026-09-01T21:00:00.000Z', ?, 'snoozed_forever', ?, ?)`,
        [ids.scheduleId, ids.groupId, ids.contactId, NOW, NOW, NOW]
      )
    ).rejects.toThrow();
    await db.close();
  });

  it('allows a contact event with no related reminder, for future manual logging', async () => {
    const db = await freshDb();
    const ids = await seed(db);
    await expect(
      db.run(
        `INSERT INTO contact_events
           (contact_reference_id, occurred_at, source, related_reminder_id, created_at)
         VALUES (?, ?, 'manual_log', NULL, ?)`,
        [ids.contactId, NOW, NOW]
      )
    ).resolves.toBeDefined();
    await db.close();
  });
});

describe('transactions', () => {
  it('rolls back on error', async () => {
    const db = await freshDb();
    const before = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM groups');

    await expect(
      db.transaction(async () => {
        await db.run(`INSERT INTO groups (name, created_at, updated_at) VALUES ('Temp', ?, ?)`, [
          NOW,
          NOW,
        ]);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const after = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM groups');
    expect(after?.c).toBe(before?.c);
    await db.close();
  });

  it('commits on success', async () => {
    const db = await freshDb();
    await db.transaction(async () => {
      await db.run(`INSERT INTO groups (name, created_at, updated_at) VALUES ('Kept', ?, ?)`, [
        NOW,
        NOW,
      ]);
    });
    const row = await db.get<{ name: string }>(`SELECT name FROM groups WHERE name = 'Kept'`);
    expect(row?.name).toBe('Kept');
    await db.close();
  });
});
