import type { SQLiteDatabase } from 'expo-sqlite';
import type { ReminderHistory, ReminderAction, RecordReminderInput } from '../../types/reminder';
import { nowISO } from '../database';

interface ReminderHistoryRow {
  id: number;
  circle_id: number;
  circle_person_id: number;
  suggested_at: string;
  action: string;
  completed_at: string | null;
}

function rowToHistory(row: ReminderHistoryRow): ReminderHistory {
  return {
    id: row.id,
    circleId: row.circle_id,
    circlePersonId: row.circle_person_id,
    suggestedAt: row.suggested_at,
    action: row.action as ReminderAction,
    completedAt: row.completed_at,
  };
}

export class ReminderHistoryRepository {
  constructor(private db: SQLiteDatabase) {}

  async record(input: RecordReminderInput): Promise<ReminderHistory> {
    const now = nowISO();
    const result = await this.db.runAsync(
      `INSERT INTO reminder_history (circle_id, circle_person_id, suggested_at, action, completed_at)
       VALUES (?, ?, ?, ?, NULL)`,
      [input.circleId, input.circlePersonId, now, input.action]
    );

    const history = await this.findById(result.lastInsertRowId);
    if (!history) throw new Error('Failed to record reminder history');
    return history;
  }

  async findById(id: number): Promise<ReminderHistory | null> {
    const row = await this.db.getFirstAsync<ReminderHistoryRow>(
      'SELECT * FROM reminder_history WHERE id = ?',
      [id]
    );
    return row ? rowToHistory(row) : null;
  }

  async markCompleted(id: number): Promise<void> {
    await this.db.runAsync(
      `UPDATE reminder_history SET action = 'completed', completed_at = ? WHERE id = ?`,
      [nowISO(), id]
    );
  }

  async markReplaced(id: number): Promise<void> {
    await this.db.runAsync(
      `UPDATE reminder_history SET action = 'replaced' WHERE id = ?`,
      [id]
    );
  }

  async markSkipped(id: number): Promise<void> {
    await this.db.runAsync(
      `UPDATE reminder_history SET action = 'skipped' WHERE id = ?`,
      [id]
    );
  }

  async findByCirclePersonId(personId: number): Promise<ReminderHistory[]> {
    const rows = await this.db.getAllAsync<ReminderHistoryRow>(
      `SELECT * FROM reminder_history WHERE circle_person_id = ? ORDER BY suggested_at DESC, id DESC`,
      [personId]
    );
    return rows.map(rowToHistory);
  }

  async findRecentByCircleId(
    circleId: number,
    limit: number = 10
  ): Promise<ReminderHistory[]> {
    const rows = await this.db.getAllAsync<ReminderHistoryRow>(
      `SELECT * FROM reminder_history WHERE circle_id = ? ORDER BY suggested_at DESC, id DESC LIMIT ?`,
      [circleId, limit]
    );
    return rows.map(rowToHistory);
  }

  async getLastSuggestedPersonId(circleId: number): Promise<number | null> {
    const row = await this.db.getFirstAsync<{ circle_person_id: number }>(
      `SELECT circle_person_id FROM reminder_history
       WHERE circle_id = ? AND action = 'shown'
       ORDER BY suggested_at DESC, id DESC LIMIT 1`,
      [circleId]
    );
    return row?.circle_person_id ?? null;
  }

  async deleteByCircleId(circleId: number): Promise<void> {
    await this.db.runAsync(
      'DELETE FROM reminder_history WHERE circle_id = ?',
      [circleId]
    );
  }
}
