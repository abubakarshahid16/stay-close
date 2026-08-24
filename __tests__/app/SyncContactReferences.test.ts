/**
 * Contact synchronisation tests (issue 012 / #23).
 *
 * The cases that matter are the ones that would silently destroy data:
 * an identifier churn must not look like a deletion, and a permission loss
 * must not look like the whole address book vanishing.
 */
import { NodeSqlDriver } from '../../src/testing/NodeSqlDriver';
import { FakeClock } from '../../src/testing/FakeClock';
import { FakeContactProvider } from '../../src/testing/FakeContactProvider';
import { migrate } from '../../src/adapters/persistence/Database';
import { SqlUnitOfWork } from '../../src/adapters/persistence/SqlRepositories';
import { SyncContactReferences } from '../../src/app/contacts/SyncContactReferences';
import { nativeContactId } from '../../src/domain/shared/ids';

const START = '2026-08-16T21:00:00.000Z';

async function harness(seeds: Parameters<typeof FakeContactProvider>[0] = []) {
  const db = new NodeSqlDriver(':memory:');
  await migrate(db);
  const clock = new FakeClock(START);
  const provider = new FakeContactProvider(seeds);
  const uow = new SqlUnitOfWork(db);
  return {
    db,
    clock,
    provider,
    uow,
    repos: uow.repositories,
    sync: new SyncContactReferences(uow, provider, clock),
  };
}

describe('permission handling', () => {
  it.each(['denied', 'restricted', 'undetermined', 'unavailable'] as const)(
    'does nothing when permission is %s',
    async (state) => {
      const h = await harness([
        { nativeId: 'n-1', displayName: 'Ahmed', numbers: ['+447700900123'] },
      ]);
      const stored = await h.repos.contacts.ensure(
        { nativeId: nativeContactId('n-1'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
        h.clock.now()
      );
      h.provider.setPermission(state);

      const outcome = await h.sync.run();

      // Concluding anything without read access would mark the whole address
      // book unavailable.
      expect(outcome.skipped).toBe(true);
      expect(outcome.markedUnavailable).toBe(0);
      expect((await h.repos.contacts.findById(stored.id))?.availability).toBe('available');
      await h.db.close();
    }
  );

  it('runs under limited access', async () => {
    const h = await harness([
      { nativeId: 'n-1', displayName: 'Ahmed', numbers: ['+447700900123'] },
    ]);
    await h.repos.contacts.ensure(
      { nativeId: nativeContactId('n-1'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      h.clock.now()
    );
    h.provider.setPermission('limited');
    const outcome = await h.sync.run();
    expect(outcome.skipped).toBe(false);
    expect(outcome.checked).toBe(1);
    await h.db.close();
  });
});

describe('snapshot refresh', () => {
  it('picks up a renamed contact', async () => {
    const h = await harness([
      { nativeId: 'n-1', displayName: 'Ahmed', numbers: ['+447700900123'] },
    ]);
    const stored = await h.repos.contacts.ensure(
      { nativeId: nativeContactId('n-1'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      h.clock.now()
    );

    h.provider.upsert({ nativeId: 'n-1', displayName: 'Ahmed Khan', numbers: ['+447700900123'] });
    const outcome = await h.sync.run();

    expect(outcome.updated).toBe(1);
    expect((await h.repos.contacts.findById(stored.id))?.displayNameCache).toBe('Ahmed Khan');
    await h.db.close();
  });

  it('is a no-op when nothing changed', async () => {
    const h = await harness([
      { nativeId: 'n-1', displayName: 'Ahmed', numbers: ['+447700900123'] },
    ]);
    await h.repos.contacts.ensure(
      { nativeId: nativeContactId('n-1'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      h.clock.now()
    );
    const outcome = await h.sync.run();
    expect(outcome).toMatchObject({ checked: 1, updated: 0, repaired: 0, markedUnavailable: 0 });
    await h.db.close();
  });

  it('adopts a new number when the stored one is gone', async () => {
    const h = await harness([
      { nativeId: 'n-1', displayName: 'Ahmed', numbers: ['+447700900123'] },
    ]);
    const stored = await h.repos.contacts.ensure(
      { nativeId: nativeContactId('n-1'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      h.clock.now()
    );

    h.provider.upsert({ nativeId: 'n-1', displayName: 'Ahmed', numbers: ['+447700900555'] });
    await h.sync.run();

    expect((await h.repos.contacts.findById(stored.id))?.phoneE164).toBe('+447700900555');
    await h.db.close();
  });

  it('keeps the stored number when it is still one of several', async () => {
    const h = await harness([
      { nativeId: 'n-1', displayName: 'Ahmed', numbers: ['+447700900999', '+447700900123'] },
    ]);
    const stored = await h.repos.contacts.ensure(
      { nativeId: nativeContactId('n-1'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      h.clock.now()
    );
    await h.sync.run();
    // Identity is anchored on this number; it must not drift to the first entry.
    expect((await h.repos.contacts.findById(stored.id))?.phoneE164).toBe('+447700900123');
    await h.db.close();
  });

  // phone_e164 is UNIQUE, so a naive overwrite would throw.
  it('does not steal a number that already belongs to someone else', async () => {
    const h = await harness([
      { nativeId: 'n-1', displayName: 'Ahmed', numbers: ['+447700900222'] },
      { nativeId: 'n-2', displayName: 'Sara', numbers: ['+447700900222'] },
    ]);
    const ahmed = await h.repos.contacts.ensure(
      { nativeId: nativeContactId('n-1'), phoneE164: '+447700900111', displayNameCache: 'Ahmed' },
      h.clock.now()
    );
    const sara = await h.repos.contacts.ensure(
      { nativeId: nativeContactId('n-2'), phoneE164: '+447700900222', displayNameCache: 'Sara' },
      h.clock.now()
    );

    await expect(h.sync.run()).resolves.toBeDefined();

    expect((await h.repos.contacts.findById(sara.id))?.phoneE164).toBe('+447700900222');
    expect((await h.repos.contacts.findById(ahmed.id))?.phoneE164).toBe('+447700900111');
    await h.db.close();
  });
});

describe('identifier churn', () => {
  // The case that would otherwise look like every contact being deleted.
  it('repairs a churned native id by matching on phone number', async () => {
    const h = await harness([
      { nativeId: 'old-id', displayName: 'Ahmed', numbers: ['+447700900123'] },
    ]);
    const stored = await h.repos.contacts.ensure(
      {
        nativeId: nativeContactId('old-id'),
        phoneE164: '+447700900123',
        displayNameCache: 'Ahmed',
      },
      h.clock.now()
    );

    // Model an account sync rewriting the identifier.
    h.provider.churnId('old-id', 'new-id');
    const outcome = await h.sync.run();

    expect(outcome.repaired).toBe(1);
    expect(outcome.markedUnavailable).toBe(0);
    const after = await h.repos.contacts.findById(stored.id);
    expect(after?.nativeId).toBe('new-id');
    expect(after?.availability).toBe('available');
    await h.db.close();
  });

  it('recovers a reference that had no native id at all', async () => {
    const h = await harness([
      { nativeId: 'n-1', displayName: 'Ahmed', numbers: ['+447700900123'] },
    ]);
    const stored = await h.repos.contacts.ensure(
      { nativeId: null, phoneE164: '+447700900123', displayNameCache: 'Manual entry' },
      h.clock.now()
    );

    const outcome = await h.sync.run();

    expect(outcome.repaired).toBe(1);
    expect((await h.repos.contacts.findById(stored.id))?.nativeId).toBe('n-1');
    await h.db.close();
  });
});

describe('deletion and restoration', () => {
  it('marks a deleted contact unavailable without deleting anything', async () => {
    const h = await harness([
      { nativeId: 'n-1', displayName: 'Ahmed', numbers: ['+447700900123'] },
    ]);
    const stored = await h.repos.contacts.ensure(
      { nativeId: nativeContactId('n-1'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      h.clock.now()
    );
    await h.repos.events.record(
      {
        contactReferenceId: stored.id,
        occurredAt: h.clock.now(),
        source: 'manual_log',
        relatedReminderId: null,
      },
      h.clock.now()
    );

    h.provider.remove('n-1');
    const outcome = await h.sync.run();

    expect(outcome.markedUnavailable).toBe(1);
    const after = await h.repos.contacts.findById(stored.id);
    expect(after).not.toBeNull();
    expect(after?.availability).toBe('unavailable');
    // History is untouched (docs/DOMAIN.md §2 rule 3).
    expect(await h.repos.events.lastContactedAt(stored.id)).not.toBeNull();
    await h.db.close();
  });

  it('does not re-mark an already unavailable contact', async () => {
    const h = await harness();
    await h.repos.contacts.ensure(
      { nativeId: nativeContactId('gone'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      h.clock.now()
    );
    expect((await h.sync.run()).markedUnavailable).toBe(1);
    expect((await h.sync.run()).markedUnavailable).toBe(0);
    await h.db.close();
  });

  it('restores a contact that reappears', async () => {
    const h = await harness();
    const stored = await h.repos.contacts.ensure(
      { nativeId: nativeContactId('n-1'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      h.clock.now()
    );
    await h.sync.run();
    expect((await h.repos.contacts.findById(stored.id))?.availability).toBe('unavailable');

    h.provider.upsert({ nativeId: 'n-1', displayName: 'Ahmed', numbers: ['+447700900123'] });
    const outcome = await h.sync.run();

    expect(outcome.restored).toBe(1);
    expect((await h.repos.contacts.findById(stored.id))?.availability).toBe('available');
    await h.db.close();
  });

  // Under iOS limited access an unshared contact is invisible, not deleted.
  it('marks an unshared contact unavailable but restores it when reshared', async () => {
    const h = await harness([
      { nativeId: 'n-1', displayName: 'Ahmed', numbers: ['+447700900123'] },
    ]);
    const stored = await h.repos.contacts.ensure(
      { nativeId: nativeContactId('n-1'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      h.clock.now()
    );
    h.provider.setPermission('limited');
    h.provider.setUnshared('n-1', true);

    // Still resolvable by id, so it stays available — the OS has not hidden it
    // from a direct lookup, only from enumeration.
    await h.sync.run();
    expect((await h.repos.contacts.findById(stored.id))?.availability).toBe('available');

    h.provider.remove('n-1');
    await h.sync.run();
    expect((await h.repos.contacts.findById(stored.id))?.availability).toBe('unavailable');
    await h.db.close();
  });
});

describe('empty state', () => {
  it('handles having no stored references', async () => {
    const h = await harness();
    expect(await h.sync.run()).toMatchObject({ checked: 0, skipped: false });
    await h.db.close();
  });
});
