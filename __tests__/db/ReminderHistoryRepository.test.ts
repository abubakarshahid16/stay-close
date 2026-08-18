/**
 * Database integration tests for ReminderHistoryRepository.
 * Uses a real in-memory SQLite database via better-sqlite3 test adapter.
 */
import { openTestDatabase, TestSQLiteDatabase } from '../../src/db/__tests__/sqlite-test-adapter';
import { CircleRepository } from '../../src/db/repositories/CircleRepository';
import { CirclePeopleRepository } from '../../src/db/repositories/CirclePeopleRepository';
import { ReminderHistoryRepository } from '../../src/db/repositories/ReminderHistoryRepository';
import type { Circle, CirclePerson } from '../../src/types/circle';

let db: TestSQLiteDatabase;
let historyRepo: ReminderHistoryRepository;
let circle: Circle;
let person: CirclePerson;

beforeEach(async () => {
  db = await openTestDatabase();
  const circleRepo = new CircleRepository(db as never);
  const peopleRepo = new CirclePeopleRepository(db as never);
  historyRepo = new ReminderHistoryRepository(db as never);

  circle = await circleRepo.create({ name: 'Family', reminderFrequency: 'weekly' });
  person = await peopleRepo.add({
    circleId: circle.id,
    contactIdentifier: 'fake-id-001',
    displayName: 'Alex Example',
    phoneNumber: null,
  });
});

afterEach(async () => {
  await db.closeAsync();
});

describe('ReminderHistoryRepository', () => {
  describe('record', () => {
    it('records a shown event', async () => {
      const h = await historyRepo.record({
        circleId: circle.id,
        circlePersonId: person.id,
        action: 'shown',
      });
      expect(h.id).toBeGreaterThan(0);
      expect(h.action).toBe('shown');
      expect(h.completedAt).toBeNull();
    });

    it('records completed, skipped, and replaced actions', async () => {
      for (const action of ['completed', 'skipped', 'replaced'] as const) {
        const h = await historyRepo.record({
          circleId: circle.id,
          circlePersonId: person.id,
          action,
        });
        expect(h.action).toBe(action);
      }
    });
  });

  describe('markCompleted', () => {
    it('marks a history entry as completed', async () => {
      const h = await historyRepo.record({
        circleId: circle.id,
        circlePersonId: person.id,
        action: 'shown',
      });
      await historyRepo.markCompleted(h.id);
      const updated = await historyRepo.findById(h.id);
      expect(updated?.action).toBe('completed');
      expect(updated?.completedAt).not.toBeNull();
    });
  });

  describe('markReplaced', () => {
    it('marks a history entry as replaced', async () => {
      const h = await historyRepo.record({
        circleId: circle.id,
        circlePersonId: person.id,
        action: 'shown',
      });
      await historyRepo.markReplaced(h.id);
      const updated = await historyRepo.findById(h.id);
      expect(updated?.action).toBe('replaced');
    });
  });

  describe('getLastSuggestedPersonId', () => {
    it('returns null when no history', async () => {
      const result = await historyRepo.getLastSuggestedPersonId(circle.id);
      expect(result).toBeNull();
    });

    it('returns most recently shown person id', async () => {
      await historyRepo.record({ circleId: circle.id, circlePersonId: person.id, action: 'shown' });
      const result = await historyRepo.getLastSuggestedPersonId(circle.id);
      expect(result).toBe(person.id);
    });
  });

  describe('findRecentByCircleId', () => {
    it('returns history in descending order', async () => {
      await historyRepo.record({ circleId: circle.id, circlePersonId: person.id, action: 'shown' });
      await historyRepo.record({ circleId: circle.id, circlePersonId: person.id, action: 'completed' });

      const history = await historyRepo.findRecentByCircleId(circle.id, 5);
      expect(history.length).toBe(2);
      // Most recent first
      expect(history[0].action).toBe('completed');
    });

    it('limits to specified count', async () => {
      for (let i = 0; i < 5; i++) {
        await historyRepo.record({ circleId: circle.id, circlePersonId: person.id, action: 'shown' });
      }
      const history = await historyRepo.findRecentByCircleId(circle.id, 3);
      expect(history.length).toBe(3);
    });
  });

  describe('findByCirclePersonId', () => {
    it('returns history for a specific person', async () => {
      await historyRepo.record({ circleId: circle.id, circlePersonId: person.id, action: 'shown' });
      await historyRepo.record({ circleId: circle.id, circlePersonId: person.id, action: 'completed' });
      const history = await historyRepo.findByCirclePersonId(person.id);
      expect(history.length).toBe(2);
    });

    it('returns empty array for person with no history', async () => {
      const history = await historyRepo.findByCirclePersonId(99999);
      expect(history).toHaveLength(0);
    });
  });
});
