import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';
import { CircleRepository } from '../db/repositories/CircleRepository';
import { CirclePeopleRepository } from '../db/repositories/CirclePeopleRepository';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { ReminderHistoryRepository } from '../db/repositories/ReminderHistoryRepository';
import { validateCircleName, validateReminderFrequency, MAX_BACKUP_FILE_SIZE_BYTES } from '../utils/validation';

const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_FILENAME = 'stay-close-backup.json';

export interface BackupData {
  schema_version: number;
  exported_at: string;
  circles: BackupCircle[];
  settings?: Record<string, string>;
}

interface BackupCircle {
  id: number;
  name: string;
  reminder_frequency: string;
  created_at: string;
  people: BackupPerson[];
}

interface BackupPerson {
  contact_identifier: string;
  display_name: string;
  phone_number: string | null;
  suggestion_count: number;
  last_suggested_at: string | null;
}

export class BackupService {
  constructor(private db: SQLiteDatabase) {}

  /** Build the JSON string in memory — testable without file I/O. */
  async exportToString(): Promise<string> {
    const circleRepo = new CircleRepository(this.db);
    const peopleRepo = new CirclePeopleRepository(this.db);
    const settingsRepo = new SettingsRepository(this.db);

    const circles = await circleRepo.findAll();
    const backupCircles: BackupCircle[] = [];

    for (const circle of circles) {
      const people = await peopleRepo.findByCircleId(circle.id);
      backupCircles.push({
        id: circle.id,
        name: circle.name,
        reminder_frequency: circle.reminderFrequency,
        created_at: circle.createdAt,
        people: people.map((p) => ({
          contact_identifier: p.contactIdentifier,
          display_name: p.displayName,
          phone_number: p.phoneNumber,
          suggestion_count: p.suggestionCount,
          last_suggested_at: p.lastSuggestedAt,
        })),
      });
    }

    const settings = await settingsRepo.getAll();
    const backup: BackupData = {
      schema_version: BACKUP_SCHEMA_VERSION,
      exported_at: new Date().toISOString(),
      circles: backupCircles,
      settings,
    };

    return JSON.stringify(backup, null, 2);
  }

  /** Import from a JSON string — testable without file I/O. */
  async importFromString(json: string): Promise<void> {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error('Backup file is not valid JSON');
    }
    this.validateBackupData(data);
    await this._restoreData(data as BackupData);
  }

  async export(): Promise<string> {
    const json = await this.exportToString();
    const path = `${FileSystem.documentDirectory}${BACKUP_FILENAME}`;
    await FileSystem.writeAsStringAsync(path, json, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return path;
  }

  async share(filePath?: string): Promise<void> {
    const path = filePath ?? (await this.export());
    const isAvailable = await Sharing.isAvailableAsync();
    if (isAvailable) {
      await Sharing.shareAsync(path, {
        mimeType: 'application/json',
        dialogTitle: 'Save Stay Close Backup',
      });
    }
  }

  async import(filePath: string): Promise<void> {
    // Size check
    const info = await FileSystem.getInfoAsync(filePath);
    if (info.exists && 'size' in info && (info.size as number) > MAX_BACKUP_FILE_SIZE_BYTES) {
      throw new Error('Backup file is too large');
    }

    // Read and parse
    const json = await FileSystem.readAsStringAsync(filePath, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error('Backup file is not valid JSON');
    }

    // Validate
    this.validateBackupData(data);
    const backup = data as BackupData;

    await this._restoreData(backup);
  }

  private async _restoreData(backup: BackupData): Promise<void> {
    const circleRepo = new CircleRepository(this.db);
    const peopleRepo = new CirclePeopleRepository(this.db);
    const settingsRepo = new SettingsRepository(this.db);
    const historyRepo = new ReminderHistoryRepository(this.db);

    await this.db.withTransactionAsync(async () => {
      // Clear existing data (cascade deletes circle_people + reminder_history)
      const existingCircles = await circleRepo.findAll();
      for (const c of existingCircles) {
        await historyRepo.deleteByCircleId(c.id);
        await peopleRepo.removeByCircleId(c.id);
        await circleRepo.delete(c.id);
      }
      await settingsRepo.deleteAll();

      // Restore circles and people
      for (const bc of backup.circles) {
        const circle = await circleRepo.create({
          name: bc.name,
          reminderFrequency: bc.reminder_frequency as Parameters<CircleRepository['create']>[0]['reminderFrequency'],
        });

        for (const bp of bc.people) {
          const person = await peopleRepo.add({
            circleId: circle.id,
            contactIdentifier: bp.contact_identifier,
            displayName: bp.display_name,
            phoneNumber: bp.phone_number,
          });

          // Restore suggestion metadata
          if (bp.suggestion_count > 0 && bp.last_suggested_at) {
            await this.db.runAsync(
              `UPDATE circle_people SET suggestion_count = ?, last_suggested_at = ? WHERE id = ?`,
              [bp.suggestion_count, bp.last_suggested_at, person.id]
            );
          }
        }
      }

      // Restore settings (optional field for compatibility)
      if (backup.settings) {
        for (const [key, value] of Object.entries(backup.settings)) {
          await settingsRepo.set(key, value);
        }
      }
    });
  }

  private validateBackupData(data: unknown): void {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid backup: not an object');
    }

    const d = data as Record<string, unknown>;

    if (!('schema_version' in d)) {
      throw new Error('Invalid backup: missing schema_version');
    }
    if (d['schema_version'] !== BACKUP_SCHEMA_VERSION) {
      throw new Error(`Unsupported backup version: ${d['schema_version']}`);
    }
    if (!Array.isArray(d['circles'])) {
      throw new Error('Invalid backup: circles must be an array');
    }
    if (d['settings'] !== undefined && (typeof d['settings'] !== 'object' || d['settings'] === null)) {
      throw new Error('Invalid backup: settings must be an object');
    }

    for (const circle of d['circles'] as unknown[]) {
      this.validateBackupCircle(circle);
    }
  }

  private validateBackupCircle(data: unknown): void {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid backup: circle must be an object');
    }
    const c = data as Record<string, unknown>;
    if (typeof c['name'] !== 'string') {
      throw new Error('Invalid backup: circle name must be a string');
    }
    const nameError = validateCircleName(c['name'] as string);
    if (nameError) throw new Error(`Invalid backup: ${nameError}`);

    if (typeof c['reminder_frequency'] !== 'string' ||
        !validateReminderFrequency(c['reminder_frequency'] as string)) {
      throw new Error('Invalid backup: invalid reminder_frequency');
    }
    if (!Array.isArray(c['people'])) {
      throw new Error('Invalid backup: circle people must be an array');
    }
    for (const person of c['people'] as unknown[]) {
      this.validateBackupPerson(person);
    }
  }

  private validateBackupPerson(data: unknown): void {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid backup: person must be an object');
    }
    const p = data as Record<string, unknown>;
    if (typeof p['contact_identifier'] !== 'string' || !p['contact_identifier']) {
      throw new Error('Invalid backup: person contact_identifier must be a non-empty string');
    }
    if (typeof p['display_name'] !== 'string' || !p['display_name'].trim()) {
      throw new Error('Invalid backup: person display_name must be a non-empty string');
    }
    if (p['suggestion_count'] !== undefined && typeof p['suggestion_count'] !== 'number') {
      throw new Error('Invalid backup: suggestion_count must be a number');
    }
  }
}
