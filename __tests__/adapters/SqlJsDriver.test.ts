/**
 * Web database tests (sql.js).
 *
 * These exist because the web storage path had, until now, only ever been
 * "verified" by deploying it and looking at the page — which is how it shipped
 * broken twice. sql.js runs under Node, so the browser database can be
 * exercised here properly.
 *
 * The point is not sql.js itself but that the SAME migrations, repositories and
 * SQL work against it. That is what the SqlDriver port was for: swapping the
 * storage engine without touching a single repository.
 *
 * IndexedDB does not exist in Node, so persistence degrades to in-memory —
 * which the driver handles deliberately, and which is asserted below.
 */
import { join } from 'node:path';
import { SqlJsDriver } from '../../src/adapters/persistence/SqlJsDriver';
import { migrate, getSchemaVersion, LATEST_VERSION } from '../../src/adapters/persistence/Database';
import { SqlUnitOfWork } from '../../src/adapters/persistence/SqlRepositories';
import { GroupUseCases } from '../../src/usecases/groups/GroupUseCases';
import { ScheduleUseCases } from '../../src/usecases/schedules/ScheduleUseCases';
import { RunScheduler } from '../../src/usecases/scheduler/RunScheduler';
import { ReminderUseCases } from '../../src/usecases/reminders/ReminderUseCases';
import { FakeClock } from '../../src/testing/FakeClock';
import { SeededRandom } from '../../src/adapters/system/SeededRandom';
import { unwrap } from '../../src/domain/shared/Result';

/** In Node the wasm comes off disk rather than a URL. */
const locateWasm = (file: string): string =>
  join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file);

const START = '2026-08-16T00:00:00.000Z';

async function open(): Promise<SqlJsDriver> {
  return SqlJsDriver.open(locateWasm);
}

describe('sql.js driver', () => {
  it('opens without SharedArrayBuffer, a Worker, or cross-origin isolation', async () => {
    // The whole reason for this driver. None of these exist in Node either,
    // which makes Node a fair stand-in for a non-isolated browser page.
    expect(typeof SharedArrayBuffer === 'undefined' || !globalThis.crossOriginIsolated).toBe(true);

    const db = await open();
    expect(db).toBeDefined();
    await db.close();
  });

  it('runs the real migrations', async () => {
    const db = await open();
    expect(await getSchemaVersion(db)).toBe(0);
    expect(await migrate(db)).toBe(LATEST_VERSION);
    await db.close();
  });

  it('creates every table the app expects', async () => {
    const db = await open();
    await migrate(db);
    const rows = await db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    );
    expect(rows.map((r) => r.name).sort()).toEqual(
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

  it('reports lastInsertRowId and changes correctly', async () => {
    const db = await open();
    await migrate(db);

    const insert = await db.run(
      `INSERT INTO groups (name, created_at, updated_at) VALUES ('Family', '2026-01-01', '2026-01-01')`
    );
    expect(insert.lastInsertRowId).toBe(1);
    expect(insert.changes).toBe(1);

    const update = await db.run(`UPDATE groups SET name = 'Kin' WHERE id = 1`);
    expect(update.changes).toBe(1);

    const noop = await db.run(`UPDATE groups SET name = 'X' WHERE id = 999`);
    expect(noop.changes).toBe(0);
    await db.close();
  });

  // Regression guard for a real bug: sql.js's export() resets
  // connection-scoped pragmas, and this driver exports on every write. Foreign
  // keys were silently switching off after the first save, which would have
  // quietly disabled every history-preservation rule in the schema.
  it('keeps foreign keys enforced after a snapshot', async () => {
    const db = await open();
    await migrate(db);

    // A write, which triggers a snapshot and therefore an export().
    await db.run(
      `INSERT INTO groups (name, created_at, updated_at) VALUES ('Family', '2026-01-01', '2026-01-01')`
    );
    await db.flush();

    expect((await db.get<{ foreign_keys: number }>('PRAGMA foreign_keys'))?.foreign_keys).toBe(1);
    await db.close();
  });

  it('enforces foreign keys', async () => {
    const db = await open();
    await migrate(db);
    await expect(
      db.run(
        `INSERT INTO memberships (group_id, contact_reference_id, active, created_at, updated_at)
         VALUES (999, 999, 1, '2026-01-01', '2026-01-01')`
      )
    ).rejects.toThrow();
    await db.close();
  });

  it('rolls back a failed transaction', async () => {
    const db = await open();
    await migrate(db);

    await expect(
      db.transaction(async () => {
        await db.run(
          `INSERT INTO groups (name, created_at, updated_at) VALUES ('Temp', '2026-01-01', '2026-01-01')`
        );
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const count = await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM groups');
    expect(count?.c).toBe(0);
    await db.close();
  });

  it('commits a successful transaction', async () => {
    const db = await open();
    await migrate(db);
    await db.transaction(async () => {
      await db.run(
        `INSERT INTO groups (name, created_at, updated_at) VALUES ('Kept', '2026-01-01', '2026-01-01')`
      );
    });
    expect((await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM groups'))?.c).toBe(1);
    await db.close();
  });

  // Blocked storage must not break the session (private windows, quota).
  it('works when IndexedDB is unavailable', async () => {
    const db = await open();
    await migrate(db);
    await db.run(
      `INSERT INTO groups (name, created_at, updated_at) VALUES ('NoIDB', '2026-01-01', '2026-01-01')`
    );
    // flush() swallows the persistence failure rather than propagating it.
    await expect(db.flush()).resolves.toBeUndefined();
    expect((await db.get<{ c: number }>('SELECT COUNT(*) AS c FROM groups'))?.c).toBe(1);
    await db.close();
  });
});

describe('the whole app runs on the web database', () => {
  // The real assurance: unchanged repositories and use cases, different engine.
  it('creates a group, schedules a cycle, and completes a reminder', async () => {
    const db = await open();
    await migrate(db);

    const clock = new FakeClock(START, 'UTC');
    const uow = new SqlUnitOfWork(db);
    const groups = new GroupUseCases(uow, clock);
    const schedules = new ScheduleUseCases(uow, clock);
    const scheduler = new RunScheduler(uow, clock, new SeededRandom(1));
    const reminders = new ReminderUseCases(uow, clock);

    const group = unwrap(await groups.create('Family'));
    for (let i = 1; i <= 4; i++) {
      unwrap(
        await groups.addMember(group.id, {
          phoneE164: `+4477009001${String(i).padStart(2, '0')}`,
          displayName: `Person ${i}`,
          nativeId: null, // web has no address book
        })
      );
    }

    unwrap(
      await schedules.create({
        groupId: group.id,
        peoplePerCycle: 1,
        cadence: 'weekly',
        intervalCount: 1,
        weekday: 0,
        monthDay: null,
        hour: 21,
        minute: 0,
      })
    );

    clock.set('2026-08-16T22:00:00.000Z');
    const run = await scheduler.run();
    expect(run.remindersCreated).toBe(1);

    const pending = await reminders.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].displayName).toMatch(/^Person \d$/);

    const completed = unwrap(await reminders.complete(pending[0].reminder.id));
    expect(completed.state).toBe('completed');
    expect(
      await uow.repositories.events.lastContactedAt(pending[0].reminder.contactReferenceId)
    ).not.toBeNull();

    await db.close();
  });

  it('stays idempotent on the web engine too', async () => {
    const db = await open();
    await migrate(db);

    const clock = new FakeClock(START, 'UTC');
    const uow = new SqlUnitOfWork(db);
    const groups = new GroupUseCases(uow, clock);
    const schedules = new ScheduleUseCases(uow, clock);
    const scheduler = new RunScheduler(uow, clock, new SeededRandom(1));

    const group = unwrap(await groups.create('Family'));
    unwrap(
      await groups.addMember(group.id, {
        phoneE164: '+447700900101',
        displayName: 'Ahmed',
        nativeId: null,
      })
    );
    unwrap(
      await schedules.create({
        groupId: group.id,
        peoplePerCycle: 1,
        cadence: 'weekly',
        intervalCount: 1,
        weekday: 0,
        monthDay: null,
        hour: 21,
        minute: 0,
      })
    );

    clock.set('2026-08-16T22:00:00.000Z');
    expect((await scheduler.run()).remindersCreated).toBe(1);
    expect((await scheduler.run()).remindersCreated).toBe(0);
    expect((await scheduler.run()).remindersCreated).toBe(0);
    expect(await uow.repositories.reminders.findPending()).toHaveLength(1);

    await db.close();
  });
});
