import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  Circle,
  CreateCircleInput,
  UpdateCircleInput,
  ReminderFrequency,
} from '../../types/circle';
import { nowISO } from '../database';

interface CircleRow {
  id: number;
  name: string;
  reminder_frequency: string;
  created_at: string;
  updated_at: string;
}

function rowToCircle(row: CircleRow): Circle {
  return {
    id: row.id,
    name: row.name,
    reminderFrequency: row.reminder_frequency as ReminderFrequency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class CircleRepository {
  constructor(private db: SQLiteDatabase) {}

  async findAll(): Promise<Circle[]> {
    const rows = await this.db.getAllAsync<CircleRow>(
      'SELECT * FROM circles ORDER BY name ASC'
    );
    return rows.map(rowToCircle);
  }

  async findById(id: number): Promise<Circle | null> {
    const row = await this.db.getFirstAsync<CircleRow>(
      'SELECT * FROM circles WHERE id = ?',
      [id]
    );
    return row ? rowToCircle(row) : null;
  }

  async create(input: CreateCircleInput): Promise<Circle> {
    const name = input.name.trim();
    if (!name || name.length === 0) {
      throw new Error('Circle name cannot be empty');
    }
    if (name.length > 100) {
      throw new Error('Circle name cannot exceed 100 characters');
    }

    const now = nowISO();
    const result = await this.db.runAsync(
      `INSERT INTO circles (name, reminder_frequency, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [name, input.reminderFrequency, now, now]
    );

    const circle = await this.findById(result.lastInsertRowId);
    if (!circle) throw new Error('Failed to create circle');
    return circle;
  }

  async update(id: number, input: UpdateCircleInput): Promise<Circle> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Circle ${id} not found`);

    const name = input.name !== undefined ? input.name.trim() : existing.name;
    if (!name || name.length === 0) {
      throw new Error('Circle name cannot be empty');
    }
    if (name.length > 100) {
      throw new Error('Circle name cannot exceed 100 characters');
    }

    const frequency = input.reminderFrequency ?? existing.reminderFrequency;
    const now = nowISO();

    await this.db.runAsync(
      `UPDATE circles SET name = ?, reminder_frequency = ?, updated_at = ? WHERE id = ?`,
      [name, frequency, now, id]
    );

    const updated = await this.findById(id);
    if (!updated) throw new Error('Failed to update circle');
    return updated;
  }

  async delete(id: number): Promise<void> {
    await this.db.runAsync('DELETE FROM circles WHERE id = ?', [id]);
  }

  async count(): Promise<number> {
    const row = await this.db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM circles'
    );
    return row?.count ?? 0;
  }
}
