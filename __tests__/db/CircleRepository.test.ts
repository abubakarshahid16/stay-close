/**
 * Database integration tests for CircleRepository.
 * Uses a real in-memory SQLite database via better-sqlite3 test adapter.
 */
import { openTestDatabase, TestSQLiteDatabase } from '../../src/db/__tests__/sqlite-test-adapter';
import { CircleRepository } from '../../src/db/repositories/CircleRepository';
import { CirclePeopleRepository } from '../../src/db/repositories/CirclePeopleRepository';
import { ReminderHistoryRepository } from '../../src/db/repositories/ReminderHistoryRepository';

let db: TestSQLiteDatabase;
let repo: CircleRepository;

beforeEach(async () => {
  db = await openTestDatabase();
  repo = new CircleRepository(db as never);
});

afterEach(async () => {
  await db.closeAsync();
});

describe('CircleRepository', () => {
  describe('create', () => {
    it('creates a circle with valid input', async () => {
      const circle = await repo.create({ name: 'Family', reminderFrequency: 'weekly' });
      expect(circle.id).toBeGreaterThan(0);
      expect(circle.name).toBe('Family');
      expect(circle.reminderFrequency).toBe('weekly');
      expect(circle.createdAt).toBeTruthy();
    });

    it('trims whitespace from circle name', async () => {
      const circle = await repo.create({ name: '  Family  ', reminderFrequency: 'weekly' });
      expect(circle.name).toBe('Family');
    });

    it('rejects empty circle name', async () => {
      await expect(repo.create({ name: '', reminderFrequency: 'weekly' })).rejects.toThrow();
    });

    it('rejects whitespace-only name', async () => {
      await expect(repo.create({ name: '   ', reminderFrequency: 'weekly' })).rejects.toThrow();
    });

    it('rejects name exceeding 100 characters', async () => {
      await expect(
        repo.create({ name: 'A'.repeat(101), reminderFrequency: 'weekly' })
      ).rejects.toThrow('100 characters');
    });

    it('accepts all valid reminder frequencies', async () => {
      const frequencies = ['daily', 'every_3_days', 'weekly', 'every_2_weeks', 'monthly'] as const;
      for (const freq of frequencies) {
        const circle = await repo.create({ name: `Circle ${freq}`, reminderFrequency: freq });
        expect(circle.reminderFrequency).toBe(freq);
      }
    });

    it('accepts Unicode circle name', async () => {
      const circle = await repo.create({ name: 'عائلة', reminderFrequency: 'weekly' });
      expect(circle.name).toBe('عائلة');
    });

    it('accepts emoji in circle name', async () => {
      const circle = await repo.create({ name: 'Family 💙', reminderFrequency: 'weekly' });
      expect(circle.name).toBe('Family 💙');
    });
  });

  describe('findById', () => {
    it('returns circle by ID', async () => {
      const created = await repo.create({ name: 'Family', reminderFrequency: 'weekly' });
      const found = await repo.findById(created.id);
      expect(found?.name).toBe('Family');
    });

    it('returns null for non-existent ID', async () => {
      expect(await repo.findById(99999)).toBeNull();
    });
  });

  describe('findAll', () => {
    it('returns all circles sorted by name', async () => {
      await repo.create({ name: 'Work', reminderFrequency: 'monthly' });
      await repo.create({ name: 'Family', reminderFrequency: 'weekly' });
      await repo.create({ name: 'College Friends', reminderFrequency: 'every_2_weeks' });

      const circles = await repo.findAll();
      expect(circles.length).toBe(3);
      expect(circles[0].name).toBe('College Friends');
      expect(circles[1].name).toBe('Family');
      expect(circles[2].name).toBe('Work');
    });

    it('returns empty array when no circles exist', async () => {
      expect(await repo.findAll()).toEqual([]);
    });
  });

  describe('update', () => {
    it('updates circle name', async () => {
      const c = await repo.create({ name: 'Family', reminderFrequency: 'weekly' });
      const updated = await repo.update(c.id, { name: 'Close Family' });
      expect(updated.name).toBe('Close Family');
    });

    it('updates reminder frequency', async () => {
      const c = await repo.create({ name: 'Family', reminderFrequency: 'weekly' });
      const updated = await repo.update(c.id, { reminderFrequency: 'monthly' });
      expect(updated.reminderFrequency).toBe('monthly');
    });

    it('throws for non-existent circle', async () => {
      await expect(repo.update(99999, { name: 'Test' })).rejects.toThrow('not found');
    });

    it('rejects empty name on update', async () => {
      const c = await repo.create({ name: 'Family', reminderFrequency: 'weekly' });
      await expect(repo.update(c.id, { name: '' })).rejects.toThrow('cannot be empty');
    });
  });

  describe('delete', () => {
    it('deletes an existing circle', async () => {
      const c = await repo.create({ name: 'Family', reminderFrequency: 'weekly' });
      await repo.delete(c.id);
      expect(await repo.findById(c.id)).toBeNull();
    });

    it('cascade deletes circle_people', async () => {
      const circle = await repo.create({ name: 'Family', reminderFrequency: 'weekly' });
      const peopleRepo = new CirclePeopleRepository(db as never);
      await peopleRepo.add({
        circleId: circle.id,
        contactIdentifier: 'fake-id-001',
        displayName: 'Alex Example',
        phoneNumber: null,
      });

      await repo.delete(circle.id);
      expect(await peopleRepo.findByCircleId(circle.id)).toHaveLength(0);
    });

    it('cascade deletes reminder_history', async () => {
      const circle = await repo.create({ name: 'Family', reminderFrequency: 'weekly' });
      const peopleRepo = new CirclePeopleRepository(db as never);
      const historyRepo = new ReminderHistoryRepository(db as never);

      const person = await peopleRepo.add({
        circleId: circle.id,
        contactIdentifier: 'fake-id-001',
        displayName: 'Alex Example',
        phoneNumber: null,
      });
      await historyRepo.record({ circleId: circle.id, circlePersonId: person.id, action: 'shown' });

      await repo.delete(circle.id);
      expect(await historyRepo.findByCirclePersonId(person.id)).toHaveLength(0);
    });
  });

  describe('SQL injection protection', () => {
    it('handles SQL injection attempt in circle name safely', async () => {
      const malicious = "'); DROP TABLE circles; --";
      const circle = await repo.create({ name: malicious, reminderFrequency: 'weekly' });
      expect(circle.name).toBe(malicious);
      // Table still exists and is queryable
      const all = await repo.findAll();
      expect(all.length).toBeGreaterThan(0);
    });

    it('handles semicolon injection in circle name', async () => {
      const name = "Family; SELECT * FROM circles";
      const circle = await repo.create({ name, reminderFrequency: 'weekly' });
      expect(circle.name).toBe(name);
    });
  });
});
