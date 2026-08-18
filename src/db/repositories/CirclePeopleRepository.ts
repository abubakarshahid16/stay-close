import type { SQLiteDatabase } from 'expo-sqlite';
import type { CirclePerson, AddPersonInput } from '../../types/circle';
import { nowISO } from '../database';

interface CirclePersonRow {
  id: number;
  circle_id: number;
  contact_identifier: string;
  display_name: string;
  phone_number: string | null;
  created_at: string;
  updated_at: string;
  last_suggested_at: string | null;
  suggestion_count: number;
}

function rowToPerson(row: CirclePersonRow): CirclePerson {
  return {
    id: row.id,
    circleId: row.circle_id,
    contactIdentifier: row.contact_identifier,
    displayName: row.display_name,
    phoneNumber: row.phone_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSuggestedAt: row.last_suggested_at,
    suggestionCount: row.suggestion_count,
  };
}

export class CirclePeopleRepository {
  constructor(private db: SQLiteDatabase) {}

  async findByCircleId(circleId: number): Promise<CirclePerson[]> {
    const rows = await this.db.getAllAsync<CirclePersonRow>(
      'SELECT * FROM circle_people WHERE circle_id = ? ORDER BY display_name ASC',
      [circleId]
    );
    return rows.map(rowToPerson);
  }

  async findById(id: number): Promise<CirclePerson | null> {
    const row = await this.db.getFirstAsync<CirclePersonRow>(
      'SELECT * FROM circle_people WHERE id = ?',
      [id]
    );
    return row ? rowToPerson(row) : null;
  }

  async findByContactIdentifier(
    circleId: number,
    contactIdentifier: string
  ): Promise<CirclePerson | null> {
    const row = await this.db.getFirstAsync<CirclePersonRow>(
      'SELECT * FROM circle_people WHERE circle_id = ? AND contact_identifier = ?',
      [circleId, contactIdentifier]
    );
    return row ? rowToPerson(row) : null;
  }

  async add(input: AddPersonInput): Promise<CirclePerson> {
    const displayName = input.displayName.trim();
    if (!displayName) throw new Error('Display name cannot be empty');

    const now = nowISO();
    const result = await this.db.runAsync(
      `INSERT INTO circle_people
         (circle_id, contact_identifier, display_name, phone_number, created_at, updated_at,
          last_suggested_at, suggestion_count)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0)`,
      [input.circleId, input.contactIdentifier, displayName, input.phoneNumber ?? null, now, now]
    );

    const person = await this.findById(result.lastInsertRowId);
    if (!person) throw new Error('Failed to add person');
    return person;
  }

  async updateContactSnapshot(
    id: number,
    displayName: string,
    phoneNumber: string | null
  ): Promise<void> {
    const now = nowISO();
    await this.db.runAsync(
      `UPDATE circle_people SET display_name = ?, phone_number = ?, updated_at = ? WHERE id = ?`,
      [displayName.trim(), phoneNumber, now, id]
    );
  }

  async recordSuggestion(id: number, suggestedAt: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE circle_people
       SET last_suggested_at = ?,
           suggestion_count = suggestion_count + 1,
           updated_at = ?
       WHERE id = ?`,
      [suggestedAt, nowISO(), id]
    );
  }

  async remove(id: number): Promise<void> {
    await this.db.runAsync('DELETE FROM circle_people WHERE id = ?', [id]);
  }

  async removeByCircleId(circleId: number): Promise<void> {
    await this.db.runAsync('DELETE FROM circle_people WHERE circle_id = ?', [circleId]);
  }

  async countByCircleId(circleId: number): Promise<number> {
    const row = await this.db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM circle_people WHERE circle_id = ?',
      [circleId]
    );
    return row?.count ?? 0;
  }

  async getAllContactIdentifiersForCircle(circleId: number): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ contact_identifier: string }>(
      'SELECT contact_identifier FROM circle_people WHERE circle_id = ?',
      [circleId]
    );
    return rows.map((r) => r.contact_identifier);
  }
}
