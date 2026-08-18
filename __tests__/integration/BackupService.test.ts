/**
 * Integration test for BackupService.
 * Tests export and import using the better-sqlite3 test adapter.
 */
import { openTestDatabase, TestSQLiteDatabase } from '../../src/db/__tests__/sqlite-test-adapter';
import { CircleRepository } from '../../src/db/repositories/CircleRepository';
import { CirclePeopleRepository } from '../../src/db/repositories/CirclePeopleRepository';
import { BackupService } from '../../src/services/BackupService';

let db: TestSQLiteDatabase;
let circleRepo: CircleRepository;
let peopleRepo: CirclePeopleRepository;

beforeEach(async () => {
  db = await openTestDatabase();
  circleRepo = new CircleRepository(db as never);
  peopleRepo = new CirclePeopleRepository(db as never);
});

afterEach(async () => {
  await db.closeAsync();
});

describe('BackupService', () => {
  describe('export', () => {
    it('exports a valid JSON backup with circles and people', async () => {
      const circle = await circleRepo.create({ name: 'Family', reminderFrequency: 'weekly' });
      await peopleRepo.add({
        circleId: circle.id,
        contactIdentifier: 'test-id-001',
        displayName: 'Alex Example',
        phoneNumber: '+1 555 000 0001',
      });

      const service = new BackupService(db as never);
      const json = await service.exportToString();
      const data = JSON.parse(json);

      expect(data.schema_version).toBe(1);
      expect(data.exported_at).toBeTruthy();
      expect(data.circles).toHaveLength(1);
      expect(data.circles[0].name).toBe('Family');
      expect(data.circles[0].people).toHaveLength(1);
      expect(data.circles[0].people[0].display_name).toBe('Alex Example');
    });

    it('exports empty backup when no data', async () => {
      const service = new BackupService(db as never);
      const json = await service.exportToString();
      const data = JSON.parse(json);

      expect(data.schema_version).toBe(1);
      expect(data.circles).toHaveLength(0);
    });

    it('exports multiple circles', async () => {
      await circleRepo.create({ name: 'Family', reminderFrequency: 'weekly' });
      await circleRepo.create({ name: 'Friends', reminderFrequency: 'monthly' });

      const service = new BackupService(db as never);
      const json = await service.exportToString();
      const data = JSON.parse(json);

      expect(data.circles).toHaveLength(2);
    });
  });

  describe('import', () => {
    it('imports circles and people from a valid JSON string', async () => {
      // First export from a populated db
      const circle = await circleRepo.create({ name: 'Family', reminderFrequency: 'weekly' });
      await peopleRepo.add({
        circleId: circle.id,
        contactIdentifier: 'test-id-001',
        displayName: 'Alex Example',
        phoneNumber: null,
      });

      const service = new BackupService(db as never);
      const json = await service.exportToString();

      // Import into a fresh db
      const db2 = await openTestDatabase();
      const service2 = new BackupService(db2 as never);
      const circleRepo2 = new CircleRepository(db2 as never);
      const peopleRepo2 = new CirclePeopleRepository(db2 as never);

      await service2.importFromString(json);

      const circles = await circleRepo2.findAll();
      expect(circles).toHaveLength(1);
      expect(circles[0].name).toBe('Family');

      const people = await peopleRepo2.findByCircleId(circles[0].id);
      expect(people).toHaveLength(1);
      expect(people[0].displayName).toBe('Alex Example');

      await db2.closeAsync();
    });

    it('rejects invalid JSON', async () => {
      const service = new BackupService(db as never);
      await expect(service.importFromString('not json')).rejects.toThrow();
    });

    it('rejects missing schema_version', async () => {
      const service = new BackupService(db as never);
      await expect(
        service.importFromString(JSON.stringify({ circles: [] }))
      ).rejects.toThrow();
    });

    it('rejects wrong schema_version', async () => {
      const service = new BackupService(db as never);
      await expect(
        service.importFromString(JSON.stringify({ schema_version: 99, circles: [] }))
      ).rejects.toThrow();
    });

    it('import is atomic — rolls back on failure', async () => {
      const service = new BackupService(db as never);
      // Malformed people inside a circle
      const badBackup = JSON.stringify({
        schema_version: 1,
        exported_at: new Date().toISOString(),
        circles: [
          {
            name: 'Family',
            reminder_frequency: 'weekly',
            people: [
              {
                // Missing required display_name
                contact_identifier: 'test-001',
                phone_number: null,
              },
            ],
          },
        ],
      });

      await expect(service.importFromString(badBackup)).rejects.toThrow();
      // No circles should have been created
      const circles = await circleRepo.findAll();
      expect(circles).toHaveLength(0);
    });
  });
});
