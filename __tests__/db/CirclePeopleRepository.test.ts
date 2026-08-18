/**
 * Database integration tests for CirclePeopleRepository.
 * Uses a real in-memory SQLite database via better-sqlite3 test adapter.
 */
import { openTestDatabase, TestSQLiteDatabase } from '../../src/db/__tests__/sqlite-test-adapter';
import { CircleRepository } from '../../src/db/repositories/CircleRepository';
import { CirclePeopleRepository } from '../../src/db/repositories/CirclePeopleRepository';
import type { Circle } from '../../src/types/circle';

let db: TestSQLiteDatabase;
let circleRepo: CircleRepository;
let repo: CirclePeopleRepository;
let testCircle: Circle;

beforeEach(async () => {
  db = await openTestDatabase();
  circleRepo = new CircleRepository(db as never);
  repo = new CirclePeopleRepository(db as never);
  testCircle = await circleRepo.create({ name: 'Family', reminderFrequency: 'weekly' });
});

afterEach(async () => {
  await db.closeAsync();
});

describe('CirclePeopleRepository', () => {
  describe('add', () => {
    it('adds a person to a circle', async () => {
      const person = await repo.add({
        circleId: testCircle.id,
        contactIdentifier: 'fake-id-001',
        displayName: 'Alex Example',
        phoneNumber: '+1 555 000 0001',
      });

      expect(person.id).toBeGreaterThan(0);
      expect(person.circleId).toBe(testCircle.id);
      expect(person.displayName).toBe('Alex Example');
      expect(person.phoneNumber).toBe('+1 555 000 0001');
      expect(person.suggestionCount).toBe(0);
      expect(person.lastSuggestedAt).toBeNull();
    });

    it('adds a person with no phone number', async () => {
      const person = await repo.add({
        circleId: testCircle.id,
        contactIdentifier: 'fake-id-002',
        displayName: 'Jamie Example',
        phoneNumber: null,
      });
      expect(person.phoneNumber).toBeNull();
    });

    it('rejects empty display name', async () => {
      await expect(
        repo.add({
          circleId: testCircle.id,
          contactIdentifier: 'fake-id-003',
          displayName: '',
          phoneNumber: null,
        })
      ).rejects.toThrow('cannot be empty');
    });

    it('rejects duplicate contact_identifier in same circle', async () => {
      await repo.add({
        circleId: testCircle.id,
        contactIdentifier: 'fake-id-001',
        displayName: 'Alex Example',
        phoneNumber: null,
      });

      await expect(
        repo.add({
          circleId: testCircle.id,
          contactIdentifier: 'fake-id-001',
          displayName: 'Alex Example Again',
          phoneNumber: null,
        })
      ).rejects.toThrow();
    });

    it('allows same contact_identifier in different circles', async () => {
      const circle2 = await circleRepo.create({ name: 'Work', reminderFrequency: 'monthly' });

      const p1 = await repo.add({
        circleId: testCircle.id,
        contactIdentifier: 'fake-id-001',
        displayName: 'Alex Example',
        phoneNumber: null,
      });
      const p2 = await repo.add({
        circleId: circle2.id,
        contactIdentifier: 'fake-id-001',
        displayName: 'Alex Example',
        phoneNumber: null,
      });

      expect(p1.id).not.toBe(p2.id);
    });

    it('accepts Unicode display name', async () => {
      const person = await repo.add({
        circleId: testCircle.id,
        contactIdentifier: 'fake-id-unicode',
        displayName: '张伟',
        phoneNumber: null,
      });
      expect(person.displayName).toBe('张伟');
    });
  });

  describe('findByCircleId', () => {
    it('returns people for a circle sorted by name', async () => {
      await repo.add({ circleId: testCircle.id, contactIdentifier: 'fake-id-t', displayName: 'Taylor Example', phoneNumber: null });
      await repo.add({ circleId: testCircle.id, contactIdentifier: 'fake-id-a', displayName: 'Alex Example', phoneNumber: null });
      await repo.add({ circleId: testCircle.id, contactIdentifier: 'fake-id-j', displayName: 'Jamie Example', phoneNumber: null });

      const people = await repo.findByCircleId(testCircle.id);
      expect(people).toHaveLength(3);
      expect(people[0].displayName).toBe('Alex Example');
      expect(people[1].displayName).toBe('Jamie Example');
      expect(people[2].displayName).toBe('Taylor Example');
    });

    it('returns empty array for circle with no people', async () => {
      const people = await repo.findByCircleId(testCircle.id);
      expect(people).toEqual([]);
    });
  });

  describe('recordSuggestion', () => {
    it('increments suggestion_count and sets last_suggested_at', async () => {
      const person = await repo.add({
        circleId: testCircle.id,
        contactIdentifier: 'fake-id-001',
        displayName: 'Alex Example',
        phoneNumber: null,
      });

      const suggestedAt = '2024-06-01T09:00:00.000Z';
      await repo.recordSuggestion(person.id, suggestedAt);

      const updated = await repo.findById(person.id);
      expect(updated?.suggestionCount).toBe(1);
      expect(updated?.lastSuggestedAt).toBe(suggestedAt);

      // Record another suggestion
      await repo.recordSuggestion(person.id, '2024-06-08T09:00:00.000Z');
      const updated2 = await repo.findById(person.id);
      expect(updated2?.suggestionCount).toBe(2);
    });
  });

  describe('updateContactSnapshot', () => {
    it('updates display name and phone number', async () => {
      const person = await repo.add({
        circleId: testCircle.id,
        contactIdentifier: 'fake-id-001',
        displayName: 'Alex Example',
        phoneNumber: null,
      });

      await repo.updateContactSnapshot(person.id, 'Alex Updated Example', '+1 555 999 0000');
      const updated = await repo.findById(person.id);
      expect(updated?.displayName).toBe('Alex Updated Example');
      expect(updated?.phoneNumber).toBe('+1 555 999 0000');
    });
  });

  describe('remove', () => {
    it('removes a person from a circle', async () => {
      const person = await repo.add({
        circleId: testCircle.id,
        contactIdentifier: 'fake-id-001',
        displayName: 'Alex Example',
        phoneNumber: null,
      });

      await repo.remove(person.id);
      const found = await repo.findById(person.id);
      expect(found).toBeNull();
    });
  });

  describe('countByCircleId', () => {
    it('returns 0 for empty circle', async () => {
      expect(await repo.countByCircleId(testCircle.id)).toBe(0);
    });

    it('returns correct count', async () => {
      await repo.add({ circleId: testCircle.id, contactIdentifier: 'fake-id-001', displayName: 'Alex Example', phoneNumber: null });
      await repo.add({ circleId: testCircle.id, contactIdentifier: 'fake-id-002', displayName: 'Jamie Example', phoneNumber: null });
      expect(await repo.countByCircleId(testCircle.id)).toBe(2);
    });
  });
});
