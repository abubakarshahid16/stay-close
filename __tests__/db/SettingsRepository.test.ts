/**
 * Database integration tests for SettingsRepository.
 * Uses a real in-memory SQLite database via better-sqlite3 test adapter.
 */
import { openTestDatabase, TestSQLiteDatabase } from '../../src/db/__tests__/sqlite-test-adapter';
import { SettingsRepository } from '../../src/db/repositories/SettingsRepository';

let db: TestSQLiteDatabase;
let repo: SettingsRepository;

beforeEach(async () => {
  db = await openTestDatabase();
  repo = new SettingsRepository(db as never);
});

afterEach(async () => {
  await db.closeAsync();
});

describe('SettingsRepository', () => {
  it('sets and gets a value', async () => {
    await repo.set('test_key', 'test_value');
    const val = await repo.get('test_key');
    expect(val).toBe('test_value');
  });

  it('returns null for missing key', async () => {
    const val = await repo.get('nonexistent');
    expect(val).toBeNull();
  });

  it('updates existing value (upsert)', async () => {
    await repo.set('key', 'first');
    await repo.set('key', 'second');
    expect(await repo.get('key')).toBe('second');
  });

  it('deletes a key', async () => {
    await repo.set('key', 'value');
    await repo.delete('key');
    expect(await repo.get('key')).toBeNull();
  });

  it('deletes all settings', async () => {
    await repo.set('a', '1');
    await repo.set('b', '2');
    await repo.deleteAll();
    expect(await repo.get('a')).toBeNull();
    expect(await repo.get('b')).toBeNull();
  });

  describe('getAppSettings', () => {
    it('returns defaults when no settings stored', async () => {
      const settings = await repo.getAppSettings();
      expect(settings.notificationPrivacy).toBe('private');
      expect(settings.onboardingCompleted).toBe(false);
      expect(settings.contactsPermissionExplained).toBe(false);
    });

    it('reads stored notification privacy', async () => {
      await repo.setNotificationPrivacy('detailed');
      const settings = await repo.getAppSettings();
      expect(settings.notificationPrivacy).toBe('detailed');
    });

    it('reads onboarding completed', async () => {
      await repo.setOnboardingCompleted(true);
      const settings = await repo.getAppSettings();
      expect(settings.onboardingCompleted).toBe(true);
    });
  });
});
